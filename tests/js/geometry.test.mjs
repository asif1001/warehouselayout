import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  zoneOf,
  ptSegDist,
  edgeLength,
  expandBins,
  enrichForExport,
  bayOf,
  resolveBayLabel,
  rackAisle,
  rackFootprint,
  rackRowAxis,
  nextRackRow,
  aisleFit,
  rackBlockPositions,
  matchBinType,
  rowTokensFor,
  DEFAULT_RACK_AISLE,
} from '../../app/js/geometry.js';
import { fromDbConnect } from '../../app/js/dbconnect.js';

const defaultLayout = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../app/data/default_layout.json', import.meta.url)), 'utf8'),
);
// v5 file — convert to editor-native state for functions that expect it
const defaultState = fromDbConnect(defaultLayout);

test('zoneOf finds the containing zone', () => {
  // zone "1": x:-70, y:0, w:75, d:60 — point (-40, 30) is inside
  const z = zoneOf(defaultState.zones, -40, 30);
  assert.equal(z.id, '1');
});

test('zoneOf returns null outside every zone', () => {
  assert.equal(zoneOf(defaultState.zones, -50, -50), null);
});

test('ptSegDist: distance to a horizontal segment', () => {
  assert.equal(ptSegDist(5, 3, 0, 0, 10, 0), 3);
});

test('ptSegDist: clamps to the nearest endpoint', () => {
  assert.equal(ptSegDist(-4, 0, 0, 0, 10, 0), 4);
});

test('edgeLength rounds the straight-line distance', () => {
  const nodes = [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 3, y: 4 },
  ];
  assert.equal(edgeLength(nodes, { a: 'A', b: 'B' }), 5);
});

test('edgeLength is null when an endpoint is missing', () => {
  assert.equal(edgeLength([{ id: 'A', x: 0, y: 0 }], { a: 'A', b: 'X' }), null);
});

test('expandBins produces bays x levels bins per run', () => {
  const expected = defaultState.racks.reduce((sum, r) => sum + r.bays * Math.max(r.levels, 1), 0);
  assert.equal(expandBins(defaultState).length, expected);
});

test('expanded bin labels follow ROW-BAY-LEVEL (no zone prefix)', () => {
  const bins = expandBins(defaultState);
  // Format: rowToken-paddedBay-level, e.g. "C-01-1"
  assert.match(bins[0].bin_label, /^[A-Za-z0-9]+-\d+-\d+$/);
  // bin_label and whse_location must be identical
  assert.equal(bins[0].bin_label, bins[0].whse_location);
});

// ── bayOf ────────────────────────────────────────────────────────────────────

const BT = { STD: { w: 3, d: 2 } };

test('bayOf dir=E: returns correct bay index for interior point', () => {
  const rack = { id: 'R', type: 'STD', dir: 'E', bays: 4, x: 0, y: 0 };
  assert.equal(bayOf(rack, BT, 1.5, 1), 0); // first bay
  assert.equal(bayOf(rack, BT, 3.5, 1), 1); // second bay
  assert.equal(bayOf(rack, BT, 9.5, 1), 3); // fourth bay
});

test('bayOf dir=E: returns null outside the footprint', () => {
  const rack = { id: 'R', type: 'STD', dir: 'E', bays: 3, x: 0, y: 0 };
  assert.equal(bayOf(rack, BT, -1, 1), null); // left of rack
  assert.equal(bayOf(rack, BT, 10, 1), null); // right of rack (3*3=9)
  assert.equal(bayOf(rack, BT, 1, 3), null); // above rack (d=2)
});

test('bayOf dir=N: returns correct bay index for interior point', () => {
  const rack = { id: 'R', type: 'STD', dir: 'N', bays: 4, x: 0, y: 0 };
  assert.equal(bayOf(rack, BT, 1, 1.5), 0); // first bay (y 0-3)
  assert.equal(bayOf(rack, BT, 1, 4.5), 1); // second bay (y 3-6)
});

test('bayOf dir=N: returns null outside the footprint', () => {
  const rack = { id: 'R', type: 'STD', dir: 'N', bays: 3, x: 0, y: 0 };
  assert.equal(bayOf(rack, BT, 1, -1), null);
  assert.equal(bayOf(rack, BT, 3, 1), null); // outside depth (d=2)
});

test('bayOf: unknown bin type returns null', () => {
  const rack = { id: 'R', type: 'MISSING', dir: 'E', bays: 3, x: 0, y: 0 };
  assert.equal(bayOf(rack, {}, 1, 1), null);
});

// ── resolveBayLabel ───────────────────────────────────────────────────────────

const NAMING_STATE = { naming: { separator: '-', bayPad: 2 }, binOverrides: {} };

test('resolveBayLabel: first bay is 01 with default naming', () => {
  const rack = { id: 'ROW-C', rowToken: 'C', bayStart: 1, bayReverse: false, bays: 13, type: 'STD' };
  assert.equal(resolveBayLabel(NAMING_STATE, rack, 0), 'C-01');
});

test('resolveBayLabel: last bay reflects bays count', () => {
  const rack = { id: 'ROW-C', rowToken: 'C', bayStart: 1, bayReverse: false, bays: 13, type: 'STD' };
  assert.equal(resolveBayLabel(NAMING_STATE, rack, 12), 'C-13');
});

test('resolveBayLabel: bayReverse reverses the numbering', () => {
  const rack = { id: 'ROW-C', rowToken: 'C', bayStart: 1, bayReverse: true, bays: 13, type: 'STD' };
  assert.equal(resolveBayLabel(NAMING_STATE, rack, 0), 'C-13');
  assert.equal(resolveBayLabel(NAMING_STATE, rack, 12), 'C-01');
});

test('resolveBayLabel: bayStart offsets the number', () => {
  const rack = { id: 'ROW-A', rowToken: 'A', bayStart: 5, bayReverse: false, bays: 4, type: 'STD' };
  assert.equal(resolveBayLabel(NAMING_STATE, rack, 0), 'A-05');
  assert.equal(resolveBayLabel(NAMING_STATE, rack, 3), 'A-08');
});

test('resolveBayLabel: custom separator and bayPad', () => {
  const state = { naming: { separator: '/', bayPad: 3 }, binOverrides: {} };
  const rack = { id: 'ROW-X', rowToken: 'X', bayStart: 1, bayReverse: false, bays: 2, type: 'STD' };
  assert.equal(resolveBayLabel(state, rack, 0), 'X/001');
});

test('resolveBayLabel matches expandBins level-1 prefix for every bay', () => {
  const state = {
    naming: { separator: '-', bayPad: 2 },
    binOverrides: {},
    binTypes: { STD: { w: 3, d: 2, h: 6, color: '#aaa' } },
    zones: [],
    racks: [
      {
        id: 'ROW-C',
        type: 'STD',
        dir: 'N',
        bays: 4,
        levels: 2,
        levelHeights: [6, 6],
        rowToken: 'C',
        bayStart: 1,
        bayReverse: true,
        x: 0,
        y: 0,
      },
    ],
  };
  const rack = state.racks[0];
  const sep = state.naming.separator;
  const level1 = expandBins(state).filter((b) => b.row === rack.id && b.level === 1);
  for (let b = 0; b < rack.bays; b++) {
    const bayLabel = resolveBayLabel(state, rack, b);
    assert.equal(level1[b].whse_location, `${bayLabel}${sep}1`, `bay ${b} mismatch`);
  }
});

// ── expandBins: bayLevelOverrides ────────────────────────────────────────────

const BLO_BASE_STATE = {
  naming: { separator: '-', bayPad: 2 },
  binOverrides: {},
  binTypes: { STD: { w: 3, d: 1, h: 6, color: '#aaa' } },
  zones: [],
};

test('expandBins: override bay produces more levels than row default', () => {
  const state = {
    ...BLO_BASE_STATE,
    racks: [
      {
        id: 'ROW-A',
        type: 'STD',
        dir: 'N',
        bays: 3,
        levels: 2,
        levelHeights: [6, 8],
        rowToken: 'A',
        bayStart: 1,
        bayReverse: false,
        x: 0,
        y: 0,
        bayLevelOverrides: { 1: { levels: 3, levelHeights: [4, 4, 4] } },
      },
    ],
  };
  const bins = expandBins(state);
  // bay index 0 (bayNum 1): row default → 2 levels
  // bay index 1 (bayNum 2): override    → 3 levels
  // bay index 2 (bayNum 3): row default → 2 levels
  assert.equal(bins.filter((b) => b.bay === 1).length, 2);
  assert.equal(bins.filter((b) => b.bay === 2).length, 3);
  assert.equal(bins.filter((b) => b.bay === 3).length, 2);
});

test('expandBins: override bay uses override levelHeights for z', () => {
  const state = {
    ...BLO_BASE_STATE,
    racks: [
      {
        id: 'ROW-A',
        type: 'STD',
        dir: 'N',
        bays: 2,
        levels: 2,
        levelHeights: [6, 8],
        rowToken: 'A',
        bayStart: 1,
        bayReverse: false,
        x: 0,
        y: 0,
        bayLevelOverrides: { 0: { levels: 2, levelHeights: [3, 3] } },
      },
    ],
  };
  const bins = expandBins(state);
  // bay index 0 (bayNum 1): heights [3,3] → level 1 z=0, level 2 z=3
  // bay index 1 (bayNum 2): heights [6,8] → level 1 z=0, level 2 z=6
  const b1l1 = bins.find((b) => b.bay === 1 && b.level === 1);
  const b1l2 = bins.find((b) => b.bay === 1 && b.level === 2);
  const b2l2 = bins.find((b) => b.bay === 2 && b.level === 2);
  assert.equal(b1l1.z, 0);
  assert.equal(b1l2.z, 3);
  assert.equal(b2l2.z, 6);
});

test('expandBins: rack without bayLevelOverrides renders identically to pre-v6 behaviour', () => {
  const state = {
    ...BLO_BASE_STATE,
    racks: [
      {
        id: 'ROW-A',
        type: 'STD',
        dir: 'N',
        bays: 2,
        levels: 2,
        levelHeights: [6, 8],
        rowToken: 'A',
        bayStart: 1,
        bayReverse: false,
        x: 0,
        y: 0,
      },
    ],
  };
  const stateWithEmpty = {
    ...BLO_BASE_STATE,
    racks: [{ ...state.racks[0], bayLevelOverrides: {} }],
  };
  assert.deepEqual(expandBins(state), expandBins(stateWithEmpty));
});

test('enrichForExport adds zone, distance and bins without mutating state', () => {
  const state = JSON.parse(JSON.stringify(defaultState));
  state.nodes = [
    { id: 'N1', kind: 'junction', x: -40, y: 30 },
    { id: 'N2', kind: 'junction', x: -50, y: 30 },
  ];
  state.edges = [{ a: 'N1', b: 'N2', ramp: false }];
  const snapshot = JSON.parse(JSON.stringify(state));
  const out = enrichForExport(state);
  assert.ok(Array.isArray(out.bins));
  assert.ok('zone' in out.nodes[0]);
  assert.ok('distance_m' in out.edges[0]);
  assert.deepEqual(state, snapshot); // input untouched
});

// ── rack row spacing (aisle / pitch) ─────────────────────────────────────────

test('rackAisle: explicit value wins, fallback otherwise', () => {
  assert.equal(rackAisle({ aisle: 3.5 }, 1), 3.5);
  assert.equal(rackAisle({ aisle: 0 }, 1), 0); // explicit back-to-back is honoured
  assert.equal(rackAisle({}, 2.5), 2.5); // no aisle → inherits the fallback
  assert.equal(rackAisle({ aisle: -1 }, 4), 4); // invalid value ignored
  assert.equal(rackAisle({ aisle: 'x' }, 4), 4);
});

test('rackAisle: falls back to the built-in default when none is given', () => {
  assert.equal(rackAisle({}), DEFAULT_RACK_AISLE);
});

test('rackFootprint: dir E runs bays along x, dir N along y', () => {
  const bt = { STD: { w: 3, d: 1 } };
  assert.deepEqual(rackFootprint({ type: 'STD', dir: 'E', bays: 4 }, bt), {
    spanX: 12,
    spanY: 1,
    depth: 1,
  });
  assert.deepEqual(rackFootprint({ type: 'STD', dir: 'N', bays: 4 }, bt), {
    spanX: 1,
    spanY: 12,
    depth: 1,
  });
});

test('rackRowAxis: rows stack below for E, east for N, pitch = depth + aisle', () => {
  const bt = { STD: { w: 3, d: 2 } };
  assert.deepEqual(rackRowAxis({ type: 'STD', dir: 'E', aisle: 3 }, bt), {
    axis: 'y',
    sign: -1,
    depth: 2,
    pitch: 5,
  });
  assert.deepEqual(rackRowAxis({ type: 'STD', dir: 'N', aisle: 3 }, bt), {
    axis: 'x',
    sign: 1,
    depth: 2,
    pitch: 5,
  });
});

test('rackRowAxis: uses the fallback aisle when the rack has none', () => {
  const bt = { STD: { w: 3, d: 1 } };
  assert.equal(rackRowAxis({ type: 'STD', dir: 'N' }, bt, 2.5).pitch, 3.5);
});

test('nextRackRow: steps by depth + aisle along the cross axis', () => {
  const bt = { STD: { w: 3, d: 1 } };
  // dir N: next row sits depth(1) + aisle(3) = 4 m east
  assert.deepEqual(nextRackRow({ type: 'STD', dir: 'N', bays: 2, x: -65, y: 10, aisle: 3 }, bt), {
    x: -61,
    y: 10,
  });
  // dir E: next row sits 4 m below (screen down)
  assert.deepEqual(nextRackRow({ type: 'STD', dir: 'E', bays: 2, x: 5, y: 20, aisle: 3 }, bt), {
    x: 5,
    y: 16,
  });
  // two steps → two pitches
  assert.deepEqual(nextRackRow({ type: 'STD', dir: 'N', bays: 2, x: 0, y: 0, aisle: 3 }, bt, 2), {
    x: 8,
    y: 0,
  });
});

test('nextRackRow: fallback aisle applies when the rack has none', () => {
  const bt = { STD: { w: 3, d: 1 } };
  assert.deepEqual(nextRackRow({ type: 'STD', dir: 'N', bays: 2, x: 0, y: 0 }, bt, 1, 2.5), {
    x: 3.5,
    y: 0,
  });
});

test('aisleFit: maps a clear width to the equipment tier it suits', () => {
  assert.deepEqual(aisleFit(3.5), { min: 3.5, label: 'Counterbalance forklift', tone: 'ok' });
  assert.equal(aisleFit(4.2).label, 'Counterbalance forklift');
  assert.equal(aisleFit(2.7).label, 'Reach truck');
  assert.equal(aisleFit(2.5).label, 'Powered pallet truck (BOPT)');
  assert.equal(aisleFit(2.2).label, 'Powered pallet truck (BOPT)');
  assert.equal(aisleFit(2.1).label, 'Hand pallet truck / walkway');
  assert.equal(aisleFit(1.4).label, 'Hand pallet truck / walkway');
  assert.equal(aisleFit(0.5).tone, 'bad');
});

test('aisleFit: clamps junk and negative widths to the tightest tier', () => {
  assert.equal(aisleFit(-5).label, 'Too tight for equipment');
  assert.equal(aisleFit(NaN).label, 'Too tight for equipment');
  assert.equal(aisleFit(undefined).label, 'Too tight for equipment');
});

test('rackBlockPositions: single rows step by depth + aisle on the cross axis', () => {
  // dir N stacks east (x); dir E stacks toward -y (screen down)
  assert.deepEqual(rackBlockPositions({ x: 0, y: 0, dir: 'N', depth: 1, aisle: 2, rows: 3 }), [
    { x: 0, y: 0, twin: false },
    { x: 3, y: 0, twin: false },
    { x: 6, y: 0, twin: false },
  ]);
  assert.deepEqual(rackBlockPositions({ x: 10, y: 20, dir: 'E', depth: 2, aisle: 1.5, rows: 2 }), [
    { x: 10, y: 20, twin: false },
    { x: 10, y: 16.5, twin: false },
  ]);
});

test('rackBlockPositions: a twin step is a back-to-back pair plus the aisle', () => {
  // N: pair shares a spine at x+1; next pair starts 2*depth + aisle = 4 away
  assert.deepEqual(rackBlockPositions({ x: 0, y: 0, dir: 'N', depth: 1, aisle: 2, rows: 2, twin: true }), [
    { x: 0, y: 0, twin: false },
    { x: 1, y: 0, twin: true },
    { x: 4, y: 0, twin: false },
    { x: 5, y: 0, twin: true },
  ]);
  // E: the mirrored row sits depth below, sharing the spine at y
  assert.deepEqual(rackBlockPositions({ x: 0, y: 0, dir: 'E', depth: 1, aisle: 2, rows: 2, twin: true }), [
    { x: 0, y: 0, twin: false },
    { x: 0, y: -1, twin: true },
    { x: 0, y: -4, twin: false },
    { x: 0, y: -5, twin: true },
  ]);
});

test('rackBlockPositions: at least one row, at most 500 pairs', () => {
  assert.equal(rackBlockPositions({ x: 0, y: 0, dir: 'N', depth: 1, aisle: 1, rows: 0 }).length, 1);
  assert.equal(rackBlockPositions({ x: 0, y: 0, dir: 'N', depth: 1, aisle: 1, rows: 900 }).length, 500);
});

test('matchBinType: returns the key whose W/D/H match, else null', () => {
  const bt = { STD: { w: 3, d: 1, h: 6 }, EURO: { w: 1.2, d: 0.8, h: 4 } };
  assert.equal(matchBinType(bt, { w: 3, d: 1, h: 6 }), 'STD');
  assert.equal(matchBinType(bt, { w: 1.2, d: 0.8, h: 4 }), 'EURO');
  assert.equal(matchBinType(bt, { w: 3, d: 1, h: 5 }), null);
  assert.equal(matchBinType({}, { w: 1, d: 1, h: 1 }), null);
});

test('rowTokensFor: single letters increment, other bases gain a number', () => {
  assert.deepEqual(rowTokensFor('A', 4), ['A', 'B', 'C', 'D']);
  assert.deepEqual(rowTokensFor('A', 1), ['A']);
  assert.deepEqual(rowTokensFor('ROW1', 3), ['ROW1', 'ROW12', 'ROW13']);
  assert.deepEqual(rowTokensFor('', 2), ['', '2']);
  // Wrapping past Z falls back to a numeric suffix instead of a symbol
  assert.deepEqual(rowTokensFor('Z', 2), ['Z', 'Z2']);
});
