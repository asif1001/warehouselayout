// fixtures.js — the catalogue and model for placed building + warehouse
// elements (doors, windows, desks, dock levellers, pallets, forklifts…).
//
// Pure: no DOM, no canvas, no three.js, so it stays unit-testable. The 2D plan
// symbols live in symbols.js and the 3D shapes in models3d.js.
//
// Every fixture is an axis-aligned footprint in metres plus a quarter-turn
// rotation about its centre. Keeping rotation to 90° steps means the bounding
// box stays exact, which keeps hit-testing honest.

// Rotation is limited to quarter turns, so a fixture's AABB is always exact.
export const FIXTURE_ROTATIONS = [0, 90, 180, 270];

// The two menus these appear under in the toolbar.
export const FIXTURE_GROUPS = ['building', 'warehouse'];

// `w` × `d` are the default footprint in metres, `h` the 3D height, `symbol`
// picks the plan drawing in symbols.js, and `section` groups the menu entries.
export const FIXTURES = [
  // ── building · openings ───────────────────────────────────────────────────
  {
    kind: 'door',
    group: 'building',
    section: 'Openings',
    label: 'Door',
    w: 1,
    d: 0.16,
    h: 2.1,
    color: '#d8b25e',
    symbol: 'swingDoor',
  },
  {
    kind: 'double-door',
    group: 'building',
    section: 'Openings',
    label: 'Double Door',
    w: 2,
    d: 0.16,
    h: 2.1,
    color: '#d8b25e',
    symbol: 'doubleDoor',
  },
  {
    kind: 'shutter',
    group: 'building',
    section: 'Openings',
    label: 'Shutter Door',
    w: 3,
    d: 0.28,
    h: 3,
    color: '#c98b4b',
    symbol: 'shutter',
  },
  {
    kind: 'window',
    group: 'building',
    section: 'Openings',
    label: 'Window',
    w: 1.5,
    d: 0.22,
    h: 1.2,
    color: '#7fd4ff',
    symbol: 'window',
  },
  {
    kind: 'gate',
    group: 'building',
    section: 'Openings',
    label: 'Gate',
    w: 4,
    d: 0.28,
    h: 2.4,
    color: '#c0c8d2',
    symbol: 'gate',
  },

  // ── building · structure & services ──────────────────────────────────────
  {
    kind: 'wall',
    group: 'building',
    section: 'Structure & services',
    label: 'Wall',
    w: 4,
    d: 0.2,
    h: 4,
    color: '#b8c2cc',
    symbol: 'panel',
  },
  {
    kind: 'column',
    group: 'building',
    section: 'Structure & services',
    label: 'Column',
    w: 0.6,
    d: 0.6,
    h: 6,
    color: '#9aa6b3',
    symbol: 'column',
  },
  {
    kind: 'stair',
    group: 'building',
    section: 'Structure & services',
    label: 'Staircase',
    w: 1.2,
    d: 3,
    h: 3,
    color: '#a9b7c6',
    symbol: 'stairs',
  },
  {
    kind: 'toilet',
    group: 'building',
    section: 'Structure & services',
    label: 'Toilet / WC',
    w: 1.6,
    d: 2,
    h: 2.4,
    color: '#9fd0e8',
    symbol: 'wc',
  },
  {
    kind: 'sink',
    group: 'building',
    section: 'Structure & services',
    label: 'Sink',
    w: 0.8,
    d: 0.6,
    h: 0.9,
    color: '#9fd0e8',
    symbol: 'sink',
  },

  // ── building · dock equipment ────────────────────────────────────────────
  {
    kind: 'dock-leveller',
    group: 'building',
    section: 'Dock equipment',
    label: 'Dock Leveller',
    w: 3,
    d: 2.2,
    h: 0.15,
    color: '#8fbc6a',
    symbol: 'dockLeveller',
  },
  {
    kind: 'dock-shelter',
    group: 'building',
    section: 'Dock equipment',
    label: 'Dock Shelter',
    w: 3.4,
    d: 1.2,
    h: 3,
    color: '#6f9e52',
    symbol: 'dockShelter',
  },
  {
    kind: 'bollard',
    group: 'building',
    section: 'Dock equipment',
    label: 'Bollard',
    w: 0.3,
    d: 0.3,
    h: 0.9,
    color: '#e0a03c',
    symbol: 'bollard',
  },

  // ── building · office furniture ──────────────────────────────────────────
  {
    kind: 'desk',
    group: 'building',
    section: 'Office furniture',
    label: 'Office Desk',
    w: 1.6,
    d: 0.8,
    h: 0.75,
    color: '#c9a86a',
    symbol: 'desk',
  },
  {
    kind: 'table',
    group: 'building',
    section: 'Office furniture',
    label: 'Table',
    w: 1.2,
    d: 0.8,
    h: 0.75,
    color: '#c9a86a',
    symbol: 'panel',
  },
  {
    kind: 'meeting-table',
    group: 'building',
    section: 'Office furniture',
    label: 'Meeting Table',
    w: 2.4,
    d: 1.2,
    h: 0.75,
    color: '#c9a86a',
    symbol: 'tableChairs',
  },
  {
    kind: 'chair',
    group: 'building',
    section: 'Office furniture',
    label: 'Chair',
    w: 0.5,
    d: 0.5,
    h: 0.9,
    color: '#b8975a',
    symbol: 'chair',
  },
  {
    kind: 'cabinet',
    group: 'building',
    section: 'Office furniture',
    label: 'Cabinet / Locker',
    w: 0.9,
    d: 0.45,
    h: 1.8,
    color: '#a08a63',
    symbol: 'panel',
  },

  // ── warehouse · equipment ────────────────────────────────────────────────
  {
    kind: 'pallet',
    group: 'warehouse',
    section: 'Equipment',
    label: 'Pallet',
    w: 1.2,
    d: 0.8,
    h: 0.15,
    color: '#c8a165',
    symbol: 'pallet',
  },
  {
    kind: 'forklift',
    group: 'warehouse',
    section: 'Equipment',
    label: 'Forklift',
    w: 1.4,
    d: 3,
    h: 2.2,
    color: '#e8a33d',
    symbol: 'forklift',
  },
  {
    kind: 'bopt',
    group: 'warehouse',
    section: 'Equipment',
    label: 'BOPT (powered pallet truck)',
    w: 0.75,
    d: 1.9,
    h: 1.3,
    color: '#6fb3d0',
    symbol: 'palletTruck',
  },
  {
    kind: 'hpt',
    group: 'warehouse',
    section: 'Equipment',
    label: 'HPT (hand pallet truck)',
    w: 0.7,
    d: 1.8,
    h: 1.2,
    color: '#8a94a0',
    symbol: 'palletTruck',
  },
];

const BY_KIND = new Map(FIXTURES.map((f) => [f.kind, f]));

export function fixtureDef(kind) {
  return BY_KIND.get(kind) || null;
}

// The entries for one menu, in catalogue order.
export function fixturesInGroup(group) {
  return FIXTURES.filter((f) => f.group === group);
}

export function isFixtureKind(kind) {
  return BY_KIND.has(kind);
}

// A new fixture centred on (x, y) at its catalogue size.
export function createFixture(kind, x, y) {
  const def = fixtureDef(kind);
  if (!def) return null;
  return { id: 'F-1', kind, x, y, w: def.w, d: def.d, rot: 0 };
}

// Next unused F-n id, so ids stay stable and readable in the exported file.
export function nextFixtureId(fixtures) {
  const used = new Set((fixtures || []).map((f) => f && f.id));
  let i = 1;
  while (used.has('F-' + i)) i++;
  return 'F-' + i;
}

// Quarter-turn rotation, normalised into FIXTURE_ROTATIONS.
export function rotateFixture(f, delta) {
  const next = ((Number(f.rot) || 0) + delta + 360) % 360;
  return FIXTURE_ROTATIONS.includes(next) ? next : 0;
}

// The axis-aligned footprint of a fixture: 90°/270° swap width and depth, which
// is why only quarter turns are allowed.
export function fixtureAabb(f) {
  const quarter = f.rot === 90 || f.rot === 270;
  const w = quarter ? f.d : f.w;
  const d = quarter ? f.w : f.d;
  return { x: f.x - w / 2, y: f.y - d / 2, w, d };
}

// Topmost fixture under a world point, or null. Later entries win, matching the
// paint order.
export function fixtureAt(fixtures, x, y) {
  for (let i = (fixtures || []).length - 1; i >= 0; i--) {
    const b = fixtureAabb(fixtures[i]);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.d) return fixtures[i];
  }
  return null;
}

// Defensive cleanup for fixtures coming from a loaded/imported file. Unknown
// kinds are kept (so a round-trip never loses data) but simply do not draw.
export function normalizeFixtures(fixtures) {
  if (!Array.isArray(fixtures)) return [];
  return fixtures
    .filter((f) => f && typeof f === 'object' && typeof f.kind === 'string' && f.kind)
    .map((f, i) => {
      const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
      const def = fixtureDef(f.kind);
      const w = num(f.w, def ? def.w : 1);
      const d = num(f.d, def ? def.d : 1);
      const rot = FIXTURE_ROTATIONS.includes(Number(f.rot)) ? Number(f.rot) : 0;
      return {
        ...f,
        id: typeof f.id === 'string' && f.id ? f.id : 'F-' + (i + 1),
        kind: f.kind,
        x: num(f.x, 0),
        y: num(f.y, 0),
        w: w > 0 ? w : 1,
        d: d > 0 ? d : 1,
        rot,
      };
    });
}
