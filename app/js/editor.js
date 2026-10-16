// editor.js — the 2D plan editor. Owns the live `state`, the canvas camera, the
// toolset, and the side-panel UI. Pure layout math lives in geometry.js;
// persistence lives in store.js; the 3D view lives in preview3d.js.

import {
  ptSegDist,
  expandBins,
  bayOf,
  resolveBayLabel,
  rackAisle,
  rackFootprint,
  rackRowAxis,
  nextRackRow,
  rackBlockPositions,
  matchBinType,
  rowTokensFor,
  aisleFit,
  DEFAULT_RACK_AISLE,
} from './geometry.js';
import { saveLayout, fetchDefaultLayout } from './store.js';
import { createPreview3D } from './preview3d.js';
import { migrate } from './migrations.js';
import { fromDbConnect, toDbConnect } from './dbconnect.js';
import {
  createLabelState,
  normalizeLabelStyle,
  normalizeLabelOverrides,
  normalizeTexts,
  createText,
  nextTextId,
  fontString,
  labelKey,
  resolveLabelStyle,
  setLabelOverride,
  FONTS,
  LABEL_KINDS,
  DEFAULT_TEXT_SIZE,
} from './labels.js';
import { createHistory } from './history.js';
import {
  createFixture,
  normalizeFixtures,
  nextFixtureId,
  fixtureDef,
  fixtureAabb,
  fixtureAt,
  fixturesInGroup,
  rotateFixture,
  FIXTURE_GROUPS,
} from './fixtures.js';
import { drawSymbol } from './symbols.js';

let state;
let preview;
const labelState = createLabelState();

// Clear aisle (metres) used to space rack rows. A rack may carry its own
// `aisle`; otherwise the warehouse-wide default from Settings applies, so one
// value can space a whole block.
function globalAisle() {
  const v = Number(state?.settings?.aisle);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_RACK_AISLE;
}
function aisleOf(rack) {
  return rackAisle(rack, globalAisle());
}

// DOM refs (resolved in initEditor)
let cv;
let ctx;
let props;
let toolHint;

// 2D camera: world center (cx, cy) in metres + zoom in px/m. These values are
// only the fallback for the very first frame — initEditor() frames the layout
// with centerView() so the plan opens centered and fitted.
const view = { cx: 61, cy: 27, zoom: 10 };

// World-space bounds of everything the last 2D draw painted. Recorded during
// draw() so "Center map" fits exactly what is on screen, and cannot drift from
// the drawing rules below.
let drawnBounds = null;

// interaction state
let tool = 'select';
// The selection: { kind, obj } for one thing, or { kind: 'multi', items: [{kind, obj}] }
// once several elements are picked up together.
let sel = null;
let pendingEdgeNode = null;
let dragDraw = null;
let dragMove = null;
let marquee = null; // { x0, y0, x1, y1 } — Shift-drag rubber band while selecting
let panning = null;
let spaceDown = false; // Space held: left-drag pans instead of editing
let calMode = false;
let calClicks = [];
let mode3d = false;
let bgImage = null;
let saveTimer = null;
let selBay = null; // { rack, bayIndex } — which bay is highlighted for the readout
let history = null; // undo/redo timeline over whole-layout snapshots
let styleResize = null; // in-progress drag of the selected label/text resize grip
// In-progress corner drag of a selected fixture (independent width/depth).
let fixtureResize = null;
// The fixture kind the Building / Warehouse menu last armed, used when the
// Fixture tool places a new object.
let fixtureKind = 'door';

// World-space boxes of the automatic labels painted by the last draw(). Recorded
// during draw() (like drawnBounds) so clicking a label can never drift from what
// is actually on screen.
let labelBoxes = [];
// Device-pixel box, size (metres) and world anchor of the selected label/text,
// set while drawing it. Drives the resize grip and the Font toolbar position.
let selGrip = null;

// ---------- coordinate transforms ----------
const sx = (x) => (x - view.cx) * view.zoom * devicePixelRatio + cv.width / 2;
const sy = (y) => cv.height / 2 - (y - view.cy) * view.zoom * devicePixelRatio;
const wx = (px) => (px * devicePixelRatio - cv.width / 2) / (view.zoom * devicePixelRatio) + view.cx;
const wy = (py) => (cv.height / 2 - py * devicePixelRatio) / (view.zoom * devicePixelRatio) + view.cy;
const snap = (v) => {
  const s = +state.settings.snap || 0;
  return s > 0 ? Math.round(v / s) * s : v;
};

// Draw a line from (x1,y1) to (x2,y2) with an arrowhead at the end, in device px.
function drawArrow(x1, y1, x2, y2, color) {
  const dpr = devicePixelRatio;
  const head = 7 * dpr;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

// ---------- persistence (debounced draft cache + saved flag) ----------
// Every edit funnels through save(). After a short idle it records one undo
// step, then writes the draft cache. Coalescing here means a drag or a burst of
// typing becomes a single undo step instead of dozens.
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    commitHistory();
    persistNow();
    updateHistoryButtons();
  }, 400);
  updateHistoryButtons(); // a pending edit already counts as undoable
}

// Fold a pending (debounced) save into the timeline right now. Undo/redo call
// this first so an edit made moments ago is undone as its own step, not skipped.
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  commitHistory();
  persistNow();
  updateHistoryButtons();
}

function persistNow() {
  try {
    saveLayout(state);
    flagSaved('saved');
  } catch {
    flagSaved('not saved — export!', true);
  }
}

function commitHistory() {
  if (history) history.record(state);
}

function updateHistoryButtons() {
  const pending = saveTimer !== null; // a debounced edit is still undoable
  const u = document.getElementById('undoBtn');
  const r = document.getElementById('redoBtn');
  if (u) u.disabled = !history || !(history.canUndo || pending);
  if (r) r.disabled = !history || !history.canRedo || pending;
}

function undo() {
  flushSave();
  const snap = history && history.undo();
  if (snap) applySnapshot(snap);
}

function redo() {
  flushSave();
  const snap = history && history.redo();
  if (snap) applySnapshot(snap);
}

// Swap the live state for a history snapshot and repaint everything that reads
// it. Selection and in-progress gestures are dropped: they point into the
// discarded object graph.
function applySnapshot(snap) {
  state = snap;
  sel = null;
  selBay = null;
  pendingEdgeNode = null;
  dragDraw = null;
  dragMove = null;
  marquee = null;
  styleResize = null;
  fixtureResize = null;
  calMode = false;
  calClicks = [];
  setHint('');
  loadBgImage();
  renderBinTypes();
  renderProps();
  updateBgInfo();
  if (mode3d) preview.build(state, labelState.get());
  else draw();
  persistNow();
  updateHistoryButtons();
}

function flagSaved(text, warn) {
  const el = document.getElementById('savedFlag');
  el.textContent = text;
  el.style.color = warn ? 'var(--node)' : 'var(--ok)';
  if (!warn) {
    setTimeout(() => {
      if (el.textContent === text) el.textContent = '';
    }, 2200);
  }
}

function loadBgImage() {
  if (state.bg && state.bg.dataURL) {
    bgImage = new Image();
    bgImage.onload = draw;
    bgImage.src = state.bg.dataURL;
  } else {
    bgImage = null;
  }
}

// ---------- canvas sizing ----------
function resize() {
  cv.width = cv.clientWidth * devicePixelRatio;
  cv.height = cv.clientHeight * devicePixelRatio;
  draw();
}

// ---------- label + text drawing ----------
// Device pixel -> world metres. sx()/sy() go the other way.
const toWorldX = (px) => view.cx + (px - cv.width / 2) / (view.zoom * devicePixelRatio);
const toWorldY = (py) => view.cy + (cv.height / 2 - py) / (view.zoom * devicePixelRatio);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Effective typography for one automatic label: that label's own override (if
// any) layered over the shared defaults.
function labelStyleAt(kind, id, bayIndex) {
  return resolveLabelStyle(state.labelStyle, state.labelOverrides[labelKey(kind, id, bayIndex)]);
}

// Device-pixel height of a label: an explicit override is a height in metres,
// otherwise fall back to the zoom-derived automatic size.
function labelSizePx(st, autoPx) {
  if (st.size) return Math.max(6, st.size * view.zoom * devicePixelRatio);
  return autoPx * state.labelStyle.scale;
}

function isSelectedLabel(hit) {
  return (
    !!sel &&
    sel.kind === 'label' &&
    sel.labelKind === hit.labelKind &&
    sel.obj === hit.obj &&
    (sel.bayIndex ?? null) === (hit.bayIndex ?? null)
  );
}

// A small legible readout used for the live size hints while drawing. `lines`
// are stacked and centred on (cx, cy); the text stays a constant screen size.
function dimTag(cx, cy, lines) {
  const dpr = devicePixelRatio;
  const fs = 12 * dpr;
  const pad = 7 * dpr;
  const lh = fs * 1.35;
  ctx.font = `600 ${fs}px Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = Math.max(...lines.map((s) => ctx.measureText(s).width)) + pad * 2;
  const height = lh * lines.length + pad;
  const x = cx - width / 2;
  const y = cy - height / 2;
  ctx.fillStyle = 'rgba(18,22,27,0.92)';
  ctx.strokeStyle = '#5fa8e8';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, 5 * dpr);
  else ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d7dde4';
  lines.forEach((line, i) => ctx.fillText(line, cx, y + pad / 2 + lh * (i + 0.5)));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// Dashed outline plus the corner grip that resizes just this label / text.
function drawSelectionBox(box) {
  ctx.strokeStyle = '#5fa8e8';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(box.l, box.t, box.r - box.l, box.b - box.t);
  ctx.setLineDash([]);
  ctx.fillStyle = '#5fa8e8';
  ctx.fillRect(box.r - 5, box.b - 5, 10, 10);
}

// Paint one automatic label: highlight, halo, underline, then the text itself.
// When `hit` is given its world-space box is recorded for hit-testing, and the
// selected label also gets the outline + resize grip.
function drawLabel(text, xPx, yPx, { autoPx, color, hit = null, st, align }) {
  const sizePx = labelSizePx(st, autoPx);
  const a = align ?? st.align;
  ctx.font = fontString({ font: st.font, weight: st.weight, italic: st.italic, sizePx });
  ctx.textAlign = a;
  ctx.textBaseline = 'alphabetic';
  const wPx = ctx.measureText(text).width;
  const leftPx = a === 'center' ? xPx - wPx / 2 : a === 'right' ? xPx - wPx : xPx;
  if (st.highlight) {
    ctx.fillStyle = st.highlight;
    ctx.fillRect(leftPx - sizePx * 0.16, yPx - sizePx * 0.98, wPx + sizePx * 0.32, sizePx * 1.3);
  }
  if (state.labelStyle.halo) {
    ctx.lineWidth = Math.max(3, sizePx * 0.24);
    ctx.strokeStyle = 'rgba(12,16,20,0.88)';
    ctx.lineJoin = 'round';
    ctx.strokeText(text, xPx, yPx);
  }
  ctx.fillStyle = st.color ?? color;
  ctx.fillText(text, xPx, yPx);
  if (st.underline) {
    ctx.strokeStyle = st.color ?? color;
    ctx.lineWidth = Math.max(1, sizePx * 0.07);
    ctx.beginPath();
    ctx.moveTo(leftPx, yPx + sizePx * 0.16);
    ctx.lineTo(leftPx + wPx, yPx + sizePx * 0.16);
    ctx.stroke();
  }
  ctx.textAlign = 'left';

  const box = { l: leftPx, r: leftPx + wPx, t: yPx - sizePx, b: yPx + sizePx * 0.3 };
  if (hit) {
    const xW0 = toWorldX(box.l);
    const xW1 = toWorldX(box.r);
    const yW0 = toWorldY(box.b);
    const yW1 = toWorldY(box.t);
    labelBoxes.push({
      ...hit,
      x0: Math.min(xW0, xW1),
      x1: Math.max(xW0, xW1),
      y0: Math.min(yW0, yW1),
      y1: Math.max(yW0, yW1),
    });
    if (isSelectedLabel(hit)) {
      drawSelectionBox(box);
      selGrip = {
        box,
        sizeM: sizePx / (view.zoom * devicePixelRatio),
        ax: toWorldX(xPx),
        ay: toWorldY(yPx),
      };
    }
  }
  return box;
}

// Text objects are sized in metres, but never shrink below a legible size.
function textPx(t) {
  return Math.max(6, (t.size || DEFAULT_TEXT_SIZE) * view.zoom * devicePixelRatio);
}

// Screen geometry of a text object: device-pixel edges for drawing/handles plus
// world-space bounds for hit-testing.
function textBox(t) {
  const px = textPx(t);
  ctx.font = fontString({ font: t.font, weight: t.weight, italic: t.italic, sizePx: px });
  const wPx = ctx.measureText(t.text || '').width;
  const ax = sx(t.x);
  const ay = sy(t.y);
  const leftPx = t.align === 'center' ? ax - wPx / 2 : t.align === 'right' ? ax - wPx : ax;
  const rightPx = leftPx + wPx;
  const topPx = ay - px;
  const botPx = ay + px * 0.3; // a little descender room
  const x0 = toWorldX(leftPx);
  const x1 = toWorldX(rightPx);
  const yA = toWorldY(botPx);
  const yB = toWorldY(topPx);
  return {
    leftPx,
    rightPx,
    topPx,
    botPx,
    x0: Math.min(x0, x1),
    x1: Math.max(x0, x1),
    y0: Math.min(yA, yB),
    y1: Math.max(yA, yB),
  };
}

function drawTextObj(t) {
  const b = textBox(t);
  const px = textPx(t);
  const ax = sx(t.x);
  const ay = sy(t.y);
  ctx.font = fontString({ font: t.font, weight: t.weight, italic: t.italic, sizePx: px });
  ctx.textAlign = t.align || 'left';
  ctx.textBaseline = 'alphabetic';
  if (t.highlight) {
    ctx.fillStyle = t.highlight;
    ctx.fillRect(b.leftPx - px * 0.16, ay - px * 0.98, b.rightPx - b.leftPx + px * 0.32, px * 1.3);
  }
  if (state.labelStyle.halo) {
    ctx.lineWidth = Math.max(3, px * 0.24);
    ctx.strokeStyle = 'rgba(12,16,20,0.88)';
    ctx.lineJoin = 'round';
    ctx.strokeText(t.text, ax, ay);
  }
  ctx.fillStyle = t.color || '#eef2f6';
  ctx.fillText(t.text, ax, ay);
  if (t.underline) {
    ctx.strokeStyle = t.color || '#eef2f6';
    ctx.lineWidth = Math.max(1, px * 0.07);
    ctx.beginPath();
    ctx.moveTo(b.leftPx, ay + px * 0.16);
    ctx.lineTo(b.rightPx, ay + px * 0.16);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  return b;
}

// Paint one placed fixture: its plan symbol inside the rotated footprint, then
// its name label when labels are on (or whenever it is selected).
function drawFixtureObj(f) {
  const def = fixtureDef(f.kind);
  if (!def) return null;
  const z = view.zoom * devicePixelRatio;
  const wPx = f.w * z;
  const dPx = f.d * z;
  const cx = sx(f.x);
  const cy = sy(f.y);
  const selected = isSelected('fixture', f);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((f.rot * Math.PI) / 180);
  drawSymbol(def.symbol, ctx, -wPx / 2, -dPx / 2, wPx, dPx, def.color);
  ctx.restore();

  // Quarter turns swap the footprint, so the on-screen box is exact.
  const quarter = f.rot === 90 || f.rot === 270;
  const bw = quarter ? dPx : wPx;
  const bd = quarter ? wPx : dPx;
  const box = { l: cx - bw / 2, t: cy - bd / 2, r: cx + bw / 2, b: cy + bd / 2 };
  if (selected) {
    drawSelectionBox(box);
    selGrip = { box, sizeM: null, ax: f.x, ay: f.y, fixture: f };
  }
  if ((labelState.get() && state.labelStyle.show.fixtures && z >= 4) || selected) {
    drawLabel(def.label, box.r + 6, box.b, {
      autoPx: Math.max(9, z * 1.9),
      color: def.color,
      st: labelStyleAt('fixture', f.id),
    });
  }
  return box;
}

// ---------- draw ----------
function draw() {
  if (mode3d) return;
  const W = cv.width;
  const H = cv.height;
  const z = view.zoom * devicePixelRatio;

  // Track the world extent of what we paint, for centerView().
  drawnBounds = null;
  labelBoxes = [];
  selGrip = null;
  const mark = (x, y, w = 0, d = 0) => {
    if (!drawnBounds) {
      drawnBounds = { minX: x, minY: y, maxX: x + w, maxY: y + d };
    } else {
      drawnBounds.minX = Math.min(drawnBounds.minX, x);
      drawnBounds.minY = Math.min(drawnBounds.minY, y);
      drawnBounds.maxX = Math.max(drawnBounds.maxX, x + w);
      drawnBounds.maxY = Math.max(drawnBounds.maxY, y + d);
    }
  };
  ctx.fillStyle = '#14181d';
  ctx.fillRect(0, 0, W, H);

  if (bgImage && state.bg) {
    ctx.save();
    ctx.globalAlpha = (state.bg.opacity ?? 35) / 100;
    const s = state.bg.mPerPx * z;
    ctx.translate(sx(state.bg.ox), sy(state.bg.oy + bgImage.height * state.bg.mPerPx));
    ctx.scale(s, s);
    ctx.drawImage(bgImage, 0, 0);
    ctx.restore();
  }

  const g = +state.settings.grid || 10;
  const x0 = Math.floor(wx(0) / g) * g;
  const x1 = wx(cv.clientWidth);
  const y1 = Math.floor(wy(cv.clientHeight) / g) * g;
  const y0 = wy(0);
  ctx.strokeStyle = '#212931';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += g) {
    ctx.moveTo(sx(x), 0);
    ctx.lineTo(sx(x), H);
  }
  for (let y = y1; y <= y0; y += g) {
    ctx.moveTo(0, sy(y));
    ctx.lineTo(W, sy(y));
  }
  ctx.stroke();
  ctx.strokeStyle = '#3a4654';
  ctx.beginPath();
  ctx.moveTo(sx(0), 0);
  ctx.lineTo(sx(0), H);
  ctx.moveTo(0, sy(0));
  ctx.lineTo(W, sy(0));
  ctx.stroke();

  // origin axes at (0,0): +x = East (screen right), +y = North (screen up)
  const dpr = devicePixelRatio;
  const aLen = 56 * dpr;
  const ox = sx(0);
  const oy = sy(0);
  drawArrow(ox, oy, ox + aLen, oy, '#d4453a');
  drawArrow(ox, oy, ox, oy - aLen, '#5fb878');
  ctx.font = `600 ${12 * dpr}px Consolas`;
  ctx.fillStyle = '#d4453a';
  ctx.fillText('x → E', ox + aLen + 4 * dpr, oy + 4 * dpr);
  ctx.fillStyle = '#5fb878';
  ctx.fillText('y ↑ N', ox + 5 * dpr, oy - aLen - 5 * dpr);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ox, oy, 3 * dpr, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#aeb8c2';
  ctx.font = `${11 * dpr}px Consolas`;
  ctx.fillText('0,0', ox + 7 * dpr, oy + 15 * dpr);

  // fixed north compass, top-right of the canvas (north is always screen-up in 2D)
  const cxp = W - 40 * dpr;
  const cyp = 50 * dpr;
  drawArrow(cxp, cyp + 20 * dpr, cxp, cyp - 20 * dpr, '#5fb878');
  ctx.fillStyle = '#9fb4cf';
  ctx.font = `600 ${14 * dpr}px Consolas`;
  ctx.textAlign = 'center';
  ctx.fillText('N', cxp, cyp - 26 * dpr);
  ctx.textAlign = 'left';

  state.zones.forEach((zn) => {
    const seld = isSelected('zone', zn);
    ctx.fillStyle = zn.color + '55';
    ctx.strokeStyle = seld ? '#5fa8e8' : zn.color;
    ctx.lineWidth = seld ? 3 : 1.5;
    const x = sx(zn.x);
    const y = sy(zn.y + zn.d);
    const w = zn.w * z;
    const h = zn.d * z;
    mark(zn.x, zn.y, zn.w, zn.d);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    if (labelState.get() && state.labelStyle.show.zones) {
      const st = labelStyleAt('zone', zn.id);
      drawLabel('ZONE ' + zn.id, x + 8, y + Math.max(16, z * 5), {
        autoPx: Math.max(12, z * 4),
        color: '#eef2f6',
        st,
        hit: { kind: 'label', labelKind: 'zone', obj: zn },
      });
      drawLabel(`${zn.w}×${zn.d}  elev ${zn.elev}`, x + 8, y + Math.max(30, z * 8.4), {
        autoPx: Math.max(10, z * 2.4),
        color: '#9aa6b3',
        st: { ...st, size: null, align: 'left' },
      });
    }
  });

  state.racks.forEach((r) => {
    const t = state.binTypes[r.type] || { w: 4, d: 4, color: '#888' };
    const seld = isSelected('rack', r);
    const sole = !!sel && sel.kind === 'rack' && sel.obj === r; // exactly this row is selected
    for (let b = 0; b < r.bays; b++) {
      let bx = r.x;
      let by = r.y;
      let bw;
      let bd;
      if (r.dir === 'E') {
        bx += b * t.w;
        bw = t.w;
        bd = t.d;
      } else {
        by += b * t.w;
        bw = t.d;
        bd = t.w;
      }
      mark(bx, by, bw, bd);
      ctx.fillStyle = t.color + (seld ? 'cc' : '88');
      ctx.strokeStyle = seld ? '#5fa8e8' : '#10141a';
      ctx.lineWidth = seld ? 2 : 1;
      ctx.fillRect(sx(bx), sy(by + bd), bw * z, bd * z);
      ctx.strokeRect(sx(bx), sy(by + bd), bw * z, bd * z);
      if (selBay && selBay.rack === r && selBay.bayIndex === b) {
        ctx.strokeStyle = '#ffe580';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(sx(bx) + 1, sy(by + bd) + 1, bw * z - 2, bd * z - 2);
        if (z >= 3 && state.labelStyle.show.bays) {
          drawLabel(resolveBayLabel(state, r, b), sx(bx) + 4, sy(by + bd) + Math.max(12, z * 2.5), {
            autoPx: Math.max(9, z * 2),
            color: '#ffe580',
            st: labelStyleAt('bay', r.id, b),
            hit: { kind: 'label', labelKind: 'bay', obj: r, bayIndex: b },
          });
        }
      }
    }
    if (labelState.get() && state.labelStyle.show.racks) {
      const dOff = r.dir === 'E' ? z * (state.binTypes[r.type]?.d || 4) : 0;
      drawLabel(
        `${r.id} ×${r.bays} L${r.levels} ${r.type}`,
        sx(r.x),
        sy(r.y) + Math.max(13, z * 3.2) + dOff + 12,
        {
          autoPx: Math.max(11, z * 2.6),
          color: seld ? '#5fa8e8' : '#cfd8e2',
          st: labelStyleAt('rack', r.id),
          hit: { kind: 'label', labelKind: 'rack', obj: r },
        },
      );
    }
    // Selected rack: shade the reserved aisle on its far side and label it, so
    // the row-to-row spacing is visible at a glance. Not marked as drawnBounds —
    // it is an editing aid, not part of the layout. Only for a lone selection;
    // a whole block of rows would just clutter the plan.
    if (sole) {
      const aisle = aisleOf(r);
      if (aisle > 0) {
        const { spanX, spanY } = rackFootprint(r, state.binTypes);
        const ax = rackRowAxis(r, state.binTypes, globalAisle());
        const gx = ax.axis === 'y' ? r.x : r.x + ax.depth;
        const gy = ax.axis === 'y' ? r.y - aisle : r.y;
        const gw = ax.axis === 'y' ? spanX : aisle;
        const gd = ax.axis === 'y' ? aisle : spanY;
        ctx.fillStyle = 'rgba(95,168,232,0.12)';
        ctx.fillRect(sx(gx), sy(gy + gd), gw * z, gd * z);
        ctx.strokeStyle = '#5fa8e8';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(sx(gx), sy(gy + gd), gw * z, gd * z);
        ctx.setLineDash([]);
        dimTag(sx(gx + gw / 2), sy(gy + gd / 2), [`aisle ${+aisle.toFixed(2)} m`]);
      }
    }
  });

  state.edges.forEach((ed) => {
    const a = state.nodes.find((n) => n.id === ed.a);
    const b = state.nodes.find((n) => n.id === ed.b);
    if (!a || !b) return;
    const seld = isSelected('edge', ed);
    ctx.strokeStyle = seld ? '#5fa8e8' : ed.ramp ? '#e8a33d' : '#7f8a96';
    ctx.lineWidth = seld ? 4 : 2;
    ctx.setLineDash(ed.ramp ? [8, 5] : []);
    ctx.beginPath();
    ctx.moveTo(sx(a.x), sy(a.y));
    ctx.lineTo(sx(b.x), sy(b.y));
    ctx.stroke();
    ctx.setLineDash([]);
  });

  state.nodes.forEach((n) => {
    mark(n.x, n.y);
    const seld = isSelected('node', n);
    const pend = pendingEdgeNode === n;
    ctx.fillStyle = n.kind === 'ramp' ? '#e8a33d' : '#d4453a';
    ctx.strokeStyle = seld || pend ? '#5fa8e8' : '#10141a';
    ctx.lineWidth = seld || pend ? 3 : 1.5;
    ctx.beginPath();
    ctx.arc(sx(n.x), sy(n.y), Math.max(5, z * 1.0), 0, 7);
    ctx.fill();
    ctx.stroke();
    if (labelState.get() && state.labelStyle.show.nodes) {
      drawLabel(n.id, sx(n.x) + 8, sy(n.y) - 8, {
        autoPx: Math.max(10, z * 2.2),
        color: '#ffb3ab',
        st: labelStyleAt('node', n.id),
        hit: { kind: 'label', labelKind: 'node', obj: n },
      });
    }
  });

  // Placed building + warehouse elements (doors, desks, pallets…).
  state.fixtures.forEach((f) => {
    const b = fixtureAabb(f);
    mark(b.x, b.y, b.w, b.d);
    drawFixtureObj(f);
  });

  // Free text annotations (Text tool). Drawn last so they sit above the plan.
  state.texts.forEach((t) => {
    mark(t.x, t.y);
    const b = drawTextObj(t);
    if (isSelected('text', t)) {
      const box = { l: b.leftPx, t: b.topPx, r: b.rightPx, b: b.botPx };
      drawSelectionBox(box);
      selGrip = { box, sizeM: t.size, ax: t.x, ay: t.y };
    }
  });

  if (dragDraw) {
    ctx.strokeStyle = '#5fa8e8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    if (tool === 'zone') {
      const x = Math.min(dragDraw.x0, dragDraw.x1);
      const y = Math.max(dragDraw.y0, dragDraw.y1);
      const w = Math.abs(dragDraw.x1 - dragDraw.x0);
      const d = Math.abs(dragDraw.y1 - dragDraw.y0);
      const left = sx(x);
      const top = sy(y);
      ctx.fillStyle = 'rgba(95,168,232,0.12)';
      ctx.fillRect(left, top, w * z, d * z);
      ctx.strokeRect(left, top, w * z, d * z);
      // Live readout while dragging: width x depth, then the floor area.
      dimTag(left + (w * z) / 2, top + (d * z) / 2, [
        `${w.toFixed(1)} × ${d.toFixed(1)} m`,
        `${(w * d).toFixed(1)} m²`,
      ]);
    } else if (tool === 'rack') {
      ctx.beginPath();
      ctx.moveTo(sx(dragDraw.x0), sy(dragDraw.y0));
      ctx.lineTo(sx(dragDraw.x1), sy(dragDraw.y1));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Rubber band from a Shift-drag on empty space: an editing aid, so it is not
  // marked as drawnBounds.
  if (marquee) {
    const mx = Math.min(marquee.x0, marquee.x1);
    const my = Math.max(marquee.y0, marquee.y1);
    const mw = Math.abs(marquee.x1 - marquee.x0);
    const md = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = 'rgba(95,168,232,0.10)';
    ctx.strokeStyle = '#5fa8e8';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(sx(mx), sy(my), mw * z, md * z);
    ctx.strokeRect(sx(mx), sy(my), mw * z, md * z);
    ctx.setLineDash([]);
  }
  if (calClicks.length === 1) {
    ctx.fillStyle = '#5fa8e8';
    ctx.beginPath();
    ctx.arc(calClicks[0].px * devicePixelRatio, calClicks[0].py * devicePixelRatio, 6, 0, 7);
    ctx.fill();
  }
  positionFontbar();
}

// ---------- tools ----------
function setHint(t) {
  toolHint.textContent = t;
  toolHint.style.display = t ? 'block' : 'none';
}
// Resting cursor depends on the active tool; an in-progress pan overrides it.
function restCursor() {
  cv.style.cursor =
    tool === 'select' ? 'default' : tool === 'text' ? 'text' : tool === 'fixture' ? 'copy' : 'crosshair';
}

// Light up the active tool: its own button/menu item, plus the menu that owns
// it, so the toolbar always shows where you are.
function updateToolButtons() {
  document.querySelectorAll('[data-tool]').forEach((b) => {
    const mine = b.dataset.tool === tool;
    const kindOk = !b.dataset.kind || b.dataset.kind === fixtureKind;
    b.classList.toggle('active', mine && kindOk);
  });
  document.querySelectorAll('.menu').forEach((m) => {
    const btn = m.querySelector('.menu-btn');
    if (!btn) return;
    let on = (m.dataset.tools || '').split(' ').includes(tool);
    // Building and Warehouse both own the Fixture tool — only the group that
    // holds the armed kind lights up.
    if (on && m.dataset.group) {
      const def = fixtureDef(fixtureKind);
      on = !!def && def.group === m.dataset.group;
    }
    btn.classList.toggle('active', on);
  });
}

function setTool(t) {
  tool = t;
  pendingEdgeNode = null;
  dragDraw = null;
  dragMove = null;
  marquee = null;
  selBay = null;
  calMode = false;
  calClicks = [];
  styleResize = null;
  fixtureResize = null;
  updateToolButtons();
  const hints = {
    zone: 'Drag a rectangle for the new zone',
    rack: 'Drag along the row direction, then size the row in the spec sheet',
    node: 'Click to place a node (door, dock, junction…)',
    edge: 'Click first node, then second node',
    text: 'Click the plan to place a text label, then type in the panel',
    delete: 'Click anything to delete it',
    fixture: `Click the plan to drop a ${fixtureDef(fixtureKind)?.label ?? 'element'} — change it from the Building / Warehouse menus`,
  };
  setHint(hints[t] || '');
  restCursor();
  draw();
}

function hitTest(x, y) {
  const tol = 8 / view.zoom;
  // Free text annotations sit above everything, then the automatic labels, so
  // clicking a label picks the label rather than the object under it.
  for (const t of [...state.texts].reverse()) {
    const b = textBox(t);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { kind: 'text', obj: t };
  }
  for (const b of [...labelBoxes].reverse()) {
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
      return { kind: 'label', labelKind: b.labelKind, obj: b.obj, bayIndex: b.bayIndex };
    }
  }
  for (const n of state.nodes) {
    if (Math.hypot(n.x - x, n.y - y) < tol) return { kind: 'node', obj: n };
  }
  for (const ed of state.edges) {
    const a = state.nodes.find((n) => n.id === ed.a);
    const b = state.nodes.find((n) => n.id === ed.b);
    if (a && b && ptSegDist(x, y, a.x, a.y, b.x, b.y) < tol * 0.8) return { kind: 'edge', obj: ed };
  }
  // Placed elements are picked before the racks and zones they sit on.
  const fx = fixtureAt(state.fixtures, x, y);
  if (fx) return { kind: 'fixture', obj: fx };
  for (const r of [...state.racks].reverse()) {
    const w = rackFootprint(r, state.binTypes).spanX;
    const d = rackFootprint(r, state.binTypes).spanY;
    if (x >= r.x && x <= r.x + w && y >= r.y && y <= r.y + d) return { kind: 'rack', obj: r };
  }
  for (const zn of [...state.zones].reverse()) {
    if (x >= zn.x && x <= zn.x + zn.w && y >= zn.y && y <= zn.y + zn.d) return { kind: 'zone', obj: zn };
  }
  return null;
}

// ---------- selection ----------

// Kinds the Select tool can pick up, move and copy as a group.
const MOVABLE_KINDS = new Set(['zone', 'rack', 'node', 'text', 'fixture']);
// Kinds that survive a copy / paste / duplicate round-trip.
const COPYABLE_KINDS = new Set(['zone', 'rack', 'fixture', 'node', 'text']);
// Label kinds that stand for a movable owner, so Shift-clicking a row label
// picks the row rather than its caption.
const LABEL_OWNER_KINDS = { zone: 'zone', rack: 'rack', bay: 'rack', node: 'node' };

// Every element in the current selection, as { kind, obj } pairs.
function selectedItems() {
  if (!sel) return [];
  if (sel.kind === 'multi') return sel.items;
  return [{ kind: sel.kind, obj: sel.obj }];
}

// Is this exact element part of the selection? Used by draw() for highlighting.
function isSelected(kind, obj) {
  if (!sel) return false;
  if (sel.kind === 'multi') return sel.items.some((it) => it.kind === kind && it.obj === obj);
  return sel.kind === kind && sel.obj === obj;
}

// Store a selection, collapsing the degenerate cases so the rest of the editor —
// which keys off sel.kind / sel.obj — keeps working unchanged.
function setSelection(items) {
  const uniq = [];
  for (const it of items) if (it && !uniq.some((u) => u.obj === it.obj)) uniq.push(it);
  if (uniq.length === 0) sel = null;
  else if (uniq.length === 1) sel = { kind: uniq[0].kind, obj: uniq[0].obj };
  else sel = { kind: 'multi', items: uniq };
  selBay = null;
}

// Shift+click: add the element to the selection, or drop it if already in.
function toggleSelection(kind, obj) {
  const items = selectedItems().filter((it) => COPYABLE_KINDS.has(it.kind));
  const at = items.findIndex((it) => it.obj === obj);
  if (at >= 0) items.splice(at, 1);
  else items.push({ kind, obj });
  setSelection(items);
}

// World-space footprint of one element, for the rubber band.
function elementAabb(kind, o) {
  if (kind === 'rack') {
    const fp = rackFootprint(o, state.binTypes);
    return { x: o.x, y: o.y, w: fp.spanX, d: fp.spanY };
  }
  if (kind === 'fixture') return fixtureAabb(o);
  if (kind === 'zone') return { x: o.x, y: o.y, w: o.w, d: o.d };
  if (kind === 'text') {
    const b = textBox(o);
    return { x: b.x0, y: b.y0, w: b.x1 - b.x0, d: b.y1 - b.y0 };
  }
  return { x: o.x - 0.25, y: o.y - 0.25, w: 0.5, d: 0.5 }; // node
}

// Everything the rubber band touches, in paint order. Zones (containers) and
// path edges are deliberately skipped: a band over a block of racks must not
// also grab the floor they stand on.
function bandPicks(box) {
  const hit = (k, o) => {
    const b = elementAabb(k, o);
    return b.x <= box.maxX && b.x + b.w >= box.minX && b.y <= box.maxY && b.y + b.d >= box.minY;
  };
  const picks = [];
  for (const r of state.racks) if (hit('rack', r)) picks.push({ kind: 'rack', obj: r });
  for (const f of state.fixtures) if (hit('fixture', f)) picks.push({ kind: 'fixture', obj: f });
  for (const t of state.texts) if (hit('text', t)) picks.push({ kind: 'text', obj: t });
  for (const n of state.nodes) if (hit('node', n)) picks.push({ kind: 'node', obj: n });
  return picks;
}

function selectAllRacks() {
  if (state.racks.length === 0) {
    setHint('No rack rows to select');
    return;
  }
  setSelection(state.racks.map((r) => ({ kind: 'rack', obj: r })));
  renderProps();
  draw();
  setHint(`${state.racks.length} rack row${state.racks.length === 1 ? '' : 's'} selected`);
}

// A one-line name for an element, for the multi-selection list.
function itemLabel(kind, o) {
  if (kind === 'rack') return `${o.id} — ${o.bays} bays × ${o.levels}`;
  if (kind === 'zone') return `Zone ${o.id}`;
  if (kind === 'fixture') return fixtureDef(o.kind)?.label ?? o.kind;
  if (kind === 'text') return o.text ? `“${o.text}”` : 'Text';
  if (kind === 'node') return `Node ${o.id}`;
  return o.id || kind;
}

function deleteSelected() {
  const items = selectedItems();
  if (items.length === 0) return;
  for (const { kind, obj } of items) {
    if (kind === 'zone') state.zones = state.zones.filter((z) => z !== obj);
    if (kind === 'rack') state.racks = state.racks.filter((r) => r !== obj);
    if (kind === 'edge') state.edges = state.edges.filter((ed) => ed !== obj);
    if (kind === 'text') state.texts = state.texts.filter((t) => t !== obj);
    if (kind === 'fixture') state.fixtures = state.fixtures.filter((f) => f !== obj);
    if (kind === 'node') {
      state.edges = state.edges.filter((ed) => ed.a !== obj.id && ed.b !== obj.id);
      state.nodes = state.nodes.filter((n) => n !== obj);
    }
  }
  sel = null;
  selBay = null;
  save();
  renderProps();
  draw();
}

// ---------- clipboard: copy / paste / cut / duplicate ----------

// The clipboard holds a group — one element or several — as cloned { kind, obj }
// pairs, so a whole multi-selection travels together. `pasteAnchor` remembers
// where the most recent paste landed so repeated Ctrl+V pastes stair-step away
// instead of stacking. Reset whenever something new is copied.
let clipboard = null; // { items: [{ kind, obj }] }
let pasteAnchor = null; // { items: [{ x, y }] } — landing spots of the last paste,
// aligned index-for-index with clipboard.items.

// Where a paste lands relative to its origin: one element-length down-right
// (screen down = negative world y), with a small gap. Racks stack along their
// short axis so a copied row lands beside its original like a second row, one
// row-pitch (depth + aisle) away — the row's own aisle sets the gap.
function pasteOffset(kind, o) {
  const gap = 1;
  let dx, dy;
  if (kind === 'rack') {
    const at = nextRackRow(o, state.binTypes, 1, globalAisle());
    dx = at.x - o.x;
    dy = at.y - o.y;
  } else if (kind === 'zone') {
    dx = Math.max(2, o.w) + gap;
    dy = -(Math.max(2, o.d) + gap);
  } else if (kind === 'fixture') {
    const b = fixtureAabb(o);
    dx = Math.max(1, b.w) + gap;
    dy = -(Math.max(1, b.d) + gap);
  } else {
    dx = 2;
    dy = -2; // node / text
  }
  return { dx, dy };
}

function freshId(kind, o) {
  if (kind === 'zone') return nextZoneId();
  if (kind === 'rack') return nextRackId();
  if (kind === 'fixture') return nextFixtureId(state.fixtures);
  if (kind === 'node') return nextNodeId(o.kind);
  if (kind === 'text') return nextTextId(state.texts);
  return o.id;
}

function pushElement(kind, o) {
  if (kind === 'zone') state.zones.push(o);
  if (kind === 'rack') state.racks.push(o);
  if (kind === 'fixture') state.fixtures.push(o);
  if (kind === 'node') state.nodes.push(o);
  if (kind === 'text') state.texts.push(o);
}

function kindLabel(kind) {
  const names = { zone: 'Zone', rack: 'rack row', node: 'node', text: 'label', fixture: 'element' };
  return names[kind] || kind;
}

// Clone one element for a paste, with a fresh identity and a row token to match
// (bin labels are built from the row token, so a clone must not reuse one).
function cloneElement(kind, o) {
  const copy = JSON.parse(JSON.stringify(o));
  copy.id = freshId(kind, copy);
  if (kind === 'rack') copy.rowToken = copy.id.replace(/^[^-]+-/, '');
  return copy;
}

function copySelected() {
  const items = selectedItems().filter((it) => COPYABLE_KINDS.has(it.kind));
  if (items.length === 0) {
    clipboard = null;
    pasteAnchor = null;
    setHint(
      sel && sel.kind === 'edge'
        ? 'Path edges can\u2019t be copied — copy an element instead'
        : 'Nothing selected to copy',
    );
    return;
  }
  clipboard = { items: items.map((it) => ({ kind: it.kind, obj: JSON.parse(JSON.stringify(it.obj)) })) };
  pasteAnchor = null;
  setHint(items.length === 1 ? `Copied ${kindLabel(items[0].kind)}` : `Copied ${items.length} elements`);
}

function cutSelected() {
  copySelected();
  if (clipboard) deleteSelected();
}

function paste() {
  if (!clipboard) {
    setHint('Nothing copied yet — select an element, then press Ctrl+C');
    return;
  }
  // Land each copy on top of the matching item from the previous paste (or on
  // its original spot), then shift the whole block by one offset, so the group
  // keeps its shape and repeat pastes march away as a unit.
  const base = clipboard.items.map((it, i) =>
    pasteAnchor && pasteAnchor.items[i] ? pasteAnchor.items[i] : { x: it.obj.x, y: it.obj.y },
  );
  const head = clipboard.items[0];
  const { dx, dy } = pasteOffset(head.kind, { ...head.obj, x: base[0].x, y: base[0].y });
  const made = clipboard.items.map((it, i) => {
    const o = cloneElement(it.kind, it.obj);
    o.x = base[i].x + dx;
    o.y = base[i].y + dy;
    pushElement(it.kind, o);
    return { kind: it.kind, obj: o };
  });
  setSelection(made);
  pasteAnchor = { items: made.map((m) => ({ x: m.obj.x, y: m.obj.y })) };
  save();
  renderProps();
  draw();
  setHint(
    made.length === 1
      ? `Pasted ${kindLabel(made[0].kind)} — drag it into place`
      : `Pasted ${made.length} elements — drag them into place`,
  );
}

function duplicateSelected() {
  const items = selectedItems().filter((it) => COPYABLE_KINDS.has(it.kind));
  if (items.length === 0) return;
  const { dx, dy } = pasteOffset(items[0].kind, items[0].obj);
  const made = items.map((it) => {
    const o = cloneElement(it.kind, it.obj);
    o.x = it.obj.x + dx;
    o.y = it.obj.y + dy;
    pushElement(it.kind, o);
    return { kind: it.kind, obj: o };
  });
  setSelection(made);
  save();
  renderProps();
  draw();
  setHint(made.length === 1 ? `Duplicated ${kindLabel(made[0].kind)}` : `Duplicated ${made.length} elements`);
}

// Build out a block: clone the selected row `count` times, each one a further
// row-pitch away along the cross axis (depth + aisle). One click lays a whole
// block; the newest row is selected so it can be nudged or restyled straight
// away. New rows get fresh ids + row tokens so their bin labels stay unique.
function addRackRows(rack, count) {
  const n = Math.max(1, Math.min(200, Math.floor(Number(count)) || 1));
  let last = null;
  for (let i = 1; i <= n; i++) {
    const o = JSON.parse(JSON.stringify(rack));
    o.id = nextRackId();
    o.rowToken = o.id.replace(/^[^-]+-/, '');
    const at = nextRackRow(rack, state.binTypes, i, globalAisle());
    o.x = at.x;
    o.y = at.y;
    state.racks.push(o);
    last = o;
  }
  sel = { kind: 'rack', obj: last };
  save();
  renderProps();
  draw();
  setHint(`Added ${n} rack row${n === 1 ? '' : 's'} at ${+aisleOf(rack).toFixed(2)} m aisle`);
}

// ---------- new-rack dialog ----------
// Placing a rack opens this spec sheet first, the way a warehouse consultant
// would size a run before it exists: bin size, bays, levels, the aisle that
// spaces the block and how many rows to lay. A bin size that is not already a
// saved type is stored, so the same pallet footprint can be reused next time.

const NEW_TYPE = '__new__';

function rackDialogEl() {
  return document.getElementById('rackModal');
}

function rackDialogOpen() {
  const m = rackDialogEl();
  return !!m && !m.hidden;
}

function currentRackType() {
  return Object.keys(state.binTypes)[0] || 'STD';
}

function binTypeOptions(selected) {
  return (
    Object.keys(state.binTypes)
      .map((n) => `<option value="${n}" ${n === selected ? 'selected' : ''}>${n}</option>`)
      .join('') +
    `<option value="${NEW_TYPE}" ${selected === NEW_TYPE ? 'selected' : ''}>＋ New bin type…</option>`
  );
}

function dimsMatch(t, { w, d, h }) {
  return Math.abs(t.w - w) < 1e-6 && Math.abs(t.d - d) < 1e-6 && Math.abs(t.h - h) < 1e-6;
}

// Read every field, coercing to the types the rack model expects.
function readRackDialog() {
  const g = (id) => document.getElementById(id);
  const num = (id) => parseFloat(g(id).value);
  const int = (id) => parseInt(g(id).value, 10);
  return {
    token: (g('rk_token').value.trim() || 'R').toUpperCase(),
    dir: g('rk_dir').value === 'N' ? 'N' : 'E',
    x: num('rk_x'),
    y: num('rk_y'),
    bays: int('rk_bays'),
    levels: int('rk_levels'),
    levelH: num('rk_lh'),
    typeName: g('rk_type').value,
    w: num('rk_bw'),
    d: num('rk_bd'),
    h: num('rk_bh'),
    color: g('rk_bc').value,
    saveAs: g('rk_saveas').value.trim().toUpperCase(),
    aisle: num('rk_aisle'),
    rows: int('rk_rows'),
    twin: g('rk_twin').checked,
  };
}

function validateRackSpec(s) {
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return 'Start x / y must be numbers.';
  if (!(s.bays >= 1)) return 'Bays must be at least 1.';
  if (!(s.levels >= 1)) return 'Levels must be at least 1.';
  if (!(s.levelH > 0)) return 'Level height must be greater than 0.';
  if (!(s.w > 0) || !(s.d > 0) || !(s.h > 0)) return 'Bin width, depth and height must all be > 0.';
  if (!Number.isFinite(s.aisle) || s.aisle < 0) return 'Aisle must be 0 or more.';
  if (!(s.rows >= 1)) return 'Rows to add must be at least 1.';
  return null;
}

// Use an existing bin type when the size matches one; otherwise save the size
// as a new type (never silently overwriting a differently-sized one). Choosing
// "New bin type" always defines a fresh named type, even at a known size.
function resolveBinType(s) {
  const dims = { w: s.w, d: s.d, h: s.h };
  const wantsNew = s.typeName === NEW_TYPE;
  if (!wantsNew) {
    const match = matchBinType(state.binTypes, dims);
    if (match) return { type: match, created: false };
  }
  const base = s.saveAs || (wantsNew ? 'RACK' : s.typeName);
  let name = base;
  let i = 2;
  while (state.binTypes[name] && !dimsMatch(state.binTypes[name], dims)) name = `${base}-${i++}`;
  if (state.binTypes[name]) return { type: name, created: false }; // same size already saved
  state.binTypes[name] = { w: s.w, d: s.d, h: s.h, color: s.color };
  return { type: name, created: true };
}

// Live "spec sheet" under the form: lengths, capacity, aisle tier, tokens.
function updateRackDialogSummary() {
  const el = document.getElementById('rk_summary');
  if (!el) return;
  const s = readRackDialog();
  const bays = Math.max(1, Math.round(s.bays) || 1);
  const levels = Math.max(1, Math.round(s.levels) || 1);
  const rows = Math.max(1, Math.round(s.rows) || 1);
  const aisle = Number.isFinite(s.aisle) ? Math.max(0, s.aisle) : 0;
  const rowDepth = (Number.isFinite(s.d) ? s.d : 0) * (s.twin ? 2 : 1);
  const pitch = rowDepth + aisle;
  const length = bays * (Number.isFinite(s.w) ? s.w : 0);
  const perRow = bays * levels;
  const racks = rows * (s.twin ? 2 : 1);
  const total = perRow * racks;
  const fit = aisleFit(aisle);
  const tones = `rk-tone-${fit.tone}`;
  const match = s.typeName === NEW_TYPE ? null : matchBinType(state.binTypes, { w: s.w, d: s.d, h: s.h });
  const saveasRow = document.getElementById('rk_saveas_row');
  if (saveasRow) saveasRow.hidden = !!match;
  const tokens = rowTokensFor(s.token || 'R', racks);
  const newName = s.saveAs || (s.typeName !== NEW_TYPE ? s.typeName : 'RACK');
  el.innerHTML =
    `<div>Row <b>${length.toFixed(1)} m</b> long · ${bays} bays × ${levels} levels = <b>${perRow}</b> positions/row</div>` +
    `<div>Pitch <b>${pitch.toFixed(2)} m</b> (${rowDepth.toFixed(2)} m deep${s.twin ? ' — back-to-back' : ''} + ${aisle.toFixed(2)} m aisle) × ${rows}</div>` +
    `<div>Aisle <b class="${tones}">${aisle.toFixed(2)} m</b> — <span class="${tones}">${fit.label}</span></div>` +
    `<div>Block: <b>${racks}</b> row${racks === 1 ? '' : 's'} · <b>${total}</b> pallet positions · token${tokens.length === 1 ? '' : 's'} ${tokens.join(', ')}</div>` +
    `<div>${match ? `Bin size matches saved type <b>${match}</b>` : `New bin size → saved as <b>${newName}</b>`}</div>`;
  const addBtn = document.getElementById('rk_add');
  if (addBtn) addBtn.textContent = `Add ${racks} row${racks === 1 ? '' : 's'}`;
}

function openRackDialog(prefill = {}) {
  const modal = rackDialogEl();
  if (!modal) return;
  const type = currentRackType();
  const t = state.binTypes[type] || { w: 3, d: 1, h: 6, color: '#6f93c4' };
  const dir = prefill.dir === 'N' ? 'N' : 'E';
  const x = Number.isFinite(prefill.x) ? prefill.x : 0;
  const y = Number.isFinite(prefill.y) ? prefill.y : 0;
  const bays = Math.max(1, Math.floor(prefill.bays) || 1);
  const token = nextRowToken();

  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="New rack row">
      <div class="modal-head">
        <h2>New rack row</h2>
        <button class="modal-x" id="rk_cancel_x" title="Cancel (Esc)">×</button>
      </div>
      <div class="modal-body">
        <div class="rk-sec">Row</div>
        <div class="rk-cols">
          ${f('Row token', `<input type="text" id="rk_token" value="${token}">`)}
          ${f(
            'Direction',
            `<select id="rk_dir">
              <option value="E" ${dir === 'E' ? 'selected' : ''}>E — bays run east</option>
              <option value="N" ${dir === 'N' ? 'selected' : ''}>N — bays run north</option>
            </select>`,
          )}
          ${f('Start x (m)', `<input type="number" id="rk_x" value="${x}" step="0.5">`)}
          ${f('Start y (m)', `<input type="number" id="rk_y" value="${y}" step="0.5">`)}
          ${f('Bays', `<input type="number" id="rk_bays" value="${bays}" min="1" step="1">`)}
          ${f('Levels', `<input type="number" id="rk_levels" value="3" min="1" step="1">`)}
          ${f('Level height (m)', `<input type="number" id="rk_lh" value="${t.h > 0 ? t.h : 6}" min="0.05" step="0.5">`)}
        </div>
        <div class="rk-sec">Bin size</div>
        ${f('Bin type', `<select id="rk_type">${binTypeOptions(type)}</select>`)}
        <div class="rk-cols">
          ${f('Bay width (m)', `<input type="number" id="rk_bw" value="${t.w}" min="0.1" step="0.1">`)}
          ${f('Depth (m)', `<input type="number" id="rk_bd" value="${t.d}" min="0.1" step="0.1">`)}
          ${f('Height (m)', `<input type="number" id="rk_bh" value="${t.h}" min="0.1" step="0.1">`)}
          ${f('Colour', `<input type="color" id="rk_bc" value="${t.color || '#6f93c4'}">`)}
        </div>
        <div id="rk_saveas_row" hidden>
          ${f('Save size as', `<input type="text" id="rk_saveas" value="" placeholder="e.g. PALLET-EU">`)}
        </div>
        <div class="rk-sec">Spacing &amp; block</div>
        <div class="rk-cols">
          ${f('Aisle (m)', `<input type="number" id="rk_aisle" value="${+globalAisle().toFixed(2)}" min="0" step="0.25">`)}
          ${f('Rows to add', `<input type="number" id="rk_rows" value="1" min="1" max="200" step="1">`)}
        </div>
        <label class="rk-check">
          <input type="checkbox" id="rk_twin"> Back-to-back pair (twin rows share a spine)
        </label>
      </div>
      <div class="modal-foot">
        <div class="rk-err" id="rk_err"></div>
        <div class="modal-summary" id="rk_summary"></div>
        <div class="btnrow">
          <button class="btn small" id="rk_cancel">Cancel</button>
          <button class="btn small" id="rk_add">Add row</button>
        </div>
      </div>
    </div>`;
  modal.hidden = false;

  const loadType = (name) => {
    const bt = state.binTypes[name];
    if (!bt) return;
    document.getElementById('rk_bw').value = bt.w;
    document.getElementById('rk_bd').value = bt.d;
    document.getElementById('rk_bh').value = bt.h;
    document.getElementById('rk_bc').value = bt.color || '#6f93c4';
    document.getElementById('rk_lh').value = bt.h > 0 ? bt.h : 6;
  };

  // Any edit clears a previous validation message and refreshes the spec sheet.
  const onEdit = () => {
    const e = document.getElementById('rk_err');
    if (e) e.textContent = '';
    updateRackDialogSummary();
  };
  document.getElementById('rk_type').addEventListener('change', (e) => {
    if (e.target.value !== NEW_TYPE) loadType(e.target.value);
    onEdit();
  });
  modal.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', onEdit);
    el.addEventListener('change', onEdit);
  });
  document.getElementById('rk_cancel').onclick = closeRackDialog;
  document.getElementById('rk_cancel_x').onclick = closeRackDialog;
  document.getElementById('rk_add').onclick = createRacksFromDialog;

  updateRackDialogSummary();
  const first = document.getElementById('rk_bays');
  if (first) {
    first.focus();
    first.select();
  }
}

function closeRackDialog() {
  const modal = rackDialogEl();
  if (!modal) return;
  modal.hidden = true;
  modal.innerHTML = '';
  if (cv) cv.focus({ preventScroll: true });
}

function createRacksFromDialog() {
  const errEl = document.getElementById('rk_err');
  const s = readRackDialog();
  const err = validateRackSpec(s);
  if (err) {
    if (errEl) errEl.textContent = '⚠ ' + err;
    return;
  }
  if (errEl) errEl.textContent = '';
  const bays = Math.max(1, Math.round(s.bays));
  const levels = Math.max(1, Math.round(s.levels));
  const rows = Math.max(1, Math.round(s.rows));
  const { type, created } = resolveBinType(s);
  const positions = rackBlockPositions({
    x: s.x,
    y: s.y,
    dir: s.dir,
    depth: s.d,
    aisle: s.aisle,
    rows,
    twin: s.twin,
  });
  const tokens = rowTokensFor(s.token, positions.length);
  const levelHeights = Array.from({ length: levels }, () => s.levelH);
  // Keep the "inherit unless overridden" rule: only store an aisle that differs
  // from the warehouse default, so later default changes still reach the row.
  const defAisle = globalAisle();
  const aisle = Math.abs(s.aisle - defAisle) < 1e-9 ? undefined : s.aisle;
  const made = positions.map((p, i) => {
    const id = nextRackId();
    const r = {
      id,
      type,
      dir: s.dir,
      bays,
      levels,
      levelHeights: [...levelHeights],
      bayLevelOverrides: {},
      rowToken: tokens[i],
      bayStart: 1,
      bayReverse: false,
      x: p.x,
      y: p.y,
      aisle,
    };
    state.racks.push(r);
    return r;
  });
  sel = { kind: 'rack', obj: made[made.length - 1] };
  if (created) renderBinTypes();
  save();
  renderProps();
  draw();
  closeRackDialog();
  const cells = made.length * bays * levels;
  setHint(
    `Added ${made.length} rack row${made.length === 1 ? '' : 's'} · ${cells} pallet positions` +
      (created ? ` · saved bin type ${type}` : ''),
  );
}

// Attach the dialog's own Backdrop / Esc / Enter handling once, so repeated
// open-close cycles don't stack listeners on the persistent modal element.
function wireRackDialog() {
  const modal = rackDialogEl();
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = '1';
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeRackDialog(); // click the dim backdrop to cancel
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // keep Esc from also cancelling the active tool
      closeRackDialog();
    } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      e.stopPropagation();
      createRacksFromDialog();
    }
  });
}

function nextZoneId() {
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!state.zones.some((z) => z.id === c)) return c;
  }
  return 'Z' + state.zones.length;
}
function nextRackId() {
  let i = 1;
  while (state.racks.some((r) => r.id === 'ROW-' + i)) i++;
  return 'ROW-' + i;
}
// Default row token for a new row: the first unused single letter (A, B, …),
// then R1, R2… once the alphabet is taken.
function nextRowToken() {
  const used = new Set(state.racks.map((r) => String(r.rowToken || '').toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  let n = 1;
  while (used.has('R' + n)) n++;
  return 'R' + n;
}
function nextNodeId(kind) {
  let i = 1;
  const p = kind.toUpperCase();
  while (state.nodes.some((n) => n.id === `${p}-${i}`)) i++;
  return `${p}-${i}`;
}
function randColor() {
  const cs = ['#4a5a72', '#55657d', '#4f6a63', '#5d6f55', '#6d5f4e', '#6b5a66', '#5a6b8a', '#6e5a4a'];
  return cs[Math.floor(Math.random() * cs.length)];
}

// ---------- properties panel ----------
function f(label, html) {
  return `<div class="field"><label>${label}</label>${html}</div>`;
}
// Two short fields share one row, so a form does not become a long ladder.
function f2(labelA, htmlA, labelB, htmlB) {
  return (
    `<div class="field pair"><label>${labelA}</label>${htmlA}` + `<label>${labelB}</label>${htmlB}</div>`
  );
}
// The same, for long lists of like fields (level heights): two per row.
function fPairs(items) {
  let out = '';
  for (let i = 0; i < items.length; i += 2) {
    const a = items[i];
    const b = items[i + 1];
    out +=
      `<div class="field pair"><label>${a.label}</label>${a.html}` +
      `<label>${b ? b.label : ''}</label>${b ? b.html : '<span class="ph"></span>'}</div>`;
  }
  return out;
}
// A heading inside an element form, grouping related fields.
function grp(title) {
  return `<div class="grp">${title}</div>`;
}
// The closing action row of an element form.
function formFoot(buttons) {
  return `<div class="formfoot">${buttons}</div>`;
}
function bind(id, fn) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', (e) => {
      fn(e.target.value);
      save();
      draw();
    });
  }
}
// Live readout under the rack "Aisle" field: depth + aisle = row pitch.
function aisleHintHTML(depth, aisle, isDefault) {
  const d = +depth.toFixed(2);
  const a = +aisle.toFixed(2);
  return `Row pitch: ${d} m depth + ${a} m aisle = <strong>${+(depth + aisle).toFixed(2)} m</strong>${isDefault ? ' · using default' : ''}`;
}
function bindNum(id, key, obj, int) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', (e) => {
      const v = int ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
      if (!Number.isNaN(v)) {
        obj[key] = v;
        save();
        draw();
      }
    });
  }
}

// ---------- label / text toolbox ----------
function fontOptions(selected) {
  const list = FONTS.includes(selected) ? FONTS : [...FONTS, selected];
  return list.map((fn) => `<option ${fn === selected ? 'selected' : ''}>${fn}</option>`).join('');
}

// Every fixture kind, grouped, so a placed element can be retyped in place.
function fixtureOptions(current) {
  return FIXTURE_GROUPS.map((g) => {
    const opts = fixturesInGroup(g)
      .map((d) => `<option value="${d.kind}" ${d.kind === current ? 'selected' : ''}>${d.label}</option>`)
      .join('');
    return `<optgroup label="${g === 'warehouse' ? 'Warehouse' : 'Building'}">${opts}</optgroup>`;
  }).join('');
}

// A range slider with a live readout. Dragging it is the "resize by mouse" path.
function rangeField(label, id, min, max, step, value, readout) {
  return f(
    label,
    `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">` +
      `<span class="labelval" id="${id}_v">${readout}</span>`,
  );
}

// The automatic-label toolbox. It edits the one shared style, which the panel
// says plainly so it is never a surprise.
function labelStyleFields(st) {
  return (
    f('Font', `<select id="ls_font">${fontOptions(st.font)}</select>`) +
    rangeField('Size', 'ls_scale', 0.4, 4, 0.05, st.scale, st.scale.toFixed(2) + '×') +
    f(
      'Weight',
      `<select id="ls_weight">
        <option value="400" ${st.weight === 400 ? 'selected' : ''}>Normal</option>
        <option value="700" ${st.weight === 700 ? 'selected' : ''}>Bold</option></select>`,
    ) +
    f('Italic', `<input type="checkbox" id="ls_italic" ${st.italic ? 'checked' : ''}>`) +
    f(
      'Colour',
      `<input type="color" id="ls_color" value="${st.color ?? '#eef2f6'}">
       <button class="btn small" id="ls_color_auto">Auto</button>`,
    ) +
    f('Halo', `<input type="checkbox" id="ls_halo" ${st.halo ? 'checked' : ''}>`) +
    LABEL_KINDS.map((k) =>
      f('Show ' + k, `<input type="checkbox" id="ls_show_${k}" ${st.show[k] ? 'checked' : ''}>`),
    ).join('')
  );
}

function wireLabelStyleFields() {
  const st = state.labelStyle;
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', fn);
  };
  on('ls_font', (e) => {
    st.font = e.target.value;
    save();
    draw();
  });
  on('ls_scale', (e) => {
    st.scale = parseFloat(e.target.value) || 1;
    const v = document.getElementById('ls_scale_v');
    if (v) v.textContent = st.scale.toFixed(2) + '×';
    save();
    draw();
  });
  on('ls_weight', (e) => {
    st.weight = parseInt(e.target.value, 10) === 700 ? 700 : 400;
    save();
    draw();
  });
  on('ls_italic', (e) => {
    st.italic = e.target.checked;
    save();
    draw();
  });
  on('ls_color', (e) => {
    st.color = e.target.value;
    save();
    draw();
  });
  on('ls_halo', (e) => {
    st.halo = e.target.checked;
    save();
    draw();
  });
  LABEL_KINDS.forEach((k) => {
    on('ls_show_' + k, (e) => {
      st.show[k] = e.target.checked;
      save();
      draw();
    });
  });
  const auto = document.getElementById('ls_color_auto');
  if (auto) {
    auto.onclick = () => {
      st.color = null; // back to each label's built-in colour
      save();
      renderProps();
      draw();
    };
  }
}

// ---------- floating Font toolbar ----------
// Appears when a single label or text object is selected and edits only that
// one. The controls mirror a word-processor font ribbon: family, size (with
// grow/shrink), bold, italic, underline, alignment, highlight and colour.

// What the toolbar is editing right now, plus how to write one field back.
function styleTarget() {
  if (!sel) return null;
  if (sel.kind === 'label') {
    const key = labelKey(sel.labelKind, sel.obj.id, sel.bayIndex);
    return {
      st: resolveLabelStyle(state.labelStyle, state.labelOverrides[key]),
      apply(field, value) {
        state.labelOverrides = setLabelOverride(state.labelOverrides, key, field, value);
        save();
        draw();
      },
    };
  }
  if (sel.kind === 'text') {
    const t = sel.obj;
    return {
      st: {
        font: t.font,
        size: t.size,
        weight: t.weight,
        italic: Boolean(t.italic),
        underline: Boolean(t.underline),
        color: t.color,
        highlight: t.highlight,
        align: t.align || 'left',
      },
      apply(field, value) {
        if (field === 'color' && !value) return;
        t[field] = value;
        save();
        draw();
      },
    };
  }
  return null;
}

// Resize the selected label / text to an absolute height in metres.
function applySelectedSize(metres) {
  const v = Math.max(0.05, Math.round(metres * 100) / 100);
  if (!sel) return;
  if (sel.kind === 'text') {
    sel.obj.size = v;
    return;
  }
  if (sel.kind === 'label') {
    const key = labelKey(sel.labelKind, sel.obj.id, sel.bayIndex);
    state.labelOverrides = setLabelOverride(state.labelOverrides, key, 'size', v);
  }
}

const hexOr = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fallback);

function renderFontbar() {
  const bar = document.getElementById('fontbar');
  if (!bar) return;
  const target = styleTarget();
  if (!target) {
    bar.style.display = 'none';
    return;
  }
  const { st } = target;
  bar.style.display = 'flex';
  const fontList = FONTS.includes(st.font) ? FONTS : [...FONTS, st.font];
  document.getElementById('fb_font').innerHTML = fontList
    .map((x) => `<option ${x === st.font ? 'selected' : ''}>${x}</option>`)
    .join('');
  const sizeIn = document.getElementById('fb_size');
  sizeIn.value = st.size ? st.size.toFixed(2) : '';
  sizeIn.placeholder = 'auto';
  document.getElementById('fb_bold').classList.toggle('active', st.weight === 700);
  document.getElementById('fb_italic').classList.toggle('active', st.italic);
  document.getElementById('fb_underline').classList.toggle('active', st.underline);
  document.getElementById('fb_align').value = st.align;
  document.getElementById('fb_color').value = hexOr(st.color, '#eef2f6');
  document.getElementById('fb_highlight').value = hexOr(st.highlight, '#ffe580');
  document.getElementById('fb_hl_off').classList.toggle('active', !st.highlight);
}

// Park the toolbar just under the thing it edits, clamped inside the canvas.
function positionFontbar() {
  const bar = document.getElementById('fontbar');
  const stage = document.getElementById('stage');
  if (!bar || !stage || bar.style.display === 'none') return;
  const w = bar.offsetWidth || 430;
  const h = bar.offsetHeight || 34;
  let left = 12;
  let top = 12;
  if (selGrip) {
    left = selGrip.box.l / devicePixelRatio - 8;
    top = selGrip.box.b / devicePixelRatio + 12;
  }
  left = Math.max(8, Math.min(left, stage.clientWidth - w - 8));
  if (top + h > stage.clientHeight - 8) top = Math.max(8, top - h - 30);
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
}

function wireFontbar() {
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  };
  on('fb_font', 'change', () => {
    const t = styleTarget();
    if (t) t.apply('font', document.getElementById('fb_font').value);
  });
  on('fb_size', 'input', () => {
    const t = styleTarget();
    const v = parseFloat(document.getElementById('fb_size').value);
    if (t) t.apply('size', Number.isFinite(v) && v > 0 ? v : null);
  });
  const nudge = (factor) => {
    const t = styleTarget();
    if (!t) return;
    const base = t.st.size ?? 0.6;
    const next = Math.max(0.05, Math.round(base * factor * 100) / 100);
    t.apply('size', next);
    document.getElementById('fb_size').value = next.toFixed(2);
  };
  on('fb_grow', 'click', () => nudge(1.15));
  on('fb_shrink', 'click', () => nudge(1 / 1.15));
  const toggle = (id, field, onValue, offValue) => {
    on(id, 'click', () => {
      const t = styleTarget();
      const el = document.getElementById(id);
      if (!t || !el) return;
      const next = !el.classList.contains('active');
      el.classList.toggle('active', next);
      t.apply(field, next ? onValue : offValue);
    });
  };
  toggle('fb_bold', 'weight', 700, 400);
  toggle('fb_italic', 'italic', true, false);
  toggle('fb_underline', 'underline', true, false);
  on('fb_align', 'change', () => {
    const t = styleTarget();
    if (t) t.apply('align', document.getElementById('fb_align').value);
  });
  on('fb_color', 'input', () => {
    const t = styleTarget();
    if (t) t.apply('color', document.getElementById('fb_color').value);
  });
  on('fb_highlight', 'input', () => {
    const t = styleTarget();
    if (!t) return;
    document.getElementById('fb_hl_off').classList.remove('active');
    t.apply('highlight', document.getElementById('fb_highlight').value);
  });
  on('fb_hl_off', 'click', () => {
    const t = styleTarget();
    if (!t) return;
    document.getElementById('fb_hl_off').classList.add('active');
    t.apply('highlight', null);
  });
  on('fb_reset', 'click', () => {
    if (!sel || sel.kind !== 'label') return;
    const key = labelKey(sel.labelKind, sel.obj.id, sel.bayIndex);
    const next = { ...state.labelOverrides };
    delete next[key];
    state.labelOverrides = next;
    save();
    renderProps();
    draw();
  });
}

// Repaint the sidebar for the current selection, then keep the layout-wide
// sections out of the way: while something is selected they fold down to a
// single row, so the element's own form is the only thing taking up space.
function renderProps() {
  renderPropsBody();
  syncSideSections();
}

function renderPropsBody() {
  renderFontbar();
  if (!sel) {
    props.innerHTML = `<h2>Properties</h2>
      <div class="hintline">Click an object on the plan with the <strong>Select</strong>
      tool (<strong>V</strong>) to edit it here. <strong>Shift</strong>+click or
      <strong>Shift</strong>+drag to pick several at once, then drag any one to move
      the group or <strong>Ctrl+C</strong> / <strong>Ctrl+V</strong> to copy it.</div>
      <div class="field"><label>Building</label>
        <input type="text" id="p_bname" value="${esc(state.meta.name)}"></div>
      <details class="sec"><summary>Label defaults</summary>
        <div class="det-body">
          <div class="hintline">Used by every label that has no override of its own.</div>
          ${labelStyleFields(state.labelStyle)}
        </div>
      </details>`;
    bind('p_bname', (v) => {
      state.meta.name = v;
    });
    wireLabelStyleFields();
    return;
  }
  if (sel.kind === 'multi') {
    const items = sel.items;
    const racks = items.filter((it) => it.kind === 'rack');
    const cells = racks.reduce((n, it) => n + it.obj.bays * it.obj.levels, 0);
    const rows = items.map((it) => `<div class="sel-row">${esc(itemLabel(it.kind, it.obj))}</div>`).join('');
    props.innerHTML =
      `<h2>${items.length} selected</h2>` +
      (racks.length
        ? `<div class="hintline">${racks.length} rack row${racks.length === 1 ? '' : 's'} &middot; ` +
          `${cells} pallet position${cells === 1 ? '' : 's'}</div>`
        : '') +
      `<div class="sel-list">${rows}</div>` +
      `<div class="hintline">Drag any one of them to move the whole group &middot; ` +
      `<strong>Ctrl+C</strong> then <strong>Ctrl+V</strong> copies them together &middot; ` +
      `<strong>Ctrl+D</strong> duplicates the group &middot; <strong>Del</strong> removes it</div>` +
      formFoot(
        `<button class="btn small" id="p_dup">Duplicate group</button>` +
          `<span class="grow"></span>` +
          `<button class="btn small del" id="p_del">Delete group</button>`,
      );
    document.getElementById('p_dup').onclick = duplicateSelected;
    document.getElementById('p_del').onclick = deleteSelected;
    return;
  }
  const o = sel.obj;
  if (sel.kind === 'zone') {
    props.innerHTML =
      `<h2>Zone</h2>` +
      f('ID', `<input type="text" id="p_id" value="${esc(o.id)}">`) +
      grp('Footprint') +
      f2(
        'x (m)',
        `<input type="number" id="p_x" value="${o.x}" step="0.1">`,
        'y (m)',
        `<input type="number" id="p_y" value="${o.y}" step="0.1">`,
      ) +
      f2(
        'Width (m)',
        `<input type="number" id="p_w" value="${o.w}" step="0.5">`,
        'Depth (m)',
        `<input type="number" id="p_d" value="${o.d}" step="0.5">`,
      ) +
      grp('Vertical') +
      f2(
        'Floor elev',
        `<input type="number" id="p_elev" value="${o.elev}" step="0.5">`,
        'Clear ht',
        `<input type="number" id="p_ch" value="${o.clearH}" step="0.5">`,
      ) +
      f('Colour', `<input type="color" id="p_col" value="${o.color}">`) +
      formFoot(`<span class="grow"></span><button class="btn small del" id="p_del">Delete zone</button>`);
    bindNum('p_x', 'x', o);
    bindNum('p_y', 'y', o);
    bindNum('p_w', 'w', o);
    bindNum('p_d', 'd', o);
    bindNum('p_elev', 'elev', o);
    bindNum('p_ch', 'clearH', o);
    bind('p_id', (v) => {
      o.id = v;
    });
    bind('p_col', (v) => {
      o.color = v;
    });
    document.getElementById('p_del').onclick = deleteSelected;
  }
  if (sel.kind === 'fixture') {
    const def = fixtureDef(o.kind);
    const menu = def && def.group === 'warehouse' ? 'Warehouse' : 'Building';
    const wDef = def ? def.w : o.w;
    const dDef = def ? def.d : o.d;
    props.innerHTML =
      `<h2>${def ? esc(def.label) : esc(o.kind)}</h2>` +
      f('ID', `<input type="text" id="p_id" value="${esc(o.id)}">`) +
      f('Kind', `<select id="p_fkind">${fixtureOptions(o.kind)}</select>`) +
      grp('Size') +
      f2(
        'Width (m)',
        `<input type="number" id="p_w" value="${o.w}" step="0.1" min="0.2">`,
        'Depth (m)',
        `<input type="number" id="p_d" value="${o.d}" step="0.1" min="0.1">`,
      ) +
      grp('Position') +
      f2(
        'x (m)',
        `<input type="number" id="p_x" value="${o.x}" step="0.1">`,
        'y (m)',
        `<input type="number" id="p_y" value="${o.y}" step="0.1">`,
      ) +
      f(
        'Rotation',
        `<span class="rotrow"><button class="btn small" id="p_rot_l">&#8630; 90&deg;</button>` +
          `<span class="labelval">${o.rot}&deg;</span>` +
          `<button class="btn small" id="p_rot_r">90&deg; &#8631;</button></span>`,
      ) +
      `<div class="hintline">From the <strong>${menu}</strong> menu — natural size
        ${wDef} × ${dDef} m. Drag it to move, or drag the corner square to resize.</div>` +
      formFoot(
        `<button class="btn small" id="p_dup">Duplicate</button>` +
          `<span class="grow"></span>` +
          `<button class="btn small del" id="p_del">Delete element</button>`,
      );
    bindNum('p_x', 'x', o);
    bindNum('p_y', 'y', o);
    bindNum('p_w', 'w', o);
    bindNum('p_d', 'd', o);
    bind('p_id', (v) => {
      o.id = v;
    });
    bind('p_fkind', (v) => {
      const from = fixtureDef(o.kind);
      const to = fixtureDef(v);
      // Keep a footprint the user has customised; otherwise take the new
      // element's natural size so the symbol is immediately the right shape.
      const untouched = !from || (o.w === from.w && o.d === from.d);
      o.kind = v;
      if (to && untouched) {
        o.w = to.w;
        o.d = to.d;
      }
      renderProps();
    });
    const turn = (delta) => {
      o.rot = rotateFixture(o, delta);
      save();
      renderProps();
      draw();
    };
    document.getElementById('p_rot_l').onclick = () => turn(-90);
    document.getElementById('p_rot_r').onclick = () => turn(90);
    document.getElementById('p_dup').onclick = () => {
      const copy = { ...o, id: nextFixtureId(state.fixtures), x: o.x + Math.max(1, o.w) };
      state.fixtures.push(copy);
      sel = { kind: 'fixture', obj: copy };
      save();
      renderProps();
      draw();
    };
    document.getElementById('p_del').onclick = deleteSelected;
  }
  if (sel.kind === 'node') {
    props.innerHTML =
      `<h2>Node</h2>` +
      f('ID', `<input type="text" id="p_id" value="${esc(o.id)}">`) +
      f(
        'Kind',
        `<select id="p_kind">
        ${['door', 'ramp', 'junction', 'dock', 'staging', 'charge']
          .map((k) => `<option ${o.kind === k ? 'selected' : ''}>${k}</option>`)
          .join('')}</select>`,
      ) +
      grp('Position') +
      f2(
        'x (m)',
        `<input type="number" id="p_x" value="${o.x}" step="0.1">`,
        'y (m)',
        `<input type="number" id="p_y" value="${o.y}" step="0.1">`,
      ) +
      `<div class="hintline">Zone is auto-detected from position at export time.</div>` +
      formFoot(`<span class="grow"></span><button class="btn small del" id="p_del">Delete node</button>`);
    bindNum('p_x', 'x', o);
    bindNum('p_y', 'y', o);
    bind('p_kind', (v) => {
      o.kind = v;
    });
    bind('p_id', (v) => {
      state.edges.forEach((ed) => {
        if (ed.a === o.id) ed.a = v;
        if (ed.b === o.id) ed.b = v;
      });
      o.id = v;
    });
    document.getElementById('p_del').onclick = deleteSelected;
  }
  if (sel.kind === 'edge') {
    props.innerHTML =
      `<h2>Path edge</h2>` +
      f2(
        'From',
        `<input type="text" value="${esc(o.a)}" disabled>`,
        'To',
        `<input type="text" value="${esc(o.b)}" disabled>`,
      ) +
      f('Ramp', `<input type="checkbox" id="p_ramp" ${o.ramp ? 'checked' : ''}>`) +
      `<div class="hintline">Length is computed from node coordinates.</div>` +
      formFoot(`<span class="grow"></span><button class="btn small del" id="p_del">Delete edge</button>`);
    document.getElementById('p_ramp').onchange = (e) => {
      o.ramp = e.target.checked;
      save();
      draw();
    };
    document.getElementById('p_del').onclick = deleteSelected;
  }
  if (sel.kind === 'label') {
    const key = labelKey(sel.labelKind, sel.obj.id, sel.bayIndex);
    const what = { zone: 'zone', rack: 'rack row', bay: 'bay', node: 'node' }[sel.labelKind] || 'label';
    const name = sel.labelKind === 'bay' ? resolveBayLabel(state, sel.obj, sel.bayIndex) : sel.obj.id;
    const overridden = !!state.labelOverrides[key];
    props.innerHTML =
      `<h2>Label</h2>` +
      `<div class="hintline">Editing the <strong>${what}</strong> label
       <strong>${esc(name)}</strong> — it still uses the shared defaults${overridden ? ' plus your overrides' : ''}.
       Use the <strong>Font</strong> toolbar over the plan: changes apply to
       <em>this label only</em>.</div>` +
      formFoot(
        `<button class="btn small" id="p_lbl_reset"${overridden ? '' : ' disabled'}>Reset this label</button>` +
          `<span class="grow"></span>` +
          `<button class="btn small" id="p_lbl_all">Reset all labels</button>`,
      );
    document.getElementById('p_lbl_reset').onclick = () => {
      const next = { ...state.labelOverrides };
      delete next[key];
      state.labelOverrides = next;
      save();
      renderProps();
      draw();
    };
    document.getElementById('p_lbl_all').onclick = () => {
      state.labelOverrides = {};
      save();
      renderProps();
      draw();
    };
    return;
  }
  if (sel.kind === 'text') {
    props.innerHTML =
      `<h2>Text</h2>` +
      f('Content', `<input type="text" id="p_text" value="${esc(o.text)}">`) +
      grp('Position') +
      f2(
        'x (m)',
        `<input type="number" id="p_x" value="${o.x}" step="0.5">`,
        'y (m)',
        `<input type="number" id="p_y" value="${o.y}" step="0.5">`,
      ) +
      `<div class="hintline">Style it with the <strong>Font</strong> toolbar over the plan.
        Drag the text to move it, or drag its corner square to resize.</div>` +
      formFoot(`<span class="grow"></span><button class="btn small del" id="p_del">Delete text</button>`);
    bind('p_text', (v) => {
      o.text = v;
    });
    bindNum('p_x', 'x', o);
    bindNum('p_y', 'y', o);
    document.getElementById('p_del').onclick = deleteSelected;
    return;
  }
  if (sel.kind === 'rack') {
    // Guards: ensure v4 fields exist (in-flight data may be mid-migration)
    if (!Array.isArray(o.levelHeights) || o.levelHeights.length !== o.levels) {
      const t = state.binTypes[o.type];
      const defH = t && t.h > 0 ? t.h : 0.12;
      o.levelHeights = Array.from({ length: Math.max(o.levels, 1) }, (_, i) => o.levelHeights?.[i] ?? defH);
    }
    if (!o.rowToken) o.rowToken = o.id.replace(/^[^-]+-/, '');
    if (!Number.isInteger(o.bayStart) || o.bayStart < 1) o.bayStart = 1;
    if (typeof o.bayReverse !== 'boolean') o.bayReverse = false;
    if (!state.binOverrides || typeof state.binOverrides !== 'object') state.binOverrides = {};

    const lhFields = fPairs(
      o.levelHeights.map((h, i) => ({
        label: `L${i + 1} ht (m)`,
        html: `<input type="number" id="p_lh_${i}" value="${h}" min="0.01" step="0.1">`,
      })),
    );

    // Bin label overrides — collapsible, rendered via <details>
    const rackBins = expandBins(state).filter((b) => b.row === o.id);
    const binovrRows = rackBins
      .map((b) => {
        const cur = state.binOverrides[b.override_key] ?? '';
        return `<div class="binovr-row">
          <span class="binovr-gen">${b.override_key in state.binOverrides ? '✎' : ''} ${b.bin_label}</span>
          <input type="text" class="binovr-inp" data-key="${b.override_key}"
            value="${cur}" placeholder="${b.bin_label}">
        </div>`;
      })
      .join('');

    const selBayBlo = selBay && selBay.rack === o ? (o.bayLevelOverrides || {})[selBay.bayIndex] : null;
    const selBayLevels = selBayBlo ? selBayBlo.levels : o.levels;
    const bayReadout =
      selBay && selBay.rack === o
        ? `<div class="hintline bay-readout">Bay: <strong>${resolveBayLabel(state, o, selBay.bayIndex)}</strong>&ensp;&middot;&ensp;${selBayLevels} level${selBayLevels !== 1 ? 's' : ''}${selBayBlo ? ' <em>(override)</em>' : ''}&ensp;&middot;&ensp;click another bay to update</div>`
        : '';

    // Aisle spacing: the clear gap between this row and the next row, and the
    // derived row pitch (depth + aisle) that Copy/Paste and "Add rows" use.
    const rackDepth = state.binTypes[o.type]?.d ?? 4;
    const effAisle = aisleOf(o);
    const aisleIsDefault = !(Number.isFinite(o.aisle) && o.aisle >= 0);
    const rowArrow = o.dir === 'E' ? '↓' : '→'; // where "Add rows" stacks

    props.innerHTML =
      `<h2>Rack row</h2>` +
      bayReadout +
      f('ID', `<input type="text" id="p_id" value="${esc(o.id)}">`) +
      f(
        'Bin type',
        `<select id="p_type">
        ${Object.keys(state.binTypes)
          .map((k) => `<option ${o.type === k ? 'selected' : ''}>${k}</option>`)
          .join('')}</select>`,
      ) +
      grp('Row layout') +
      f(
        'Direction',
        `<select id="p_dir">
        <option ${o.dir === 'E' ? 'selected' : ''} value="E">E — bays run east</option>
        <option ${o.dir === 'N' ? 'selected' : ''} value="N">N — bays run north</option></select>`,
      ) +
      f2(
        'Bays',
        `<input type="number" id="p_bays" value="${o.bays}" min="1" step="1">`,
        'Levels',
        `<input type="number" id="p_lv" value="${o.levels}" min="1" step="1">`,
      ) +
      lhFields +
      f2(
        'Row token',
        `<input type="text" id="p_rt" value="${esc(o.rowToken)}">`,
        'Bay start',
        `<input type="number" id="p_bs" value="${o.bayStart}" min="1" step="1">`,
      ) +
      f('Bay reverse', `<input type="checkbox" id="p_br" ${o.bayReverse ? 'checked' : ''}>`) +
      grp('Position') +
      f2(
        'Start x',
        `<input type="number" id="p_x" value="${o.x}" step="0.5">`,
        'Start y',
        `<input type="number" id="p_y" value="${o.y}" step="0.5">`,
      ) +
      grp('Aisle &amp; rows') +
      f(
        'Aisle (m)',
        `<input type="number" id="p_aisle" value="${+effAisle.toFixed(2)}" min="0" step="0.25">`,
      ) +
      `<div class="hintline" id="p_aisle_hint">${aisleHintHTML(rackDepth, effAisle, aisleIsDefault)}</div>` +
      f(
        'Rows to add',
        `<input type="number" id="p_rows" value="1" min="1" max="200" step="1">` +
          `<button class="btn small" id="p_addrows">Add ${rowArrow}</button>`,
      ) +
      grp('Bins') +
      `<div class="hintline">Bins generate as ROW-BAY-LEVEL at export (whse_location).</div>` +
      `<details class="box"><summary>Bin labels (${rackBins.length})</summary>` +
      `<div class="det-body"><div class="binovr-scroll" id="p_binovr">${binovrRows}</div></div></details>` +
      (() => {
        if (!selBay || selBay.rack !== o) return '';
        const blo = (o.bayLevelOverrides || {})[selBay.bayIndex];
        const bayLabel = resolveBayLabel(state, o, selBay.bayIndex);
        const effLevels = blo ? blo.levels : o.levels;
        const effHeights = blo ? blo.levelHeights : [...o.levelHeights];
        const heightFields = fPairs(
          effHeights.map((h, i) => ({
            label: `L${i + 1} (m)`,
            html: `<input type="number" id="p_bov_h_${i}" value="${h}" min="0.01" step="0.1">`,
          })),
        );
        return (
          `<details class="box" id="p_bay_ov"${blo ? ' open' : ''}>` +
          `<summary>Bay ${esc(bayLabel)} levels</summary>` +
          `<div class="det-body">` +
          f('Levels', `<input type="number" id="p_bov_lv" value="${effLevels}" min="1" step="1">`) +
          heightFields +
          (blo
            ? `<div class="btnrow"><button class="btn small" id="p_bov_clear">Remove override</button></div>`
            : '') +
          `</div></details>`
        );
      })() +
      formFoot(`<span class="grow"></span><button class="btn small del" id="p_del">Delete row</button>`);

    bindNum('p_x', 'x', o);
    bindNum('p_y', 'y', o);
    bindNum('p_bays', 'bays', o, true);
    bindNum('p_bs', 'bayStart', o, true);

    // Aisle: type a gap to give this row its own value, or clear the field to
    // fall back to the warehouse default. Updates the pitch readout live.
    const aisleEl = document.getElementById('p_aisle');
    if (aisleEl) {
      aisleEl.addEventListener('input', (e) => {
        const raw = e.target.value.trim();
        if (raw === '') {
          delete o.aisle;
        } else {
          const v = parseFloat(raw);
          if (!Number.isFinite(v) || v < 0) return;
          o.aisle = v;
        }
        save();
        draw();
        const hint = document.getElementById('p_aisle_hint');
        if (hint) {
          const d = state.binTypes[o.type]?.d ?? 4;
          hint.innerHTML = aisleHintHTML(d, aisleOf(o), !(Number.isFinite(o.aisle) && o.aisle >= 0));
        }
      });
    }

    // Add rows: lay a block of identical rows at the current aisle pitch.
    const addRowsEl = document.getElementById('p_addrows');
    if (addRowsEl) {
      addRowsEl.onclick = () => {
        const inp = document.getElementById('p_rows');
        addRackRows(o, inp ? inp.value : 1);
      };
    }

    // Custom levels handler: resize levelHeights to stay in sync with levels count
    const lvEl = document.getElementById('p_lv');
    if (lvEl) {
      lvEl.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        if (Number.isNaN(v) || v < 1) return;
        const oldLen = o.levelHeights.length;
        if (v > oldLen) {
          const lastH = o.levelHeights[oldLen - 1] ?? (state.binTypes[o.type]?.h || 0.12);
          for (let i = oldLen; i < v; i++) o.levelHeights.push(lastH);
        } else {
          o.levelHeights.length = v;
        }
        o.levels = v;
        save();
        renderProps();
        draw();
      });
    }
    o.levelHeights.forEach((_, i) => {
      const lhEl = document.getElementById(`p_lh_${i}`);
      if (lhEl) {
        lhEl.addEventListener('input', (e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v) && v > 0) {
            o.levelHeights[i] = v;
            save();
            draw();
          }
        });
      }
    });

    // Per-bay level override controls
    if (selBay && selBay.rack === o) {
      const blo = (o.bayLevelOverrides || {})[selBay.bayIndex];
      const effHeights = blo ? blo.levelHeights : [...o.levelHeights];

      const bovLvEl = document.getElementById('p_bov_lv');
      if (bovLvEl) {
        bovLvEl.addEventListener('input', (e) => {
          const v = parseInt(e.target.value, 10);
          if (Number.isNaN(v) || v < 1) return;
          if (!o.bayLevelOverrides) o.bayLevelOverrides = {};
          const curBlo = o.bayLevelOverrides[selBay.bayIndex];
          const curHeights = curBlo ? curBlo.levelHeights : [...o.levelHeights];
          const defH = curHeights[curHeights.length - 1] ?? o.levelHeights[o.levelHeights.length - 1] ?? 6;
          const newHeights = Array.from({ length: v }, (_, i) => curHeights[i] ?? defH);
          o.bayLevelOverrides[selBay.bayIndex] = { levels: v, levelHeights: newHeights };
          save();
          renderProps();
          draw();
        });
      }

      effHeights.forEach((_, i) => {
        const hEl = document.getElementById(`p_bov_h_${i}`);
        if (hEl) {
          hEl.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            if (Number.isNaN(v) || v <= 0) return;
            if (!o.bayLevelOverrides) o.bayLevelOverrides = {};
            if (!o.bayLevelOverrides[selBay.bayIndex]) {
              o.bayLevelOverrides[selBay.bayIndex] = { levels: o.levels, levelHeights: [...o.levelHeights] };
            }
            o.bayLevelOverrides[selBay.bayIndex].levelHeights[i] = v;
            save();
            draw();
          });
        }
      });

      const bovClearEl = document.getElementById('p_bov_clear');
      if (bovClearEl) {
        bovClearEl.addEventListener('click', () => {
          if (o.bayLevelOverrides) delete o.bayLevelOverrides[selBay.bayIndex];
          save();
          renderProps();
          draw();
        });
      }
    }

    // Bin label overrides — event delegation on the scroll container
    const binovrEl = document.getElementById('p_binovr');
    if (binovrEl) {
      binovrEl.addEventListener('input', (e) => {
        const key = e.target.dataset.key;
        if (!key) return;
        const v = e.target.value.trim();
        if (v) {
          state.binOverrides[key] = v;
        } else {
          delete state.binOverrides[key];
        }
        save();
      });
    }

    bind('p_id', (v) => {
      o.id = v;
    });
    bind('p_rt', (v) => {
      o.rowToken = v;
    });
    bind('p_type', (v) => {
      o.type = v;
    });
    bind('p_dir', (v) => {
      o.dir = v;
    });
    const brEl = document.getElementById('p_br');
    if (brEl) {
      brEl.addEventListener('change', (e) => {
        o.bayReverse = e.target.checked;
        save();
        draw();
      });
    }
    document.getElementById('p_del').onclick = deleteSelected;
  }
}

// Fold the layout-wide sections away while an element form is on screen. The
// state only flips when the selection goes from empty to non-empty (or back), so
// a user who opens the group by hand keeps it open.
let sideHadSel = null;
function syncSideSections() {
  const g = document.getElementById('globals');
  if (!g) return;
  const has = !!sel;
  if (has === sideHadSel) return;
  sideHadSel = has;
  g.open = !has;
  // Show the form from the top when a selection replaces a long settings page.
  const side = document.getElementById('side');
  if (has && side) side.scrollTop = 0;
}

// ---------- bin types panel ----------
function renderBinTypes() {
  const box = document.getElementById('binTypeList');
  box.innerHTML = '';
  Object.entries(state.binTypes).forEach(([name, t]) => {
    const row = document.createElement('div');
    row.className = 'bt-row';
    row.innerHTML = `
      <input type="text" value="${name}" data-f="name">
      <input type="number" value="${t.w}" step="0.5" data-f="w">
      <input type="number" value="${t.d}" step="0.5" data-f="d">
      <input type="number" value="${t.h}" step="0.5" data-f="h">
      <input type="color" value="${t.color}" data-f="color">
      <span class="x" title="delete">×</span>`;
    row.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const field = inp.dataset.f;
        if (field === 'name') {
          const nv = inp.value.trim().toUpperCase() || name;
          if (nv !== name) {
            state.binTypes[nv] = state.binTypes[name];
            delete state.binTypes[name];
            state.racks.forEach((r) => {
              if (r.type === name) r.type = nv;
            });
            renderBinTypes();
            renderProps();
          }
        } else if (field === 'color') {
          state.binTypes[name].color = inp.value;
        } else {
          state.binTypes[name][field] = parseFloat(inp.value) || 0;
        }
        save();
        draw();
      });
    });
    row.querySelector('.x').onclick = () => {
      if (state.racks.some((r) => r.type === name)) {
        alert('Rows still use this type.');
        return;
      }
      delete state.binTypes[name];
      renderBinTypes();
      save();
      draw();
    };
    box.appendChild(row);
  });
}

// ---------- background image ----------
function updateBgInfo() {
  document.getElementById('bgInfo').textContent = state.bg
    ? `Image loaded · scale ${state.bg.mPerPx.toFixed(3)} m/px. Drag with Select does NOT move the image; adjust via Calibrate.`
    : 'No image loaded. Load your floorplan PNG, then Calibrate: click two points a known distance apart.';
}

// ---------- import / export ----------
function exportLayout() {
  const out = toDbConnect(state);
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'warehouse_layout.json';
  a.click();
  flagSaved('exported');
}

async function importLayoutFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    alert('Could not parse that file: ' + err.message);
    return;
  }
  delete data.bins; // derived — regenerate on next save; binOverrides is NOT deleted (user data)
  try {
    data = fromDbConnect(migrate(data));
  } catch (err) {
    alert('Could not load that layout: ' + err.message);
    return;
  }
  // Backfill any missing top-level keys from the shipped default.
  const defaults = await fetchDefaultLayout();
  state = Object.assign(JSON.parse(JSON.stringify(defaults)), data);
  state.labelStyle = normalizeLabelStyle(state.labelStyle);
  state.texts = normalizeTexts(state.texts);
  state.labelOverrides = normalizeLabelOverrides(state.labelOverrides);
  state.fixtures = normalizeFixtures(state.fixtures);
  sel = null;
  loadBgImage();
  renderBinTypes();
  renderProps();
  updateBgInfo();
  save();
  draw();
}

// ---------- 3D toggle ----------
function setMode3d(on) {
  mode3d = on;
  document.getElementById('c3dwrap').style.display = on ? 'block' : 'none';
  cv.style.display = on ? 'none' : 'block';
  document.getElementById('view3d').classList.toggle('active', on);
  document.getElementById('view2d').classList.toggle('active', !on);
  if (on) {
    preview.build(state, labelState.get());
  } else {
    preview.teardown();
    draw();
  }
}

// ---------- label toggle ----------
function toggleLabels() {
  labelState.toggle();
  const btn = document.getElementById('toggleLabels');
  if (btn) btn.classList.toggle('active', labelState.get());
  if (mode3d) preview.build(state, labelState.get());
  draw();
}

// ---------- view panning ----------
// Screen-space pan: dxPx > 0 moves the viewport east, dyPx > 0 moves it north
// (i.e. the plan slides the opposite way under the cursor). Used by the keyboard
// arrows; pointer panning works directly from cursor deltas further below.
const PAN_STEP_PX = 90;

function panBy(dxPx, dyPx) {
  if (mode3d) return;
  view.cx += dxPx / view.zoom;
  view.cy += dyPx / view.zoom;
  draw();
}

function startPan(mx, my) {
  panning = { mx, my };
  cv.style.cursor = 'grabbing';
}

// Recenter on the layout and zoom to fit, so a lost view is one click away.
// Bounds come from the last draw, so the fit matches exactly what is painted.
function centerView() {
  if (mode3d) {
    preview.build(state, labelState.get()); // rebuilding reframes the 3D camera
    return;
  }
  draw();
  const b = drawnBounds;
  if (!b) return;
  const pad = 0.08; // 8% breathing room around the layout
  const w = Math.max(b.maxX - b.minX, 1);
  const d = Math.max(b.maxY - b.minY, 1);
  const fit = Math.min(cv.clientWidth / (w * (1 + pad * 2)), cv.clientHeight / (d * (1 + pad * 2)));
  view.zoom = Math.max(0.4, Math.min(40, fit));
  view.cx = (b.minX + b.maxX) / 2;
  view.cy = (b.minY + b.maxY) / 2;
  draw();
}

// ---------- pointer / keyboard wiring ----------
function wirePointer() {
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // Suppress the browser's middle-click autoscroll so middle-drag can pan.
  cv.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  cv.addEventListener('pointerdown', (e) => {
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const x = wx(mx);
    const y = wy(my);
    cv.setPointerCapture(e.pointerId);
    cv.focus({ preventScroll: true }); // so Space/arrows reach the plan

    // Pan the plan: right- or middle-drag, Space+drag, or left-drag on empty
    // space (Select tool). Scroll-wheel zoom is wired separately below.
    if (e.button === 2 || e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      startPan(mx, my);
      return;
    }

    if (calMode) {
      calClicks.push({ x, y, px: mx, py: my });
      if (calClicks.length === 2) {
        const distM = parseFloat(prompt('Real-world distance between those two points, in metres:', '30'));
        if (distM > 0 && state.bg) {
          const dPx =
            Math.hypot(calClicks[1].x - calClicks[0].x, calClicks[1].y - calClicks[0].y) / state.bg.mPerPx;
          state.bg.mPerPx = distM / dPx;
          updateBgInfo();
          save();
        }
        calMode = false;
        calClicks = [];
        setHint('');
      } else {
        setHint('Calibrate: click the SECOND point');
      }
      draw();
      return;
    }

    if (tool === 'select') {
      // The corner grip of the selected label / text resizes just that one.
      const gx = mx * devicePixelRatio;
      const gy = my * devicePixelRatio;
      const g = selGrip && selGrip.box;
      if (g && gx >= g.r - 8 && gx <= g.r + 8 && gy >= g.b - 8 && gy <= g.b + 8) {
        e.preventDefault();
        if (selGrip.fixture) {
          fixtureResize = { f: selGrip.fixture };
        } else {
          styleResize = {
            startSize: selGrip.sizeM,
            startDist: Math.max(0.001, Math.hypot(x - selGrip.ax, y - selGrip.ay)),
            ax: selGrip.ax,
            ay: selGrip.ay,
          };
        }
        cv.style.cursor = 'nwse-resize';
        return;
      }
      const h = hitTest(x, y);
      const item = h && MOVABLE_KINDS.has(h.kind) ? { kind: h.kind, obj: h.obj } : null;

      if (e.shiftKey) {
        // A label that stands for a movable owner (a row caption, a bay number)
        // counts as that owner while extending the selection, so a Shift-click
        // near a row picks the row rather than its caption.
        const owner =
          h && h.kind === 'label' && LABEL_OWNER_KINDS[h.labelKind] && h.obj
            ? { kind: LABEL_OWNER_KINDS[h.labelKind], obj: h.obj }
            : null;
        // Shift starts a rubber band, so a sweep can begin even on top of a
        // zone. If the pointer never really moves the gesture is a Shift-click
        // and toggles (or picks) whatever was under it.
        marquee = { x0: x, y0: y, x1: x, y1: y, moved: false, hit: item || owner || h };
        renderProps();
        draw();
        return;
      }

      if (!item) {
        // A non-movable hit (label, path edge) is selected as before; empty
        // space clears the selection and starts a pan.
        if (h) {
          sel = h;
          selBay = null;
          renderProps();
          draw();
          return;
        }
        sel = null;
        selBay = null;
        renderProps();
        draw();
        startPan(mx, my); // left-drag on empty space pans the plan
        return;
      }

      const already = isSelected(item.kind, item.obj);
      if (!already) setSelection([item]);
      if (item.kind === 'rack') {
        const bi = bayOf(item.obj, state.binTypes, x, y);
        selBay = bi !== null ? { rack: item.obj, bayIndex: bi } : null;
      } else {
        selBay = null;
      }
      // Grab the whole selection. The grabbed element sets the grid snap; a
      // click that never moves collapses the group back to just that element.
      dragMove = {
        ax0: item.obj.x,
        ay0: item.obj.y,
        ox: x - item.obj.x,
        oy: y - item.obj.y,
        items: selectedItems().map((it) => ({ obj: it.obj, x0: it.obj.x, y0: it.obj.y })),
        collapseTo: already ? item : null,
        moved: false,
      };
      renderProps();
      draw();
      return;
    }
    if (tool === 'text') {
      const t = createText({
        id: nextTextId(state.texts),
        x: snap(x),
        y: snap(y),
        font: state.labelStyle.font,
        weight: state.labelStyle.weight,
        italic: state.labelStyle.italic,
        size: Math.max(0.4, +(DEFAULT_TEXT_SIZE * state.labelStyle.scale).toFixed(2)),
      });
      state.texts.push(t);
      sel = { kind: 'text', obj: t };
      save();
      renderProps();
      draw();
      const inp = document.getElementById('p_text'); // type straight away, like Paint
      if (inp) {
        inp.focus();
        inp.select();
      }
      return;
    }
    if (tool === 'fixture') {
      const f = createFixture(fixtureKind, snap(x), snap(y));
      if (!f) return;
      f.id = nextFixtureId(state.fixtures);
      state.fixtures.push(f);
      sel = { kind: 'fixture', obj: f };
      save();
      renderProps();
      draw();
      return;
    }
    if (tool === 'zone' || tool === 'rack') {
      dragDraw = { x0: snap(x), y0: snap(y), x1: snap(x), y1: snap(y) };
      return;
    }
    if (tool === 'node') {
      const id = nextNodeId('door');
      const n = { id, kind: 'door', x: snap(x), y: snap(y) };
      state.nodes.push(n);
      sel = { kind: 'node', obj: n };
      save();
      renderProps();
      draw();
      return;
    }
    if (tool === 'edge') {
      const h = hitTest(x, y);
      if (h && h.kind === 'node') {
        if (!pendingEdgeNode) {
          pendingEdgeNode = h.obj;
          setHint(`Edge from ${h.obj.id} — click second node`);
        } else if (h.obj !== pendingEdgeNode) {
          state.edges.push({ a: pendingEdgeNode.id, b: h.obj.id, ramp: false });
          sel = { kind: 'edge', obj: state.edges[state.edges.length - 1] };
          pendingEdgeNode = null;
          setHint('Click first node, then second node');
          save();
          renderProps();
        }
      }
      draw();
      return;
    }
    if (tool === 'delete') {
      const h = hitTest(x, y);
      if (h) {
        sel = h;
        deleteSelected();
      }
    }
  });

  cv.addEventListener('pointermove', (e) => {
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const x = wx(mx);
    const y = wy(my);
    document.getElementById('status').textContent =
      `x: ${x.toFixed(1)} m , y: ${y.toFixed(1)} m   zoom ${view.zoom.toFixed(1)} px/m`;

    if (fixtureResize) {
      // Drag the corner: the grip simply follows the cursor, mapped into the
      // fixture's own rotated frame so it works at any quarter turn.
      const f = fixtureResize.f;
      const radial = (f.rot * Math.PI) / 180;
      const cos = Math.cos(radial);
      const sin = Math.sin(radial);
      const u = x - f.x; // world east
      const v = f.y - y; // canvas down
      const lx = u * cos + v * sin;
      const ly = -u * sin + v * cos;
      f.w = Math.max(0.2, +(Math.abs(lx) * 2).toFixed(2));
      f.d = Math.max(0.1, +(Math.abs(ly) * 2).toFixed(2));
      renderProps();
      draw();
      return;
    }
    if (styleResize) {
      const dist = Math.hypot(x - styleResize.ax, y - styleResize.ay);
      applySelectedSize(styleResize.startSize * (dist / styleResize.startDist));
      renderFontbar();
      draw();
      return;
    }
    if (panning) {
      view.cx -= (mx - panning.mx) / view.zoom;
      view.cy += (my - panning.my) / view.zoom;
      panning = { mx, my };
      draw();
      return;
    }
    if (dragDraw) {
      dragDraw.x1 = snap(x);
      dragDraw.y1 = snap(y);
      draw();
      return;
    }
    if (marquee) {
      marquee.x1 = x;
      marquee.y1 = y;
      // A few pixels of slop so a Shift-click is not read as a tiny band.
      if (Math.hypot(x - marquee.x0, y - marquee.y0) > 8 / view.zoom) marquee.moved = true;
      draw();
      return;
    }
    if (dragMove && sel) {
      // Snap the grabbed element to the grid, then shift every other member of
      // the selection by the same delta so the group moves rigidly.
      const dx = snap(x - dragMove.ox) - dragMove.ax0;
      const dy = snap(y - dragMove.oy) - dragMove.ay0;
      if (dx !== 0 || dy !== 0) dragMove.moved = true;
      for (const it of dragMove.items) {
        it.obj.x = it.x0 + dx;
        it.obj.y = it.y0 + dy;
      }
      renderProps();
      draw();
    }
  });

  cv.addEventListener('pointerup', () => {
    if (fixtureResize) {
      fixtureResize = null;
      restCursor();
      save();
      return;
    }
    if (styleResize) {
      styleResize = null;
      restCursor();
      save();
      return;
    }
    if (panning) {
      panning = null;
      restCursor();
      return;
    }
    if (dragMove) {
      const dm = dragMove;
      dragMove = null;
      save();
      // A click on an element that was already part of a group (no drag) drops
      // back to selecting just that one.
      if (!dm.moved && dm.collapseTo) {
        setSelection([dm.collapseTo]);
        renderProps();
        draw();
      }
      return;
    }
    if (marquee) {
      const mq = marquee;
      marquee = null;
      if (!mq.moved) {
        // A Shift-click rather than a sweep: toggle the element under it.
        const h = mq.hit;
        if (h && MOVABLE_KINDS.has(h.kind)) {
          toggleSelection(h.kind, h.obj);
          selBay = null;
          if (sel && sel.kind === 'rack') {
            const bi = bayOf(sel.obj, state.binTypes, mq.x0, mq.y0);
            selBay = bi !== null ? { rack: sel.obj, bayIndex: bi } : null;
          }
        } else if (h) {
          sel = h;
          selBay = null;
        }
        // Shift-clicking empty space leaves the selection as it was.
      } else {
        const box = {
          minX: Math.min(mq.x0, mq.x1),
          maxX: Math.max(mq.x0, mq.x1),
          minY: Math.min(mq.y0, mq.y1),
          maxY: Math.max(mq.y0, mq.y1),
        };
        const picks = bandPicks(box);
        setSelection(picks);
        if (picks.length) {
          setHint(`${picks.length} selected — drag any one to move the group, Ctrl+C to copy`);
        }
      }
      renderProps();
      draw();
      return;
    }
    if (!dragDraw) return;

    const { x0, y0, x1, y1 } = dragDraw;
    dragDraw = null;
    if (tool === 'zone') {
      const w = Math.abs(x1 - x0);
      const d = Math.abs(y1 - y0);
      if (w >= 4 && d >= 4) {
        const zn = {
          id: nextZoneId(),
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w,
          d,
          elev: 0,
          clearH: 14,
          color: randColor(),
        };
        state.zones.push(zn);
        sel = { kind: 'zone', obj: zn };
        save();
        renderProps();
      }
    }
    if (tool === 'rack') {
      // The drag fixes the start point, the direction and a proposed length;
      // the spec sheet then opens so the run is sized before it exists.
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dir = Math.abs(dx) >= Math.abs(dy) ? 'E' : 'N';
      const len = dir === 'E' ? Math.abs(dx) : Math.abs(dy);
      const type = currentRackType();
      const bw = state.binTypes[type]?.w || 4.5;
      openRackDialog({
        x: dir === 'E' ? Math.min(x0, x1) : x0,
        y: dir === 'E' ? y0 : Math.min(y0, y1),
        dir,
        bays: Math.max(1, Math.min(200, Math.floor(len / bw))),
      });
    }
    draw();
  });

  // A cancelled gesture (e.g. the OS steals the pointer) must not leave the
  // plan stuck mid-pan.
  cv.addEventListener('pointercancel', () => {
    panning = null;
    dragMove = null;
    dragDraw = null;
    marquee = null;
    styleResize = null;
    fixtureResize = null;
    restCursor();
  });

  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const px = wx(mx);
      const py = wy(my);
      view.zoom *= e.deltaY > 0 ? 0.88 : 1.14;
      view.zoom = Math.max(0.4, Math.min(40, view.zoom));
      view.cx = px - (mx * devicePixelRatio - cv.width / 2) / (view.zoom * devicePixelRatio);
      view.cy = py + (my * devicePixelRatio - cv.height / 2) / (view.zoom * devicePixelRatio);
      draw();
    },
    { passive: false },
  );
}

function wireKeyboard() {
  const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

  addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if (rackDialogOpen()) return; // the dialog owns the keyboard while it is open

    // Ctrl/Cmd+Z undoes and Ctrl+Y / Ctrl+Shift+Z redoes. Every Ctrl/Cmd chord
    // is swallowed here so none fall through to the single-letter tool keys.
    if (e.ctrlKey || e.metaKey) {
      if (!e.altKey) {
        const ck = e.key.toLowerCase();
        if (ck === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (ck === 'y' || (ck === 'z' && e.shiftKey)) {
          e.preventDefault();
          redo();
          return;
        }
        if (ck === 'c') {
          e.preventDefault();
          copySelected();
          return;
        }
        if (ck === 'x') {
          e.preventDefault();
          cutSelected();
          return;
        }
        if (ck === 'v') {
          e.preventDefault();
          paste();
          return;
        }
        if (ck === 'd') {
          e.preventDefault();
          duplicateSelected();
          return;
        }
        if (ck === 'a') {
          e.preventDefault();
          selectAllRacks();
          return;
        }
      }
      return;
    }

    const k = e.key.toLowerCase();
    // Arrow keys pan the plan (Shift = larger steps). Hold to glide.
    if (k.startsWith('arrow')) {
      const step = PAN_STEP_PX * (e.shiftKey ? 3 : 1);
      if (k === 'arrowleft') panBy(-step, 0);
      if (k === 'arrowright') panBy(step, 0);
      if (k === 'arrowup') panBy(0, step);
      if (k === 'arrowdown') panBy(0, -step);
      e.preventDefault();
      return;
    }
    if (k === ' ') {
      // Space is a pan modifier over the plan. Leave it alone when a control
      // (button, input, …) has focus so those keep working by keyboard.
      if (e.target === document.body || e.target === cv) {
        spaceDown = true;
        e.preventDefault();
      }
      return;
    }
    if (k === 'v') setTool('select');
    if (k === 'z') setTool('zone');
    if (k === 'r') setTool('rack');
    if (k === 'n') setTool('node');
    if (k === 'e') setTool('edge');
    if (k === 't') setTool('text');
    if (k === 'x') setTool('delete');
    if (k === 'l') toggleLabels();
    if (k === 'home') centerView();
    if (k === 'escape') {
      pendingEdgeNode = null;
      dragDraw = null;
      marquee = null;
      calMode = false;
      calClicks = [];
      setHint('');
      draw();
    }
    if ((k === 'delete' || k === 'backspace') && sel) deleteSelected();
  });

  addEventListener('keyup', (e) => {
    if (e.key === ' ') spaceDown = false;
  });
  // Releasing Space outside the window / on blur must not leave pan mode stuck.
  addEventListener('blur', () => {
    spaceDown = false;
  });
}

// ---------- toolbar menus ----------
// The top bar folds its tools into dropdown menus. The Building / Warehouse
// lists are generated from the fixture catalogue, so the menus can never drift
// from what the editor actually draws.

function menuItemHtml(label, tool, kind, title) {
  const data = kind ? ` data-tool="${tool}" data-kind="${kind}"` : ` data-tool="${tool}"`;
  return `<button class="menu-item"${data} title="${title || ''}">${label}</button>`;
}

// One group's fixtures, with a small heading per section.
function fixtureMenuHtml(group) {
  let out = '';
  let last = null;
  for (const d of fixturesInGroup(group)) {
    if (d.section !== last) {
      out += `<div class="menu-sep">${d.section}</div>`;
      last = d.section;
    }
    out += menuItemHtml(d.label, 'fixture', d.kind, `Drop a ${d.label}`);
  }
  return out;
}

function buildToolMenus() {
  const building = document.querySelector('#menu-building .menu-list');
  if (building) building.innerHTML = fixtureMenuHtml('building');
  // The warehouse menu leads with the parametric rack-row tool, then equipment.
  const warehouse = document.querySelector('#menu-warehouse .menu-list');
  if (warehouse) {
    warehouse.innerHTML =
      menuItemHtml('Rack Row', 'rack', null, 'R — drag along the row direction to size a new row') +
      `<div class="menu-sep">Equipment</div>` +
      fixtureMenuHtml('warehouse');
  }
}

function closeMenus() {
  document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
}

function wireMenus() {
  document.querySelectorAll('.menu').forEach((m) => {
    const btn = m.querySelector('.menu-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = m.classList.contains('open');
      closeMenus();
      if (!wasOpen) m.classList.add('open');
    });
  });
  // A click anywhere else, or Esc, dismisses whatever is open.
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
  });
}

function wirePanels() {
  wireFontbar();
  wireRackDialog();
  buildToolMenus();
  wireMenus();

  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.kind) fixtureKind = b.dataset.kind;
      setTool(b.dataset.tool);
      closeMenus();
      cv.focus({ preventScroll: true }); // keep the canvas the keyboard target
    });
  });

  document.getElementById('centerView').onclick = () => {
    centerView();
    cv.focus({ preventScroll: true });
  };

  document.getElementById('undoBtn').onclick = () => {
    undo();
    cv.focus({ preventScroll: true });
  };
  document.getElementById('redoBtn').onclick = () => {
    redo();
    cv.focus({ preventScroll: true });
  };

  document.getElementById('addBinType').onclick = () => {
    let i = 1;
    while (state.binTypes['TYPE' + i]) i++;
    state.binTypes['TYPE' + i] = { w: 4.5, d: 4, h: 6, color: '#8f7fc4' };
    renderBinTypes();
    save();
  };

  const snapIn = document.getElementById('snapIn');
  const gridIn = document.getElementById('gridIn');
  snapIn.value = state.settings.snap;
  gridIn.value = state.settings.grid;
  snapIn.onchange = (e) => {
    state.settings.snap = parseFloat(e.target.value) || 0;
    save();
  };
  gridIn.onchange = (e) => {
    state.settings.grid = parseFloat(e.target.value) || 10;
    save();
    draw();
  };

  // Warehouse-wide default aisle for rack rows that have no aisle of their own.
  const aisleIn = document.getElementById('aisleIn');
  aisleIn.value = globalAisle();
  aisleIn.onchange = (e) => {
    const v = parseFloat(e.target.value);
    state.settings.aisle = Number.isFinite(v) && v >= 0 ? v : DEFAULT_RACK_AISLE;
    aisleIn.value = state.settings.aisle;
    save();
    renderProps();
    draw();
  };

  document.getElementById('bgLoad').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const file = inp.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        state.bg = { dataURL: rd.result, mPerPx: 0.107, ox: 0, oy: 0, opacity: 35 };
        loadBgImage();
        updateBgInfo();
        save();
      };
      rd.readAsDataURL(file);
    };
    inp.click();
  };
  document.getElementById('bgCal').onclick = () => {
    if (!state.bg) {
      alert('Load a background image first.');
      return;
    }
    calMode = true;
    calClicks = [];
    setHint('Calibrate: click the FIRST of two points a known distance apart');
  };
  document.getElementById('bgClear').onclick = () => {
    state.bg = null;
    bgImage = null;
    updateBgInfo();
    save();
    draw();
  };
  document.getElementById('bgOpacity').oninput = (e) => {
    if (state.bg) {
      state.bg.opacity = +e.target.value;
      save();
      draw();
    }
  };

  document.getElementById('view2d').onclick = () => setMode3d(false);
  document.getElementById('view3d').onclick = () => setMode3d(true);
  document.getElementById('toggleLabels').onclick = toggleLabels;
  document.getElementById('exportBtn').onclick = exportLayout;
  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = (e) => {
    const file = e.target.files[0];
    if (file) importLayoutFile(file);
    e.target.value = '';
  };
}

// ---------- entry point ----------
export function initEditor(layout) {
  state = layout;
  // Belt and braces: every route into the editor lands on the same defaults.
  state.labelStyle = normalizeLabelStyle(state.labelStyle);
  state.texts = normalizeTexts(state.texts);
  state.labelOverrides = normalizeLabelOverrides(state.labelOverrides);
  state.fixtures = normalizeFixtures(state.fixtures);
  history = createHistory(state); // the loaded layout is the first undo step

  cv = document.getElementById('c2d');
  ctx = cv.getContext('2d');
  props = document.getElementById('props');
  toolHint = document.getElementById('toolHint');
  preview = createPreview3D(document.getElementById('c3dwrap'));

  addEventListener('resize', resize);
  wirePointer();
  wireKeyboard();
  wirePanels();

  loadBgImage();
  renderProps();
  renderBinTypes();
  updateBgInfo();
  resize();
  // Open on a framed plan: resize() has painted once, so the layout bounds are
  // known and the first thing the user sees is the map centered and fitted.
  centerView();
  setTool('select');
  updateHistoryButtons();
}
