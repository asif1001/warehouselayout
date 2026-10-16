// fixtures.test.mjs — the pure fixture catalogue + model, and the plan symbols.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIXTURES,
  FIXTURE_GROUPS,
  FIXTURE_ROTATIONS,
  fixtureDef,
  fixturesInGroup,
  isFixtureKind,
  createFixture,
  nextFixtureId,
  rotateFixture,
  fixtureAabb,
  fixtureAt,
  normalizeFixtures,
} from '../../app/js/fixtures.js';
import { SYMBOLS, drawSymbol } from '../../app/js/symbols.js';

// A context that records calls instead of painting, so symbol drawing can be
// exercised without a real canvas.
function recorder() {
  const calls = [];
  const noop =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  return {
    calls,
    beginPath: noop('beginPath'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    stroke: noop('stroke'),
    fill: noop('fill'),
    fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'),
    arc: noop('arc'),
    ellipse: noop('ellipse'),
    rect: noop('rect'),
    roundRect: noop('roundRect'),
    save: noop('save'),
    restore: noop('restore'),
    translate: noop('translate'),
    rotate: noop('rotate'),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  };
}

// ── catalogue ────────────────────────────────────────────────────────────────

test('every fixture has a section, sensible size, height and a known symbol', () => {
  for (const d of FIXTURES) {
    assert.ok(typeof d.kind === 'string' && d.kind, `${d.kind} needs a kind`);
    assert.ok(FIXTURE_GROUPS.includes(d.group), `${d.kind} has an unknown group`);
    assert.ok(typeof d.section === 'string' && d.section, `${d.kind} needs a section`);
    assert.ok(typeof d.label === 'string' && d.label, `${d.kind} needs a label`);
    assert.ok(d.w > 0 && d.d > 0, `${d.kind} needs a positive footprint`);
    assert.ok(d.h > 0, `${d.kind} needs a positive 3D height`);
    assert.match(d.color, /^#[0-9a-f]{6}$/i, `${d.kind} needs a plain hex colour`);
    assert.ok(SYMBOLS[d.symbol], `${d.kind} references an unknown symbol ${d.symbol}`);
  }
});

test('fixture kinds are unique', () => {
  const kinds = FIXTURES.map((d) => d.kind);
  assert.equal(new Set(kinds).size, kinds.length);
});

test('fixtureDef() finds known kinds and rejects unknown ones', () => {
  assert.equal(fixtureDef('door').label, 'Door');
  assert.equal(fixtureDef('forklift').group, 'warehouse');
  assert.equal(fixtureDef('nope'), null);
  assert.equal(isFixtureKind('pallet'), true);
  assert.equal(isFixtureKind('nope'), false);
});

test('fixturesInGroup() splits building from warehouse in catalogue order', () => {
  const building = fixturesInGroup('building');
  const warehouse = fixturesInGroup('warehouse');
  assert.ok(building.length > 0);
  assert.ok(warehouse.length > 0);
  assert.equal(building.length + warehouse.length, FIXTURES.length);
  assert.ok(building.every((d) => d.group === 'building'));
  assert.equal(building[0].kind, 'door');
  assert.equal(warehouse[0].kind, 'pallet');
});

// ── model ────────────────────────────────────────────────────────────────────

test('createFixture() uses the catalogue footprint and a neutral rotation', () => {
  const f = createFixture('desk', 12, 34);
  assert.deepEqual(
    { kind: f.kind, x: f.x, y: f.y, w: f.w, d: f.d, rot: f.rot },
    { kind: 'desk', x: 12, y: 34, w: 1.6, d: 0.8, rot: 0 },
  );
  assert.equal(createFixture('nope', 0, 0), null);
});

test('nextFixtureId() skips ids that are already taken', () => {
  assert.equal(nextFixtureId([]), 'F-1');
  assert.equal(nextFixtureId([{ id: 'F-1' }, { id: 'F-3' }]), 'F-2');
  assert.equal(nextFixtureId([{ id: 'F-1' }, { id: 'F-2' }]), 'F-3');
});

test('rotateFixture() stays inside the quarter turns', () => {
  assert.equal(rotateFixture({ rot: 0 }, 90), 90);
  assert.equal(rotateFixture({ rot: 270 }, 90), 0);
  assert.equal(rotateFixture({ rot: 0 }, -90), 270);
  assert.ok(FIXTURE_ROTATIONS.includes(rotateFixture({}, 90)));
});

test('fixtureAabb() swaps width and depth at a quarter turn', () => {
  const f = { kind: 'door', x: 10, y: 20, w: 2, d: 0.5, rot: 0 };
  assert.deepEqual(fixtureAabb(f), { x: 9, y: 19.75, w: 2, d: 0.5 });
  assert.deepEqual(fixtureAabb({ ...f, rot: 90 }), { x: 9.75, y: 19, w: 0.5, d: 2 });
  assert.deepEqual(fixtureAabb({ ...f, rot: 180 }), { x: 9, y: 19.75, w: 2, d: 0.5 });
  assert.deepEqual(fixtureAabb({ ...f, rot: 270 }), { x: 9.75, y: 19, w: 0.5, d: 2 });
});

test('fixtureAt() returns the topmost hit and honours rotation', () => {
  const lower = { id: 'F-1', kind: 'wall', x: 0, y: 0, w: 10, d: 10, rot: 0 };
  const upper = { id: 'F-2', kind: 'chair', x: 0, y: 0, w: 1, d: 1, rot: 0 };
  assert.equal(fixtureAt([lower, upper], 0, 0), upper); // later entry wins
  assert.equal(fixtureAt([upper, lower], 0, 0), lower);
  assert.equal(fixtureAt([upper], 5, 5), null);

  // A 2×0.5 door rotated 90° is 0.5 wide × 2 deep.
  const door = { id: 'F-3', kind: 'door', x: 0, y: 0, w: 2, d: 0.5, rot: 90 };
  assert.equal(fixtureAt([door], 0.2, 0.9), door);
  assert.equal(fixtureAt([door], 0.9, 0.2), null);
});

test('normalizeFixtures() repairs a messy list without losing unknown kinds', () => {
  const out = normalizeFixtures([
    { kind: 'door', x: '3', y: 4, w: -1, d: '0.2', rot: 45 },
    { kind: 'teleporter', x: 1, y: 1 }, // unknown kind: kept, not drawn
    null,
    'nope',
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { kind: 'door', id: 'F-1', x: 3, y: 4, w: 1, d: 0.2, rot: 0 });
  // Unknown kind falls back to a 1×1 footprint so it still round-trips.
  assert.deepEqual(out[1], { kind: 'teleporter', id: 'F-2', x: 1, y: 1, w: 1, d: 1, rot: 0 });
});

test('normalizeFixtures() returns [] for anything that is not a list', () => {
  assert.deepEqual(normalizeFixtures(undefined), []);
  assert.deepEqual(normalizeFixtures(null), []);
  assert.deepEqual(normalizeFixtures({}), []);
});

// ── symbols ──────────────────────────────────────────────────────────────────

test('drawSymbol() draws every catalogue symbol without throwing', () => {
  for (const d of FIXTURES) {
    const ctx = recorder();
    assert.equal(drawSymbol(d.symbol, ctx, -20, -10, 40, 20, d.color), true, d.kind);
    assert.ok(ctx.calls.length > 0, `${d.kind} drew nothing`);
  }
});

test('drawSymbol() ignores unknown symbols and degenerate boxes', () => {
  const ctx = recorder();
  assert.equal(drawSymbol('does-not-exist', ctx, 0, 0, 10, 10, '#fff'), false);
  assert.equal(drawSymbol('panel', ctx, 0, 0, 0, 10, '#fff'), false);
  assert.equal(drawSymbol('panel', ctx, 0, 0, 10, -1, '#fff'), false);
  assert.equal(ctx.calls.length, 0);
});
