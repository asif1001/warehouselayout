// plot.test.mjs — the architectural sheet model: dimension chains, title block,
// title band, label sizes, scale choice and the measurement schedules.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  LABEL_MAX,
  LABEL_MIN,
  SCALES,
  SHEETS,
  buildSheetModel,
  chainBreaks,
  chooseScale,
  clampLabel,
  dimText,
  fmt,
  layoutExtent,
  renderSheet,
  scheduleMetrics,
  sheetPlan,
  tint,
  titleBlockRows,
} from '../../app/js/plot.js';
import { createDocument } from '../../app/js/pdf.js';
import { fromDbConnect } from '../../app/js/dbconnect.js';
import { migrate } from '../../app/js/migrations.js';

function defaultLayout() {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../app/data/default_layout.json', import.meta.url)), 'utf8'),
  );
  return fromDbConnect(migrate(raw));
}

// A small two-zone, two-rack shop for deterministic checks.
function smallLayout() {
  return {
    schemaVersion: 7,
    meta: { name: 'TEST WAREHOUSE' },
    settings: { aisle: 2, snap: 0.3, grid: 3 },
    binTypes: { STD: { w: 3, d: 1.2, h: 6, color: '#6f93c4' } },
    naming: { separator: '-', bayPad: 2 },
    binOverrides: {},
    labelStyle: { scale: 1 },
    labelOverrides: {},
    texts: [],
    zones: [
      { id: 'MAIN', x: 0, y: 0, w: 40, d: 30, elev: 0, clearH: 10, color: '#55657d' },
      { id: 'OFFICE', x: 40, y: 0, w: 10, d: 12, elev: 0, clearH: 3, color: '#6d5f4e' },
    ],
    racks: [
      {
        id: 'ROW-A',
        type: 'STD',
        dir: 'E',
        bays: 4,
        levels: 3,
        levelHeights: [6, 6, 6],
        rowToken: 'A',
        bayStart: 1,
        bayReverse: false,
        x: 2,
        y: 2,
      },
      {
        id: 'ROW-B',
        type: 'STD',
        dir: 'E',
        bays: 4,
        levels: 3,
        levelHeights: [6, 6, 6],
        rowToken: 'B',
        bayStart: 1,
        bayReverse: false,
        x: 2,
        y: 5,
        aisle: 2.5,
      },
    ],
    nodes: [{ id: 'D1', kind: 'door', x: 0, y: 15 }],
    edges: [],
    fixtures: [{ id: 'F-1', kind: 'pallet', x: 20, y: 20, w: 1.2, d: 0.8, rot: 0 }],
    bg: null,
  };
}

const digitTexts = (model) => model.planItems.filter((i) => i.t === 'text' && /^\d+$/.test(i.s));

// ── labels ──────────────────────────────────────────────────────────────────

test('every label size is clamped into the 1–3 mm band', () => {
  assert.equal(LABEL_MIN, 1);
  assert.equal(LABEL_MAX, 3);
  assert.equal(clampLabel(0.2), 1);
  assert.equal(clampLabel(0), 1);
  assert.equal(clampLabel(2), 2);
  assert.equal(clampLabel(3), 3);
  assert.equal(clampLabel(9), 3);
  assert.equal(clampLabel(NaN), 2);
});

test('no plan label in the finished model exceeds the band', () => {
  const model = buildSheetModel(smallLayout());
  const sizes = [
    ...model.planItems.filter((i) => i.t === 'text').map((i) => i.size),
    model.labels.base,
    model.labels.small,
    model.labels.tiny,
  ];
  assert.ok(sizes.length > 0);
  for (const s of sizes) assert.ok(s >= LABEL_MIN && s <= LABEL_MAX, `label ${s} outside the band`);
});

// ── extent + scale ──────────────────────────────────────────────────────────

test('layoutExtent covers zones, racks, fixtures and nodes', () => {
  const ext = layoutExtent(smallLayout());
  assert.equal(ext.minX, 0);
  assert.ok(ext.maxX >= 50);
  assert.ok(ext.w >= 50 && ext.d >= 30);
});

test('an empty layout still yields a usable extent', () => {
  const ext = layoutExtent({ zones: [], racks: [], fixtures: [], nodes: [], texts: [] });
  assert.ok(ext.w > 0 && ext.d > 0);
});

test('chooseScale picks the largest standard scale that fits', () => {
  const box = { w: 300, h: 200 };
  const s = chooseScale({ w: 50, d: 20 }, box);
  assert.ok(SCALES.includes(s.denom));
  assert.equal(s.denom, 200);
  assert.ok(s.fits);
  const small = chooseScale({ w: 5, d: 4 }, box);
  assert.ok(small.denom < s.denom, 'small plans get a larger scale');
});

// ── dimension chains ────────────────────────────────────────────────────────

test('chainBreaks drops crowded breaks but keeps both ends', () => {
  const out = chainBreaks([0, 0.2, 0.3, 5, 5.1, 5.2, 10], 2);
  assert.equal(out[0], 0);
  assert.equal(out[out.length - 1], 10);
  assert.deepEqual(out, [0, 5, 10]);
  // A wide threshold collapses to just the extent.
  assert.deepEqual(chainBreaks([0, 1, 2, 3], 100), [0, 3]);
});

test('dimText prints millimetres by default and metres on request', () => {
  assert.equal(dimText(1.85), '1850');
  assert.equal(dimText(1.85, 'mm'), '1850');
  assert.equal(dimText(1.85, 'm'), '1.85');
  assert.equal(dimText(0.3, 'm'), '0.3');
  assert.equal(dimText(NaN), '—');
});

test('dimension chains appear on all four sides, and disappear when switched off', () => {
  const withDims = buildSheetModel(smallLayout(), { dimensions: true });
  const digits = digitTexts(withDims);
  // Four chains, each with at least one segment.
  assert.ok(digits.length >= 4, `expected chains on every side, got ${digits.length} values`);

  const without = buildSheetModel(smallLayout(), { dimensions: false });
  assert.equal(digitTexts(without).length, 0);
});

test('dimension chains stay inside the drawing area', () => {
  for (const sheet of Object.keys(SHEETS)) {
    const model = buildSheetModel(defaultLayout(), { sheet, dimensions: true });
    const box = model.boxes.plan;
    for (const it of model.planItems) {
      const pts =
        it.t === 'line'
          ? [
              [it.x1, it.y1],
              [it.x2, it.y2],
            ]
          : it.t === 'rect'
            ? [
                [it.x, it.y],
                [it.x + it.w, it.y + it.h],
              ]
            : it.t === 'text'
              ? [[it.x, it.y]]
              : [];
      for (const [x, y] of pts) {
        assert.ok(x >= box.x - 1 && x <= box.x + box.w + 1, `${sheet}: x=${x} escapes the plan box`);
        assert.ok(y >= box.y - 1 && y <= box.y + box.h + 1, `${sheet}: y=${y} escapes the plan box`);
      }
    }
  }
});

// ── sheet furniture ─────────────────────────────────────────────────────────

test('the sheet regions never overlap and sit inside the frame', () => {
  for (const [key, sheet] of Object.entries(SHEETS)) {
    const { frame, plan, block, band } = buildSheetModel(smallLayout(), { sheet: key }).boxes;
    const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlaps(plan, block), `${key}: plan overlaps the title block`);
    assert.ok(!overlaps(plan, band), `${key}: plan overlaps the band`);
    assert.ok(!overlaps(block, band), `${key}: title block overlaps the band`);
    for (const box of [plan, block, band]) {
      assert.ok(
        box.x >= frame.x - 0.01 && box.x + box.w <= frame.x + frame.w + 0.01,
        `${key}: box inside the frame`,
      );
      assert.ok(
        box.y >= frame.y - 0.01 && box.y + box.h <= frame.y + frame.h + 0.01,
        `${key}: box above the frame`,
      );
      assert.ok(box.w > 40 && box.h > 10, `${key}: box has usable size`);
    }
    assert.equal(sheet.w > sheet.h, key.endsWith('L'), `${key}: orientation matches its dimensions`);
  }
});

test('the title block carries every field the drawing set needs', () => {
  const model = buildSheetModel(smallLayout(), {
    project: 'TOYOTA SPARE PARTS SHOP',
    location: 'HAMAD TOWN',
    drawingTitle: 'OPTION 2 SHOP',
    drawingNo: 'WLE-001',
    date: '2026-04-06',
    drawnBy: 'AS',
    checkedBy: 'MK',
    approvedBy: 'RA',
    clearHeightMm: 4300,
    ceilingHeightMm: 3100,
  });
  const rows = titleBlockRows(model);
  assert.equal(rows.length, 7);
  const total = rows.reduce((n, r) => n + r.h, 0);
  assert.ok(Math.abs(total - model.boxes.block.h) < 0.01, 'rows fill the block');
  const text = JSON.stringify(rows);
  assert.match(text, /CLEAR HEIGHT\s+\+4300/);
  assert.match(text, /CEILING HEIGHT\s+\+3100/);
  assert.match(text, /DATE :\s+06-04-2026/);
  assert.match(text, /PROJECT/);
  assert.match(text, /TOYOTA SPARE PARTS SHOP/);
  assert.match(text, /PROJECT LOCATION/);
  assert.match(text, /HAMAD TOWN/);
  assert.match(text, /DRAWING TITLE/);
  assert.match(text, /OPTION 2 SHOP/);
  assert.match(text, /DRAWING No\./);
  assert.match(text, /WLE-001/);
});

test('heights fall back to the tallest zone when not given', () => {
  const model = buildSheetModel(smallLayout());
  assert.equal(model.meta.clearHeightMm, 10000, '10 m clear height from the MAIN zone');
  assert.equal(model.meta.ceilingHeightMm, 9600, 'ceiling sits 400 mm below');
});

test('the band title combines the drawing title and the project', () => {
  const model = buildSheetModel(smallLayout(), {
    project: 'TOYOTA SPARE PARTS SHOP',
    drawingTitle: 'Option 2 shop',
  });
  assert.equal(model.meta.bandText, 'OPTION 2 SHOP — TOYOTA SPARE PARTS SHOP');
  assert.match(model.meta.scheduleHeading, /^OPTION 2 SHOP — SCHEDULES$/);
});

// ── schedules ───────────────────────────────────────────────────────────────

test('the schedules list every zone, rack and equipment type', () => {
  const model = buildSheetModel(smallLayout());
  const defs = Object.fromEntries(model.schedules.defs.map((d) => [d.key, d]));

  assert.equal(defs.zones.rows.length, 2);
  assert.equal(defs.zones.rows[0].cells[0], 'MAIN');
  assert.equal(defs.zones.rows[0].cells[3], '40');
  assert.equal(defs.zones.rows[0].cells[4], '30');
  assert.equal(defs.zones.rows[0].cells[5], '1200');

  assert.equal(defs.racks.rows.length, 2);
  const rowA = defs.racks.rows[0].cells;
  assert.equal(rowA[0], 'A');
  assert.equal(rowA[3], '4');
  assert.equal(rowA[4], '3');
  assert.equal(rowA[10], '12');
  assert.equal(rowA[11], '12');

  assert.deepEqual(defs.equipment.rows, [{ cells: ['Pallet', '1'] }]);

  const totals = Object.fromEntries(model.schedules.totals);
  assert.equal(totals['Zones'], '2');
  assert.equal(totals['Rack rows'], '2');
  assert.equal(totals['Pallet positions'], '24');
  assert.equal(totals['Floor area (zones)'], '1320 m²');
});

// ── pagination + rendering ──────────────────────────────────────────────────

test('the sheet plan starts with the plan and flows the schedules after it', () => {
  const model = buildSheetModel(smallLayout());
  const sheets = sheetPlan(model);
  assert.equal(sheets[0].kind, 'plan');
  assert.ok(sheets.length >= 2);

  const counts = {};
  for (const sheet of sheets.slice(1)) {
    for (const item of sheet.items || []) {
      if (item.kind !== 'table') continue;
      counts[item.def.key] = (counts[item.def.key] || 0) + (item.to - item.from);
    }
  }
  assert.equal(counts.zones, 2);
  assert.equal(counts.racks, 2);
  assert.equal(counts.equipment, 1);
});

test('a tall rack list flows on without losing rows or overflowing a page', () => {
  const state = smallLayout();
  state.racks = Array.from({ length: 60 }, (_, i) => ({ ...state.racks[0], id: 'R' + i, rowToken: 'T' + i }));
  const model = buildSheetModel(state);
  const sheets = sheetPlan(model);
  assert.ok(sheets.length > 2);

  const slices = sheets
    .flatMap((s) => s.items || [])
    .filter((i) => i.kind === 'table' && i.def.key === 'racks');
  assert.equal(
    slices.reduce((n, s) => n + (s.to - s.from), 0),
    60,
  );
  assert.ok(slices.some((s) => s.cont));

  const m = scheduleMetrics(model);
  const totalsH = 4.6 + Math.ceil(model.schedules.totals.length / 2) * 4.4 + m.gap;
  for (const sheet of sheets.slice(1)) {
    let used = 0;
    for (const item of sheet.items) {
      used += item.kind === 'table' ? m.headH + (item.to - item.from) * m.rowH + m.gap : totalsH;
    }
    assert.ok(used <= m.height + 0.01, `a page uses ${used.toFixed(1)} of ${m.height.toFixed(1)} mm`);
  }
});

test('renderSheet paints every page and keeps labels inside the band', () => {
  const model = buildSheetModel(smallLayout());
  const doc = createDocument();
  const recorded = [];
  const calls = [];
  const realAdd = doc.addPage;
  doc.addPage = (opts) => {
    const page = realAdd(opts);
    for (const name of ['text', 'line', 'rect', 'polyline', 'polygon']) {
      const fn = page[name];
      page[name] = (...args) => {
        calls.push(name);
        if (name === 'text') recorded.push({ size: args[3]?.size, s: String(args[2] ?? '') });
        return fn.apply(page, args);
      };
    }
    return page;
  };

  const total = renderSheet(doc, model);
  assert.equal(total, sheetPlan(model).length);
  assert.equal(doc.pageCount(), total);
  assert.ok(calls.filter((c) => c === 'text').length > 40);
  assert.ok(calls.includes('rect'));

  // Headings are larger than the label band on purpose; annotations are not.
  const headings = new Set([model.meta.bandText.trim(), model.meta.scheduleHeading.trim()]);
  const notLabels =
    /^(CLEAR HEIGHT|PROPOSED|DATE|PROJECT|DRAWING|SCALE|DRAWN|CHECKED|APPROVED|LEGEND|TOTALS|ZONE SCHEDULE|RACK SCHEDULE|EQUIPMENT SCHEDULE|SHEET|N$)/i;
  for (const r of recorded) {
    const s = r.s.trim();
    if (headings.has(s) || notLabels.test(s)) continue;
    assert.ok(r.size >= LABEL_MIN - 1e-9 && r.size <= LABEL_MAX + 1e-9, `"${r.s}" drawn at ${r.size} mm`);
  }
});

test('the default layout plots on every sheet size without NaN', () => {
  const state = defaultLayout();
  for (const key of Object.keys(SHEETS)) {
    const model = buildSheetModel(state, { sheet: key, dimensions: true, grid: true });
    for (const it of model.planItems) {
      if (it.t === 'line')
        for (const v of [it.x1, it.y1, it.x2, it.y2]) assert.ok(Number.isFinite(v), `${key} NaN`);
      if (it.t === 'text') {
        assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y) && Number.isFinite(it.size));
        assert.ok(it.size >= LABEL_MIN && it.size <= LABEL_MAX);
      }
      if (it.t === 'rect') assert.ok(it.w >= 0 && it.h >= 0);
    }
    assert.ok(model.totalMm.w <= model.boxes.plan.w + 0.01, `${key}: drawing fits across`);
    assert.ok(model.totalMm.h <= model.boxes.plan.h + 0.01, `${key}: drawing fits down`);
  }
});

test('turning schedules off leaves a single sheet', () => {
  const model = buildSheetModel(smallLayout(), { schedules: false });
  assert.equal(model.schedules.withSchedules, false);
  assert.equal(sheetPlan(model).length, 1);
});

test('the grid adds lines only when asked', () => {
  const without = buildSheetModel(smallLayout()).planItems.filter((i) => i.w === 0.1).length;
  const withGrid = buildSheetModel(smallLayout(), { grid: true }).planItems.filter((i) => i.w === 0.1).length;
  assert.equal(without, 0);
  assert.ok(withGrid > 0);
});

// ── helpers ─────────────────────────────────────────────────────────────────

test('tint mixes towards paper white', () => {
  assert.equal(tint('#000000', 1), '#000000');
  assert.equal(tint('#000000', 0), '#ffffff');
  assert.equal(tint('#ff0000', 0.5), '#ff8080');
  assert.equal(tint('nonsense', 1), '#ffffff');
});

test('fmt trims trailing zeros but keeps real decimals', () => {
  assert.equal(fmt(3), '3');
  assert.equal(fmt(3.5), '3.5');
  assert.equal(fmt(3.14159, 2), '3.14');
  assert.equal(fmt(1000, 0), '1000');
  assert.equal(fmt(NaN), '—');
});
