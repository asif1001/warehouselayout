// plot.test.mjs — the plotted sheet model: label sizes, scale choice, the plan
// geometry, and the measurement schedules.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  LABEL_MAX,
  LABEL_MIN,
  PAPERS,
  SCALES,
  buildSheetModel,
  chooseScale,
  clampLabel,
  fmt,
  layoutExtent,
  renderSheet,
  scheduleMetrics,
  sheetPlan,
  tint,
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

// A tiny two-zone, two-rack layout for deterministic checks.
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

// ── labels ──────────────────────────────────────────────────────────────────

test('every label size is clamped into the 1–3 mm band', () => {
  assert.equal(LABEL_MIN, 1);
  assert.equal(LABEL_MAX, 3);
  assert.equal(clampLabel(0.2), 1);
  assert.equal(clampLabel(0), 1);
  assert.equal(clampLabel(-4), 1);
  assert.equal(clampLabel(2), 2);
  assert.equal(clampLabel(3), 3);
  assert.equal(clampLabel(9), 3);
  assert.equal(clampLabel(NaN), 2);
  assert.equal(clampLabel(undefined), 2);
});

test('no label in the finished model exceeds the band', () => {
  const model = buildSheetModel(smallLayout());
  const sizes = [
    ...model.planItems.filter((i) => i.t === 'text').map((i) => i.size),
    model.labels.base,
    model.labels.small,
    model.labels.tiny,
  ];
  assert.ok(sizes.length > 0);
  for (const s of sizes) {
    assert.ok(s >= LABEL_MIN && s <= LABEL_MAX, `label ${s} outside ${LABEL_MIN}–${LABEL_MAX}`);
  }
});

// ── extent + scale ──────────────────────────────────────────────────────────

test('layoutExtent covers zones, racks, fixtures and nodes', () => {
  const ext = layoutExtent(smallLayout());
  assert.equal(ext.minX, 0);
  assert.ok(ext.maxX >= 50, 'the office zone reaches x=50');
  assert.ok(ext.maxY >= 30);
  assert.ok(ext.w >= 50 && ext.d >= 30);
});

test('an empty layout still yields a usable extent', () => {
  const ext = layoutExtent({ zones: [], racks: [], fixtures: [], nodes: [], texts: [] });
  assert.ok(ext.w > 0 && ext.d > 0);
  assert.ok(Number.isFinite(ext.minX) && Number.isFinite(ext.maxY));
});

test('chooseScale picks the largest standard scale that fits', () => {
  const box = { w: 300, h: 200 };
  // 50 m wide: 1:200 gives 250 mm — fits, 1:150 gives 333 mm — does not.
  const s = chooseScale({ w: 50, d: 20 }, box);
  assert.ok(SCALES.includes(s.denom));
  assert.equal(s.denom, 200);
  assert.ok(s.fits);
  assert.ok(Math.abs(s.mmPerM - 5) < 1e-9);

  // A small plan can use a bigger scale.
  const small = chooseScale({ w: 5, d: 4 }, box);
  assert.ok(small.denom < s.denom, 'small plans get a larger scale');
  assert.ok(SCALES.includes(small.denom));
});

test('the plan drawing fits inside the plan box', () => {
  const model = buildSheetModel(smallLayout(), { paper: 'A3' });
  assert.ok(model.totalMm.w <= model.boxes.plan.w + 0.01, 'drawing width fits');
  assert.ok(model.totalMm.h <= model.boxes.plan.h + 0.01, 'drawing height fits');
  assert.ok(model.scale.fits, 'scale marked as fitting');
});

// ── the sheet model ─────────────────────────────────────────────────────────

test('the model carries the project, date and scale for the title block', () => {
  const model = buildSheetModel(smallLayout(), {
    paper: 'A3',
    project: 'Unit 7',
    date: '2026-10-17',
    revision: 'B',
  });
  assert.equal(model.meta.project, 'Unit 7');
  assert.equal(model.meta.date, '2026-10-17');
  assert.equal(model.meta.revision, 'B');
  assert.equal(model.paper.name, 'A3');
  assert.match(String(model.scale.denom), /^\d+$/);
});

test('the schedules list every zone, rack and equipment type', () => {
  const model = buildSheetModel(smallLayout());
  const defs = Object.fromEntries(model.schedules.defs.map((d) => [d.key, d]));

  assert.equal(defs.zones.rows.length, 2);
  assert.equal(defs.zones.rows[0].cells[0], 'MAIN');
  // Width/Depth/Area columns.
  assert.equal(defs.zones.rows[0].cells[3], '40');
  assert.equal(defs.zones.rows[0].cells[4], '30');
  assert.equal(defs.zones.rows[0].cells[5], '1200');

  assert.equal(defs.racks.rows.length, 2);
  const rowA = defs.racks.rows[0].cells;
  assert.equal(rowA[0], 'A', 'row token');
  assert.equal(rowA[3], '4', 'bays');
  assert.equal(rowA[4], '3', 'levels');
  assert.equal(rowA[11], '12', 'pallet positions');
  // Row length = bays × bin width.
  assert.equal(rowA[10], '12');

  assert.deepEqual(defs.equipment.rows, [{ cells: ['Pallet', '1'] }]);

  const totals = Object.fromEntries(model.schedules.totals);
  assert.equal(totals['Zones'], '2');
  assert.equal(totals['Rack rows'], '2');
  assert.equal(totals['Pallet positions'], '24');
  assert.equal(totals['Equipment items'], '1');
  assert.equal(totals['Floor area (zones)'], '1320 m²');
});

test('the plan draws the racks, their bays and the overall dimensions', () => {
  const model = buildSheetModel(smallLayout(), { dimensions: true });
  const texts = model.planItems.filter((i) => i.t === 'text').map((i) => i.s);
  assert.ok(texts.includes('MAIN'));
  assert.ok(texts.includes('A'));
  assert.ok(texts.includes('OFFICE'));
  assert.ok(
    texts.some((s) => /^\d+(\.\d+)? m$/.test(s)),
    'overall dimension values present',
  );

  // 4 bays per row → 3 internal dividers per row, 2 rows.
  const dividers = model.planItems.filter((i) => i.t === 'line' && i.w === 0.12);
  assert.equal(dividers.length, 6);
});

test('turning dimensions or schedules off removes them', () => {
  const bare = buildSheetModel(smallLayout(), { dimensions: false, schedules: false });
  const texts = bare.planItems.filter((i) => i.t === 'text').map((i) => i.s);
  assert.ok(!texts.some((s) => /^\d+(\.\d+)? m$/.test(s)), 'no dimension values');
  assert.equal(bare.schedules.withSchedules, false);
  assert.equal(sheetPlan(bare).length, 1, 'a bare sheet is a single page');
});

test('the grid adds lines only when asked', () => {
  const without = buildSheetModel(smallLayout()).planItems.filter((i) => i.w === 0.1).length;
  const withGrid = buildSheetModel(smallLayout(), { grid: true }).planItems.filter((i) => i.w === 0.1).length;
  assert.equal(without, 0);
  assert.ok(withGrid > 0);
});

test('the default layout plots without NaNs or off-sheet geometry', () => {
  const state = defaultLayout();
  for (const paper of Object.keys(PAPERS)) {
    const model = buildSheetModel(state, { paper, grid: true, dimensions: true });
    const { plan } = model.boxes;
    for (const it of model.planItems) {
      if (it.t === 'line') {
        for (const v of [it.x1, it.y1, it.x2, it.y2, it.w])
          assert.ok(Number.isFinite(v), `${paper} line NaN`);
      } else if (it.t === 'text') {
        assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y) && Number.isFinite(it.size));
        assert.ok(it.size >= LABEL_MIN && it.size <= LABEL_MAX);
      } else if (it.t === 'rect') {
        for (const v of [it.x, it.y, it.w, it.h]) assert.ok(Number.isFinite(v), `${paper} rect NaN`);
        assert.ok(it.w >= 0 && it.h >= 0);
      }
    }
    assert.ok(model.totalMm.w <= plan.w + 0.01, `${paper}: drawing fits horizontally`);
    assert.ok(model.totalMm.h <= plan.h + 0.01, `${paper}: drawing fits vertically`);
  }
});

// ── pagination + rendering ──────────────────────────────────────────────────

test('the sheet plan starts with the plan and flows the schedules after it', () => {
  const model = buildSheetModel(smallLayout());
  const sheets = sheetPlan(model);
  assert.equal(sheets[0].kind, 'plan');
  assert.ok(sheets.length >= 2, 'at least the plan and a schedule page');

  // Every zone, rack and equipment row appears exactly once across the pages.
  const counts = {};
  for (const sheet of sheets.slice(1)) {
    for (const item of sheet.items) {
      if (item.kind !== 'table') continue;
      counts[item.def.key] = (counts[item.def.key] || 0) + (item.to - item.from);
    }
  }
  assert.equal(counts.zones, 2);
  assert.equal(counts.racks, 2);
  assert.equal(counts.equipment, 1);
});

test('a tall rack list flows across pages without losing rows or overflowing', () => {
  const state = smallLayout();
  state.racks = Array.from({ length: 60 }, (_, i) => ({
    ...state.racks[0],
    id: 'R' + i,
    rowToken: 'T' + i,
  }));
  const model = buildSheetModel(state);
  const sheets = sheetPlan(model);
  assert.ok(sheets.length > 2, 'the racks need more than one schedule page');

  const slices = sheets.flatMap((s) => s.items).filter((i) => i.kind === 'table' && i.def.key === 'racks');
  assert.equal(
    slices.reduce((n, s) => n + (s.to - s.from), 0),
    60,
    'every rack row is placed exactly once',
  );
  assert.ok(
    slices.some((s) => s.cont),
    'continuation sheets are flagged',
  );

  // No page may use more vertical space than it has.
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

test('renderSheet paints every planned page and stays in the label band', () => {
  const model = buildSheetModel(smallLayout());
  const doc = createDocument();
  const calls = [];
  const recorded = [];
  // Record every primitive and the text sizes that reach the page.
  const realAdd = doc.addPage;
  doc.addPage = (opts) => {
    const page = realAdd(opts);
    const wrap = (name) => {
      const fn = page[name];
      page[name] = (...args) => {
        calls.push(name);
        if (name === 'text') recorded.push({ size: args[3]?.size, s: args[2] });
        return fn.apply(page, args);
      };
    };
    ['text', 'line', 'rect', 'polyline', 'polygon', 'image'].forEach(wrap);
    return page;
  };

  const total = renderSheet(doc, model);
  assert.equal(total, sheetPlan(model).length);
  assert.equal(doc.pageCount(), total);
  assert.ok(calls.filter((c) => c === 'text').length > 20, 'plenty of text drawn');
  assert.ok(calls.includes('rect'), 'rectangles drawn');

  // Headings and the sheet title may exceed the band; labels never do.
  const labels = recorded.filter(
    (r) =>
      !/^(WAREHOUSE|SHEET |LEGEND|KEY DATA|ZONE SCHEDULE|RACK SCHEDULE|EQUIPMENT SCHEDULE|TOTALS)/.test(
        r.s ?? '',
      ),
  );
  for (const r of labels) {
    assert.ok(r.size >= LABEL_MIN - 1e-9 && r.size <= LABEL_MAX + 1e-9, `rendered "${r.s}" at ${r.size} mm`);
  }
});

test('the sheet regions never overlap, on any paper size', () => {
  for (const paper of Object.keys(PAPERS)) {
    const { header, plan, side, title, frame } = buildSheetModel(smallLayout(), { paper }).boxes;
    const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlaps(header, plan), `${paper}: header overlaps the plan`);
    assert.ok(!overlaps(header, side), `${paper}: header overlaps the side column`);
    assert.ok(!overlaps(plan, side), `${paper}: plan overlaps the side column`);
    assert.ok(!overlaps(plan, title), `${paper}: plan overlaps the title block`);
    assert.ok(!overlaps(side, title), `${paper}: side column overlaps the title block`);
    for (const box of [header, plan, side, title]) {
      assert.ok(
        box.x >= frame.x - 0.01 && box.x + box.w <= frame.x + frame.w + 0.01,
        `${paper}: box inside the frame`,
      );
      assert.ok(
        box.y >= frame.y - 0.01 && box.y + box.h <= frame.y + frame.h + 0.01,
        `${paper}: box above the frame`,
      );
      assert.ok(box.w > 20 && box.h > 8, `${paper}: box has usable size`);
    }
    assert.ok(plan.h > 60 && plan.w > 100, `${paper}: the plan area is large enough to draw in`);
    assert.ok(title.h > 12, `${paper}: the title block has room for its cells`);
  }
});

test('nothing drawn on the plan escapes the plan box', () => {
  for (const paper of Object.keys(PAPERS)) {
    const model = buildSheetModel(defaultLayout(), { paper, grid: true, dimensions: true });
    const box = model.boxes.plan;
    const slack = 1; // half a line width plus rounding
    for (const it of model.planItems) {
      if (it.t === 'line') {
        for (const [x, y] of [
          [it.x1, it.y1],
          [it.x2, it.y2],
        ]) {
          assert.ok(x >= box.x - slack && x <= box.x + box.w + slack, `${paper}: line x=${x} outside plan`);
          assert.ok(y >= box.y - slack && y <= box.y + box.h + slack, `${paper}: line y=${y} outside plan`);
        }
      } else if (it.t === 'rect') {
        assert.ok(
          it.x >= box.x - slack && it.x + it.w <= box.x + box.w + slack,
          `${paper}: rect outside plan`,
        );
        assert.ok(
          it.y >= box.y - slack && it.y + it.h <= box.y + box.h + slack,
          `${paper}: rect outside plan`,
        );
      }
    }
  }
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
  assert.equal(fmt(0), '0');
  assert.equal(fmt(1000, 0), '1000');
  assert.equal(fmt(NaN), '—');
});
