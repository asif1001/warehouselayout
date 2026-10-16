// geometry.js — pure layout math. No DOM, no THREE, no side effects, so every
// function here is straightforward to unit-test.

// The zone whose footprint contains (x, y), or null.
export function zoneOf(zones, x, y) {
  return zones.find((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.d) || null;
}

// Distance from point (px,py) to the segment (x1,y1)-(x2,y2). Used for edge hit-testing.
export function ptSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Straight-line length of an edge from its two endpoint nodes, or null if an
// endpoint is missing.
export function edgeLength(nodes, edge) {
  const a = nodes.find((n) => n.id === edge.a);
  const b = nodes.find((n) => n.id === edge.b);
  return a && b ? +Math.hypot(a.x - b.x, a.y - b.y).toFixed(1) : null;
}

// Expand rack runs into individual bins with whse_location labels and world
// coordinates. Three naming layers apply in priority order:
//   1. binOverrides["rackId|bayIndex|level"] — wins over everything
//   2. Per-rack fields: rowToken, bayStart, bayReverse
//   3. Top-level naming: { separator, bayPad }
// z is computed cumulatively from r.levelHeights via levelBaseZ().
export function expandBins(state) {
  const naming = state.naming ?? { separator: '-', bayPad: 2 };
  const overrides = state.binOverrides ?? {};
  const sep = typeof naming.separator === 'string' ? naming.separator : '-';
  const bayPad = Number.isInteger(naming.bayPad) && naming.bayPad >= 1 ? naming.bayPad : 2;
  const bins = [];
  for (const r of state.racks) {
    const t = state.binTypes[r.type];
    if (!t) continue;
    const zone = zoneOf(state.zones, r.x, r.y);
    const zid = zone ? zone.id : '?';
    const zoneElev = zone ? zone.elev : 0;
    const rowToken = r.rowToken ?? r.id.replace(/^[^-]+-/, '');
    const bayStart = Number.isInteger(r.bayStart) && r.bayStart >= 1 ? r.bayStart : 1;
    const bayReverse = r.bayReverse === true;
    const rowLevelHeights = Array.isArray(r.levelHeights)
      ? r.levelHeights
      : Array.from({ length: Math.max(r.levels, 1) }, () => t.h || 0.12);
    for (let b = 0; b < r.bays; b++) {
      const blo = r.bayLevelOverrides?.[b];
      const effectiveLevels = blo?.levels ?? Math.max(r.levels, 1);
      const effectiveLevelHeights = blo?.levelHeights ?? rowLevelHeights;
      const cx = r.x + (r.dir === 'E' ? b * t.w + t.w / 2 : t.d / 2);
      const cy = r.y + (r.dir === 'N' ? b * t.w + t.w / 2 : t.d / 2);
      const bayNum = bayReverse ? bayStart + r.bays - 1 - b : bayStart + b;
      const bayStr = String(bayNum).padStart(bayPad, '0');
      for (let l = 1; l <= effectiveLevels; l++) {
        const overrideKey = `${r.id}|${b}|${l}`;
        const generated = `${rowToken}${sep}${bayStr}${sep}${l}`;
        const whse_location = overrides[overrideKey] ?? generated;
        bins.push({
          bin_label: whse_location,
          whse_location,
          override_key: overrideKey,
          zone: zid,
          row: r.id,
          bay: bayNum,
          level: l,
          bin_type: r.type,
          x: +cx.toFixed(1),
          y: +cy.toFixed(1),
          z: +(zoneElev + levelBaseZ(effectiveLevelHeights, l - 1)).toFixed(1),
        });
      }
    }
  }
  return bins;
}

// Returns the cumulative z base (bottom edge) of level `levelIndex` given an
// array of per-level heights. Level 0 starts at z=0; each subsequent level
// starts at the sum of all preceding level heights.
export function levelBaseZ(levelHeights, levelIndex) {
  let z = 0;
  for (let i = 0; i < levelIndex; i++) z += levelHeights[i];
  return z;
}

// Return the 0-based bay index that world point (x, y) falls within for the
// given rack, or null if the point is outside the rack's footprint.
export function bayOf(rack, binTypes, x, y) {
  const t = binTypes[rack.type];
  if (!t) return null;
  if (rack.dir === 'E') {
    if (x < rack.x || x > rack.x + rack.bays * t.w || y < rack.y || y > rack.y + t.d) return null;
    const b = Math.floor((x - rack.x) / t.w);
    return b >= 0 && b < rack.bays ? b : null;
  }
  if (x < rack.x || x > rack.x + t.d || y < rack.y || y > rack.y + rack.bays * t.w) return null;
  const b = Math.floor((y - rack.y) / t.w);
  return b >= 0 && b < rack.bays ? b : null;
}

// ── Rack row spacing ────────────────────────────────────────────────────────
// A rack row has a cross-axis thickness (its depth) and an *aisle*: the clear
// gap kept between this row and the next row stacked on its far side. Rows are
// therefore spaced `pitch = depth + aisle` apart. The aisle is a per-row value
// (`rack.aisle`); when absent the caller's fallback (the warehouse-wide
// default) applies, so one setting can space a whole block.

export const DEFAULT_RACK_AISLE = 1; // metres — clear gap used when unset

// Effective clear-gap distance for a rack, in metres.
export function rackAisle(rack, fallback = DEFAULT_RACK_AISLE) {
  const a = rack?.aisle;
  if (Number.isFinite(a) && a >= 0) return a;
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : DEFAULT_RACK_AISLE;
}

// Full axis-aligned footprint of a rack row: { spanX, spanY, depth }. `depth`
// is the cross-axis thickness — the direction rows stack in — and is always the
// bin type's `d`, whichever way the row runs.
export function rackFootprint(rack, binTypes) {
  const t = binTypes?.[rack.type] || { w: 4.5, d: 4 };
  if (rack.dir === 'E') return { spanX: rack.bays * t.w, spanY: t.d, depth: t.d };
  return { spanX: t.d, spanY: rack.bays * t.w, depth: t.d };
}

// How rows of this rack stack: which world axis, which sign, and the row pitch.
// dir 'E' rows run east, so the next row sits below (negative y); dir 'N' rows
// run north, so the next row sits east (positive x).
export function rackRowAxis(rack, binTypes, fallback) {
  const { depth } = rackFootprint(rack, binTypes);
  return {
    axis: rack.dir === 'E' ? 'y' : 'x',
    sign: rack.dir === 'E' ? -1 : 1,
    depth,
    pitch: depth + rackAisle(rack, fallback),
  };
}

// Anchor (Start x / Start y) of the `steps`-th row beyond this one. steps = 1 is
// the immediately adjacent row, one pitch away.
export function nextRackRow(rack, binTypes, steps = 1, fallback) {
  const a = rackRowAxis(rack, binTypes, fallback);
  const delta = a.sign * a.pitch * steps;
  return {
    x: rack.x + (a.axis === 'x' ? delta : 0),
    y: rack.y + (a.axis === 'y' ? delta : 0),
  };
}

// Standard aisle clearances, widest first, for the "what fits here?" readout in
// the New-rack dialog. Approximate planning guidance — not a code ruling.
export const AISLE_GUIDE = [
  { min: 3.5, label: 'Counterbalance forklift', tone: 'ok' },
  { min: 2.7, label: 'Reach truck', tone: 'ok' },
  { min: 2.2, label: 'Powered pallet truck (BOPT)', tone: 'warn' },
  { min: 1.4, label: 'Hand pallet truck / walkway', tone: 'warn' },
  { min: 0, label: 'Too tight for equipment', tone: 'bad' },
];

// Which aisle tier a clear width falls into: { min, label, tone }.
export function aisleFit(metres) {
  const m = Number.isFinite(metres) && metres >= 0 ? metres : 0;
  return { ...(AISLE_GUIDE.find((g) => m >= g.min) ?? AISLE_GUIDE[AISLE_GUIDE.length - 1]) };
}

// Anchor positions for a block of identical rows laid out from one start point.
// With `twin`, each step is a back-to-back pair (two rows sharing a spine), so a
// step is 2·depth + aisle; otherwise it is depth + aisle. Returns one entry per
// rack, in placement order, each flagged `twin` for the mirrored second row.
export function rackBlockPositions({ x, y, dir, depth, aisle = 0, rows = 1, twin = false }) {
  const n = Math.max(1, Math.min(500, Math.floor(rows) || 1));
  const step = (twin ? depth * 2 : depth) + Math.max(0, aisle);
  const sign = dir === 'E' ? -1 : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const main = {
      x: x + (dir === 'E' ? 0 : sign * step * i),
      y: y + (dir === 'E' ? sign * step * i : 0),
      twin: false,
    };
    out.push(main);
    if (twin) {
      out.push({
        x: main.x + (dir === 'E' ? 0 : depth),
        y: main.y + (dir === 'E' ? -depth : 0),
        twin: true,
      });
    }
  }
  return out;
}

// Key of a bin type whose W/D/H match `dims`, or null when none does (so the
// caller can save the size as a new type).
export function matchBinType(binTypes, { w, d, h }, tol = 1e-6) {
  for (const [name, t] of Object.entries(binTypes || {})) {
    if (Math.abs(t.w - w) <= tol && Math.abs(t.d - d) <= tol && Math.abs(t.h - h) <= tol) return name;
  }
  return null;
}

// Row tokens for a block of rows sharing one base label: a single letter
// increments (A → B → C); anything else gains a numeric suffix (ROW1, ROW12…).
export function rowTokensFor(base, count) {
  const b = String(base ?? '');
  const n = Math.max(1, Math.min(500, Math.floor(count) || 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push(b);
    } else if (/^[A-Za-z]$/.test(b)) {
      const c = String.fromCharCode(b.charCodeAt(0) + (i % 26));
      out.push(/^[A-Za-z]$/.test(c) ? c : `${b}${i + 1}`);
    } else {
      out.push(`${b}${i + 1}`);
    }
  }
  return out;
}

// Resolve the row-bay label for a single bay (no level suffix). Uses the same
// naming fields as expandBins so the result always matches the prefix of the
// whse_location that expandBins emits for level 1 of this bay (no overrides).
export function resolveBayLabel(state, rack, bayIndex) {
  const naming = state.naming ?? { separator: '-', bayPad: 2 };
  const sep = typeof naming.separator === 'string' ? naming.separator : '-';
  const bayPad = Number.isInteger(naming.bayPad) && naming.bayPad >= 1 ? naming.bayPad : 2;
  const rowToken = rack.rowToken ?? rack.id.replace(/^[^-]+-/, '');
  const bayStart = Number.isInteger(rack.bayStart) && rack.bayStart >= 1 ? rack.bayStart : 1;
  const bayReverse = rack.bayReverse === true;
  const bayNum = bayReverse ? bayStart + rack.bays - 1 - bayIndex : bayStart + bayIndex;
  return `${rowToken}${sep}${String(bayNum).padStart(bayPad, '0')}`;
}

// Produce the export payload: a deep copy of the editor state enriched with
// derived fields (node zone, edge distance, expanded bins) that are convenient
// for downstream consumers but are not part of the editable model.
export function enrichForExport(state) {
  const out = JSON.parse(JSON.stringify(state));
  out.nodes.forEach((n) => {
    const z = zoneOf(state.zones, n.x, n.y);
    n.zone = z ? z.id : null;
  });
  out.edges.forEach((ed) => {
    ed.distance_m = edgeLength(state.nodes, ed);
  });
  out.bins = expandBins(state);
  return out;
}
