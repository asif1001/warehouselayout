// models3d.test.mjs — the 3D shape data for the placed fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIXTURES, fixtureDef } from '../../app/js/fixtures.js';
import { fixtureParts } from '../../app/js/models3d.js';

// Every part must be a well-formed primitive with finite, positive sizes.
function checkPart(part, kind) {
  assert.ok(part.shape === 'box' || part.shape === 'cyl', `${kind}: shape ${part.shape}`);
  for (const k of ['x', 'y', 'z']) {
    assert.ok(Number.isFinite(part[k]), `${kind}: ${k} must be finite`);
  }
  assert.ok(Number.isFinite(part.rx) || part.rx === undefined, `${kind}: rx must be finite`);
  if (part.opacity !== undefined) {
    assert.ok(part.opacity > 0 && part.opacity <= 1, `${kind}: opacity out of range`);
  }
  if (part.shape === 'box') {
    for (const k of ['w', 'h', 'd']) {
      assert.ok(part[k] > 0, `${kind}: ${k} must be positive`);
    }
  } else {
    assert.ok(part.r > 0 && part.h > 0, `${kind}: r and h must be positive`);
    assert.ok(['x', 'y', 'z'].includes(part.axis), `${kind}: axis ${part.axis}`);
  }
}

test('every catalogue kind produces at least one well-formed part', () => {
  for (const def of FIXTURES) {
    const parts = fixtureParts(def.kind, def.w, def.d, def.h);
    assert.ok(Array.isArray(parts) && parts.length > 0, `${def.kind}: no parts`);
    parts.forEach((p) => checkPart(p, def.kind));
  }
});

// The whole point of the module: equipment is modelled, not just blocked in.
test('equipment is modelled with more than one primitive', () => {
  for (const kind of ['forklift', 'bopt', 'hpt', 'pallet', 'stair', 'desk', 'chair', 'toilet']) {
    const def = fixtureDef(kind);
    const parts = fixtureParts(kind, def.w, def.d, def.h);
    assert.ok(parts.length > 1, `${kind}: expected a model, got ${parts.length} part(s)`);
  }
});

test('kinds that really are a slab keep the single-box fallback', () => {
  for (const kind of ['wall', 'door', 'dock-leveller', 'cabinet']) {
    const def = fixtureDef(kind);
    const parts = fixtureParts(kind, def.w, def.d, def.h);
    assert.equal(parts.length, 1, `${kind} should be one part`);
    assert.equal(parts[0].shape, 'box');
    assert.equal(parts[0].w, def.w);
    assert.equal(parts[0].d, def.d);
  }
});

test('the round fixtures stay cylinders', () => {
  for (const kind of ['bollard', 'column']) {
    const def = fixtureDef(kind);
    const parts = fixtureParts(kind, def.w, def.d, def.h);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].shape, 'cyl');
    assert.equal(parts[0].r, Math.min(def.w, def.d) / 2);
    assert.equal(parts[0].h, def.h);
  }
});

test('a forklift has a mast reaching up and forks down at the front', () => {
  const def = fixtureDef('forklift');
  const parts = fixtureParts('forklift', def.w, def.d, def.h);
  const top = Math.max(...parts.map((p) => p.y + p.h / 2));
  assert.ok(top > def.h * 0.85, `nothing reaches the top of the mast (${top})`);
  // The forks sit below knee height and toward the front (negative local z is
  // north, so the front is +z).
  const forks = parts.filter((p) => p.y < 0.25 && p.z > 0.2);
  assert.ok(forks.length >= 2, 'expected two low fork tines at the front');
  // Wheels: laid-down cylinders.
  const wheels = parts.filter((p) => p.shape === 'cyl' && p.axis === 'x');
  assert.ok(wheels.length >= 4, 'expected four wheels');
});

test('a pallet stays inside its footprint and its height', () => {
  const def = fixtureDef('pallet');
  const parts = fixtureParts('pallet', def.w, def.d, def.h);
  for (const p of parts) {
    assert.ok(Math.abs(p.x) + p.w / 2 <= def.w / 2 + 1e-9, 'pallet parts stay within the width');
    assert.ok(Math.abs(p.z) + p.d / 2 <= def.d / 2 + 1e-9, 'pallet parts stay within the depth');
    assert.ok(p.y + p.h / 2 <= def.h + 1e-9, 'pallet parts stay under the height');
  }
});

test('a resized fixture drives the model size', () => {
  const parts = fixtureParts('pallet', 2.4, 1.6, 0.15);
  const widest = Math.max(...parts.map((p) => p.w));
  assert.ok(widest > 2, `expected the slats to span the wider pallet (${widest})`);
});

test('an unknown kind still draws its footprint', () => {
  const parts = fixtureParts('jetpack', 1.5, 0.7, 0.9);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].shape, 'box');
  assert.equal(parts[0].w, 1.5);
  assert.equal(parts[0].d, 0.7);
  assert.equal(parts[0].h, 0.9);
  assert.equal(parts[0].y, 0.45);
});

test('degenerate sizes fall back to a sane box', () => {
  const parts = fixtureParts('pallet', 0, NaN, -3);
  assert.ok(parts.length > 0);
  parts.forEach((p) => checkPart(p, 'degenerate'));
});
