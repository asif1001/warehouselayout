// history.js — undo/redo over immutable snapshots of a plain-data value.
//
// The store never mutates what you hand it and never hands back a reference it
// still holds, so callers can't corrupt the timeline. Snapshots are deep-cloned
// with a structural copy (not JSON round-tripping) so large strings — e.g. a
// background image data URL — are passed by reference instead of re-encoded on
// every edit.

// Deep copy of plain JSON-shaped data. Arrays and objects are copied; every
// primitive (including long strings) is returned as-is.
export function cloneValue(v) {
  if (Array.isArray(v)) return v.map(cloneValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = cloneValue(v[k]);
    return out;
  }
  return v;
}

// Structural equality for JSON-shaped data. Primitive comparison short-circuits
// on identity first, so repeated big strings compare in O(1).
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// A bounded undo/redo timeline seeded with `initial`. `record()` is idempotent
// for an unchanged value, so calling it after a no-op edit adds no step.
export function createHistory(initial, { limit = 80 } = {}) {
  let entries = [cloneValue(initial)];
  let index = 0;

  const trim = () => {
    const overflow = entries.length - limit;
    if (overflow > 0) {
      entries = entries.slice(overflow);
      index -= overflow;
    }
  };

  return {
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < entries.length - 1;
    },
    get size() {
      return entries.length;
    },
    get position() {
      return index;
    },

    // Store `value` as the current step. Returns true if it was stored, false
    // when it matches the current step (nothing to record).
    record(value) {
      const snap = cloneValue(value);
      if (deepEqual(entries[index], snap)) return false;
      entries = entries.slice(0, index + 1); // a new edit drops the redo branch
      entries.push(snap);
      index = entries.length - 1;
      trim();
      return true;
    },

    // Step back/forward and return a fresh clone of the resulting value, or
    // null when there is nowhere to go.
    undo() {
      if (index <= 0) return null;
      index -= 1;
      return cloneValue(entries[index]);
    },
    redo() {
      if (index >= entries.length - 1) return null;
      index += 1;
      return cloneValue(entries[index]);
    },

    // Discard the timeline and start over from `value`.
    reset(value) {
      entries = [cloneValue(value)];
      index = 0;
    },
  };
}
