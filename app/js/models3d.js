// models3d.js — the 3D shape of a placed fixture, as plain data.
//
// The 2D plan symbol (symbols.js) draws inside a rectangle (x, y, w, d) with y
// growing downward, after the caller has rotated the canvas. These models use
// the same layout so a 3D part sits where its plan symbol draws it: a part is
// placed in a local frame where
//
//   +x  runs across the fixture's width  (east when rot = 0)
//   +z  runs down the symbol's depth     (south when rot = 0)
//   +y  runs up from the fixture's base
//
// A feature the symbol draws at fraction (fx, fy) of its box therefore sits at
// x = (fx - 0.5) * w and z = (fy - 0.5) * d. The 3D view drops the parts into a
// group, positions it at the fixture and applies the fixture's rotation, so the
// models never need to know where they are.
//
// Parts are plain objects — no three.js — which keeps the models unit-testable;
// `fixtureParts` turns each one into a mesh. An unknown kind falls back to a
// single box, so a file written by a newer build still draws something.

// Colours for the machinery details that are not the fixture's own colour.
const TYRE = '#20242a';
const STEEL = '#707b88';
const DARK = '#39414c';
const GLASS = '#8fd3f5';

// A box centred on (x, z) spanning y0..y1, optionally tilted about x (used for
// the pallet truck's raked tiller).
function box(x, y, z, w, h, d, color, rx = 0) {
  return { shape: 'box', x, y, z, w, h, d, color, rx };
}

// A cylinder, vertical by default; `axis` lays it on its side (wheels).
function cyl(x, y, z, r, h, color, axis = 'y') {
  return { shape: 'cyl', x, y, z, r, h, color, axis };
}

// A box described the way the plan symbols describe shapes: two fractions across
// the width, an absolute height band, and two fractions down the depth.
function span(w, d, fx0, fx1, y0, y1, fy0, fy1, color, rx = 0) {
  return box(
    ((fx0 + fx1) / 2 - 0.5) * w,
    (y0 + y1) / 2,
    ((fy0 + fy1) / 2 - 0.5) * d,
    Math.abs(fx1 - fx0) * w,
    Math.abs(y1 - y0),
    Math.abs(fy1 - fy0) * d,
    color,
    rx,
  );
}

// ── warehouse equipment ─────────────────────────────────────────────────────

// A counterbalance forklift: counterweight and body, the operator's seat under an
// overhead guard, a tall mast at the front and two fork tines reaching out.
// Mirrors the plan symbol, which draws the body at fy 0.30–0.76, the cab at the
// rear and the mast and forks at fy 0.80–1.00.
function forklift(w, d, h, c) {
  const p = [];
  const top = h * 0.95;
  p.push(span(w, d, 0.08, 0.92, 0.22, 0.7, 0.3, 0.78, c)); // chassis
  p.push(span(w, d, 0.08, 0.92, 0.22, 0.95, 0.3, 0.46, c)); // counterweight
  p.push(span(w, d, 0.26, 0.42, 0.7, 0.84, 0.4, 0.62, DARK)); // seat
  p.push(span(w, d, 0.58, 0.74, 0.7, 0.84, 0.4, 0.62, DARK)); // backrest
  // Overhead guard: four posts carrying a roof over the operator.
  p.push(span(w, d, 0.1, 0.18, 0.7, top, 0.28, 0.36, DARK));
  p.push(span(w, d, 0.82, 0.9, 0.7, top, 0.28, 0.36, DARK));
  p.push(span(w, d, 0.1, 0.18, 0.7, top, 0.58, 0.66, DARK));
  p.push(span(w, d, 0.82, 0.9, 0.7, top, 0.58, 0.66, DARK));
  p.push(span(w, d, 0.04, 0.96, top, top + 0.08, 0.24, 0.7, DARK));
  // Mast: two uprights with cross-members, then the fork carriage and tines.
  p.push(span(w, d, 0.14, 0.22, 0.3, top + 0.04, 0.84, 0.94, STEEL));
  p.push(span(w, d, 0.78, 0.86, 0.3, top + 0.04, 0.84, 0.94, STEEL));
  p.push(span(w, d, 0.14, 0.86, 0.34, 0.46, 0.86, 0.92, STEEL));
  p.push(span(w, d, 0.3, 0.7, 0.18, 0.56, 0.86, 0.92, DARK)); // carriage
  p.push(span(w, d, 0.26, 0.44, 0.1, 0.18, 0.9, 1.0, STEEL)); // fork tines
  p.push(span(w, d, 0.56, 0.74, 0.1, 0.18, 0.9, 1.0, STEEL));
  // Wheels: larger drive wheels under the mast, smaller steer wheels behind.
  const axle = w / 2 - 0.16;
  for (const sx of [-1, 1]) {
    p.push(cyl(sx * axle, 0.3, (0.74 - 0.5) * d, 0.3, 0.16, TYRE, 'x'));
    p.push(cyl(sx * axle, 0.21, (0.4 - 0.5) * d, 0.21, 0.14, TYRE, 'x'));
  }
  return p;
}

// A pallet: three bearers under a deck of slats, which is what the plan symbol
// scores across the footprint.
function pallet(w, d, h, c) {
  const p = [];
  const bearing = Math.max(0.04, h * 0.36);
  for (const fy of [0.18, 0.5, 0.82]) {
    p.push(span(w, d, 0.02, 0.98, 0, bearing, fy - 0.07, fy + 0.07, c));
  }
  for (const fx of [0.06, 0.28, 0.5, 0.72, 0.94]) {
    p.push(span(w, d, fx - 0.05, fx + 0.05, bearing, h, 0.02, 0.98, c));
  }
  return p;
}

// A pallet truck, shared by the powered (BOPT) and hand (HPT) versions: a power
// head, two low fork tines, load wheels at the tips and a raked tiller. The
// powered one adds the battery box the operator stands behind.
function palletTruck(w, d, h, c, powered) {
  const p = [];
  const deck = Math.max(0.05, h * 0.06);
  p.push(span(w, d, 0.24, 0.76, 0, 0.34, 0.5, 0.8, c)); // power head / chassis
  if (powered) p.push(span(w, d, 0.26, 0.74, 0.34, 0.58, 0.54, 0.78, c)); // battery box
  p.push(span(w, d, 0.24, 0.4, 0, deck, 0.5, 1.0, STEEL)); // fork tines
  p.push(span(w, d, 0.6, 0.76, 0, deck, 0.5, 1.0, STEEL));
  // Tiller: raked back over the head so the handle clears it, with a grip bar.
  const rise = h * 0.62;
  const angle = -0.55;
  const base = 0.06;
  p.push(
    box(
      0,
      0.34 + (rise / 2) * Math.cos(angle),
      base + (rise / 2) * Math.sin(angle),
      w * 0.1,
      rise,
      w * 0.1,
      c,
      angle,
    ),
  );
  p.push(box(0, 0.34 + rise * Math.cos(angle), base + rise * Math.sin(angle), w * 0.66, 0.06, 0.06, DARK));
  // Load wheels at the tips, steer wheels under the head.
  p.push(cyl(w * 0.2, deck / 2, (0.92 - 0.5) * d, deck * 0.9, 0.08, TYRE, 'x'));
  p.push(cyl(-w * 0.2, deck / 2, (0.92 - 0.5) * d, deck * 0.9, 0.08, TYRE, 'x'));
  p.push(cyl(w * 0.24, 0.08, (0.58 - 0.5) * d, 0.08, 0.07, TYRE, 'x'));
  p.push(cyl(-w * 0.24, 0.08, (0.58 - 0.5) * d, 0.08, 0.07, TYRE, 'x'));
  return p;
}

// ── building · openings, structure and services ─────────────────────────────

// A glazed panel: a frame with a translucent pane, so the glass reads as glass.
function windowPanel(w, d, h, c) {
  const f = Math.max(0.05, h * 0.06);
  const p = [
    span(w, d, 0, 1, 0, f, 0, 1, c),
    span(w, d, 0, 1, h - f, h, 0, 1, c),
    span(w, d, 0, f, f, h - f, 0, 1, c),
    span(w, d, 1 - f, 1, f, h - f, 0, 1, c),
  ];
  const pane = span(w, d, 0.04, 0.96, f, h - f, 0.3, 0.7, GLASS);
  pane.opacity = 0.45;
  p.push(pane);
  return p;
}

// A gate: a lattice of rails between two posts.
function gatePanel(w, d, h, c) {
  const p = [];
  const post = Math.max(0.08, w * 0.04);
  p.push(span(w, d, 0, post / w, 0, h, 0, 1, c));
  p.push(span(w, d, 1 - post / w, 1, 0, h, 0, 1, c));
  for (const fy of [0.62, 0.82, 1.02]) p.push(span(w, d, 0, 1, h * fy, h * fy + 0.08, 0.4, 0.6, c));
  for (const fx of [0.2, 0.4, 0.6, 0.8]) p.push(span(w, d, fx - 0.02, fx + 0.02, 0, h, 0.4, 0.6, c));
  return p;
}

// A staircase: eight treads of increasing height.
function staircase(w, d, h, c) {
  const p = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    p.push(span(w, d, 0.02, 0.98, 0, (h * (i + 1)) / n, i / n, (i + 1) / n, c));
  }
  return p;
}

// A WC cubicle: three walls around a bowl.
function toilet(w, d, h, c) {
  const t = Math.max(0.06, w * 0.06);
  const p = [
    span(w, d, 0, 1, 0, h, 0, t / d, c), // back wall
    span(w, d, 0, t / w, 0, h, 0, 0.88, c), // side walls
    span(w, d, 1 - t / w, 1, 0, h, 0, 0.88, c),
  ];
  p.push(cyl(0, 0.2, d * 0.12, Math.min(w, d) * 0.17, 0.4, '#eef2f6'));
  p.push(span(w, d, 0.32, 0.68, 0.4, h * 0.5, 0.02, 0.14, '#eef2f6')); // cistern
  return p;
}

// A sink: basin on a pedestal, with a tap at the back.
function sink(w, d, h, c) {
  return [
    span(w, d, 0.04, 0.96, h - 0.14, h, 0.04, 0.96, c),
    span(w, d, 0.34, 0.66, 0, h - 0.14, 0.34, 0.66, c),
    cyl(0, h + 0.1, (0.14 - 0.5) * d, 0.02, 0.2, STEEL),
  ];
}

// A dock shelter: a curtain on three sides, open toward the trailer.
function dockShelter(w, d, h, c) {
  const t = 0.16;
  return [
    span(w, d, 0, 1, 0, h, 0.6, 0.72, c), // back
    span(w, d, 0, t / w, 0, h, 0.24, 1, c), // sides
    span(w, d, 1 - t / w, 1, 0, h, 0.24, 1, c),
    span(w, d, 0, 1, h * 0.88, h, 0.24, 1, c), // canopy
  ];
}

// ── office furniture ────────────────────────────────────────────────────────

// A top slab on legs, with an optional modesty panel (desk) or a ring of chairs
// (meeting table).
function table(w, d, h, c, { panel = false, chairs = 0 } = {}) {
  const p = [];
  const top = Math.max(0.04, h * 0.08);
  p.push(span(w, d, 0.01, 0.99, h - top, h, 0.01, 0.99, c));
  const iw = w / 2 - 0.1;
  const id = d / 2 - 0.1;
  const leg = Math.max(0.03, Math.min(w, d) * 0.035);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.push(cyl(sx * iw, (h - top) / 2, sz * id, leg, h - top, STEEL));
  }
  if (panel) p.push(span(w, d, 0.05, 0.95, top, h - top, 0.02, 0.06, c));
  for (let i = 0; i < chairs; i++) {
    const cx = ((i % 3) / 2 - 0.5) * w * 0.62;
    const sz = i < 3 ? -1 : 1;
    const cz = sz * (d / 2 - Math.min(w, d) * 0.16);
    p.push(box(cx, h * 0.6, cz, 0.42, 0.06, 0.42, c)); // seat
    p.push(box(cx, h * 0.78, cz + sz * 0.19, 0.42, 0.42, 0.05, c)); // back
    p.push(cyl(cx, h * 0.3, cz, 0.04, h * 0.6, STEEL));
  }
  return p;
}

// A chair: seat, back and a pedestal on a foot.
function chair(w, d, h, c) {
  return [
    box(0, h * 0.52, 0, w * 0.86, 0.07, d * 0.86, c),
    box(0, h * 0.76, -d * 0.4, w * 0.86, h * 0.5, 0.06, c),
    cyl(0, h * 0.26, 0, Math.min(w, d) * 0.08, h * 0.52, STEEL),
    cyl(0, 0.02, 0, Math.min(w, d) * 0.34, 0.04, STEEL),
  ];
}

// ── the catalogue ───────────────────────────────────────────────────────────

// kind → a function (w, d, h, colour) → part list. Kinds that are honestly a
// plain slab (wall, door, dock leveller, cabinet…) are absent and fall back to
// one box; the round ones become a single cylinder.
const post = (w, d, h, c) => [cyl(0, h / 2, 0, Math.min(w, d) / 2, h, c)];

const MODELS = {
  forklift,
  pallet,
  bopt: (w, d, h, c) => palletTruck(w, d, h, c, true),
  hpt: (w, d, h, c) => palletTruck(w, d, h, c, false),
  window: windowPanel,
  gate: gatePanel,
  stair: staircase,
  toilet,
  sink,
  'dock-shelter': dockShelter,
  desk: (w, d, h, c) => table(w, d, h, c, { panel: true }),
  table: (w, d, h, c) => table(w, d, h, c),
  'meeting-table': (w, d, h, c) => table(w, d, h, c, { chairs: 6 }),
  chair,
  bollard: post,
  column: post,
};

// The parts for one placed fixture. `w`/`d` come from the fixture (it can be
// resized by hand), `h` from its catalogue entry. Always returns at least one
// part so an unknown kind still draws its footprint.
export function fixtureParts(kind, w, d, h) {
  const W = Math.max(0.05, Number(w) || 0.5);
  const D = Math.max(0.05, Number(d) || 0.5);
  const H = Math.max(0.02, Number(h) || 0.5);
  const fn = MODELS[kind];
  const parts = fn ? fn(W, D, H, null) : [];
  return parts.length > 0 ? parts : [box(0, H / 2, 0, W, H, D, null)];
}
