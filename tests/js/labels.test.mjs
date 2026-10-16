import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLabelState,
  normalizeLabelStyle,
  normalizeLabelOverrides,
  normalizeTexts,
  createText,
  nextTextId,
  fontString,
  labelKey,
  resolveLabelStyle,
  setLabelOverride,
  FONTS,
  LABEL_KINDS,
  DEFAULT_LABEL_STYLE,
  DEFAULT_TEXT_SIZE,
} from '../../app/js/labels.js';

test('label state is visible by default', () => {
  const s = createLabelState();
  assert.equal(s.get(), true);
});

test('label state can be initialised hidden', () => {
  const s = createLabelState(false);
  assert.equal(s.get(), false);
});

test('toggle() flips visibility from true to false', () => {
  const s = createLabelState();
  const result = s.toggle();
  assert.equal(result, false);
  assert.equal(s.get(), false);
});

test('toggle() flips back to true on second call', () => {
  const s = createLabelState();
  s.toggle();
  s.toggle();
  assert.equal(s.get(), true);
});

test('toggle() returns the new state', () => {
  const s = createLabelState(false);
  assert.equal(s.toggle(), true);
  assert.equal(s.toggle(), false);
});

test('set(false) hides labels', () => {
  const s = createLabelState();
  s.set(false);
  assert.equal(s.get(), false);
});

test('set(true) shows labels', () => {
  const s = createLabelState(false);
  s.set(true);
  assert.equal(s.get(), true);
});

test('multiple instances are independent', () => {
  const a = createLabelState();
  const b = createLabelState();
  a.toggle();
  assert.equal(a.get(), false);
  assert.equal(b.get(), true);
});

// ── label style normalisation ────────────────────────────────────────────────

test('normalizeLabelStyle fills in the defaults for a missing style', () => {
  const st = normalizeLabelStyle(undefined);
  assert.equal(st.scale, DEFAULT_LABEL_STYLE.scale);
  assert.equal(st.font, DEFAULT_LABEL_STYLE.font);
  assert.equal(st.weight, DEFAULT_LABEL_STYLE.weight);
  assert.equal(st.italic, false);
  assert.equal(st.color, null);
  assert.equal(st.halo, DEFAULT_LABEL_STYLE.halo);
  for (const k of LABEL_KINDS) assert.equal(st.show[k], true);
});

test('normalizeLabelStyle keeps valid values', () => {
  const st = normalizeLabelStyle({
    scale: 2.5,
    font: 'Arial',
    weight: 700,
    italic: true,
    color: '#ff0000',
    halo: false,
    show: { zones: false },
  });
  assert.equal(st.scale, 2.5);
  assert.equal(st.font, 'Arial');
  assert.equal(st.weight, 700);
  assert.equal(st.italic, true);
  assert.equal(st.color, '#ff0000');
  assert.equal(st.halo, false);
  assert.equal(st.show.zones, false);
  assert.equal(st.show.racks, true); // untouched group falls back to the default
});

test('normalizeLabelStyle repairs nonsense without throwing', () => {
  const st = normalizeLabelStyle({
    scale: -3,
    font: '   ',
    weight: 123,
    color: '',
    show: { nodes: 'yes' },
  });
  assert.equal(st.scale, 1);
  assert.equal(st.font, DEFAULT_LABEL_STYLE.font);
  assert.equal(st.weight, DEFAULT_LABEL_STYLE.weight);
  assert.equal(st.color, null);
  assert.equal(st.show.nodes, true); // 'yes' is truthy
});

test('normalizeLabelStyle does not hand out the shared default show object', () => {
  const st = normalizeLabelStyle(null);
  st.show.zones = false;
  assert.equal(DEFAULT_LABEL_STYLE.show.zones, true);
});

// ── canvas font strings ──────────────────────────────────────────────────────

test('fontString quotes the family so names with spaces stay valid', () => {
  assert.equal(
    fontString({ font: 'Courier New', weight: 400, italic: false, sizePx: 16 }),
    '400 16px "Courier New", monospace',
  );
});

test('fontString includes italic before the weight', () => {
  assert.equal(
    fontString({ font: 'Arial', weight: 700, italic: true, sizePx: 12 }),
    'italic 700 12px "Arial", monospace',
  );
});

test('fontString clamps a non-positive size', () => {
  assert.equal(fontString({ font: 'Arial', weight: 400, sizePx: 0 }), '400 1px "Arial", monospace');
});

test('FONTS is a non-empty list of names', () => {
  assert.ok(FONTS.length > 0);
  assert.ok(FONTS.every((f) => typeof f === 'string' && f.length > 0));
});

// ── text objects ─────────────────────────────────────────────────────────────

test('createText starts from sensible defaults', () => {
  const t = createText({ id: 'TXT-1', x: 3, y: 4 });
  assert.equal(t.id, 'TXT-1');
  assert.equal(t.text, 'Text');
  assert.equal(t.x, 3);
  assert.equal(t.y, 4);
  assert.equal(t.size, DEFAULT_TEXT_SIZE);
  assert.equal(t.align, 'left');
  assert.equal(t.underline, false);
  assert.equal(t.highlight, null);
  assert.equal(typeof t.color, 'string');
});

test('createText lets the caller override any field', () => {
  const t = createText({ id: 'TXT-2', x: 0, y: 0, text: 'DOCK 3', size: 4, align: 'center' });
  assert.equal(t.text, 'DOCK 3');
  assert.equal(t.size, 4);
  assert.equal(t.align, 'center');
});

test('nextTextId returns the first free id', () => {
  assert.equal(nextTextId([]), 'TXT-1');
  assert.equal(nextTextId([{ id: 'TXT-1' }]), 'TXT-2');
  assert.equal(nextTextId([{ id: 'TXT-1' }, { id: 'TXT-2' }]), 'TXT-3');
});

test('nextTextId reuses a gap rather than counting up forever', () => {
  assert.equal(nextTextId([{ id: 'TXT-2' }]), 'TXT-1');
});

test('nextTextId tolerates junk entries', () => {
  assert.equal(nextTextId([null, {}, { id: 'TXT-1' }]), 'TXT-2');
});

test('normalizeTexts returns an empty list for non-arrays', () => {
  assert.deepEqual(normalizeTexts(null), []);
  assert.deepEqual(normalizeTexts('nope'), []);
});

test('normalizeTexts drops non-object entries and repairs the rest', () => {
  const out = normalizeTexts([
    'junk',
    null,
    { text: 'KEEP', x: '5', y: '6', size: 0, align: 'sideways', weight: 300 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'KEEP');
  assert.equal(out[0].x, 5);
  assert.equal(out[0].y, 6);
  assert.equal(out[0].size, DEFAULT_TEXT_SIZE);
  assert.equal(out[0].align, 'left');
  assert.equal(out[0].weight, 400);
  assert.equal(out[0].id, 'TXT-1');
});

test('normalizeTexts preserves a well-formed text unchanged in spirit', () => {
  const out = normalizeTexts([
    {
      id: 'TXT-7',
      text: 'FIRE EXIT',
      x: 1,
      y: 2,
      size: 3,
      font: 'Georgia',
      weight: 700,
      italic: true,
      underline: true,
      color: '#f00',
      highlight: '#ffe580',
      align: 'right',
    },
  ]);
  assert.deepEqual(out[0], {
    id: 'TXT-7',
    text: 'FIRE EXIT',
    x: 1,
    y: 2,
    size: 3,
    font: 'Georgia',
    weight: 700,
    italic: true,
    underline: true,
    color: '#f00',
    highlight: '#ffe580',
    align: 'right',
  });
});

// ── per-label keys and overrides ─────────────────────────────────────────────

test('labelKey is stable per label instance', () => {
  assert.equal(labelKey('zone', 'OFFICE'), 'zone:OFFICE');
  assert.equal(labelKey('rack', 'ROW-A'), 'rack:ROW-A');
  assert.equal(labelKey('node', 'N1'), 'node:N1');
});

test('labelKey distinguishes the bays of one row', () => {
  assert.equal(labelKey('bay', 'ROW-A', 0), 'bay:ROW-A#0');
  assert.notEqual(labelKey('bay', 'ROW-A', 1), labelKey('bay', 'ROW-A', 2));
});

test('resolveLabelStyle falls back to the shared defaults', () => {
  const st = resolveLabelStyle(DEFAULT_LABEL_STYLE, undefined);
  assert.equal(st.font, DEFAULT_LABEL_STYLE.font);
  assert.equal(st.weight, DEFAULT_LABEL_STYLE.weight);
  assert.equal(st.size, null); // null = automatic zoom-derived sizing
  assert.equal(st.underline, false);
  assert.equal(st.highlight, null);
  assert.equal(st.align, 'left');
});

test('resolveLabelStyle lets one label override any field', () => {
  const st = resolveLabelStyle(DEFAULT_LABEL_STYLE, {
    font: 'Georgia',
    size: 2,
    weight: 700,
    italic: true,
    underline: true,
    color: '#ff0000',
    highlight: '#ffe580',
    align: 'center',
  });
  assert.equal(st.font, 'Georgia');
  assert.equal(st.size, 2);
  assert.equal(st.weight, 700);
  assert.equal(st.italic, true);
  assert.equal(st.underline, true);
  assert.equal(st.color, '#ff0000');
  assert.equal(st.highlight, '#ffe580');
  assert.equal(st.align, 'center');
});

test('resolveLabelStyle ignores a nonsense override', () => {
  const st = resolveLabelStyle(DEFAULT_LABEL_STYLE, { size: -5, align: 'sideways', weight: 123 });
  assert.equal(st.size, null);
  assert.equal(st.align, 'left');
  assert.equal(st.weight, DEFAULT_LABEL_STYLE.weight);
});

test('setLabelOverride writes one field of one label', () => {
  const out = setLabelOverride({}, 'zone:OFFICE', 'font', 'Arial');
  assert.deepEqual(out, { 'zone:OFFICE': { font: 'Arial' } });
});

test('setLabelOverride does not mutate the input map', () => {
  const before = { 'zone:OFFICE': { font: 'Arial' } };
  const after = setLabelOverride(before, 'zone:DOCK', 'italic', true);
  assert.deepEqual(before, { 'zone:OFFICE': { font: 'Arial' } });
  assert.deepEqual(after, { 'zone:OFFICE': { font: 'Arial' }, 'zone:DOCK': { italic: true } });
});

test('setLabelOverride leaves other labels alone', () => {
  const map = { 'zone:OFFICE': { font: 'Arial' }, 'zone:DOCK': { font: 'Georgia' } };
  const out = setLabelOverride(map, 'zone:OFFICE', 'size', 3);
  assert.equal(out['zone:DOCK'].font, 'Georgia');
  assert.equal(out['zone:DOCK'].size, undefined);
});

test('setLabelOverride with null clears a field', () => {
  const map = { 'zone:OFFICE': { font: 'Arial', size: 3 } };
  const out = setLabelOverride(map, 'zone:OFFICE', 'size', null);
  assert.deepEqual(out, { 'zone:OFFICE': { font: 'Arial' } });
});

test('setLabelOverride drops an override once its last field is cleared', () => {
  const map = { 'zone:OFFICE': { font: 'Arial' } };
  assert.deepEqual(setLabelOverride(map, 'zone:OFFICE', 'font', null), {});
});

test('normalizeLabelOverrides tolerates junk', () => {
  assert.deepEqual(normalizeLabelOverrides(null), {});
  assert.deepEqual(normalizeLabelOverrides([1, 2]), {});
  assert.deepEqual(normalizeLabelOverrides({ 'zone:X': 'nope' }), {});
  assert.deepEqual(normalizeLabelOverrides({ 'zone:X': { size: -1, font: '' } }), {});
});

test('normalizeLabelOverrides keeps valid fields only', () => {
  const out = normalizeLabelOverrides({
    'zone:OFFICE': { font: 'Arial', size: '4', weight: 700, color: '#ff0000', align: 'center' },
    'zone:DOCK': { weight: 123, italic: true, color: 'red' },
  });
  assert.deepEqual(out['zone:OFFICE'], {
    font: 'Arial',
    size: 4,
    weight: 700,
    color: '#ff0000',
    align: 'center',
  });
  assert.deepEqual(out['zone:DOCK'], { italic: true });
});
