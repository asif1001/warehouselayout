// store.js — where a layout comes from and where the working draft is cached.
//
// Source of truth at startup:
//   1. If the browser has a saved draft in localStorage, use it (migrated).
//   2. Otherwise fetch the shipped default from data/default_layout.json.
//
// The localStorage copy is a convenience draft cache so a reload doesn't lose
// in-progress edits. It is NOT a substitute for Export JSON (or, later, the
// Postgres backend) — see README and docs/postgres.md.

import { migrate } from './migrations.js';
import { fromDbConnect, toDbConnect } from './dbconnect.js';

export const LS_KEY = 'warehouse_layout_editor_v1';
const DEFAULT_LAYOUT_URL = 'data/default_layout.json';

// Which saved cloud layout the working draft belongs to, so a reload keeps
// overwriting it instead of silently creating a duplicate. Per-browser state,
// deliberately not part of the layout document itself.
export const CLOUD_LINK_KEY = 'warehouse_layout_editor_cloud_v1';

export function saveCloudLink(link) {
  try {
    localStorage.setItem(CLOUD_LINK_KEY, JSON.stringify({ id: link.id, name: link.name }));
  } catch {
    /* a full quota must not break editing */
  }
}

export function loadCloudLink() {
  try {
    const raw = localStorage.getItem(CLOUD_LINK_KEY);
    if (!raw) return null;
    const link = JSON.parse(raw);
    return link && typeof link.id === 'string' && link.id ? { id: link.id, name: link.name ?? null } : null;
  } catch {
    return null;
  }
}

export function clearCloudLink() {
  try {
    localStorage.removeItem(CLOUD_LINK_KEY);
  } catch {
    /* ignore */
  }
}

// A fresh, empty layout: keeps the shipped defaults' structure (meta, settings,
// bin types, naming) but none of its content, so a new layout still exports and
// validates like any other.
export function blankLayout(defaults) {
  const out = JSON.parse(JSON.stringify(defaults));
  out.zones = [];
  out.racks = [];
  out.nodes = [];
  out.edges = [];
  out.fixtures = [];
  out.texts = [];
  out.labelOverrides = {};
  out.binOverrides = {};
  out.bg = null;
  return out;
}

export async function fetchDefaultLayout() {
  const res = await fetch(DEFAULT_LAYOUT_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Could not load ${DEFAULT_LAYOUT_URL} (HTTP ${res.status})`);
  }
  return fromDbConnect(migrate(await res.json()));
}

// Returns { layout, fromCache }. Throws only if BOTH localStorage and the
// default fetch fail (e.g. opened from a file:// URL).
export async function loadInitialLayout() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { layout: fromDbConnect(migrate(JSON.parse(raw))), fromCache: true };
  } catch (err) {
    // Corrupt cache shouldn't be fatal — fall through to the default.
    console.warn('Ignoring unreadable localStorage draft:', err);
  }
  return { layout: await fetchDefaultLayout(), fromCache: false };
}

// Synchronously write the working draft. Saves in db_connect format so the
// stored value is always a valid db_connect file (dir on racks is preserved
// via fromDbConnect when the draft is reloaded). Throws on quota errors.
export function saveLayout(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(toDbConnect(state)));
}

export function clearDraft() {
  localStorage.removeItem(LS_KEY);
}
