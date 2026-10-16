// schema.js — the layout data contract.
//
// SCHEMA_VERSION is the version of the on-disk/in-storage layout format. Bump it
// whenever the shape of a layout changes, and add a migration in migrations.js
// that upgrades the previous version to the new one. validateLayout() is a
// lightweight structural check used by import and by the test suite; it is not a
// full JSON-Schema validator, just enough to catch obviously broken files.

import { FIXTURE_ROTATIONS } from './fixtures.js';

export const SCHEMA_VERSION = 7;

// Editor-native kinds (door/ramp/junction/dock/staging/charge) plus db_connect
// kinds (access_point/waypoint/staging_area/reference_marker) tolerated on
// import so a real db_connect file validates without translation (DEBT-005).
export const NODE_KINDS = [
  'door',
  'ramp',
  'junction',
  'dock',
  'staging',
  'charge',
  'access_point',
  'waypoint',
  'staging_area',
  'reference_marker',
];
export const RACK_DIRS = ['E', 'N'];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Returns { ok: boolean, errors: string[] }.
export function validateLayout(layout) {
  const errors = [];
  const push = (m) => errors.push(m);

  if (layout == null || typeof layout !== 'object') {
    return { ok: false, errors: ['layout is not an object'] };
  }
  if (layout.schemaVersion !== SCHEMA_VERSION) {
    push(`schemaVersion must be ${SCHEMA_VERSION} (got ${layout.schemaVersion}); run a migration first`);
  }
  if (!layout.meta || typeof layout.meta.name !== 'string') {
    push('meta.name must be a string');
  }

  for (const key of ['zones', 'nodes', 'edges', 'racks']) {
    if (!Array.isArray(layout[key])) push(`${key} must be an array`);
  }
  if (!layout.binTypes || typeof layout.binTypes !== 'object') {
    push('binTypes must be an object');
  }

  // naming config
  const naming = layout.naming;
  if (!naming || typeof naming !== 'object' || Array.isArray(naming)) {
    push('naming must be an object');
  } else {
    if (typeof naming.separator !== 'string') push('naming.separator must be a string');
    if (!Number.isInteger(naming.bayPad) || naming.bayPad < 1)
      push('naming.bayPad must be a positive integer');
  }

  // binOverrides
  if (
    layout.binOverrides == null ||
    typeof layout.binOverrides !== 'object' ||
    Array.isArray(layout.binOverrides)
  ) {
    push('binOverrides must be an object');
  }

  // Optional editor extensions. Layouts written before free text / label
  // styling existed simply omit them, so these are only checked when present.
  if (layout.texts != null) {
    if (!Array.isArray(layout.texts)) {
      push('texts must be an array');
    } else {
      layout.texts.forEach((t, i) => {
        if (typeof t.id !== 'string') push(`texts[${i}].id must be a string`);
        if (typeof t.text !== 'string') push(`texts[${i}].text must be a string`);
        if (!isFiniteNumber(t.x) || !isFiniteNumber(t.y)) push(`texts[${i}] needs numeric x,y`);
        if (!isFiniteNumber(t.size) || t.size <= 0) push(`texts[${i}].size must be a positive number`);
      });
    }
  }
  if (layout.labelStyle != null) {
    if (typeof layout.labelStyle !== 'object' || Array.isArray(layout.labelStyle)) {
      push('labelStyle must be an object');
    } else {
      if (!isFiniteNumber(layout.labelStyle.scale) || layout.labelStyle.scale <= 0)
        push('labelStyle.scale must be a positive number');
      if (typeof layout.labelStyle.font !== 'string') push('labelStyle.font must be a string');
    }
  }
  if (layout.labelOverrides != null) {
    if (typeof layout.labelOverrides !== 'object' || Array.isArray(layout.labelOverrides)) {
      push('labelOverrides must be an object');
    } else {
      for (const [key, ov] of Object.entries(layout.labelOverrides)) {
        if (ov == null || typeof ov !== 'object' || Array.isArray(ov)) {
          push(`labelOverrides[${key}] must be an object`);
          continue;
        }
        if (ov.size != null && (!isFiniteNumber(ov.size) || ov.size <= 0))
          push(`labelOverrides[${key}].size must be a positive number`);
        if (ov.font != null && typeof ov.font !== 'string')
          push(`labelOverrides[${key}].font must be a string`);
      }
    }
  }

  if (layout.fixtures != null) {
    if (!Array.isArray(layout.fixtures)) {
      push('fixtures must be an array');
    } else {
      layout.fixtures.forEach((fx, i) => {
        if (typeof fx.id !== 'string') push(`fixtures[${i}].id must be a string`);
        if (typeof fx.kind !== 'string') push(`fixtures[${i}].kind must be a string`);
        if (!isFiniteNumber(fx.x) || !isFiniteNumber(fx.y)) push(`fixtures[${i}] needs numeric x,y`);
        if (!isFiniteNumber(fx.w) || fx.w <= 0) push(`fixtures[${i}].w must be a positive number`);
        if (!isFiniteNumber(fx.d) || fx.d <= 0) push(`fixtures[${i}].d must be a positive number`);
        if (!FIXTURE_ROTATIONS.includes(fx.rot))
          push(`fixtures[${i}].rot must be one of ${FIXTURE_ROTATIONS.join(', ')}`);
      });
    }
  }

  (layout.zones || []).forEach((z, i) => {
    for (const k of ['x', 'y', 'w', 'd', 'elev', 'clearH']) {
      if (!isFiniteNumber(z[k])) push(`zones[${i}].${k} must be a number`);
    }
    if (typeof z.id !== 'string') push(`zones[${i}].id must be a string`);
  });

  const nodeIds = new Set();
  (layout.nodes || []).forEach((n, i) => {
    if (typeof n.id !== 'string') push(`nodes[${i}].id must be a string`);
    else nodeIds.add(n.id);
    if (!isFiniteNumber(n.x) || !isFiniteNumber(n.y)) push(`nodes[${i}] needs numeric x,y`);
    if (n.kind && !NODE_KINDS.includes(n.kind)) push(`nodes[${i}].kind "${n.kind}" is not a known kind`);
  });

  (layout.edges || []).forEach((e, i) => {
    if (!nodeIds.has(e.a)) push(`edges[${i}].a "${e.a}" references a missing node`);
    if (!nodeIds.has(e.b)) push(`edges[${i}].b "${e.b}" references a missing node`);
  });

  const binTypeNames = Object.keys(layout.binTypes || {});
  (layout.racks || []).forEach((r, i) => {
    if (typeof r.id !== 'string') push(`racks[${i}].id must be a string`);
    if (!RACK_DIRS.includes(r.dir)) push(`racks[${i}].dir must be one of ${RACK_DIRS.join(', ')}`);
    if (!Number.isInteger(r.bays) || r.bays < 1) push(`racks[${i}].bays must be a positive integer`);
    if (!Number.isInteger(r.levels) || r.levels < 1) push(`racks[${i}].levels must be a positive integer`);
    if (r.aisle !== undefined && r.aisle !== null && (!isFiniteNumber(r.aisle) || r.aisle < 0))
      push(`racks[${i}].aisle must be a non-negative number when present`);
    if (!Array.isArray(r.levelHeights)) {
      push(`racks[${i}].levelHeights must be an array`);
    } else {
      if (r.levelHeights.length !== r.levels) {
        push(`racks[${i}].levelHeights.length (${r.levelHeights.length}) must equal levels (${r.levels})`);
      }
      if (!r.levelHeights.every((h) => isFiniteNumber(h) && h > 0)) {
        push(`racks[${i}].levelHeights must contain only positive numbers`);
      }
    }
    if (typeof r.rowToken !== 'string' || r.rowToken.length === 0)
      push(`racks[${i}].rowToken must be a non-empty string`);
    if (!Number.isInteger(r.bayStart) || r.bayStart < 1)
      push(`racks[${i}].bayStart must be a positive integer`);
    if (typeof r.bayReverse !== 'boolean') push(`racks[${i}].bayReverse must be a boolean`);
    if (!binTypeNames.includes(r.type)) push(`racks[${i}].type "${r.type}" is not a defined bin type`);
    const blo = r.bayLevelOverrides;
    if (blo != null) {
      if (typeof blo !== 'object' || Array.isArray(blo)) {
        push(`racks[${i}].bayLevelOverrides must be an object`);
      } else {
        Object.entries(blo).forEach(([bayKey, ov]) => {
          if (!ov || typeof ov !== 'object') {
            push(`racks[${i}].bayLevelOverrides[${bayKey}] must be an object`);
            return;
          }
          if (!Number.isInteger(ov.levels) || ov.levels < 1)
            push(`racks[${i}].bayLevelOverrides[${bayKey}].levels must be a positive integer`);
          if (!Array.isArray(ov.levelHeights)) {
            push(`racks[${i}].bayLevelOverrides[${bayKey}].levelHeights must be an array`);
          } else {
            if (ov.levelHeights.length !== ov.levels)
              push(`racks[${i}].bayLevelOverrides[${bayKey}].levelHeights.length must equal levels`);
            if (!ov.levelHeights.every((h) => isFiniteNumber(h) && h > 0))
              push(
                `racks[${i}].bayLevelOverrides[${bayKey}].levelHeights must contain only positive numbers`,
              );
          }
        });
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
