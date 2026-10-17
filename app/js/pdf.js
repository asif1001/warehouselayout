// pdf.js — a tiny PDF writer, just enough for a plotted sheet.
//
// Everything is drawn in millimetres with the origin at the TOP-LEFT (y down),
// which is how a sheet is laid out; the writer flips to PDF's bottom-left origin
// on the way out. Text uses the two base-14 Helvetica faces, so no font has to be
// embedded and the output stays small and vector-sharp.
//
// Supported: multi-page, text (left/centre/right, bold, colour), lines,
// polylines, filled/stroked rectangles, dashed strokes, and one JPEG image per
// call (a plan raster, when a sheet wants one).
//
// No dependencies: the file is assembled as byte chunks with a real xref table,
// so any reader — Acrobat, Chrome, Preview — opens it.

const PT_PER_MM = 72 / 25.4;

// Glyph widths per 1000 em, ASCII 32..126 (the standard Helvetica metrics).
// Needed for right/centre alignment and for fitting text into table cells.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278,
  556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584,
  556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556,
  333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// A few typographic characters that WinAnsi has and we actually use, so the
// sheets can say “3.0 × 2.4 m” and “m²” properly.
const WIN_ANSI = { '—': 0x97, '–': 0x96, '·': 0xb7, '×': 0xd7, '°': 0xb0, '²': 0xb2, '³': 0xb3, '±': 0xb1 };

// Turn a string into a PDF literal, ASCII-safe. Unknown characters degrade to
// '?' rather than corrupting the file.
function pdfString(str) {
  let out = '';
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    let byte = code;
    if (code > 126) byte = WIN_ANSI[ch] ?? 0x3f;
    if (byte === 0x28) out += '\\(';
    else if (byte === 0x29) out += '\\)';
    else if (byte === 0x5c) out += '\\\\';
    else out += String.fromCharCode(byte);
  }
  return out;
}

export function textWidthMm(str, sizeMm, bold = false) {
  const table = bold ? HELV_BOLD : HELV;
  let units = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    units += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (units / 1000) * sizeMm;
}

// Fit `str` into `maxMm`, adding an ellipsis when it has to be cut.
export function fitTextMm(str, sizeMm, maxMm, bold = false) {
  const s = String(str);
  if (textWidthMm(s, sizeMm, bold) <= maxMm) return s;
  let cut = s;
  while (cut.length > 1 && textWidthMm(cut + '…', sizeMm, bold) > maxMm) cut = cut.slice(0, -1);
  // '…' is not in WinAnsi above; fall back to three dots for the writer.
  return cut.trimEnd() + '...';
}

function hexColor(value) {
  if (Array.isArray(value)) return value;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value ?? ''));
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const f = (n) => (Math.round(n * 1000) / 1000).toString();

// ── document ────────────────────────────────────────────────────────────────

export function createDocument({
  title = 'Warehouse layout',
  author = '',
  subject = '',
  producer = 'Warehouse Layout Editor',
} = {}) {
  const pages = [];
  const meta = { title, author, subject, producer };

  function addPage({ widthMm = 420, heightMm = 297 } = {}) {
    const ops = [];
    const page = {
      width: widthMm,
      height: heightMm,
      ops,
      images: [],
      get widthPt() {
        return widthMm * PT_PER_MM;
      },
      get heightPt() {
        return heightMm * PT_PER_MM;
      },
      textWidth: textWidthMm,
      fit: fitTextMm,
      /** Draw text with its baseline at (x, y). */
      text(x, y, str, opts = {}) {
        const size = opts.size ?? 2.4;
        const bold = !!opts.bold;
        const color = hexColor(opts.color ?? '#000000');
        const s = String(str ?? '');
        if (!s) return page;
        let px = x;
        if (opts.align === 'center') px = x - textWidthMm(s, size, bold) / 2;
        else if (opts.align === 'right') px = x - textWidthMm(s, size, bold);
        const py = (heightMm - y) * PT_PER_MM;
        ops.push(
          `q ${f(color[0])} ${f(color[1])} ${f(color[2])} rg BT /${bold ? 'F2' : 'F1'} ${f(
            size * PT_PER_MM,
          )} Tf 1 0 0 1 ${f(px * PT_PER_MM)} ${f(py)} Tm (${pdfString(s)}) Tj ET Q`,
        );
        return page;
      },
      line(x1, y1, x2, y2, opts = {}) {
        const color = hexColor(opts.color ?? '#000000');
        const lw = (opts.width ?? 0.2) * PT_PER_MM;
        const dash = opts.dash ? `[${opts.dash.map((d) => f(d * PT_PER_MM)).join(' ')}] 0 d` : '[] 0 d';
        ops.push(
          `q ${f(color[0])} ${f(color[1])} ${f(color[2])} RG ${f(lw)} w ${dash} ${f(
            x1 * PT_PER_MM,
          )} ${f((heightMm - y1) * PT_PER_MM)} m ${f(x2 * PT_PER_MM)} ${f(
            (heightMm - y2) * PT_PER_MM,
          )} l S Q`,
        );
        return page;
      },
      polyline(points, opts = {}) {
        if (!points || points.length < 2) return page;
        const color = hexColor(opts.color ?? '#000000');
        const lw = (opts.width ?? 0.2) * PT_PER_MM;
        const parts = points.map(
          ([x, y], i) => `${f(x * PT_PER_MM)} ${f((heightMm - y) * PT_PER_MM)} ${i === 0 ? 'm' : 'l'}`,
        );
        ops.push(
          `q ${f(color[0])} ${f(color[1])} ${f(color[2])} RG ${f(lw)} w ${parts.join(' ')} ${
            opts.close ? 'h ' : ''
          }S Q`,
        );
        return page;
      },
      /** A filled and/or stroked polygon (also used for dots and circles). */
      polygon(points, opts = {}) {
        if (!points || points.length < 3) return page;
        const parts = points.map(
          ([x, y], i) => `${f(x * PT_PER_MM)} ${f((heightMm - y) * PT_PER_MM)} ${i === 0 ? 'm' : 'l'}`,
        );
        const fill = opts.fill ? hexColor(opts.fill) : null;
        const stroke = opts.color ? hexColor(opts.color) : null;
        const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
        let prefix = 'q ';
        if (fill) prefix += `${f(fill[0])} ${f(fill[1])} ${f(fill[2])} rg `;
        if (stroke)
          prefix += `${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} RG ${f((opts.width ?? 0.2) * PT_PER_MM)} w `;
        ops.push(`${prefix}${parts.join(' ')} h ${paint} Q`);
        return page;
      },
      rect(x, y, w, h, opts = {}) {
        if (!(w > 0) || !(h > 0)) return page;
        const px = x * PT_PER_MM;
        const py = (heightMm - y - h) * PT_PER_MM;
        const pw = w * PT_PER_MM;
        const ph = h * PT_PER_MM;
        const paint = opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S';
        let prefix = 'q ';
        if (opts.fill) {
          const c = hexColor(opts.fill);
          prefix += `${f(c[0])} ${f(c[1])} ${f(c[2])} rg `;
        }
        if (opts.stroke !== false) {
          const c = hexColor(opts.color ?? '#000000');
          prefix += `${f(c[0])} ${f(c[1])} ${f(c[2])} RG ${f((opts.width ?? 0.2) * PT_PER_MM)} w `;
        }
        ops.push(`${prefix}${f(px)} ${f(py)} ${f(pw)} ${f(ph)} re ${paint} Q`);
        return page;
      },
      /** Embed a JPEG data URL at (x, y), `w` × `h` mm, `px` = {width, height}. */
      image(dataUrl, x, y, w, h, px = {}) {
        const m = /^data:image\/jpe?g;base64,(.+)$/i.exec(String(dataUrl ?? ''));
        if (!m || !(w > 0) || !(h > 0)) return page;
        const bytes = base64ToBytes(m[1]);
        const name = 'Im' + (page.images.length + 1);
        page.images.push({
          name,
          bytes,
          width: Math.max(1, Math.round(px.width || 1)),
          height: Math.max(1, Math.round(px.height || 1)),
        });
        ops.push(
          `q ${f(w * PT_PER_MM)} 0 0 ${f(h * PT_PER_MM)} ${f(x * PT_PER_MM)} ${f(
            (heightMm - y - h) * PT_PER_MM,
          )} cm /${name} Do Q`,
        );
        return page;
      },
    };
    pages.push(page);
    return page;
  }

  function toBytes() {
    const chunks = [];
    let length = 0;
    const push = (data) => {
      const bytes = typeof data === 'string' ? latin1Bytes(data) : data;
      chunks.push(bytes);
      length += bytes.length;
      return bytes.length;
    };
    const offsets = [];
    let objectCount = 0;
    const startObject = () => {
      objectCount += 1;
      offsets[objectCount] = length;
      push(`${objectCount} 0 obj\n`);
      return objectCount;
    };
    const endObject = () => push('endobj\n');

    push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

    // 1 catalogue, 2 page tree, 3/4 fonts, then one page + its content + images each.
    const fontRegular = 3;
    const fontBold = 4;
    const firstPageObject = 5;
    const perPage = 2; // page + contents (images follow their page)

    // Reserve object numbers for images so page resources can reference them.
    const imageObjects = [];
    let nextImage = firstPageObject + pages.length * perPage;
    for (const page of pages) {
      page.imageRefs = page.images.map((img) => {
        const num = nextImage++;
        imageObjects.push({ num, img });
        return { ...img, num };
      });
    }
    const infoNum = nextImage++;

    startObject();
    push(`<< /Type /Catalog /Pages 2 0 R >>\n`);
    endObject();

    startObject();
    const kids = pages.map((_, i) => `${firstPageObject + i * perPage} 0 R`).join(' ');
    push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\n`);
    endObject();

    startObject();
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n`);
    endObject();

    startObject();
    push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n`);
    endObject();

    pages.forEach((page, i) => {
      const pageNum = firstPageObject + i * perPage;
      const contentNum = pageNum + 1;
      const xobjects = page.imageRefs.length
        ? ` /XObject << ${page.imageRefs.map((r) => `/${r.name} ${r.num} 0 R`).join(' ')} >>`
        : '';
      startObject();
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(page.widthPt)} ${f(
          page.heightPt,
        )}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xobjects} >> /Contents ${contentNum} 0 R >>\n`,
      );
      endObject();

      const stream = page.ops.join('\n');
      startObject();
      push(`<< /Length ${latin1Bytes(stream).length} >>\nstream\n`);
      push(stream);
      push('\nendstream\n');
      endObject();
    });

    for (const { num, img } of imageObjects) {
      offsets[num] = length;
      push(`${num} 0 obj\n`);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`,
      );
      push(img.bytes);
      push('\nendstream\nendobj\n');
    }

    startObject();
    push(
      `<< /Title <${hexString(meta.title)}> /Author <${hexString(meta.author)}> /Subject <${hexString(
        meta.subject,
      )}> /Producer <${hexString(meta.producer)}> >>\n`,
    );
    endObject();

    const xref = length;
    const total = objectCount + 1;
    let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) {
      table += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    push(table);
    push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const totalBytes = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(totalBytes);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  return { addPage, toBytes, pageCount: () => pages.length };
}

function hexString(str) {
  // UTF-16BE hex, the portable way to write a PDF text string.
  let out = '';
  for (const ch of String(str ?? '')) {
    out += ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  }
  return `FEFF${out}`;
}

function latin1Bytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node (the unit tests run the writer headlessly).
  const B = globalThis.Buffer;
  return new Uint8Array(B.from(b64, 'base64'));
}

export const mm = (metres, scaleDenominator) => (metres * 1000) / scaleDenominator;
