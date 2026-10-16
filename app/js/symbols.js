// symbols.js — the 2D plan symbols for the placed fixtures (doors, windows,
// desks, dock levellers, pallets, forklifts…).
//
// Every symbol draws inside the device-pixel rectangle (x, y, w, d). The caller
// has already translated the canvas to the fixture's centre and rotated it by
// the fixture's quarter-turn, so no symbol needs to know about rotation.
//
// Pure drawing: the only input is the 2D context, which makes these easy to
// exercise with a recording stub in tests.

function line(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function stroked(ctx, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width);
}

// A door leaf hinged at the left jamb, swinging into the room below the wall.
function swingDoor(ctx, x, y, w, d, c) {
  const t = Math.max(2, d * 0.55);
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w * 0.08, d); // hinge jamb
  ctx.fillRect(x + w * 0.92, y, w * 0.08, d); // strike jamb
  ctx.fillRect(x, y + d, t, w * 0.92); // the leaf, shown open
  stroked(ctx, c, t * 0.35);
  ctx.beginPath();
  ctx.arc(x, y + d, w * 0.92, 0, Math.PI / 2); // swing
  ctx.stroke();
}

function doubleDoor(ctx, x, y, w, d, c) {
  const t = Math.max(2, d * 0.55);
  const half = w / 2;
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w * 0.05, d);
  ctx.fillRect(x + w * 0.95, y, w * 0.05, d);
  ctx.fillRect(x, y + d, t, half * 0.94);
  ctx.fillRect(x + w - t, y + d, t, half * 0.94);
  stroked(ctx, c, t * 0.35);
  ctx.beginPath();
  ctx.arc(x, y + d, half * 0.94, 0, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + w, y + d, half * 0.94, Math.PI / 2, Math.PI);
  ctx.stroke();
}

// Roller shutter: a filled panel scored into slats.
function shutter(ctx, x, y, w, d, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, d);
  stroked(ctx, 'rgba(20,24,29,0.7)', d * 0.07);
  const n = 7;
  for (let i = 1; i < n; i++) line(ctx, x + (w * i) / n, y + d * 0.1, x + (w * i) / n, y + d * 0.9);
}

function windowSym(ctx, x, y, w, d, c) {
  stroked(ctx, c, d * 0.22);
  ctx.strokeRect(x, y + d * 0.12, w, d * 0.76);
  line(ctx, x, y + d / 2, x + w, y + d / 2);
}

// Gate: a lattice panel.
function gate(ctx, x, y, w, d, c) {
  stroked(ctx, c, d * 0.18);
  ctx.strokeRect(x, y, w, d);
  const n = 6;
  for (let i = 0; i < n; i++) line(ctx, x + (w * i) / n, y + d * 0.1, x + (w * (i + 1)) / n, y + d * 0.9);
}

// Dock leveller: the platform with its hinge edge and lift chevrons.
function dockLeveller(ctx, x, y, w, d, c) {
  stroked(ctx, c, Math.max(1, d * 0.05));
  ctx.strokeRect(x, y, w, d);
  line(ctx, x, y + d * 0.18, x + w, y + d * 0.18);
  stroked(ctx, c, Math.max(1, d * 0.035));
  for (let i = 0; i < 3; i++) {
    const yy = y + d * (0.44 + i * 0.19);
    line(ctx, x + w * 0.26, yy, x + w * 0.5, yy + d * 0.11);
    line(ctx, x + w * 0.74, yy, x + w * 0.5, yy + d * 0.11);
  }
}

// Dock shelter: a three-sided curtain that wraps the trailer.
function dockShelter(ctx, x, y, w, d, c) {
  stroked(ctx, c, Math.max(2, d * 0.14));
  ctx.beginPath();
  ctx.moveTo(x + w * 0.07, y + d);
  ctx.lineTo(x + w * 0.07, y + d * 0.2);
  ctx.lineTo(x + w * 0.93, y + d * 0.2);
  ctx.lineTo(x + w * 0.93, y + d);
  ctx.stroke();
}

function bollard(ctx, x, y, w, d, c) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + d / 2, Math.min(w, d) / 2, 0, Math.PI * 2);
  ctx.fill();
}

function column(ctx, x, y, w, d, c) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, d);
  stroked(ctx, 'rgba(20,24,29,0.75)', Math.min(w, d) * 0.07);
  line(ctx, x, y, x + w, y + d);
  line(ctx, x + w, y, x, y + d);
}

// A plain footprint: walls, tables, cabinets.
function panel(ctx, x, y, w, d, c) {
  ctx.fillStyle = c + 'bb';
  stroked(ctx, c, Math.min(w, d) * 0.06);
  ctx.fillRect(x, y, w, d);
  ctx.strokeRect(x, y, w, d);
}

function stairs(ctx, x, y, w, d, c) {
  stroked(ctx, c, Math.min(w, d) * 0.05);
  ctx.strokeRect(x, y, w, d);
  const n = 9;
  for (let i = 1; i < n; i++) line(ctx, x, y + (d * i) / n, x + w, y + (d * i) / n);
  // Direction of climb.
  line(ctx, x + w / 2, y + d * 0.86, x + w / 2, y + d * 0.16);
  line(ctx, x + w / 2, y + d * 0.16, x + w / 2 - w * 0.2, y + d * 0.32);
  line(ctx, x + w / 2, y + d * 0.16, x + w / 2 + w * 0.2, y + d * 0.32);
}

function wc(ctx, x, y, w, d, c) {
  stroked(ctx, c, Math.min(w, d) * 0.05);
  ctx.strokeRect(x, y, w, d); // the cubicle
  ctx.strokeRect(x + w * 0.28, y + d * 0.16, w * 0.44, d * 0.18); // cistern
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + d * 0.6, w * 0.23, d * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function sink(ctx, x, y, w, d, c) {
  stroked(ctx, c, Math.min(w, d) * 0.08);
  ctx.strokeRect(x, y, w, d);
  ctx.beginPath();
  ctx.arc(x + w / 2, y + d / 2, Math.min(w, d) * 0.15, 0, Math.PI * 2);
  ctx.stroke();
}

function desk(ctx, x, y, w, d, c) {
  panel(ctx, x, y, w, d, c);
  // The operator's chair, tucked under the front edge.
  stroked(ctx, c, d * 0.06);
  ctx.beginPath();
  ctx.arc(x + w / 2, y + d * 1.5, d * 0.42, 0, Math.PI * 2);
  ctx.stroke();
}

function chair(ctx, x, y, w, d, c) {
  stroked(ctx, c, Math.min(w, d) * 0.14);
  const px = x + w * 0.12;
  const py = y + d * 0.12;
  const pw = w * 0.76;
  const pd = d * 0.76;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(px, py, pw, pd, Math.min(w, d) * 0.2);
  else ctx.rect(px, py, pw, pd);
  ctx.stroke();
  line(ctx, px + pw * 0.1, y, px + pw * 0.9, y); // backrest
}

function tableChairs(ctx, x, y, w, d, c) {
  panel(ctx, x + w * 0.06, y + d * 0.16, w * 0.88, d * 0.68, c);
  stroked(ctx, c, Math.min(w, d) * 0.045);
  const r = Math.min(w, d) * 0.075;
  const spots = [
    [x + w * 0.22, y + r * 0.6],
    [x + w * 0.5, y + r * 0.6],
    [x + w * 0.78, y + r * 0.6],
    [x + w * 0.22, y + d - r * 0.6],
    [x + w * 0.5, y + d - r * 0.6],
    [x + w * 0.78, y + d - r * 0.6],
  ];
  for (const [cx, cy] of spots) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// A pallet: deck boards over three bearers.
function pallet(ctx, x, y, w, d, c) {
  stroked(ctx, c, Math.max(1, d * 0.06));
  ctx.strokeRect(x, y, w, d);
  const n = 5;
  for (let i = 1; i < n; i++) line(ctx, x, y + (d * i) / n, x + w, y + (d * i) / n);
  stroked(ctx, c, Math.max(2, d * 0.13));
  for (const f of [0.18, 0.5, 0.82]) line(ctx, x + w * f, y, x + w * f, y + d);
}

function forklift(ctx, x, y, w, d, c) {
  ctx.fillStyle = c + 'cc';
  ctx.fillRect(x + w * 0.08, y + d * 0.3, w * 0.84, d * 0.46); // counterweight + body
  ctx.fillRect(x + w * 0.4, y + d * 0.1, w * 0.36, d * 0.26); // cab
  stroked(ctx, c, Math.max(2, w * 0.09));
  line(ctx, x + w * 0.18, y + d * 0.8, x + w * 0.18, y + d * 0.98); // mast
  line(ctx, x + w * 0.82, y + d * 0.8, x + w * 0.82, y + d * 0.98);
  line(ctx, x + w * 0.12, y + d * 0.98, x + w * 0.88, y + d * 0.98); // forks
}

// Shared by BOPT (powered) and HPT (hand) pallet trucks.
function palletTruck(ctx, x, y, w, d, c) {
  ctx.fillStyle = c + 'cc';
  ctx.fillRect(x + w * 0.24, y + d * 0.5, w * 0.52, d * 0.3); // power head / chassis
  stroked(ctx, c, Math.max(2, w * 0.1));
  line(ctx, x + w * 0.5, y + d * 0.5, x + w * 0.5, y + d * 0.12); // tiller
  line(ctx, x + w * 0.24, y + d * 0.12, x + w * 0.76, y + d * 0.12);
  stroked(ctx, c, Math.max(2, w * 0.07));
  line(ctx, x + w * 0.3, y + d * 0.8, x + w * 0.3, y + d * 0.98); // fork tines
  line(ctx, x + w * 0.7, y + d * 0.8, x + w * 0.7, y + d * 0.98);
}

export const SYMBOLS = {
  swingDoor,
  doubleDoor,
  shutter,
  window: windowSym,
  gate,
  dockLeveller,
  dockShelter,
  bollard,
  column,
  panel,
  stairs,
  wc,
  sink,
  desk,
  chair,
  tableChairs,
  pallet,
  forklift,
  palletTruck,
};

// Draw one symbol inside the device-pixel box (x, y, w, d). Returns false when
// the kind has no symbol (e.g. a newer file opened by an older build).
export function drawSymbol(name, ctx, x, y, w, d, color) {
  const fn = SYMBOLS[name];
  if (!fn || w <= 0 || d <= 0) return false;
  fn(ctx, x, y, w, d, color);
  return true;
}
