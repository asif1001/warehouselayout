// plot.js — turns a layout into an architectural drawing sheet: a bordered
// sheet with dimension chains on all four sides, a stacked title block (clear /
// ceiling heights, date, project, location, drawing title, drawing number,
// scale / drawn / checked / approved), a big underlined title band along the
// bottom, and optional measurement schedules on following sheets.
//
// Pure data in, pure model out, so sheets can be unit-tested without a DOM or a
// PDF writer.
//
// Everything is millimetres on paper. Every *label* — plan annotation, dimension
// text, table cell — is clamped to LABEL_MIN..LABEL_MAX (1–3 mm), so a busy plan
// still reads as a technical drawing. Only headings and the sheet title are
// larger, because they are not labels.

import { rackFootprint, rackAisle, expandBins, DEFAULT_RACK_AISLE } from './geometry.js';
import { normalizeLabelStyle } from './labels.js';
import { fixtureDef } from './fixtures.js';
import { textWidthMm } from './pdf.js';

export const LABEL_MIN = 1;
export const LABEL_MAX = 3;

export function clampLabel(mm) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return 2;
  return Math.min(LABEL_MAX, Math.max(LABEL_MIN, n));
}

// Sheet sizes, portrait first because a plan sheet is usually portrait.
export const SHEETS = {
  A3P: { name: 'A3 portrait', label: 'A3 portrait', w: 297, h: 420 },
  A3L: { name: 'A3 landscape', label: 'A3 landscape', w: 420, h: 297 },
  A4P: { name: 'A4 portrait', label: 'A4 portrait', w: 210, h: 297 },
  A4L: { name: 'A4 landscape', label: 'A4 landscape', w: 297, h: 210 },
  A2L: { name: 'A2 landscape', label: 'A2 landscape', w: 594, h: 420 },
};

export const SCALES = [
  50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000,
];

export const fmt = (n, d = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(d);
  // Trim trailing zeros only after a decimal point, so 1000 stays 1000.
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

// Dimension text: millimetres (the architectural convention) or metres.
export function dimText(metres, units = 'mm') {
  const m = Number(metres);
  if (!Number.isFinite(m)) return '—';
  return units === 'm' ? fmt(m, 2) : String(Math.round(m * 1000));
}

// ── geometry of the world ───────────────────────────────────────────────────

// Everything that will be drawn, in metres. Fixtures use their plan footprint.
export function layoutExtent(state) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y, w = 0, d = 0) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + d);
  };
  (state.zones || []).forEach((z) => add(z.x, z.y, z.w, z.d));
  (state.racks || []).forEach((r) => {
    const f = rackFootprint(r, state.binTypes);
    add(r.x, r.y, f.spanX, f.spanY);
  });
  (state.fixtures || []).forEach((f) => add(f.x - f.w / 2, f.y - f.d / 2, f.w, f.d));
  (state.nodes || []).forEach((n) => add(n.x, n.y, 0, 0));
  (state.texts || []).forEach((t) => add(t.x, t.y, 0, 0));
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 10, w: 10, d: 10 };
  return { minX, minY, maxX, maxY, w: Math.max(maxX - minX, 1), d: Math.max(maxY - minY, 1) };
}

// The largest standard scale that fits the drawing into the plan box. If even
// the smallest standard scale is too big, fall back to an exact fit so the
// drawing can never spill outside the sheet.
export function chooseScale(extent, box, padMm = 10) {
  const availW = Math.max(20, box.w - padMm * 2);
  const availH = Math.max(20, box.h - padMm * 2);
  const maxMmPerM = Math.min(availW / extent.w, availH / extent.d);
  const minDenom = 1000 / maxMmPerM;
  const denom = SCALES.find((s) => s >= minDenom);
  if (denom) {
    const mmPerM = 1000 / denom;
    return { denom, mmPerM, fits: true, standard: true };
  }
  const denomFit = Math.ceil(1000 / maxMmPerM);
  return { denom: denomFit, mmPerM: maxMmPerM, fits: true, standard: false };
}

// ── the sheet ───────────────────────────────────────────────────────────────

// Frame, drawing area, title block (bottom right) and title band (bottom left).
function sheetBoxes(sheet) {
  const M = 8; // outer margin
  const frame = { x: M, y: M, w: sheet.w - M * 2, h: sheet.h - M * 2 };
  // The title block is a column at the bottom right; the band runs along the
  // bottom of the space left of it.
  const blockW = Math.min(Math.max(96, frame.w * 0.34), 150);
  const blockH = Math.min(Math.max(84, frame.h * 0.235), 110);
  const bandH = Math.max(14, blockH * 0.17);
  const plan = {
    x: frame.x + 3,
    y: frame.y + 3,
    w: frame.w - blockW - 3,
    h: frame.h - bandH - 3,
  };
  const block = {
    x: frame.x + frame.w - blockW,
    y: frame.y + frame.h - blockH,
    w: blockW,
    h: blockH,
  };
  const band = {
    x: frame.x + 1,
    y: frame.y + frame.h - bandH + 1,
    w: frame.w - blockW - 2,
    h: bandH - 2,
  };
  return { frame, plan, block, band, blockW, blockH, bandH };
}

// ── dimensions ──────────────────────────────────────────────────────────────

// Collapse a list of break points so no segment is shorter than `minWorld`.
// The first and last are always kept.
export function chainBreaks(values, minWorld) {
  const sorted = [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (sorted.length < 2) return sorted;
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length - 1; i++) {
    if (sorted[i] - out[out.length - 1] >= minWorld) out.push(sorted[i]);
  }
  const last = sorted[sorted.length - 1];
  // Drop a second-to-last break that would crowd the overall extent.
  while (out.length > 1 && last - out[out.length - 1] < minWorld) out.pop();
  out.push(last);
  return out;
}

function tick(x, y) {
  // 45° tick, the surveying convention.
  const d = 0.7;
  return { t: 'line', x1: x - d, y1: y + d, x2: x + d, y2: y - d, w: 0.25, color: '#111111' };
}

/**
 * A chain of dimensions along one edge, plus an overall dimension further out.
 * `side` is 'bottom' | 'top' | 'left' | 'right'. `breaks` are the world
 * coordinates along that edge (x for top/bottom, y for left/right).
 */
function dimensionChain({ side, breaks, X, Y, extent, units, size }) {
  const items = [];
  const inset = 8; // chain line, mm outside the drawing
  const overallInset = 15;
  const s = clampLabel(size);
  const vertical = side === 'left' || side === 'right';
  if (breaks.length < 2) return items;

  // `along` is the position along the chain; the line itself sits at a fixed
  // coordinate across it, `chainPos`.
  const along = (v) => (vertical ? Y(v) : X(v));
  let chainPos;
  let dir;
  if (side === 'bottom') {
    chainPos = Y(extent.minY) + inset;
    dir = 1;
  } else if (side === 'top') {
    chainPos = Y(extent.maxY) - inset;
    dir = -1;
  } else if (side === 'left') {
    chainPos = X(extent.minX) - inset;
    dir = -1;
  } else {
    chainPos = X(extent.maxX) + inset;
    dir = 1;
  }
  const overallPos = chainPos + dir * (overallInset - inset);

  const seg = (a, b, pos) =>
    vertical
      ? { t: 'line', x1: pos, y1: a, x2: pos, y2: b, w: 0.18, color: '#111111' }
      : { t: 'line', x1: a, y1: pos, x2: b, y2: pos, w: 0.18, color: '#111111' };

  // Segments between consecutive breaks.
  for (let i = 0; i < breaks.length - 1; i++) {
    const a = along(breaks[i]);
    const b = along(breaks[i + 1]);
    items.push(seg(a, b, chainPos));
    items.push(vertical ? tick(chainPos, a) : tick(a, chainPos));
    items.push(vertical ? tick(chainPos, b) : tick(b, chainPos));
    const text = dimText(breaks[i + 1] - breaks[i], units);
    if (vertical) {
      items.push({
        t: 'text',
        x: chainPos - 1.1,
        y: (a + b) / 2,
        s: text,
        size: s,
        color: '#111111',
        align: 'center',
      });
    } else {
      items.push({
        t: 'text',
        x: (a + b) / 2,
        y: chainPos - 1.2,
        s: text,
        size: s,
        color: '#111111',
        align: 'center',
      });
    }
  }

  // Extension lines, from the drawing edge out past the chain.
  const edge =
    side === 'bottom'
      ? Y(extent.minY)
      : side === 'top'
        ? Y(extent.maxY)
        : side === 'left'
          ? X(extent.minX)
          : X(extent.maxX);
  for (const v of breaks) {
    const p = along(v);
    if (vertical) {
      items.push({ t: 'line', x1: edge, y1: p, x2: chainPos + dir * 2, y2: p, w: 0.12, color: '#666666' });
    } else {
      items.push({ t: 'line', x1: p, y1: edge, x2: p, y2: chainPos + dir * 2, w: 0.12, color: '#666666' });
    }
  }

  // Overall dimension.
  const a = along(breaks[0]);
  const b = along(breaks[breaks.length - 1]);
  const total = breaks[breaks.length - 1] - breaks[0];
  items.push({ ...seg(a, b, overallPos), w: 0.28 });
  items.push(vertical ? tick(overallPos, a) : tick(a, overallPos));
  items.push(vertical ? tick(overallPos, b) : tick(b, overallPos));
  items.push({
    t: 'text',
    x: vertical ? overallPos - 1.1 : (a + b) / 2,
    y: vertical ? (a + b) / 2 : overallPos - 1.2,
    s: dimText(total, units),
    size: clampLabel(s + 0.2),
    bold: true,
    color: '#111111',
    align: 'center',
  });
  return items;
}

// ── the model ───────────────────────────────────────────────────────────────

/**
 * Build the sheets for a layout.
 *
 * opts: {
 *   sheet: 'A3P' | 'A3L' | 'A4P' | 'A4L' | 'A2L',
 *   dimensions, grid, schedules, units: 'mm' | 'm',
 *   project, location, drawingTitle, drawingNo, date, revision,
 *   drawnBy, checkedBy, approvedBy, clearHeightMm, ceilingHeightMm,
 *   title (band), scale (forced denominator)
 * }
 */
export function buildSheetModel(state, opts = {}) {
  const sheet = SHEETS[opts.sheet] ?? SHEETS.A3P;
  const boxes = sheetBoxes(sheet);
  const extent = layoutExtent(state);
  const units = opts.units === 'm' ? 'm' : 'mm';
  // Reserve the dimension chains around the drawing.
  const inner = { x: boxes.plan.x + 18, y: boxes.plan.y + 18, w: boxes.plan.w - 36, h: boxes.plan.h - 36 };
  const scale = opts.scale
    ? { denom: opts.scale, mmPerM: 1000 / opts.scale, fits: true }
    : chooseScale(extent, inner, 0);
  const ls = normalizeLabelStyle(state.labelStyle);
  const show = ls.show || {};
  const withDims = opts.dimensions !== false;
  const withGrid = !!opts.grid;
  const withSchedules = opts.schedules !== false;

  const drawW = extent.w * scale.mmPerM;
  const drawH = extent.d * scale.mmPerM;
  const ox = inner.x + (inner.w - drawW) / 2;
  const oy = inner.y + (inner.h - drawH) / 2;
  const X = (x) => ox + (x - extent.minX) * scale.mmPerM;
  const Y = (y) => oy + (extent.maxY - y) * scale.mmPerM; // north is up

  const items = [];
  const label = (mm) => clampLabel(mm);
  const SIZE = label(2.4);
  const SMALL = label(1.6);
  const TINY = label(1.4);

  // Grid, behind everything.
  if (withGrid) {
    const step = extent.w * scale.mmPerM > 260 ? 10 : 5;
    for (let x = Math.ceil(extent.minX / step) * step; x <= extent.maxX; x += step) {
      items.push({
        t: 'line',
        x1: X(x),
        y1: Y(extent.maxY),
        x2: X(x),
        y2: Y(extent.minY),
        w: 0.1,
        color: '#e2e6ea',
      });
    }
    for (let y = Math.ceil(extent.minY / step) * step; y <= extent.maxY; y += step) {
      items.push({
        t: 'line',
        x1: X(extent.minX),
        y1: Y(y),
        x2: X(extent.maxX),
        y2: Y(y),
        w: 0.1,
        color: '#e2e6ea',
      });
    }
  }

  // Zones: light poché with a firm outline, the way a plan is drawn.
  (state.zones || []).forEach((z) => {
    items.push({
      t: 'rect',
      x: X(z.x),
      y: Y(z.y + z.d),
      w: z.w * scale.mmPerM,
      h: z.d * scale.mmPerM,
      fill: z.color || '#8b96a2',
      opacity: 0.07,
      stroke: '#39434f',
      w2: 0.3,
    });
    if (show.zones !== false) {
      items.push({
        t: 'text',
        x: X(z.x) + 1.6,
        y: Y(z.y + z.d) + 4,
        s: String(z.id).toUpperCase(),
        size: SIZE,
        bold: true,
        color: '#101418',
      });
      items.push({
        t: 'text',
        x: X(z.x) + 1.6,
        y: Y(z.y + z.d) + 4 + SIZE + 1,
        s: `${fmt(z.w, 2)} × ${fmt(z.d, 2)} m · ${fmt(z.w * z.d, 1)} m²`,
        size: SMALL,
        color: '#39434f',
      });
    }
  });

  // Rack rows: outlined, bay divisions, token and bay/level count.
  (state.racks || []).forEach((r) => {
    const t = state.binTypes?.[r.type] || { w: 3, d: 1, h: 6 };
    const fp = rackFootprint(r, state.binTypes);
    const x = X(r.x);
    const y = Y(r.y + fp.spanY);
    const w = fp.spanX * scale.mmPerM;
    const h = fp.spanY * scale.mmPerM;
    items.push({ t: 'rect', x, y, w, h, fill: '#ffffff', stroke: '#101418', w2: 0.3 });
    for (let b = 1; b < r.bays; b++) {
      if (r.dir === 'E') {
        items.push({
          t: 'line',
          x1: x + b * t.w * scale.mmPerM,
          y1: y,
          x2: x + b * t.w * scale.mmPerM,
          y2: y + h,
          w: 0.14,
          color: '#101418',
        });
      } else {
        items.push({
          t: 'line',
          x1: x,
          y1: y + h - b * t.w * scale.mmPerM,
          x2: x + w,
          y2: y + h - b * t.w * scale.mmPerM,
          w: 0.14,
          color: '#101418',
        });
      }
    }
    if (show.racks !== false) {
      const horizontal = r.dir === 'E';
      const tx = horizontal ? x + 0.9 : x + w / 2;
      const ty = horizontal ? y + h / 2 + SIZE / 2 : y + h + 3.4;
      items.push({
        t: 'text',
        x: tx,
        y: ty,
        s: r.rowToken || r.id,
        size: SIZE,
        bold: true,
        color: '#101418',
        align: horizontal ? 'left' : 'center',
      });
      if (Math.max(w, h) > 10) {
        items.push({
          t: 'text',
          x: horizontal ? tx : x + w / 2,
          y: horizontal ? ty + SIZE + 0.9 : ty + TINY + 1,
          s: `${r.bays} × ${r.levels} · ${fmt(t.w, 1)}×${fmt(t.d, 1)} m`,
          size: TINY,
          color: '#39434f',
          align: horizontal ? 'left' : 'center',
        });
      }
    }
  });

  // Paths, nodes, equipment and free text.
  (state.edges || []).forEach((ed) => {
    const a = (state.nodes || []).find((n) => n.id === ed.a);
    const b = (state.nodes || []).find((n) => n.id === ed.b);
    if (!a || !b) return;
    items.push({
      t: 'line',
      x1: X(a.x),
      y1: Y(a.y),
      x2: X(b.x),
      y2: Y(b.y),
      w: 0.25,
      color: ed.ramp ? '#b8791f' : '#5c6672',
      dash: ed.ramp ? [1.5, 1] : null,
    });
  });
  (state.nodes || []).forEach((n) => {
    items.push({ t: 'circle', x: X(n.x), y: Y(n.y), r: 0.8, fill: '#d4453a', stroke: '#5a1d18', w: 0.15 });
  });
  (state.fixtures || []).forEach((f) => {
    const def = fixtureDef(f.kind);
    if (!def) return;
    const q = f.rot === 90 || f.rot === 270;
    const fw = (q ? f.d : f.w) * scale.mmPerM;
    const fh = (q ? f.w : f.d) * scale.mmPerM;
    const fx = X(f.x - (q ? f.d : f.w) / 2);
    const fy = Y(f.y + (q ? f.w : f.d) / 2);
    items.push({
      t: 'rect',
      x: fx,
      y: fy,
      w: fw,
      h: fh,
      fill: def.color,
      opacity: 0.12,
      stroke: '#39434f',
      w2: 0.2,
    });
    if (show.fixtures !== false && Math.max(fw, fh) > 8) {
      items.push({
        t: 'text',
        x: fx + fw / 2,
        y: fy + fh / 2 + TINY / 2,
        s: def.label,
        size: TINY,
        color: '#1b222a',
        align: 'center',
      });
    }
  });
  (state.texts || []).forEach((tx) => {
    items.push({
      t: 'text',
      x: X(tx.x),
      y: Y(tx.y),
      s: tx.text || '',
      size: clampLabel((tx.size || 1.6) * scale.mmPerM),
      bold: tx.weight === 700,
      color: tx.color || '#1b222a',
    });
  });

  // Dimension chains, two tiers on every side.
  if (withDims) {
    const minSeg = 9 / scale.mmPerM; // never draw a segment narrower than 9 mm
    const xs = [];
    const ys = [];
    (state.zones || []).forEach((z) => {
      xs.push(z.x, z.x + z.w);
      ys.push(z.y, z.y + z.d);
    });
    (state.racks || []).forEach((r) => {
      const fp = rackFootprint(r, state.binTypes);
      xs.push(r.x, r.x + fp.spanX);
      ys.push(r.y, r.y + fp.spanY);
    });
    xs.push(extent.minX, extent.maxX);
    ys.push(extent.minY, extent.maxY);
    const xBreaks = chainBreaks(xs, minSeg);
    const yBreaks = chainBreaks(ys, minSeg);
    const ctx = { X, Y, plan: boxes.plan, extent, units, size: 1.7 };
    items.push(...dimensionChain({ ...ctx, side: 'bottom', breaks: xBreaks }));
    items.push(...dimensionChain({ ...ctx, side: 'top', breaks: xBreaks }));
    items.push(...dimensionChain({ ...ctx, side: 'left', breaks: yBreaks }));
    items.push(...dimensionChain({ ...ctx, side: 'right', breaks: yBreaks }));
  }

  // ── schedules ─────────────────────────────────────────────────────
  const zones = (state.zones || []).map((z) => ({
    cells: [
      z.id,
      fmt(z.x, 2),
      fmt(z.y, 2),
      fmt(z.w, 2),
      fmt(z.d, 2),
      fmt(z.w * z.d, 1),
      fmt(z.elev ?? 0, 2),
      fmt(z.clearH ?? 0, 2),
    ],
    sort: z.id,
  }));
  const racks = (state.racks || []).map((r) => {
    const t = state.binTypes?.[r.type] || { w: 0, d: 0, h: 0 };
    const fp = rackFootprint(r, state.binTypes);
    const aisle = rackAisle(r, state.settings?.aisle ?? DEFAULT_RACK_AISLE);
    const len = r.dir === 'E' ? fp.spanX : fp.spanY;
    return {
      cells: [
        r.rowToken || r.id,
        r.type,
        r.dir,
        String(r.bays),
        String(r.levels),
        `${fmt(t.w, 2)}×${fmt(t.d, 2)}×${fmt(t.h, 2)}`,
        fmt(aisle, 2),
        fmt(fp.depth + aisle, 2),
        fmt(r.x, 2),
        fmt(r.y, 2),
        fmt(len, 2),
        String(r.bays * r.levels),
      ],
      sort: r.rowToken || r.id,
    };
  });
  const bins = expandBins(state);
  const fixtureCounts = new Map();
  (state.fixtures || []).forEach((f) => {
    const def = fixtureDef(f.kind);
    const name = def ? def.label : f.kind;
    fixtureCounts.set(name, (fixtureCounts.get(name) || 0) + 1);
  });
  const equipment = [...fixtureCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, n]) => ({ cells: [name, String(n)] }));

  const grossArea = (state.zones || []).reduce((n, z) => n + z.w * z.d, 0);
  const totals = [
    ['Zones', String((state.zones || []).length)],
    ['Rack rows', String((state.racks || []).length)],
    ['Bays', String((state.racks || []).reduce((n, r) => n + (r.bays || 0), 0))],
    ['Pallet positions', String(bins.length)],
    ['Equipment items', String((state.fixtures || []).length)],
    ['Floor area (zones)', `${fmt(grossArea, 0)} m²`],
    ['Overall extent', `${fmt(extent.w, 2)} × ${fmt(extent.d, 2)} m`],
  ];

  const scheduleDefs = [
    {
      key: 'zones',
      title: 'Zone schedule',
      columns: [
        { h: 'Zone', w: 0.2, a: 'left' },
        { h: 'X (m)', w: 0.09, a: 'right' },
        { h: 'Y (m)', w: 0.09, a: 'right' },
        { h: 'Width', w: 0.1, a: 'right' },
        { h: 'Depth', w: 0.1, a: 'right' },
        { h: 'Area m²', w: 0.11, a: 'right' },
        { h: 'Floor', w: 0.09, a: 'right' },
        { h: 'Clear ht', w: 0.11, a: 'right' },
      ],
      rows: zones,
    },
    {
      key: 'racks',
      title: 'Rack schedule',
      columns: [
        { h: 'Row', w: 0.09, a: 'left' },
        { h: 'Type', w: 0.09, a: 'left' },
        { h: 'Dir', w: 0.05, a: 'center' },
        { h: 'Bays', w: 0.06, a: 'right' },
        { h: 'Lv', w: 0.05, a: 'right' },
        { h: 'Bin W×D×H (m)', w: 0.16, a: 'right' },
        { h: 'Aisle', w: 0.07, a: 'right' },
        { h: 'Pitch', w: 0.07, a: 'right' },
        { h: 'X', w: 0.07, a: 'right' },
        { h: 'Y', w: 0.07, a: 'right' },
        { h: 'Length', w: 0.08, a: 'right' },
        { h: 'Pos.', w: 0.06, a: 'right' },
      ],
      rows: racks,
    },
    {
      key: 'equipment',
      title: 'Equipment schedule',
      columns: [
        { h: 'Element', w: 0.75, a: 'left' },
        { h: 'Qty', w: 0.25, a: 'right' },
      ],
      rows: equipment,
    },
  ];

  const tallest = (state.zones || []).reduce((n, z) => Math.max(n, Number(z.clearH) || 0), 0);
  const clearMm =
    Number(opts.clearHeightMm) > 0 ? Number(opts.clearHeightMm) : Math.round((tallest || 3) * 1000);
  const ceilingMm =
    Number(opts.ceilingHeightMm) > 0 ? Number(opts.ceilingHeightMm) : Math.max(0, clearMm - 400);
  const drawingTitle = opts.drawingTitle || 'Warehouse layout plan';
  const project = opts.project || state.meta?.name || 'Warehouse';

  return {
    sheet,
    boxes,
    extent,
    scale,
    units,
    labels: { min: LABEL_MIN, max: LABEL_MAX, base: SIZE, small: SMALL, tiny: TINY },
    meta: {
      project,
      location: opts.location || '',
      drawingTitle,
      drawingNo: opts.drawingNo || '',
      date: opts.date || new Date().toISOString().slice(0, 10),
      revision: opts.revision || 'A',
      drawnBy: opts.drawnBy || '',
      checkedBy: opts.checkedBy || '',
      approvedBy: opts.approvedBy || '',
      clearHeightMm: clearMm,
      ceilingHeightMm: ceilingMm,
      // The two headings allowed to exceed the label band.
      bandText: [opts.title || drawingTitle, project].filter(Boolean).join(' — ').toUpperCase(),
      scheduleHeading: `${drawingTitle} — schedules`.toUpperCase(),
      plottedBy: 'Warehouse Layout Editor',
    },
    planItems: items,
    totalMm: { w: drawW, h: drawH },
    schedules: { defs: scheduleDefs, totals, withSchedules },
    stats: {
      zones: (state.zones || []).length,
      racks: (state.racks || []).length,
      bins: bins.length,
      equipment: (state.fixtures || []).length,
      area: grossArea,
    },
  };
}

// ── rendering ───────────────────────────────────────────────────────────────

const INK = '#101418';
const DIM = '#5c6672';
const RULE = '#6b7683';

function wrapText(str, sizeMm, maxMm, maxLines = 3) {
  const words = String(str ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (!line || textWidthMm(test, sizeMm, true) <= maxMm) line = test;
    else {
      lines.push(line);
      line = w;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function circlePoints(cx, cy, r, n = 16) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// Mix a colour with paper white. Translucent fills are printed as a solid tint.
export function tint(color, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color ?? '#ffffff'));
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  const mix = (c) => Math.round(255 - (255 - c) * a);
  const hex = (v) => v.toString(16).padStart(2, '0');
  return `#${hex(mix((n >> 16) & 255))}${hex(mix((n >> 8) & 255))}${hex(mix(n & 255))}`;
}

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso);
}

// Title block rows, sized as fractions of the block so it scales with the sheet.
const BLOCK_ROWS = [
  { key: 'height', frac: 0.15 },
  { key: 'date', frac: 0.1 },
  { key: 'project', frac: 0.22 },
  { key: 'location', frac: 0.15 },
  { key: 'drawingTitle', frac: 0.15 },
  { key: 'drawingNo', frac: 0.11 },
  { key: 'signoff', frac: 0.12 },
];

export function titleBlockRows(model) {
  const { block } = model.boxes;
  const m = model.meta;
  return BLOCK_ROWS.map((r) => {
    const h = block.h * r.frac;
    if (r.key === 'height') {
      return {
        key: r.key,
        h,
        label: '',
        lines: [`CLEAR HEIGHT  +${m.clearHeightMm}`, `PROPOSED CEILING HEIGHT  +${m.ceilingHeightMm}`],
      };
    }
    if (r.key === 'date') return { key: r.key, h, label: '', lines: [`DATE :  ${formatDate(m.date)}`] };
    if (r.key === 'project') return { key: r.key, h, label: 'PROJECT', lines: [m.project] };
    if (r.key === 'location') return { key: r.key, h, label: 'PROJECT LOCATION', lines: [m.location || '—'] };
    if (r.key === 'drawingTitle') return { key: r.key, h, label: 'DRAWING TITLE', lines: [m.drawingTitle] };
    if (r.key === 'drawingNo') return { key: r.key, h, label: 'DRAWING No.', lines: [m.drawingNo || '—'] };
    return { key: r.key, h, label: '', lines: [] };
  });
}

function drawTitleBlock(page, model, sheetNo, sheetTotal) {
  const { block } = model.boxes;
  const rows = titleBlockRows(model);
  page.rect(block.x, block.y, block.w, block.h, { stroke: INK, width: 0.5, fill: '#ffffff' });
  let y = block.y;
  for (const row of rows) {
    if (row.key === 'signoff') break;
    page.rect(block.x, y, block.w, row.h, { stroke: RULE, width: 0.25 });
    const pad = 2.6;
    if (row.label) {
      page.text(block.x + pad, y + 4, row.label, { size: clampLabel(1.7), bold: true, color: DIM });
      const lines = wrapText(row.lines[0], 2.6, block.w - pad * 2, 2);
      lines.forEach((ln, i) => {
        page.text(block.x + pad, y + 8.6 + i * 3.6, ln, { size: clampLabel(2.6), bold: true, color: INK });
      });
    } else {
      const size = row.key === 'height' ? 2.4 : 2.6;
      row.lines.forEach((ln, i) => {
        page.text(block.x + pad, y + 4.6 + i * 4.2, ln, { size: clampLabel(size), bold: true, color: INK });
      });
    }
    y += row.h;
  }

  // Sign-off strip: SCALE | DRAWN BY | CHECKED BY | APPROVED BY.
  const signoff = rows[rows.length - 1];
  const cols = [
    { label: 'SCALE', value: `1:${model.scale.denom}` },
    { label: 'DRAWN BY', value: model.meta.drawnBy },
    { label: 'CHECKED BY', value: model.meta.checkedBy },
    { label: 'APPROVED BY', value: model.meta.approvedBy },
  ];
  let x = block.x;
  const cw = block.w / cols.length;
  cols.forEach((c, i) => {
    page.rect(x, y, cw, signoff.h, { stroke: RULE, width: 0.25 });
    page.text(x + 1.6, y + 3.6, c.label, { size: clampLabel(1.5), color: DIM });
    page.text(x + 1.6, y + 7.6, c.value || ' ', { size: clampLabel(2.3), bold: true, color: INK });
    x += cw;
    if (i === cols.length - 1) {
      page.text(block.x + block.w - 2, y + signoff.h - 2, `SHEET ${sheetNo} / ${sheetTotal}`, {
        size: clampLabel(1.5),
        color: DIM,
        align: 'right',
      });
    }
  });
}

function drawTitleBand(page, model) {
  const { band } = model.boxes;
  const text = model.meta.bandText;
  let size = 4.4;
  while (size > 2.6 && textWidthMm(text, size, true) > band.w - 8) size -= 0.2;
  const cx = band.x + band.w / 2;
  const cy = band.y + band.h * 0.66;
  page.text(cx, cy, text, { size, bold: true, color: INK, align: 'center' });
  const w = textWidthMm(text, size, true);
  page.line(cx - w / 2, cy + 1.4, cx + w / 2, cy + 1.4, { width: 0.4, color: INK });
}

function drawNorthArrow(page, x, y, r) {
  page.polygon(
    [
      [x, y - r],
      [x + r * 0.42, y + r * 0.6],
      [x, y + r * 0.28],
      [x - r * 0.42, y + r * 0.6],
    ],
    { fill: '#ffffff', color: INK, width: 0.25 },
  );
  page.line(x, y - r, x, y + r * 0.28, { width: 0.2, color: INK });
  page.text(x, y - r - 1.6, 'N', { size: clampLabel(2.6), bold: true, color: INK, align: 'center' });
}

function drawLegend(page, model, x, y) {
  const sw = 3.6;
  const rowH = 5;
  const rows = [
    { kind: 'rect', fill: '#8b96a2', opacity: 0.07, label: 'Zone / floor area' },
    { kind: 'rect', fill: '#ffffff', opacity: 1, label: 'Rack row (bays divided)' },
    { kind: 'line', label: 'Path edge', color: '#5c6672' },
    { kind: 'line', label: 'Ramp / incline', color: '#b8791f', dash: [1.5, 1] },
    { kind: 'dot', label: 'Path node' },
    { kind: 'rect', fill: '#c9a86a', opacity: 0.12, label: 'Equipment' },
  ];
  page.text(x, y, 'LEGEND', { size: clampLabel(2.4), bold: true, color: INK });
  let yy = y + 4.6;
  for (const r of rows) {
    if (r.kind === 'rect') {
      page.rect(x, yy, sw, 2.8, { fill: tint(r.fill, r.opacity), stroke: '#39434f', width: 0.18 });
    } else if (r.kind === 'line') {
      page.line(x, yy + 1.4, x + sw, yy + 1.4, { width: 0.3, color: r.color, dash: r.dash });
    } else {
      page.polygon(circlePoints(x + sw / 2, yy + 1.4, 1.2), {
        fill: '#d4453a',
        color: '#5a1d18',
        width: 0.15,
      });
    }
    page.text(x + sw + 2.2, yy + 2.1, r.label, { size: clampLabel(2), color: INK });
    yy += rowH;
  }
  return yy;
}

function drawFrame(page, model) {
  const { frame } = model.boxes;
  page.rect(frame.x, frame.y, frame.w, frame.h, { stroke: INK, width: 0.7 });
  page.rect(frame.x + 2, frame.y + 2, frame.w - 4, frame.h - 4, { stroke: INK, width: 0.25 });
}

function drawPlanPage(page, model, sheetNo, sheetTotal) {
  const { plan } = model.boxes;

  // Drawing area border (thin, inside the frame).
  page.rect(plan.x, plan.y, plan.w, plan.h, { stroke: RULE, width: 0.2 });

  for (const it of model.planItems) {
    if (it.t === 'line') {
      page.line(it.x1, it.y1, it.x2, it.y2, { width: it.w, color: it.color, dash: it.dash });
    } else if (it.t === 'rect') {
      page.rect(it.x, it.y, it.w, it.h, {
        fill: it.opacity !== undefined ? tint(it.fill, it.opacity) : it.fill,
        stroke: it.stroke !== false,
        color: it.stroke,
        width: it.w2,
      });
    } else if (it.t === 'circle') {
      page.polygon(circlePoints(it.x, it.y, it.r), { fill: it.fill, color: it.stroke, width: it.w ?? 0.15 });
    } else if (it.t === 'text') {
      page.text(it.x, it.y, it.s, {
        size: it.size,
        bold: it.bold,
        color: it.color,
        align: it.align,
      });
    }
  }

  // North arrow in the spare corner, and the legend when there is room for it.
  const right = plan.x + plan.w;
  drawNorthArrow(page, right - 12, plan.y + 14, 6);
  const freeW = plan.w - model.totalMm.w - 4;
  const freeH = plan.h - model.totalMm.h - 4;
  if (freeW > 52 && freeH > 60) {
    drawLegend(page, model, right - 46, plan.y + 30);
  }

  drawFrame(page, model);
  drawTitleBand(page, model);
  drawTitleBlock(page, model, sheetNo, sheetTotal);
}

// ── schedules ───────────────────────────────────────────────────────────────

const SCHED_ROW_H = 4.4;
const SCHED_HEAD_H = 6;
const SCHED_GAP = 7;

export const scheduleMetrics = (model) => {
  const { block, plan } = model.boxes;
  const top = plan.y + 10;
  const bottom = block.y - 6;
  return {
    top,
    bottom,
    height: Math.max(20, bottom - top),
    rowH: SCHED_ROW_H,
    headH: SCHED_HEAD_H,
    gap: SCHED_GAP,
    width: plan.w + model.boxes.block.w - 10,
  };
};

const totalsHeight = (model, m) => 4.6 + Math.ceil(model.schedules.totals.length / 2) * 4.4 + m.gap;

/**
 * Flow the schedules onto pages. Each page is a list of items to draw, so a long
 * zone or rack list spills onto continuation sheets instead of running into the
 * title block.
 */
export function schedulePages(model) {
  if (!model.schedules.withSchedules) return [];
  const m = scheduleMetrics(model);
  const pages = [];
  let page = { items: [] };
  let used = 0;
  const flush = () => {
    if (page.items.length) pages.push(page);
    page = { items: [] };
    used = 0;
  };

  const blocks = [];
  for (const def of model.schedules.defs) if (def.rows.length) blocks.push({ type: 'table', def });
  blocks.push({ type: 'totals' });

  for (const b of blocks) {
    if (b.type === 'totals') {
      const h = totalsHeight(model, m);
      if (used + h > m.height && page.items.length) flush();
      page.items.push({ kind: 'totals' });
      used += h;
      continue;
    }
    const rows = b.def.rows;
    let from = 0;
    while (from < rows.length) {
      const room = m.height - used - m.headH - m.gap;
      let take = Math.min(rows.length - from, Math.floor(room / m.rowH));
      if (take <= 0) {
        if (page.items.length) {
          flush();
          continue;
        }
        take = 1;
      }
      page.items.push({ kind: 'table', def: b.def, from, to: from + take, cont: from > 0 });
      used += m.headH + take * m.rowH + m.gap;
      from += take;
    }
  }
  flush();
  return pages;
}

export function sheetPlan(model) {
  return [{ kind: 'plan', items: [] }, ...schedulePages(model)];
}

function drawTable(page, def, rows, x, y, w, rowH = 4.4, cont = false) {
  page.text(x, y, def.title.toUpperCase() + (cont ? ' (CONT.)' : ''), {
    size: clampLabel(2.7),
    bold: true,
    color: INK,
  });
  let yy = y + 4.6;
  let cx = x;
  for (const c of def.columns) {
    const cw = w * c.w;
    page.text(c.a === 'right' ? cx + cw - 1 : c.a === 'center' ? cx + cw / 2 : cx, yy, c.h, {
      size: clampLabel(1.9),
      bold: true,
      color: DIM,
      align: c.a,
    });
    cx += cw;
  }
  yy += 1.8;
  page.line(x, yy, x + w, yy, { width: 0.3, color: RULE });
  yy += rowH;
  for (const row of rows) {
    let rx = x;
    def.columns.forEach((c, i) => {
      const cw = w * c.w;
      const cell = row.cells[i] ?? '';
      const s = page.fit(cell, clampLabel(2.1), cw - 2);
      page.text(rx + (c.a === 'right' ? cw - 1 : c.a === 'center' ? cw / 2 : 0), yy, s, {
        size: clampLabel(2.1),
        color: INK,
        align: c.a,
      });
      rx += cw;
    });
    yy += rowH;
  }
  page.line(x, yy - rowH + 1.6, x + w, yy - rowH + 1.6, { width: 0.15, color: '#dfe4e9' });
  return yy;
}

export function renderSheet(doc, model) {
  const plan = sheetPlan(model);
  const total = plan.length;
  const m = scheduleMetrics(model);

  plan.forEach((sheet, i) => {
    const page = doc.addPage({ widthMm: model.sheet.w, heightMm: model.sheet.h });
    const no = i + 1;
    if (sheet.kind === 'plan') {
      drawPlanPage(page, model, no, total);
      return;
    }

    const x = model.boxes.plan.x + 6;
    let y = m.top;
    const w = m.width;
    page.text(x, y - 6, model.meta.scheduleHeading, {
      size: 4,
      bold: true,
      color: INK,
    });
    for (const item of sheet.items) {
      if (item.kind === 'table') {
        const rows = item.def.rows.slice(item.from, item.to);
        y = drawTable(page, item.def, rows, x, y, w, m.rowH, item.cont) + 6;
      } else if (item.kind === 'totals') {
        page.text(x, y, 'TOTALS', { size: clampLabel(2.7), bold: true, color: INK });
        y += 4.6;
        const half = Math.ceil(model.schedules.totals.length / 2);
        model.schedules.totals.forEach(([k, v], idx) => {
          const col = idx < half ? 0 : 1;
          const row = idx < half ? idx : idx - half;
          const cx = x + col * (w * 0.5);
          const cy = y + row * 4.4;
          page.text(cx, cy, k, { size: clampLabel(2.1), color: DIM });
          page.text(cx + w * 0.4, cy, v, { size: clampLabel(2.1), bold: true, color: INK, align: 'right' });
        });
      }
    }
    drawFrame(page, model);
    drawTitleBand(page, model);
    drawTitleBlock(page, model, no, total);
  });
  return total;
}
