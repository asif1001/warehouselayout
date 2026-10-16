// cloudDocs.test.mjs — the pure cloud-document model: naming rules, the payload
// written to Firestore, and the small formatting helpers the dialog uses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MAX_DOC_BYTES,
  MAX_NAME,
  cleanName,
  cloudDoc,
  docBytes,
  docSummary,
  fitsInDoc,
  formatBytes,
  formatWhen,
  friendlyError,
  layoutFromDoc,
  nameError,
} from '../../app/js/cloudDocs.js';
import { fromDbConnect, toDbConnect } from '../../app/js/dbconnect.js';
import { migrate } from '../../app/js/migrations.js';
import { expandBins } from '../../app/js/geometry.js';

function defaultLayout() {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../app/data/default_layout.json', import.meta.url)), 'utf8'),
  );
  return fromDbConnect(migrate(raw));
}

// ── names ────────────────────────────────────────────────────────────────────

test('cleanName trims and collapses whitespace', () => {
  assert.equal(cleanName('  Rack   block  A '), 'Rack block A');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName(undefined), '');
});

test('nameError rejects empty, over-long and duplicate names', () => {
  assert.match(nameError(''), /name/i);
  assert.match(nameError('   '), /name/i);
  assert.match(nameError('x'.repeat(MAX_NAME + 1)), new RegExp(String(MAX_NAME)));
  assert.equal(nameError('North block', []), null);
  assert.match(nameError('north block', ['North Block']), /already saved/i);
  assert.equal(nameError('North block', ['South block']), null);
});

// ── the document ─────────────────────────────────────────────────────────────

test('cloudDoc stores the db_connect layout without the derived bins', () => {
  const state = defaultLayout();
  const { meta, data } = cloudDoc(state, '  Test   layout ');

  assert.equal(meta.name, 'Test layout');
  assert.equal(meta.schemaVersion, state.schemaVersion);
  assert.equal(meta.bytes, JSON.stringify(data).length);

  // Shape is the same as an export…
  assert.ok(Array.isArray(data.racks) && data.racks.length > 0);
  assert.ok(Array.isArray(data.zones) && data.zones.length > 0);
  assert.ok(data.editor && typeof data.editor === 'object');
  // …minus the generated bins, which are by far the biggest part.
  assert.deepEqual(data.bins, []);
  assert.ok(expandBins(state).length > 0, 'sanity: the layout does generate bins');
});

test('dropping bins makes a big saving and stays inside the Firestore limit', () => {
  const state = defaultLayout();
  const { meta, data } = cloudDoc(state, 'Default');

  const withBins = JSON.stringify(toDbConnect(state)).length;
  assert.ok(meta.bytes < withBins, 'the cloud document should be smaller than an export');
  assert.ok(fitsInDoc(data), `expected ${meta.bytes} bytes to fit`);
  assert.ok(meta.bytes < MAX_DOC_BYTES);
});

test('a payload over the limit is rejected', () => {
  const huge = { note: 'x'.repeat(MAX_DOC_BYTES + 10) };
  assert.equal(fitsInDoc(huge), false);
  assert.equal(fitsInDoc({ note: 'small' }), true);
  assert.equal(docBytes(huge), JSON.stringify(huge).length);
});

test('a cloud document round-trips back into editor state', () => {
  const state = defaultLayout();
  const { data } = cloudDoc(state, 'Round trip');
  const back = layoutFromDoc(data);

  assert.equal(back.racks.length, state.racks.length);
  assert.equal(back.zones.length, state.zones.length);
  assert.deepEqual(back.racks.map((r) => r.id).sort(), state.racks.map((r) => r.id).sort());
  // dir is editor-native and must survive the orientation round-trip.
  assert.deepEqual(
    back.racks.map((r) => r.dir),
    state.racks.map((r) => r.dir),
  );
  assert.deepEqual(back.binTypes, state.binTypes);
});

test('a cloud document keeps editor-only data (labels, texts, overrides)', () => {
  const state = defaultLayout();
  state.labelStyle = { ...state.labelStyle, color: '#ff0000', scale: 1.5 };
  state.texts = [{ id: 'T-1', text: 'Dock A', x: 1, y: 2, size: 3, color: '#fff' }];
  state.labelOverrides = { 'zone:MAIN': { size: 12 } };

  const back = layoutFromDoc(cloudDoc(state, 'Editor bits').data);
  assert.equal(back.labelStyle.color, '#ff0000');
  assert.equal(back.labelStyle.scale, 1.5);
  assert.equal(back.texts.length, 1);
  assert.equal(back.texts[0].text, 'Dock A');
  assert.deepEqual(back.labelOverrides, state.labelOverrides);
});

// ── list rows ────────────────────────────────────────────────────────────────

test('docSummary fills in what a metadata document may be missing', () => {
  const full = docSummary('abc', { name: 'North', bytes: 2048, schemaVersion: 7, updatedAt: 1234 });
  assert.deepEqual(full, { id: 'abc', name: 'North', bytes: 2048, schemaVersion: 7, updatedAt: 1234 });

  const bare = docSummary('xyz', undefined);
  assert.equal(bare.name, 'Untitled layout');
  assert.equal(bare.bytes, null);
  assert.equal(bare.schemaVersion, null);
  assert.equal(bare.updatedAt, null);

  assert.equal(docSummary('x', { name: '  A  ' }).name, 'A');
});

// ── formatting ───────────────────────────────────────────────────────────────

test('formatBytes scales to B, KB and MB', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 MB');
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(-1), '—');
});

test('formatWhen renders relative times from every timestamp shape', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(formatWhen(now - 5_000, now), 'just now');
  assert.equal(formatWhen(now - 5 * 60_000, now), '5 min ago');
  assert.equal(formatWhen(now - 3 * 3600_000, now), '3 h ago');
  assert.equal(formatWhen(now - 2 * 86400_000, now), '2 d ago');
  assert.equal(formatWhen(null, now), '—');
  // Firestore Timestamp shape, Date, and ISO string all resolve.
  assert.equal(formatWhen({ seconds: (now - 60_000) / 1000 }, now), '1 min ago');
  assert.equal(formatWhen({ toMillis: () => now - 3600_000 }, now), '1 h ago');
  assert.equal(formatWhen(new Date(now - 86400_000).toISOString(), now), '1 d ago');
});

test('friendlyError turns Firebase codes into readable text', () => {
  assert.match(friendlyError({ code: 'auth/unauthorized-domain' }), /Authorized domains/i);
  assert.match(friendlyError({ code: 'auth/invalid-credential' }), /Wrong email or password/i);
  assert.match(friendlyError({ code: 'firestore/permission-denied' }), /rules/i);
  assert.equal(friendlyError({ code: 'auth/weak-password' }), 'Passwords need at least 6 characters.');
  // Unknown codes fall through to the message, then to a generic line.
  assert.equal(friendlyError({ code: 'weird/thing', message: 'boom' }), 'boom');
  assert.equal(friendlyError({}), 'Something went wrong.');
  assert.equal(friendlyError(null), 'Something went wrong.');
});
