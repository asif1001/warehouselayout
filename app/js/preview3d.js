// preview3d.js — read-only 3D view of the current layout. Mirrors the 2D plan:
// zone slabs with clear-height wall outlines, stacked rack bins, path nodes and
// edges, and a model of every placed element (see models3d.js). Camera is a
// simple custom orbit (drag rotate, right-drag pan, wheel zoom). It is rebuilt
// from a layout snapshot each time the user opens 3D.

import * as THREE from '../vendor/three.module.js';
import { zoneOf, levelBaseZ } from './geometry.js';
import { resolveLabelStyle, labelKey } from './labels.js';
import { fixtureDef } from './fixtures.js';
import { fixtureParts } from './models3d.js';

export function createPreview3D(wrap) {
  let ctx = null; // { renderer, raf }

  function teardown() {
    if (!ctx) return;
    cancelAnimationFrame(ctx.raf);
    ctx.renderer.dispose();
    wrap.innerHTML = '';
    ctx = null;
  }

  function makeLabel(text, size, color, style = {}) {
    const pad = 8;
    const fp = 46;
    // Honour an explicit Normal/Bold from the Font toolbar; the bin-labelling
    // call sites pass no style and keep their heavier look.
    const weight = style.weight === 700 ? 700 : style.weight === 400 ? 400 : 600;
    const italic = style.italic ? 'italic ' : '';
    const font = `${italic}${weight} ${fp}px "${style.font || 'Consolas'}", monospace`;
    const c = document.createElement('canvas');
    let g = c.getContext('2d');
    g.font = font;
    c.width = Math.ceil(g.measureText(text).width) + pad * 2;
    c.height = fp + pad * 2;
    g = c.getContext('2d');
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, pad, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set((size * c.width) / c.height, size, 1);
    return sp;
  }

  function build(state, showLabels = true) {
    teardown();

    // Shared label defaults authored in the 2D sidebar.
    const raw = state.labelStyle ?? {};
    const ls = {
      scale: typeof raw.scale === 'number' && raw.scale > 0 ? raw.scale : 1,
      show: raw.show ?? {},
    };
    // Per-label overrides, so one restyled label keeps its look in 3D too.
    const overrides = state.labelOverrides || {};
    const style3d = (kind, id, bayIndex) =>
      resolveLabelStyle(state.labelStyle, overrides[labelKey(kind, id, bayIndex)]);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14181d);
    const camera = new THREE.PerspectiveCamera(50, wrap.clientWidth / wrap.clientHeight, 1, 4000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    wrap.appendChild(renderer.domElement);
    // Prevents macOS/Chrome from swallowing pointer drag events before they
    // reach the canvas — wheel-zoom still worked but rotate/pan did not.
    renderer.domElement.style.touchAction = 'none';

    scene.add(new THREE.HemisphereLight(0xbfd0e0, 0x20262e, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2dd, 0.7);
    sun.position.set(250, 400, -150);
    scene.add(sun);

    // world mapping: world.x = layout x, world.z = -layout y
    const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

    // extent for camera + grid framing
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    state.zones.forEach((z) => {
      minX = Math.min(minX, z.x);
      maxX = Math.max(maxX, z.x + z.w);
      minY = Math.min(minY, z.y);
      maxY = Math.max(maxY, z.y + z.d);
    });
    if (minX > maxX) {
      minX = 0;
      maxX = 200;
      minY = 0;
      maxY = 150;
    }
    const cx0 = (minX + maxX) / 2;
    const cy0 = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY);

    const grid = new THREE.GridHelper(span * 1.6, Math.round((span * 1.6) / 10), 0x2a323c, 0x222a33);
    grid.position.set(cx0, -0.31, -cy0);
    scene.add(grid);

    // ----- origin gizmo: marker at (0,0,0), labeled X/Y/Z axes, north arrow -----
    // Layout axes: +x = East, +y = North, +z = Up. In three.js world space the
    // mapping is W(x,y,z) = (x, z, -y), so North (+y) points along world -z.
    const aLen = Math.max(8, span * 0.16);
    const labSize = Math.max(4, span * 0.06);
    const ORIGIN = W(0, 0, 0);

    const addAxis = (dir, color, text) => {
      const d = dir.clone().normalize();
      scene.add(new THREE.ArrowHelper(d, ORIGIN, aLen, color, aLen * 0.16, aLen * 0.09));
      const lb = makeLabel(text, labSize, '#' + color.toString(16).padStart(6, '0'));
      lb.position.copy(ORIGIN.clone().addScaledVector(d, aLen * 1.1));
      scene.add(lb);
    };
    addAxis(new THREE.Vector3(1, 0, 0), 0xd4453a, '+X East'); // east
    addAxis(new THREE.Vector3(0, 0, -1), 0x5fb878, '+Y North'); // north
    addAxis(new THREE.Vector3(0, 1, 0), 0x5fa8e8, '+Z Up'); // up

    const originDot = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.4, aLen * 0.035), 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    originDot.position.copy(ORIGIN);
    scene.add(originDot);
    const oLab = makeLabel('0,0,0', labSize * 0.9, '#d7dde4');
    oLab.position.copy(ORIGIN.clone());
    oLab.position.y += aLen * 0.14;
    scene.add(oLab);

    state.zones.forEach((z) => {
      const slabH = z.elev + 0.2;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(z.w, slabH, z.d),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(z.color), transparent: true, opacity: 0.92 }),
      );
      slab.position.copy(W(z.x + z.w / 2, z.y + z.d / 2, slabH / 2));
      scene.add(slab);

      const wall = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(z.w, z.clearH, z.d)),
        new THREE.LineBasicMaterial({ color: 0x39434f }),
      );
      wall.position.copy(W(z.x + z.w / 2, z.y + z.d / 2, z.elev + z.clearH / 2));
      scene.add(wall);

      if (showLabels && ls.show.zones !== false) {
        const st = style3d('zone', z.id);
        const lb = makeLabel(
          'ZONE ' + z.id,
          st.size ? st.size * 8 : 10 * ls.scale,
          st.color ?? '#eef2f6',
          st,
        );
        lb.position.copy(W(z.x + z.w / 2, z.y + z.d / 2, z.elev + z.clearH + 1.2));
        scene.add(lb);
      }
    });

    state.racks.forEach((r) => {
      const t = state.binTypes[r.type];
      if (!t) return;
      const zone = zoneOf(state.zones, r.x, r.y);
      const elev = zone ? zone.elev : 0;
      for (let b = 0; b < r.bays; b++) {
        const bx = r.x + (r.dir === 'E' ? b * t.w + t.w / 2 : t.d / 2);
        const by = r.y + (r.dir === 'N' ? b * t.w + t.w / 2 : t.d / 2);
        const blo = r.bayLevelOverrides?.[b];
        const levelHeights =
          blo?.levelHeights?.length > 0
            ? blo.levelHeights
            : Array.isArray(r.levelHeights) && r.levelHeights.length > 0
              ? r.levelHeights
              : Array.from({ length: Math.max(r.levels, 1) }, () => (t.h > 0 ? t.h : 0.12));
        for (let l = 0; l < levelHeights.length; l++) {
          const lh = levelHeights[l] > 0 ? levelHeights[l] : 0.12;
          const geo = new THREE.BoxGeometry(
            (r.dir === 'E' ? t.w : t.d) - 0.09,
            Math.max(lh - 0.11, 0.01),
            (r.dir === 'E' ? t.d : t.w) - 0.09,
          );
          const m = new THREE.Mesh(
            geo,
            new THREE.MeshLambertMaterial({
              color: new THREE.Color(t.color),
              transparent: true,
              opacity: 0.55,
            }),
          );
          m.position.copy(W(bx, by, elev + levelBaseZ(levelHeights, l) + lh / 2));
          scene.add(m);
          const eg = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo),
            new THREE.LineBasicMaterial({ color: 0x10141a }),
          );
          eg.position.copy(m.position);
          scene.add(eg);
        }
      }
    });

    const nGeo = new THREE.SphereGeometry(0.5, 16, 12);
    state.nodes.forEach((n) => {
      const zone = zoneOf(state.zones, n.x, n.y);
      const elev = zone ? zone.elev : 0;
      const m = new THREE.Mesh(
        nGeo,
        new THREE.MeshLambertMaterial({ color: n.kind === 'ramp' ? 0xe8a33d : 0xd4453a }),
      );
      m.position.copy(W(n.x, n.y, elev + 0.5));
      scene.add(m);
      if (showLabels && ls.show.nodes !== false) {
        const st = style3d('node', n.id);
        const lb = makeLabel(n.id, st.size ? st.size * 8 : 5 * ls.scale, st.color ?? '#ff9d94', st);
        lb.position.copy(W(n.x, n.y, elev + 1.8));
        scene.add(lb);
      }
    });

    // Placed building + warehouse elements. Each kind has its own model (see
    // models3d.js) so a forklift reads as a forklift rather than a box; a kind
    // with no model falls back to its footprint slab.
    const matCache = new Map();
    const matFor = (color, opacity) => {
      const key = color + '|' + opacity;
      let m = matCache.get(key);
      if (!m) {
        m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
        if (opacity < 1) {
          m.transparent = true;
          m.opacity = opacity;
        }
        matCache.set(key, m);
      }
      return m;
    };
    (state.fixtures || []).forEach((f) => {
      const def = fixtureDef(f.kind);
      if (!def) return;
      const zone = zoneOf(state.zones, f.x, f.y);
      const elev = zone ? zone.elev : 0;
      const group = new THREE.Group();
      fixtureParts(f.kind, f.w, f.d, def.h).forEach((part) => {
        const color = part.color || def.color;
        const opacity = part.opacity ?? 1;
        let mesh;
        if (part.shape === 'cyl') {
          mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(part.r, part.r, part.h, 20),
            matFor(color, opacity),
          );
          // Cylinders stand along +Y; lay the wheels on their side.
          if (part.axis === 'x') mesh.rotation.z = Math.PI / 2;
          if (part.axis === 'z') mesh.rotation.x = Math.PI / 2;
        } else {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(part.w, part.h, part.d), matFor(color, opacity));
          if (part.rx) mesh.rotation.x = part.rx;
        }
        mesh.position.set(part.x, part.y, part.z);
        group.add(mesh);
      });
      group.position.copy(W(f.x, f.y, elev));
      // Plan rotation is clockwise on screen, which is -rot about three.js +Y.
      group.rotation.y = (-f.rot * Math.PI) / 180;
      scene.add(group);
      if (showLabels && ls.show.fixtures !== false) {
        const st = style3d('fixture', f.id);
        const lb = makeLabel(def.label, st.size ? st.size * 8 : 4 * ls.scale, def.color, st);
        lb.position.copy(W(f.x, f.y, elev + def.h + 1.2));
        scene.add(lb);
      }
    });

    // Free text annotations float above the floor, matching the 2D plan.
    state.texts.forEach((t) => {
      const zone = zoneOf(state.zones, t.x, t.y);
      const elev = zone ? zone.elev : 0;
      const lb = makeLabel(t.text, Math.max(3, t.size * 6) * ls.scale, t.color || '#eef2f6', t);
      lb.position.copy(W(t.x, t.y, elev + 2.2));
      scene.add(lb);
    });

    state.edges.forEach((ed) => {
      const a = state.nodes.find((n) => n.id === ed.a);
      const b = state.nodes.find((n) => n.id === ed.b);
      if (!a || !b) return;
      const za = zoneOf(state.zones, a.x, a.y);
      const zb = zoneOf(state.zones, b.x, b.y);
      const ea = za ? za.elev : 0;
      const eb = zb ? zb.elev : 0;
      const geo = new THREE.BufferGeometry().setFromPoints([W(a.x, a.y, ea + 0.8), W(b.x, b.y, eb + 0.8)]);
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: ed.ramp ? 0xe8a33d : 0x7f8a96 })));
    });

    // camera orbit
    const target = new THREE.Vector3(cx0, 4, -cy0);
    let theta = -0.55;
    let phi = 0.95;
    let radius = span * 1.1;
    function applyCam() {
      phi = Math.max(0.12, Math.min(1.45, phi));
      radius = Math.max(30, Math.min(3000, radius));
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(target);
    }
    applyCam();

    const el = renderer.domElement;
    let drag = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, btn: e.button };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (drag.btn === 2 || e.shiftKey) {
        const ps = radius / 700;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        target.addScaledVector(right, -dx * ps);
        target.addScaledVector(up, dy * ps);
      } else {
        theta -= dx * 0.006;
        phi -= dy * 0.006;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      applyCam();
    });
    el.addEventListener('pointerup', () => {
      drag = null;
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        radius *= 1 + Math.sign(e.deltaY) * 0.1;
        applyCam();
      },
      { passive: false },
    );

    ctx = { renderer, raf: 0 };
    const loop = () => {
      ctx.raf = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();
  }

  return { build, teardown };
}
