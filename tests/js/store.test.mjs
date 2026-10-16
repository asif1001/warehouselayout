// store.test.mjs — the pure part of store.js: what a brand-new blank layout is.
//
// store.js also owns the localStorage draft and the cloud link; those touched
// nothing at import time, so importing it here is safe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { blankLayout } from '../../app/js/store.js';
import { fromDbConnect, toDbConnect } from '../../app/js/dbconnect.js';
import { migrate } from '../../app/js/migrations.js';
import { validateLayout } from '../../app/js/schema.js';
import { expandBins } from '../../app/js/geometry.js';

function defaultLayout() {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../app/data/default_layout.json', import.meta.url)), 'utf8'),
  );
  return fromDbConnect(migrate(raw));
}

test('blankLayout keeps the structure and drops the content', () => {
  const defaults = defaultLayout();
  const blank = blankLayout(defaults);

  // Structure survives: a new layout still exports and validates like any other.
  assert.equal(blank.meta.name, defaults.meta.name);
  assert.deepEqual(blank.settings, defaults.settings);
  assert.deepEqual(blank.binTypes, defaults.binTypes);
  assert.deepEqual(blank.naming, defaults.naming);
  assert.equal(blank.schemaVersion, defaults.schemaVersion);

  // Content does not.
  assert.deepEqual(blank.zones, []);
  assert.deepEqual(blank.racks, []);
  assert.deepEqual(blank.nodes, []);
  assert.deepEqual(blank.edges, []);
  assert.deepEqual(blank.fixtures, []);
  assert.deepEqual(blank.texts, []);
  assert.deepEqual(blank.labelOverrides, {});
  assert.deepEqual(blank.binOverrides, {});
  assert.equal(blank.bg, null);
});

test('blankLayout does not mutate the layout it copies', () => {
  const defaults = defaultLayout();
  const before = JSON.stringify(defaults);
  blankLayout(defaults);
  assert.equal(JSON.stringify(defaults), before, 'the source layout must be untouched');
});

test('a blank layout is valid and generates no bins', () => {
  const blank = blankLayout(defaultLayout());

  const { ok, errors } = validateLayout(blank);
  assert.equal(ok, true, errors.join('; '));
  assert.deepEqual(errors, []);
  assert.deepEqual(expandBins(blank), []);

  const file = toDbConnect(blank);
  assert.deepEqual(file.bins, []);
  assert.deepEqual(file.racks, []);
  assert.deepEqual(file.zones, []);

  // And it survives the file round trip the way a saved layout does.
  const back = fromDbConnect(migrate(JSON.parse(JSON.stringify(file))));
  assert.deepEqual(back.racks, []);
  assert.equal(back.meta.name, blank.meta.name);
});
