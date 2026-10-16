// labels.js — pure label state. Holds four things, all kept free of DOM/THREE
// imports so they stay unit-testable:
//   - the on/off visibility toggle (createLabelState)
//   - the shared default label style (font, size, colour, halo…)
//   - the per-label overrides that the Font toolbar edits (one label at a time)
//   - the factory + normalisers for free-standing text objects (the Text tool)

export function createLabelState(initial = true) {
  let visible = initial;
  return {
    get() {
      return visible;
    },
    toggle() {
      visible = !visible;
      return visible;
    },
    set(v) {
      visible = Boolean(v);
    },
  };
}

// Fonts offered in the Font toolbar. The first entry is the default.
export const FONTS = [
  'Consolas',
  'Courier New',
  'Segoe UI',
  'Arial',
  'Verdana',
  'Georgia',
  'Times New Roman',
];

// The automatic label groups the style can show/hide individually.
export const LABEL_KINDS = ['zones', 'racks', 'bays', 'nodes', 'fixtures'];

export const LABEL_WEIGHTS = { normal: 400, bold: 700 };

export const LABEL_ALIGNS = ['left', 'center', 'right'];

// Height in metres of a freshly placed text object.
export const DEFAULT_TEXT_SIZE = 1.6;

// Defaults applied to every automatic label *unless* that label carries an
// override of its own.
export const DEFAULT_LABEL_STYLE = {
  scale: 1, // size multiplier for the automatic zoom-derived sizing
  font: 'Consolas',
  weight: LABEL_WEIGHTS.normal, // 400 normal | 700 bold
  italic: false,
  color: null, // null keeps each label's built-in colour
  halo: true, // contrasting outline so text stays readable over the plan
  show: { zones: true, racks: true, bays: true, nodes: true, fixtures: true },
};

// Merge a partial (or dirty) base style from a loaded file with the defaults, so
// the renderer never has to guard each field.
export function normalizeLabelStyle(style) {
  const s = style && typeof style === 'object' ? style : {};
  const show = s.show && typeof s.show === 'object' ? s.show : {};
  const scale = Number(s.scale);
  const weight = Number(s.weight);
  const out = {
    scale: Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_LABEL_STYLE.scale,
    font: typeof s.font === 'string' && s.font.trim() ? s.font : DEFAULT_LABEL_STYLE.font,
    weight: weight === 400 || weight === 700 ? weight : DEFAULT_LABEL_STYLE.weight,
    italic: Boolean(s.italic),
    color: typeof s.color === 'string' && s.color ? s.color : null,
    halo: s.halo === undefined ? DEFAULT_LABEL_STYLE.halo : Boolean(s.halo),
    show: {},
  };
  for (const k of LABEL_KINDS) {
    out.show[k] = show[k] === undefined ? DEFAULT_LABEL_STYLE.show[k] : Boolean(show[k]);
  }
  return out;
}

// ── per-label overrides ───────────────────────────────────────────────────────
// Every automatic label has a stable key ("zone:OFFICE", "bay:ROW-A#2"). An
// entry in `labelOverrides` restyles *that one label*; the shared
// DEFAULT_LABEL_STYLE covers everything else.

export function labelKey(kind, id, bayIndex) {
  const base = `${kind}:${id}`;
  return kind === 'bay' ? `${base}#${bayIndex}` : base;
}

// The effective typography for one label: its override layered over the shared
// defaults. `size` is text height in metres, or null for the automatic
// zoom-derived sizing.
export function resolveLabelStyle(base, override) {
  const b = base && typeof base === 'object' ? base : DEFAULT_LABEL_STYLE;
  const o = override && typeof override === 'object' ? override : {};
  const size = Number(o.size);
  return {
    font: o.font || b.font || DEFAULT_LABEL_STYLE.font,
    size: Number.isFinite(size) && size > 0 ? size : null,
    weight: o.weight === 400 || o.weight === 700 ? o.weight : (b.weight ?? DEFAULT_LABEL_STYLE.weight),
    italic: o.italic === undefined ? Boolean(b.italic) : Boolean(o.italic),
    underline: Boolean(o.underline),
    color: o.color || b.color || null,
    highlight: o.highlight || null,
    align: LABEL_ALIGNS.includes(o.align) ? o.align : 'left',
  };
}

// Immutably set (or clear, with null/'') one field of one label's override.
// An override that ends up empty is dropped so files stay tidy.
export function setLabelOverride(overrides, key, field, value) {
  const next = { ...(overrides || {}) };
  const cur = { ...(next[key] || {}) };
  if (value === null || value === undefined || value === '') delete cur[field];
  else cur[field] = value;
  if (Object.keys(cur).length) next[key] = cur;
  else delete next[key];
  return next;
}

const isHexColour = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim());

// Defensive cleanup for overrides coming from a loaded/imported file.
export function normalizeLabelOverrides(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(map)) {
    if (!raw || typeof raw !== 'object') continue;
    const clean = {};
    if (typeof raw.font === 'string' && raw.font.trim()) clean.font = raw.font;
    const size = Number(raw.size);
    if (Number.isFinite(size) && size > 0) clean.size = size;
    if (raw.weight === 400 || raw.weight === 700) clean.weight = raw.weight;
    if (raw.italic !== undefined) clean.italic = Boolean(raw.italic);
    if (raw.underline !== undefined) clean.underline = Boolean(raw.underline);
    if (isHexColour(raw.color)) clean.color = raw.color;
    if (isHexColour(raw.highlight)) clean.highlight = raw.highlight;
    if (LABEL_ALIGNS.includes(raw.align)) clean.align = raw.align;
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

// ── canvas font strings ───────────────────────────────────────────────────────

// The canvas `font` string for a label, e.g. `italic 700 16px "Consolas", monospace`.
// The family is quoted because CSS font syntax needs it for names with spaces.
export function fontString({ font, weight = 400, italic = false, sizePx }) {
  const prefix = italic ? 'italic ' : '';
  const size = Math.max(1, sizePx);
  return `${prefix}${weight} ${size}px "${font}", monospace`;
}

// ── free-standing text objects ────────────────────────────────────────────────

// A free-standing text annotation. `x`,`y` is the anchor in world metres (the
// baseline start, middle or end depending on `align`); `size` is the text height
// in metres, so text scales with the plan instead of with the screen.
export function createText(fields = {}) {
  return {
    id: 'TXT-1',
    text: 'Text',
    x: 0,
    y: 0,
    size: DEFAULT_TEXT_SIZE,
    font: DEFAULT_LABEL_STYLE.font,
    weight: DEFAULT_LABEL_STYLE.weight,
    italic: DEFAULT_LABEL_STYLE.italic,
    underline: false,
    color: '#eef2f6',
    highlight: null,
    align: 'left',
    ...fields,
  };
}

// First unused TXT-n id, so ids stay stable and readable in the exported file.
export function nextTextId(texts) {
  const used = new Set((texts || []).map((t) => t && t.id));
  let i = 1;
  while (used.has('TXT-' + i)) i++;
  return 'TXT-' + i;
}

// Defensive cleanup for texts coming from a loaded/imported file.
export function normalizeTexts(texts) {
  if (!Array.isArray(texts)) return [];
  return texts
    .filter((t) => t && typeof t === 'object')
    .map((t, i) => {
      const size = Number(t.size);
      const x = Number(t.x);
      const y = Number(t.y);
      return {
        ...t,
        id: typeof t.id === 'string' && t.id ? t.id : 'TXT-' + (i + 1),
        text: typeof t.text === 'string' ? t.text : '',
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        size: Number.isFinite(size) && size > 0 ? size : DEFAULT_TEXT_SIZE,
        font: typeof t.font === 'string' && t.font ? t.font : DEFAULT_LABEL_STYLE.font,
        weight: t.weight === 700 ? 700 : 400,
        italic: Boolean(t.italic),
        underline: Boolean(t.underline),
        color: typeof t.color === 'string' && t.color ? t.color : '#eef2f6',
        highlight: typeof t.highlight === 'string' && t.highlight ? t.highlight : null,
        align: LABEL_ALIGNS.includes(t.align) ? t.align : 'left',
      };
    });
}
