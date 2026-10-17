// plot.js — turns a layout into a plotted drawing sheet: frame, title block,
// plan with dimensions, legend, north arrow, scale bar, and measurement
// schedules. Pure data in, pure model out, so the sheets can be unit-tested
// without a DOM or a PDF writer.
//
// Everything is in millimetres on paper. Every *label* — plan annotation,
// dimension text, table cell — is clamped to LABEL_MIN..LABEL_MAX (1–3 mm), so a
// busy plan still reads as a technical drawing instead of a poster. Only the
// sheet title is larger, because a title is not a label.

import { rackFootprint, rackAisle, expandBins, DEFAULT_RACK_AISLE } from './geometry.js';
import { normalizeLabelStyle } from './labels.js';
import { fixtureDef } from './fixtures.js';

export const LABEL_MIN = 1;
export const LABEL_MAX = 3;

export function clampLabel(mm) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return 2;
  return Math.min(LABEL_MAX, Math.max(LABEL_MIN, n));
}

export const PAPERS = {
  A4: { name: 'A4', w: 297, h: 210 },
  A3: { name: 'A3', w: 420, h: 297 },
  A2: { name: 'A2', w: 594, h: 420 },
};

// Standard metric drawing scales, largest first.
export const SCALES = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];

export const fmt = (n, d = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(d);
  // Trim trailing zeros only after a decimal point, so 1000 stays 1000.
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

// ── geometry of the world ───────────────────────────────────────────────────

// Everything that will be drawn, in metres. Fixtures use their rotated AABB.
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

// The largest standard scale that fits the drawing into the plan box.
export function chooseScale(extent, box, padMm = 10) {
  const availW = Math.max(20, box.w - padMm * 2);
  const availH = Math.max(20, box.h - padMm * 2);
  const maxMmPerM = Math.min(availW / extent.w, availH / extent.d);
  const minDenom = 1000 / maxMmPerM; // smallest denominator that still fits
  const denom = SCALES.find((s) => s >= minDenom) ?? 1000;
  const mmPerM = 1000 / denom;
  const fits = extent.w * mmPerM <= availW + 0.01 && extent.d * mmPerM <= availH + 0.01;
  return { denom, mmPerM, fits, standard: SCALES.includes(denom) };
}

// ── the sheet ───────────────────────────────────────────────────────────────

function sheetBoxes(paper) {
  const M = 8;
  const inner = { x: M, y: M, w: paper.w - M * 2, h: paper.h - M * 2 };
  const headerH = Math.min(20, paper.h * 0.075);
  const titleH = Math.min(22, paper.h * 0.085);
  const sideW = Math.min(80, Math.max(52, paper.w * 0.16));
  const pad = 4;
  const planH = inner.h - headerH - titleH - pad * 2;
  const planW = inner.w - pad * 2 - sideW - pad;
  const header = { x: inner.x + pad, y: inner.y, w: inner.w - pad * 2, h: headerH };
  const plan = { x: inner.x + pad, y: inner.y + headerH, w: planW, h: planH };
  const side = { x: plan.x + planW + pad, y: plan.y, w: sideW, h: planH };
  const title = {
    x: inner.x + pad,
    y: inner.y + inner.h - titleH,
    w: inner.w - pad * 2,
    h: titleH,
  };
  return { frame: inner, header, plan, side, title };
}

// A dimension line with architectural ticks and a centred value.
function dimensionLine(x1, y1, x2, y2, label, size) {
  const items = [
    { t: 'line', x1, y1, x2, y2, w: 0.18, color: '#222222' },
    // 45° ticks at each end
    {
      t: 'line',
      x1: x1 - 0.8,
      y1: y1 + 0.8,
      x2: x1 + 0.8,
      y2: y1 - 0.8,
      w: 0.25,
      color: '#222222',
    },
    {
      t: 'line',
      x1: x2 - 0.8,
      y1: y2 + 0.8,
      x2: x2 + 0.8,
      y2: y2 - 0.8,
      w: 0.25,
      color: '#222222',
    },
  ];
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const vertical = Math.abs(x2 - x1) < 0.01;
  items.push({
    t: 'text',
    x: vertical ? mx - 1.2 : mx,
    y: vertical ? my : my - 1.1,
    s: label,
    size: clampLabel(size),
    bold: false,
    color: '#111111',
    align: vertical ? 'left' : 'center',
  });
  return items;
}

// ── the model ───────────────────────────────────────────────────────────────

/**
 * Build the sheets for a layout.
 *
 * opts: { paper: 'A3' | 'A4' | 'A2', title, project, date, revision,
 *         dimensions: bool, grid: bool, schedules: bool, scale: number|null }
 */
export function buildSheetModel(state, opts = {}) {
  const paper = PAPERS[opts.paper] ?? PAPERS.A3;
  const boxes = sheetBoxes(paper);
  const extent = layoutExtent(state);
  const scale = opts.scale
    ? { denom: opts.scale, mmPerM: 1000 / opts.scale, fits: true }
    : chooseScale(extent, boxes.plan);
  const ls = normalizeLabelStyle(state.labelStyle);
  const show = ls.show || {};
  const withDims = opts.dimensions !== false;
  const withGrid = !!opts.grid;
  const withSchedules = opts.schedules !== false;

  const drawW = extent.w * scale.mmPerM;
  const drawH = extent.d * scale.mmPerM;
  const ox = boxes.plan.x + (boxes.plan.w - drawW) / 2;
  const oy = boxes.plan.y + (boxes.plan.h - drawH) / 2;
  const X = (x) => ox + (x - extent.minX) * scale.mmPerM;
  const Y = (y) => oy + (extent.maxY - y) * scale.mmPerM; // north is up

  const items = [];
  const label = (mm) => clampLabel(mm);
  const SIZE = label(2);
  const SMALL = label(1.5);
  const TINY = label(1.4);

  // Grid, drawn behind everything.
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
        color: '#d6dbe0',
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
        color: '#d6dbe0',
      });
    }
  }

  // Zones — the floor plates.
  (state.zones || []).forEach((z) => {
    items.push({
      t: 'rect',
      x: X(z.x),
      y: Y(z.y + z.d),
      w: z.w * scale.mmPerM,
      h: z.d * scale.mmPerM,
      fill: z.color,
      opacity: 0.1,
      stroke: '#8b96a2',
      w2: 0.25,
    });
    if (show.zones !== false) {
      const area = z.w * z.d;
      items.push({
        t: 'text',
        x: X(z.x) + 1.4,
        y: Y(z.y + z.d) + 3.4,
        s: z.id,
        size: SIZE,
        bold: true,
        color: '#1d232b',
      });
      items.push({
        t: 'text',
        x: X(z.x) + 1.4,
        y: Y(z.y + z.d) + 3.4 + SIZE + 0.9,
        s: `${fmt(z.w, 1)} × ${fmt(z.d, 1)} m · ${fmt(area, 0)} m²`,
        size: SMALL,
        color: '#3b4753',
      });
    }
  });

  // Rack rows, with their bay divisions.
  (state.racks || []).forEach((r) => {
    const t = state.binTypes?.[r.type] || { w: 3, d: 1, h: 6 };
    const fp = rackFootprint(r, state.binTypes);
    const x = X(r.x);
    const y = Y(r.y + fp.spanY);
    const w = fp.spanX * scale.mmPerM;
    const h = fp.spanY * scale.mmPerM;
    items.push({
      t: 'rect',
      x,
      y,
      w,
      h,
      fill: t.color || '#6f93c4',
      opacity: 0.45,
      stroke: '#2b3440',
      w2: 0.3,
    });
    // Bay boundaries.
    for (let b = 1; b < r.bays; b++) {
      if (r.dir === 'E') {
        items.push({
          t: 'line',
          x1: x + b * t.w * scale.mmPerM,
          y1: y,
          x2: x + b * t.w * scale.mmPerM,
          y2: y + h,
          w: 0.12,
          color: '#2b3440',
        });
      } else {
        items.push({
          t: 'line',
          x1: x,
          y1: y + h - b * t.w * scale.mmPerM,
          x2: x + w,
          y2: y + h - b * t.w * scale.mmPerM,
          w: 0.12,
          color: '#2b3440',
        });
      }
    }
    if (show.racks !== false) {
      const span = r.dir === 'E' ? h : w;
      const horizontal = r.dir === 'E';
      const tx = horizontal ? x + 0.8 : x + w / 2;
      const ty = horizontal ? y + h / 2 + SIZE / 2 : y + h + 3.2;
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
      if (span > 8) {
        items.push({
          t: 'text',
          x: horizontal ? tx : x + w / 2,
          y: horizontal ? ty + SIZE + 0.8 : ty + SMALL + 0.9,
          s: `${r.bays} × ${r.levels} · ${fmt(t.w, 1)}×${fmt(t.d, 1)} m`,
          size: TINY,
          color: '#2b3440',
          align: horizontal ? 'left' : 'center',
        });
      }
    }
  });

  // Paths, nodes, equipment, free text.
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
      color: ed.ramp ? '#b8791f' : '#6a7480',
      dash: ed.ramp ? [1.5, 1] : null,
    });
  });
  (state.nodes || []).forEach((n) => {
    items.push({ t: 'circle', x: X(n.x), y: Y(n.y), r: 0.9, fill: '#d4453a', stroke: '#5a1d18', w: 0.15 });
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
      opacity: 0.5,
      stroke: '#2b3440',
      w2: 0.18,
    });
    if (show.fixtures !== false && Math.max(fw, fh) > 7) {
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
    // Text objects carry a metre height; convert it to paper, then clamp.
    const mm = clampLabel((tx.size || 1.6) * scale.mmPerM);
    items.push({
      t: 'text',
      x: X(tx.x),
      y: Y(tx.y),
      s: tx.text || '',
      size: mm,
      bold: tx.weight === 700,
      color: tx.color || '#1b222a',
    });
  });

  // Overall dimensions.
  if (withDims) {
    const dimY = Math.min(boxes.plan.y + boxes.plan.h - 4, Y(extent.minY) + 9);
    items.push(...dimensionLine(X(extent.minX), dimY, X(extent.maxX), dimY, `${fmt(extent.w, 1)} m`, 1.8));
    const dimX = Math.max(boxes.plan.x + 4, X(extent.minX) - 9);
    items.push(...dimensionLine(dimX, Y(extent.maxY), dimX, Y(extent.minY), `${fmt(extent.d, 1)} m`, 1.8));
  }

  // ── schedules ─────────────────────────────────────────────────────
  const zones = (state.zones || []).map((z) => ({
    cells: [
      z.id,
      fmt(z.x, 1),
      fmt(z.y, 1),
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
        fmt(r.x, 1),
        fmt(r.y, 1),
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
    ['Overall extent', `${fmt(extent.w, 1)} × ${fmt(extent.d, 1)} m`],
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

  return {
    paper,
    boxes,
    extent,
    scale,
    labels: { min: LABEL_MIN, max: LABEL_MAX, base: SIZE, small: SMALL, tiny: TINY },
    meta: {
      title: opts.title || 'Warehouse layout plan',
      project: opts.project || state.meta?.name || 'Warehouse',
      date: opts.date || new Date().toISOString().slice(0, 10),
      revision: opts.revision || 'A',
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

const INK = '#1d232b';
const DIM = '#5c6672';
const RULE = '#9aa4b0';

function drawHeader(page, model, sheetNo, sheetTotal) {
  const { header } = model.boxes;
  page.text(header.x, header.y + 7.4, model.meta.title.toUpperCase(), { size: 5.4, bold: true, color: INK });
  page.text(header.x, header.y + 12.2, model.meta.project, { size: clampLabel(2.8), color: DIM });
  page.text(header.x + header.w, header.y + 7.4, `SHEET ${sheetNo} OF ${sheetTotal}`, {
    size: clampLabel(2.4),
    bold: true,
    color: INK,
    align: 'right',
  });
  page.text(header.x + header.w, header.y + 12.2, `${model.meta.date}   ·   Rev ${model.meta.revision}`, {
    size: clampLabel(2.2),
    color: DIM,
    align: 'right',
  });
  page.line(header.x, header.y + header.h - 1, header.x + header.w, header.y + header.h - 1, {
    width: 0.35,
    color: RULE,
  });
}

function drawTitleBlock(page, model, sheetNo, sheetTotal) {
  const { title } = model.boxes;
  const cells = [
    { label: 'PROJECT', value: model.meta.project, w: 0.36 },
    { label: 'DRAWING', value: 'Warehouse layout plan', w: 0.28 },
    { label: 'SCALE', value: `1:${model.scale.denom}`, w: 0.12 },
    { label: 'DATE', value: model.meta.date, w: 0.12 },
    { label: 'SHEET', value: `${sheetNo} / ${sheetTotal}`, w: 0.12 },
  ];
  page.rect(title.x, title.y, title.w, title.h, { stroke: RULE, width: 0.3, fill: '#ffffff' });
  let x = title.x;
  for (const c of cells) {
    const w = title.w * c.w;
    page.rect(x, title.y, w, title.h, { stroke: RULE, width: 0.2 });
    page.text(x + 2, title.y + 4.2, c.label, { size: clampLabel(1.6), bold: true, color: DIM });
    page.text(x + 2, title.y + 9.4, c.value, {
      size: clampLabel(2.6),
      color: INK,
    });
    x += w;
  }
  page.text(title.x + 2, title.y + title.h - 2.6, `Plotted with ${model.meta.plottedBy}`, {
    size: clampLabel(1.5),
    color: DIM,
  });
}

function drawNorthArrow(page, x, y, r) {
  page.polyline(
    [
      [x, y - r],
      [x + r * 0.42, y + r * 0.55],
      [x, y + r * 0.25],
      [x - r * 0.42, y + r * 0.55],
    ],
    { close: true, width: 0.25, color: INK },
  );
  page.text(x, y - r - 1.6, 'N', { size: clampLabel(2.8), bold: true, color: INK, align: 'center' });
}

function drawScaleBar(page, x, y, mmPerM) {
  // Pick a bar whose total is a round number of metres and fits ~40 mm.
  const targets = [1, 2, 5, 10, 20, 25, 50, 100];
  let total = targets[0];
  for (const t of targets) {
    total = t;
    if (t * mmPerM >= 30) break;
  }
  const segs = 4;
  const segMm = (total * mmPerM) / segs;
  for (let i = 0; i < segs; i++) {
    page.rect(x + i * segMm, y, segMm, 1.6, {
      fill: i % 2 ? '#ffffff' : INK,
      stroke: INK,
      width: 0.15,
    });
  }
  page.text(x, y - 1.4, '0', { size: clampLabel(1.6), color: DIM, align: 'center' });
  page.text(x + (total * mmPerM) / 2, y - 1.4, fmt(total / 2, 0), {
    size: clampLabel(1.6),
    color: DIM,
    align: 'center',
  });
  page.text(x + total * mmPerM, y - 1.4, `${fmt(total, 0)} m`, {
    size: clampLabel(1.6),
    color: DIM,
    align: 'center',
  });
}

function drawLegend(page, model, x, y, w) {
  const sw = 3.4;
  const rowH = 5.2;
  const rows = [
    { kind: 'rect', fill: '#8b96a2', opacity: 0.1, stroke: '#8b96a2', label: 'Zone / floor area' },
    { kind: 'rect', fill: '#6f93c4', opacity: 0.45, stroke: '#2b3440', label: 'Rack row (bays divided)' },
    { kind: 'line', label: 'Path edge', dash: null, color: '#6a7480' },
    { kind: 'line', label: 'Ramp / incline', dash: [1.5, 1], color: '#b8791f' },
    { kind: 'dot', label: 'Path node' },
    { kind: 'rect', fill: '#c9a86a', opacity: 0.5, stroke: '#2b3440', label: 'Equipment' },
  ];
  page.text(x, y, 'LEGEND', { size: clampLabel(2.6), bold: true, color: INK });
  let yy = y + 4.4;
  for (const r of rows) {
    if (r.kind === 'rect') {
      page.rect(x, yy, sw, 2.6, {
        fill: tint(r.fill, r.opacity ?? 0.4),
        stroke: r.stroke,
        width: 0.18,
      });
    } else if (r.kind === 'line') {
      page.line(x, yy + 1.3, x + sw, yy + 1.3, { width: 0.3, color: r.color, dash: r.dash });
    } else {
      page.polygon(circlePoints(x + sw / 2, yy + 1.3, 1.3), {
        fill: '#d4453a',
        color: '#5a1d18',
        width: 0.15,
      });
    }
    page.text(x + sw + 2.2, yy + 2, r.label, { size: clampLabel(2.1), color: INK });
    yy += rowH;
  }
  void w;
}

function circlePoints(cx, cy, r, n = 16) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// Mix a colour with paper white. Translucent fills are printed as a solid tint:
// that is exactly what an alpha fill over white looks like, and it keeps the
// writer free of graphics-state objects.
export function tint(color, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color ?? '#ffffff'));
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  const mix = (c) => Math.round(255 - (255 - c) * a);
  const hex = (v) => v.toString(16).padStart(2, '0');
  return `#${hex(mix((n >> 16) & 255))}${hex(mix((n >> 8) & 255))}${hex(mix(n & 255))}`;
}

function drawSummary(page, model, x, y, w) {
  page.text(x, y, 'KEY DATA', { size: clampLabel(2.6), bold: true, color: INK });
  let yy = y + 4.6;
  for (const [k, v] of model.schedules.totals) {
    page.text(x, yy, k, { size: clampLabel(2.1), color: DIM });
    page.text(x + w, yy, v, { size: clampLabel(2.1), bold: true, color: INK, align: 'right' });
    yy += 4.4;
  }
}

function drawPlanPage(page, model, sheetNo, sheetTotal) {
  drawHeader(page, model, sheetNo, sheetTotal);
  const { plan, side, frame } = model.boxes;

  // Plan border.
  page.rect(plan.x, plan.y, plan.w, plan.h, { stroke: '#c3cbd4', width: 0.25 });

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
      page.polygon(circlePoints(it.x, it.y, it.r), {
        fill: it.fill,
        color: it.stroke,
        width: it.w ?? 0.15,
      });
    } else if (it.t === 'text') {
      page.text(it.x, it.y, it.s, { size: it.size, bold: it.bold, color: it.color, align: it.align });
    }
  }

  // Right-hand column.
  let sy = side.y + 6;
  drawNorthArrow(page, side.x + side.w - 10, sy + 7, 7);
  page.line(side.x, sy + 19, side.x + side.w, sy + 19, { width: 0.2, color: RULE });
  sy += 24;
  drawLegend(page, model, side.x, sy, side.w);
  page.line(side.x, sy + 40, side.x + side.w, sy + 40, { width: 0.2, color: RULE });
  sy += 45;
  drawScaleBar(page, side.x + 2, sy + 4, model.scale.mmPerM);
  page.text(side.x, sy - 1.2, 'SCALE 1:' + model.scale.denom, {
    size: clampLabel(2.1),
    bold: true,
    color: INK,
  });
  page.line(side.x, sy + 11, side.x + side.w, sy + 11, { width: 0.2, color: RULE });
  sy += 16;
  drawSummary(page, model, side.x, sy, side.w);

  // Frame + title block.
  page.rect(frame.x, frame.y, frame.w, frame.h, { stroke: INK, width: 0.6 });
  drawTitleBlock(page, model, sheetNo, sheetTotal);
}

function drawTable(page, def, rows, x, y, w, rowH = 4.4, cont = false) {
  page.text(x, y, def.title.toUpperCase() + (cont ? ' (CONT.)' : ''), {
    size: clampLabel(2.7),
    bold: true,
    color: INK,
  });
  let yy = y + 4.4;
  // Header
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
  yy += 1.6;
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
  page.line(x, yy - rowH + 1.4, x + w, yy - rowH + 1.4, { width: 0.15, color: '#dfe4e9' });
  return yy;
}

// -- pagination --------------------------------------------------------------

const SCHED_ROW_H = 4.4;
const SCHED_HEAD_H = 6;
const SCHED_GAP = 7;

export const scheduleMetrics = (model) => {
  const { header, title } = model.boxes;
  const top = header.y + header.h + 8;
  const bottom = title.y - 6;
  return {
    top,
    bottom,
    height: Math.max(20, bottom - top),
    rowH: SCHED_ROW_H,
    headH: SCHED_HEAD_H,
    gap: SCHED_GAP,
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
          continue; // retry on a fresh page
        }
        take = 1; // pathological paper size: draw one row rather than loop
      }
      page.items.push({
        kind: 'table',
        def: b.def,
        from,
        to: from + take,
        cont: from > 0,
      });
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

export function renderSheet(doc, model) {
  const plan = sheetPlan(model);
  const total = plan.length;
  const m = scheduleMetrics(model);

  plan.forEach((sheet, i) => {
    const page = doc.addPage({ widthMm: model.paper.w, heightMm: model.paper.h });
    const no = i + 1;
    const { frame } = model.boxes;
    if (sheet.kind === 'plan') {
      drawPlanPage(page, model, no, total);
      return;
    }

    drawHeader(page, model, no, total);
    const w = frame.w - 8;
    const x = frame.x + 4;
    let y = m.top;
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
    page.rect(frame.x, frame.y, frame.w, frame.h, { stroke: INK, width: 0.6 });
    drawTitleBlock(page, model, no, total);
  });
  return total;
}
