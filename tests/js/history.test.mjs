import test from 'node:test';
import assert from 'node:assert/strict';

import { createHistory, cloneValue, deepEqual } from '../../app/js/history.js';

const layout = (name, zones = []) => ({ meta: { name }, zones, settings: { snap: 0.3 } });

test('a fresh history has nowhere to go', () => {
  const h = createHistory(layout('a'));
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), null);
});

test('record + undo + redo walks the timeline', () => {
  const h = createHistory(layout('a'));
  h.record(layout('b'));
  h.record(layout('c'));
  assert.equal(h.canUndo, true);
  assert.equal(h.canRedo, false);

  assert.equal(h.undo().meta.name, 'b');
  assert.equal(h.canRedo, true);
  assert.equal(h.undo().meta.name, 'a');
  assert.equal(h.canUndo, false);
  assert.equal(h.redo().meta.name, 'b');
  assert.equal(h.redo().meta.name, 'c');
  assert.equal(h.canRedo, false);
});

test('recording the same value twice is ignored', () => {
  const h = createHistory(layout('a'));
  h.record(layout('b'));
  const before = h.size;
  assert.equal(h.record(layout('b')), false);
  assert.equal(h.size, before);
  // The no-op didn't add a step, so a single undo still reaches the start.
  assert.equal(h.undo().meta.name, 'a');
  assert.equal(h.canUndo, false);
});

test('a new edit after undo drops the redo branch', () => {
  const h = createHistory(layout('a'));
  h.record(layout('b'));
  h.record(layout('c'));
  h.undo(); // back to b
  assert.equal(h.canRedo, true);
  h.record(layout('d'));
  assert.equal(h.canRedo, false);
  assert.equal(h.undo().meta.name, 'b');
});

test('the timeline is bounded by limit and keeps the newest steps', () => {
  const h = createHistory(layout('a'), { limit: 3 });
  h.record(layout('b'));
  h.record(layout('c'));
  h.record(layout('d'));
  assert.equal(h.size, 3);
  // Oldest entry (a) was dropped, so we can walk back to b but no further.
  assert.equal(h.undo().meta.name, 'c');
  assert.equal(h.undo().meta.name, 'b');
  assert.equal(h.canUndo, false);
});

test('undo returns a copy, so mutating it cannot corrupt the timeline', () => {
  const h = createHistory(layout('a'));
  h.record(layout('b', [{ id: 'X' }]));
  const snap = h.undo();
  snap.zones.push({ id: 'MUTATED' });
  snap.meta.name = 'MUTATED';
  const again = h.redo(); // the stored 'b' snapshot is still intact
  assert.equal(again.meta.name, 'b');
  assert.equal(again.zones.length, 1);
  assert.equal(again.zones[0].id, 'X');
});

test('later mutations of the caller value do not leak into history', () => {
  const live = layout('a', [{ id: 'X' }]);
  const h = createHistory(live);
  live.zones[0].id = 'CHANGED';
  live.zones.push({ id: 'NEW' });
  live.meta.name = 'CHANGED';
  h.record(layout('b'));
  const first = h.undo();
  assert.equal(first.meta.name, 'a');
  assert.equal(first.zones.length, 1);
  assert.equal(first.zones[0].id, 'X');
});

test('reset discards the timeline', () => {
  const h = createHistory(layout('a'));
  h.record(layout('b'));
  h.reset(layout('z'));
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.size, 1);
});

test('cloneValue copies nested structures without sharing references', () => {
  const src = { a: [1, { b: 2 }], c: { d: [3] }, big: 'x'.repeat(1000) };
  const copy = cloneValue(src);
  assert.notEqual(copy, src);
  assert.notEqual(copy.a, src.a);
  assert.notEqual(copy.a[1], src.a[1]);
  assert.deepEqual(copy, src);
  copy.a[1].b = 99;
  assert.equal(src.a[1].b, 2);
});

test('deepEqual understands arrays, objects and primitives', () => {
  assert.equal(deepEqual({ a: [1, 2] }, { a: [1, 2] }), true);
  assert.equal(deepEqual({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual([1, 2], { 0: 1, 1: 2 }), false);
  assert.equal(deepEqual(null, null), true);
  assert.equal(deepEqual(null, {}), false);
  assert.equal(deepEqual('a', 'a'), true);
});
