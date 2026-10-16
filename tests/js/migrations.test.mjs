import test from 'node:test';
import assert from 'node:assert/strict';

import { migrate, detectVersion } from '../../app/js/migrations.js';
import { SCHEMA_VERSION } from '../../app/js/schema.js';

const legacyV1 = {
  meta: { name: 'OLD', version: 1 },
  settings: { snap: 0.3, grid: 3 },
  binTypes: {},
  zones: [],
  nodes: [],
  edges: [],
  racks: [],
  bg: null,
};

test('a layout without schemaVersion is treated as v1', () => {
  assert.equal(detectVersion(legacyV1), 1);
});

test('migrate lifts v1 to the current schema version', () => {
  const up = migrate(legacyV1);
  // v5 db_connect format: version lives in editor.schemaVersion, not top-level
  assert.equal(up.editor.schemaVersion, SCHEMA_VERSION);
});

test('migrate moves meta.version out of meta', () => {
  const up = migrate(legacyV1);
  assert.ok(!('version' in up.meta));
  assert.equal(up.meta.name, 'OLD');
});

test('migrate does not mutate its input', () => {
  const before = JSON.parse(JSON.stringify(legacyV1));
  migrate(legacyV1);
  assert.deepEqual(legacyV1, before);
});

test('an already-current layout passes through unchanged in version', () => {
  const current = { ...legacyV1, schemaVersion: SCHEMA_VERSION, meta: { name: 'NEW' } };
  assert.equal(migrate(current).schemaVersion, SCHEMA_VERSION);
});

test('a future schema version throws rather than silently downgrading', () => {
  const future = { ...legacyV1, schemaVersion: SCHEMA_VERSION + 1 };
  assert.throws(() => migrate(future), /newer than this app supports/);
});

// ── migration 5→6: bayLevelOverrides ─────────────────────────────────────────

const V5_LAYOUT = {
  meta: { name: 'T', schema_version: 2 },
  editor: { schemaVersion: 5, naming: { separator: '-', bayPad: 2 }, binOverrides: {} },
  settings: { units: 'metres' },
  binTypes: { STD: { w: 3, d: 1, h: 6, color: '#aaa' } },
  zones: [],
  racks: [
    {
      id: 'ROW-A',
      type: 'STD',
      orientation: 'length_along_y',
      bays: 3,
      levels: 2,
      levelHeights: [6, 8],
      rowToken: 'A',
      bayStart: 1,
      bayReverse: false,
      access_face: null,
      back_to_back_spine: null,
      x: 0,
      y: 0,
    },
  ],
  nodes: [],
  edges: [],
  bg: null,
  bins: [],
  categories: {},
  vehicles: {},
  dwell_times: {},
};

test('migrate() walks 5→6 and adds bayLevelOverrides: {} to racks that lack it', () => {
  const up = migrate(V5_LAYOUT);
  assert.equal(up.editor.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(up.racks[0].bayLevelOverrides, {});
  assert.deepEqual(up.fixtures, []);
});

test('migration 5→6 preserves existing bayLevelOverrides on racks that already have them', () => {
  const withBlo = {
    ...V5_LAYOUT,
    racks: [
      {
        ...V5_LAYOUT.racks[0],
        bayLevelOverrides: { 1: { levels: 1, levelHeights: [3] } },
      },
    ],
  };
  const up = migrate(withBlo);
  assert.deepEqual(up.racks[0].bayLevelOverrides, { 1: { levels: 1, levelHeights: [3] } });
});

test('migration 6→7 seeds an empty fixtures array', () => {
  const v6 = {
    ...V5_LAYOUT,
    fixtures: undefined,
    editor: { ...V5_LAYOUT.editor, schemaVersion: 6 },
  };
  const up = migrate(v6);
  assert.equal(up.editor.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(up.fixtures, []);
});

test('migration 6→7 keeps existing fixtures intact', () => {
  const fx = [{ id: 'F-1', kind: 'door', x: 1, y: 2, w: 1, d: 0.16, rot: 90 }];
  const v6 = { ...V5_LAYOUT, fixtures: fx, editor: { ...V5_LAYOUT.editor, schemaVersion: 6 } };
  const up = migrate(v6);
  assert.deepEqual(up.fixtures, fx);
});

test('migrate() is idempotent (re-running on a current layout is a no-op)', () => {
  const up1 = migrate(V5_LAYOUT);
  assert.equal(up1.editor.schemaVersion, SCHEMA_VERSION);
  // A current layout should pass through migrate() unchanged in schemaVersion
  const up2 = migrate(up1);
  assert.equal(up2.editor.schemaVersion, SCHEMA_VERSION);
});
