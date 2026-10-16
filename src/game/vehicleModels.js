// Terra3D game — procedural vehicle meshes (no external models).
// All vehicles face -Z (yaw 0 = north). Parts: {model, local: Mat4, kind}.
// Meshes are canonicalized so group index maps 1:1 to the material list.
import { Geometry, canonicalizeGroups } from "../engine/builders.js";
import { Mesh, Model } from "../engine/mesh.js";
import { Material } from "../engine/material.js";
import { Mat4 } from "../engine/mat4.js";
import { Vec3 } from "../engine/vec3.js";
import { ATLAS, cellUV } from "../world/textures.js";

/**
 * Canonical group order -> material list. The renderer selects a material by
 * group index, so every mesh must be re-ordered through this helper.
 */
function finishModel(gl, geo, mats, order, opts = {}) {
  const names = canonicalizeGroups(geo, order);
  const mesh = new Mesh(gl, geo);
  const materials = names.map((n) => {
    const m = mats[n];
    if (!m) console.warn(`vehicle mesh: no material for group "${n}"`);
    return m || mats.paint || mats.tire;
  });
  return new Model(mesh, materials, opts);
}

/**
 * Extrude a 2D profile (list of [z, y], counter-clockwise in the z-y chart)
 * across the X axis. nameForEdge(i) names the group each rim edge belongs to.
 */
function extrudeProfile(geo, profile, halfW, nameForEdge, sideGroup = "paint") {
  const n = profile.length;
  let cy = 0, cz = 0;
  for (const p of profile) { cz += p[0]; cy += p[1]; }
  cz /= n; cy /= n;

  // ---- side panels (outward normal ±X), fanned from the centroid ----
  for (const side of [-1, 1]) {
    geo.beginGroup(sideGroup);
    const cx = side * halfW;
    const cIdx = geo.addVertex(cx, cy, cz, side, 0, 0, cz, cy, 0, 0, 1, 1, 1);
    const ring = profile.map((p) => geo.addVertex(cx, p[1], p[0], side, 0, 0, p[0], p[1], 0, 0, 1, 1, 1));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (side < 0) geo.addTri(cIdx, ring[i], ring[j]);
      else geo.addTri(cIdx, ring[j], ring[i]);
    }
    geo.endGroup();
  }

  // ---- rim faces: profile edges swept along X. Winding (a, b, c, d) below
  // yields the outward geometric normal (0, -dz, dy) for a CCW profile.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p0 = profile[i], p1 = profile[j];
    const dz = p1[0] - p0[0], dy = p1[1] - p0[1];
    const len = Math.hypot(dy, dz) || 1;
    const ny = -dz / len, nz = dy / len;
    geo.beginGroup(nameForEdge ? nameForEdge(i) : "paint");
    const a = geo.addVertex(-halfW, p0[1], p0[0], 0, ny, nz, 0, 0, 0, 0, 1, 1, 1);
    const b = geo.addVertex(halfW, p0[1], p0[0], 0, ny, nz, 1, 0, 0, 0, 1, 1, 1);
    const c = geo.addVertex(halfW, p1[1], p1[0], 0, ny, nz, 1, 1, 0, 0, 1, 1, 1);
    const d = geo.addVertex(-halfW, p1[1], p1[0], 0, ny, nz, 0, 1, 0, 0, 1, 1, 1);
    geo.addQuad(a, b, c, d);
    geo.endGroup();
  }
  return geo;
}

/** Single quad in its own group (windows, lights, windshields). */
function addQuadGroup(geo, name, corners, normal, tint = [1, 1, 1], cell = [0, 0]) {
  geo.beginGroup(name);
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const ids = corners.map((p, i) => geo.addVertex(
    p[0], p[1], p[2], normal[0], normal[1], normal[2],
    uv[i][0], uv[i][1], cell[0], cell[1], tint[0], tint[1], tint[2]
  ));
  geo.addQuad(ids[0], ids[1], ids[2], ids[3]);
  geo.endGroup();
}

/** Small helper: single-group box geometry. */
function boxGeo(center, size, tint = [1, 1, 1], group = "paint", opts = {}) {
  const g = new Geometry();
  g.beginGroup(group);
  g.addBox(center[0], center[1], center[2], size[0], size[1], size[2], { tint, uvScale: 40, ...opts });
  g.endGroup();
  return g;
}

/* ------------------------------------------------------------------ */

export function makeVehicleMaterials(assets, colors = {}) {
  const {
    body = [0.72, 0.12, 0.12],
    accent = [0.09, 0.10, 0.12],
    trim = [0.10, 0.10, 0.11],
  } = colors;
  return {
    paint: new Material({ color: body, spec: 0.65, cull: false }),
    paint2: new Material({ color: accent, spec: 0.45, cull: false }),
    glass: new Material({ color: [0.07, 0.105, 0.14], spec: 1.7, cull: false }),
    trim: new Material({ color: trim, spec: 0.3, cull: false }),
    tire: new Material({ color: [0.045, 0.045, 0.05], spec: 0.06 }),
    headlight: new Material({
      texture: assets.facade, atlas: true, cellSize: 0.25, emissive: 1,
      color: [1, 1, 1], cull: false,
    }),
    taillight: new Material({
      texture: assets.facade, atlas: true, cellSize: 0.25, emissive: 1,
      color: [1, 1, 1], cull: false,
    }),
    cellWhite: cellUV(ATLAS.lightWhite),
    cellRed: cellUV(ATLAS.lightRed),
  };
}

const CAR_ORDER = ["paint", "paint2", "glass", "trim", "headlight", "taillight"];
const WHEEL_ORDER = ["tire", "trim"];
const BOAT_ORDER = ["paint", "paint2", "glass", "trim"];
const PLANE_ORDER = ["paint", "paint2", "glass", "trim"];
const PROP_ORDER = ["paint2"];

/* ---------------- car ---------------- */

export function buildCar(gl, mats) {
  const geo = new Geometry();
  // Profile in the z-y chart, counter-clockwise. Edges 5->6 (rear window)
  // and 7->8 (windshield) become glass; everything else is body paint.
  const bodyProfile = [
    [-2.15, 0.30], [2.20, 0.30], [2.32, 0.46], [2.34, 0.72],
    [2.10, 0.82], [1.18, 0.84], [0.55, 1.36], [-0.45, 1.36],
    [-1.18, 0.86], [-2.05, 0.78], [-2.34, 0.66], [-2.32, 0.40],
  ];
  extrudeProfile(geo, bodyProfile, 0.88, (i) => (i === 5 || i === 7 ? "glass" : "paint"), "paint");

  // Side windows.
  for (const sx of [-1, 1]) {
    addQuadGroup(geo, "glass",
      [[sx * 0.895, 0.90, -0.42], [sx * 0.895, 0.90, 0.52], [sx * 0.895, 1.30, 0.5], [sx * 0.895, 1.30, -0.4]],
      [sx, 0, 0]);
  }
  // Headlights + taillights (emissive atlas cells).
  for (const sx of [-1, 1]) {
    addQuadGroup(geo, "headlight",
      [[sx * 0.18, 0.53, -2.355], [sx * 0.62, 0.53, -2.355], [sx * 0.62, 0.66, -2.35], [sx * 0.18, 0.66, -2.35]],
      [0, 0, -1], [1, 1, 1], mats.cellWhite);
    addQuadGroup(geo, "taillight",
      [[sx * 0.18, 0.52, 2.375], [sx * 0.70, 0.52, 2.375], [sx * 0.70, 0.68, 2.37], [sx * 0.18, 0.68, 2.37]],
      [0, 0, 1], [1, 1, 1], mats.cellRed);
  }
  // Bumpers + grille.
  geo.beginGroup("trim");
  geo.addBox(0, 0.4, -2.3, 1.3, 0.22, 0.12, { uvScale: 40 });
  geo.addBox(0, 0.4, 2.36, 1.4, 0.24, 0.1, { uvScale: 40 });
  geo.endGroup();
  // Side mirrors.
  geo.beginGroup("paint2");
  for (const sx of [-1, 1]) {
    geo.addBox(sx * 0.98, 1.0, -0.85, 0.24, 0.12, 0.1, { uvScale: 40 });
  }
  geo.endGroup();

  const body = finishModel(gl, geo, mats, CAR_ORDER, { castShadow: true });

  // Wheels: own mesh so they can spin and steer.
  const wg = new Geometry();
  wg.beginGroup("tire");
  wg.addCylinder(new Vec3(0, 0, 0), 0.33, 0.26, "x", 14, { uvScale: 1 });
  wg.endGroup();
  wg.beginGroup("trim");
  wg.addCylinder(new Vec3(0.13, 0, 0), 0.185, 0.05, "x", 10, { uvScale: 1 });
  wg.addCylinder(new Vec3(-0.13, 0, 0), 0.185, 0.05, "x", 10, { uvScale: 1 });
  wg.endGroup();
  const wheel = finishModel(gl, wg, mats, WHEEL_ORDER, { castShadow: true, frustumCull: false });

  const wheelPos = [
    [-0.82, 0.33, -1.42], [0.82, 0.33, -1.42],
    [-0.82, 0.33, 1.40], [0.82, 0.33, 1.40],
  ];
  const parts = [{ model: body, local: new Mat4(), kind: "body" }];
  for (const p of wheelPos) {
    parts.push({
      model: wheel,
      local: new Mat4().fromTranslation(p[0], p[1], p[2]),
      kind: "wheel",
      steer: p[2] < 0, // front axle
    });
  }
  return { parts, size: { halfW: 0.95, len: 4.7, h: 1.4 } };
}

/* ---------------- boat ---------------- */

export function buildBoat(gl, mats) {
  const geo = new Geometry();
  const hullProfile = [
    [-3.25, 0.16], [2.75, 0.08], [3.02, 0.50], [1.4, 0.68],
    [-1.6, 0.74], [-3.28, 0.56],
  ];
  extrudeProfile(geo, hullProfile, 1.12, () => "paint", "paint");

  // Deck + cabin.
  geo.beginGroup("paint2");
  geo.addBox(0, 0.74, 0.6, 2.05, 0.1, 3.6, { uvScale: 40 });
  geo.endGroup();
  geo.beginGroup("paint");
  geo.addBox(0, 1.02, 1.35, 1.5, 0.62, 1.7, { uvScale: 40 });
  geo.endGroup();
  // Windshield + side windows.
  addQuadGroup(geo, "glass",
    [[0.72, 0.76, 0.55], [-0.72, 0.76, 0.55], [-0.66, 1.30, 0.98], [0.66, 1.30, 0.98]],
    [0, 0.55, -0.75]);
  for (const sx of [-1, 1]) {
    addQuadGroup(geo, "glass", [[sx * 0.755, 0.86, 0.72], [sx * 0.755, 0.86, 1.9], [sx * 0.755, 1.26, 1.9], [sx * 0.755, 1.26, 0.72]], [sx, 0, 0]);
  }
  // Bow rail + wheelhouse roof lip.
  geo.beginGroup("trim");
  geo.addBox(0, 0.92, -2.6, 0.9, 0.05, 0.05, { uvScale: 20 });
  geo.addBox(0, 1.0, -1.9, 0.05, 0.3, 0.05, { uvScale: 20 });
  geo.addBox(0, 1.34, 1.35, 1.58, 0.06, 1.78, { uvScale: 20 });
  geo.endGroup();

  const body = finishModel(gl, geo, mats, BOAT_ORDER, { castShadow: true });
  return { parts: [{ model: body, local: new Mat4(), kind: "body" }], size: { halfW: 1.2, len: 6.4, h: 1.5 } };
}

/* ---------------- plane ---------------- */

export function buildPlane(gl, mats) {
  const geo = new Geometry();
  const fuseProfile = [
    [-4.0, 0.95], [3.7, 0.9], [4.3, 1.28], [3.2, 1.6],
    [1.2, 1.68], [-0.6, 1.72], [-2.1, 1.55], [-3.6, 1.18],
  ];
  extrudeProfile(geo, fuseProfile, 0.52, () => "paint", "paint");

  // Wings with a little dihedral (+tip accent boxes, same transform).
  for (const sx of [-1, 1]) {
    const wing = boxGeo([sx * 2.7, 0, 0], [5.1, 0.16, 1.5], [1, 1, 1], "paint");
    const tip = boxGeo([sx * 4.55, 0, 0], [1.3, 0.19, 1.54], [1, 1, 1], "paint2");
    const m = new Mat4()
      .fromTranslation(0, 1.42, -0.5)
      .multiply(new Mat4().fromCompose(new Vec3(0, 0, 0), 0, 0, sx * 0.07));
    wing.transform(m);
    tip.transform(m);
    geo.append(wing);
    geo.append(tip);
  }
  // Tail.
  geo.beginGroup("paint");
  geo.addBox(0, 1.5, 3.6, 3.9, 0.12, 1.0, { uvScale: 40 });
  geo.addBox(0, 2.2, 3.75, 0.12, 1.3, 1.1, { uvScale: 40 });
  geo.endGroup();
  geo.beginGroup("paint2");
  geo.addBox(0, 2.55, 3.85, 0.14, 0.4, 1.2, { uvScale: 40 });
  geo.endGroup();
  // Canopy.
  geo.beginGroup("glass");
  geo.addBox(0, 1.95, -0.7, 0.9, 0.5, 2.0, { uvScale: 40, noBottom: true });
  geo.endGroup();
  // Nose spinner + landing gear.
  geo.beginGroup("trim");
  geo.addCylinder(new Vec3(0, 1.06, -4.16), 0.16, 0.24, "z", 10, { uvScale: 1 });
  geo.addBox(0, 0.75, -3.3, 0.08, 0.9, 0.08, { uvScale: 20 });
  geo.addCylinder(new Vec3(0, 0.24, -3.3), 0.18, 0.14, "x", 10, { uvScale: 1 });
  for (const sx of [-1, 1]) {
    geo.addBox(sx * 1.05, 0.98, -0.3, 0.09, 0.8, 0.09, { uvScale: 20 });
    geo.addCylinder(new Vec3(sx * 1.1, 0.22, -0.3), 0.22, 0.16, "x", 10, { uvScale: 1 });
  }
  geo.endGroup();

  const body = finishModel(gl, geo, mats, PLANE_ORDER, { castShadow: true });

  // Propeller (spins about Z at the nose).
  const pg = new Geometry();
  pg.beginGroup("paint2");
  for (let k = 0; k < 2; k++) {
    const blade = boxGeo([0, 1.05, 0], [0.15, 2.3, 0.07], [1, 1, 1], "paint2");
    blade.transform(new Mat4().fromCompose(new Vec3(0, 0, 0), 0, 0, k * 1.22));
    blade.transform(new Mat4().fromTranslation(0, -1.05, 0));
    pg.append(blade);
  }
  pg.endGroup();
  const prop = finishModel(gl, pg, mats, PROP_ORDER, { castShadow: false, frustumCull: false });

  return {
    parts: [
      { model: body, local: new Mat4(), kind: "body" },
      { model: prop, local: new Mat4().fromTranslation(0, 1.06, -4.16), kind: "prop" },
    ],
    size: { halfW: 5.5, len: 8.6, h: 2.6 },
  };
}
