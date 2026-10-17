// pdf.test.mjs — the minimal PDF writer: valid structure, text encoding, metrics.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, textWidthMm, fitTextMm } from '../../app/js/pdf.js';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

// Walk the xref table and confirm every object really starts where it claims.
function checkStructure(bytes) {
  const text = latin1(bytes);
  assert.ok(text.startsWith('%PDF-1.4'), 'PDF header');

  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  assert.ok(sx, 'startxref / EOF trailer');
  const xrefAt = Number(sx[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 4), 'xref', 'startxref points at the table');

  const table = /^xref\s+0 (\d+)\s+([\s\S]*?)trailer/.exec(text.slice(xrefAt));
  assert.ok(table, 'xref table parseable');
  const count = Number(table[1]);
  const rows = table[2].trim().split('\n');
  assert.equal(rows.length, count, 'xref row count matches /Size');

  for (let i = 1; i < count; i++) {
    const offset = Number(rows[i].slice(0, 10));
    assert.ok(offset > 0, `object ${i} has an offset`);
    assert.ok(
      text.slice(offset).startsWith(`${i} 0 obj`),
      `object ${i} is at its xref offset (got ${JSON.stringify(text.slice(offset, offset + 12))})`,
    );
  }
  return text;
}

test('a one-page document is structurally valid', () => {
  const doc = createDocument({ title: 'Test sheet' });
  const page = doc.addPage({ widthMm: 420, heightMm: 297 });
  page.text(10, 10, 'Hello');
  const text = checkStructure(doc.toBytes());

  assert.match(text, /\/Count 1/);
  assert.equal(doc.pageCount(), 1);
  assert.match(text, /\/MediaBox \[0 0 1190\.551 841\.89\]/);
  assert.match(text, /\/BaseFont \/Helvetica /);
  assert.match(text, /\/BaseFont \/Helvetica-Bold /);
});

test('multiple pages are counted and listed', () => {
  const doc = createDocument();
  for (let i = 0; i < 3; i++) doc.addPage({ widthMm: 297, heightMm: 210 });
  const text = checkStructure(doc.toBytes());
  assert.match(text, /\/Count 3/);
  assert.match(text, /\/Kids \[5 0 R 7 0 R 9 0 R\]/);
});

test('text is escaped and WinAnsi-mapped', () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.text(10, 10, 'Rack (A) \\ 3.0 × 2.4 m · 12 m²');
  const bytes = doc.toBytes();
  const text = latin1(bytes);

  assert.ok(text.includes('\\(A\\)'), 'parens escaped');
  assert.ok(text.includes('\\\\'), 'backslash escaped');
  // WinAnsi bytes for ×, ·, ².
  assert.ok(bytes.includes(0xd7), '× mapped to WinAnsi 0xd7');
  assert.ok(bytes.includes(0xb7), '· mapped to WinAnsi 0xb7');
  assert.ok(bytes.includes(0xb2), '² mapped to WinAnsi 0xb2');
});

test('an unknown glyph degrades to a question mark instead of corrupting', () => {
  const doc = createDocument();
  doc.addPage().text(10, 10, 'emoji 😀 here');
  const text = latin1(doc.toBytes());
  assert.ok(text.includes('emoji ? here'));
});

test('a JPEG image is embedded as a DCTDecode XObject', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x11]);
  const doc = createDocument();
  const page = doc.addPage();
  page.image(`data:image/jpeg;base64,${jpeg.toString('base64')}`, 10, 10, 50, 40, {
    width: 600,
    height: 480,
  });
  const text = checkStructure(doc.toBytes());
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/Width 600 \/Height 480/);
  assert.match(text, /\/Im1 Do/);
  assert.match(text, /\/XObject << \/Im1 \d+ 0 R >>/);
});

test('a non-JPEG data URL is ignored', () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.image('data:image/png;base64,AAAA', 0, 0, 10, 10, { width: 10, height: 10 });
  const text = checkStructure(doc.toBytes());
  assert.ok(!text.includes('/DCTDecode'));
});

test('Helvetica metrics drive alignment and fitting', () => {
  // 'A' is 667/1000 em in Helvetica, 722 in Bold.
  assert.ok(Math.abs(textWidthMm('A', 10) - 6.67) < 1e-6);
  assert.ok(Math.abs(textWidthMm('A', 10, true) - 7.22) < 1e-6);
  assert.equal(textWidthMm('', 10), 0);
  assert.ok(textWidthMm('MMMM', 2) > textWidthMm('IIII', 2));

  const long = 'a very long rack description that will not fit';
  const cut = fitTextMm(long, 2.4, 20);
  assert.ok(cut.endsWith('...'));
  assert.ok(textWidthMm(cut, 2.4) <= 20 + 1e-6, 'the cut string fits the cell');
  assert.equal(fitTextMm('short', 2.4, 60), 'short', 'short text is untouched');
});

test('degenerate geometry is dropped rather than written', () => {
  const doc = createDocument();
  const page = doc.addPage();
  page.rect(10, 10, 0, 5, { fill: '#000000' });
  page.rect(10, 10, -5, 5, { fill: '#000000' });
  page.line(0, 0, 0, 0);
  page.polyline([[0, 0]]);
  page.text(5, 5, '');
  const text = checkStructure(doc.toBytes());
  assert.ok(!text.includes(' re f'), 'no zero/negative rects painted');
});
