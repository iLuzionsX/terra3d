// Terra3D world — building meshes (extruded footprints, facades, roofs, gables)
// + a spatial index for vehicle collision.
import { Geometry } from "../engine/builders.js";
import { triangulate, nearRect, polyBounds, closestBoundary, pointInPoly } from "../engine/geom2d.js";
import { ATLAS, cellUV } from "./textures.js";

const TILE_W = 3.2;   // facade module width/height in meters
const STORE_H = 4.0;  // storefront band height
const ROOF_TILE = 6;  // roof uv tiling in meters

/**
 * Build one merged geometry chunk for a set of buildings.
 * Groups: "buildings" only (single atlas material).
 */
export function buildChunkGeometry(buildings, hf) {
  const geo = new Geometry();
  geo.beginGroup("buildings");
  for (const b of buildings) {
    addBuilding(geo, b, hf);
  }
  geo.endGroup();
  return geo;
}

function addBuilding(geo, b, hf) {
  const poly = b.poly;
  const n = poly.length / 2;

  // Base height: lowest footprint corner, sunk slightly into the terrain.
  let baseY = Infinity;
  for (let i = 0; i < n; i++) {
    const h = hf.sample(poly[i * 2], poly[i * 2 + 1]);
    if (h < baseY) baseY = h;
  }
  baseY -= 0.25;
  const topY = baseY + b.h + 0.25;
  b.baseY = baseY;

  const style = b.style || 0;
  const facadeCell = cellUV(style * 2);
  const storeCell = cellUV(style * 2 + 1);
  const tint = b.tint || [1, 1, 1];

  const useStore = b.h >= 7.2 && b.area >= 42;
  const bandH = useStore ? STORE_H : 0;
  const upperH = b.h - bandH;
  const gable = tryGable(b, poly);
  const roofCell = cellUV(gable ? ATLAS.roofTiles : ATLAS.roofFlat);

  // ---- walls ----
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[i * 2], az = poly[i * 2 + 1];
    const bx = poly[j * 2], bz = poly[j * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.55) continue;
    // Outward normal for up-facing polygon order (see geom2d.js orientation note).
    const nx = -dz / len, nz = dx / len;

    if (upperH > 0.4) {
      const y0 = baseY + bandH;
      const v0 = geo.addVertex(ax, y0, az, nx, 0, nz, 0, 0, facadeCell[0], facadeCell[1], tint[0], tint[1], tint[2]);
      const v1 = geo.addVertex(bx, y0, bz, nx, 0, nz, len / TILE_W, 0, facadeCell[0], facadeCell[1], tint[0], tint[1], tint[2]);
      const v2 = geo.addVertex(bx, topY, bz, nx, 0, nz, len / TILE_W, upperH / TILE_W, facadeCell[0], facadeCell[1], tint[0], tint[1], tint[2]);
      const v3 = geo.addVertex(ax, topY, az, nx, 0, nz, 0, upperH / TILE_W, facadeCell[0], facadeCell[1], tint[0], tint[1], tint[2]);
      geo.addQuad(v0, v1, v2, v3);
    }
    if (bandH > 0) {
      const v0 = geo.addVertex(ax, baseY, az, nx, 0, nz, 0, 0, storeCell[0], storeCell[1], tint[0] * 0.96, tint[1] * 0.96, tint[2] * 0.96);
      const v1 = geo.addVertex(bx, baseY, bz, nx, 0, nz, len / 4, 0, storeCell[0], storeCell[1], tint[0] * 0.96, tint[1] * 0.96, tint[2] * 0.96);
      const v2 = geo.addVertex(bx, baseY + bandH, bz, nx, 0, nz, len / 4, 1, storeCell[0], storeCell[1], tint[0] * 0.96, tint[1] * 0.96, tint[2] * 0.96);
      const v3 = geo.addVertex(ax, baseY + bandH, az, nx, 0, nz, 0, 1, storeCell[0], storeCell[1], tint[0] * 0.96, tint[1] * 0.96, tint[2] * 0.96);
      geo.addQuad(v0, v1, v2, v3);
    }
  }

  // ---- roof ----
  if (gable) {
    addGableRoof(geo, poly, baseY, topY, roofCell, tint, gable);
  } else {
    const tris = triangulate(poly);
    for (let t = 0; t < tris.length; t += 3) {
      const ids = [];
      for (let k = 0; k < 3; k++) {
        const idx = tris[t + k];
        const x = poly[idx * 2], z = poly[idx * 2 + 1];
        ids.push(geo.addVertex(x, topY, z, 0, 1, 0, x / ROOF_TILE, z / ROOF_TILE, roofCell[0], roofCell[1], tint[0], tint[1], tint[2]));
      }
      geo.addTri(ids[0], ids[1], ids[2]);
    }
  }
}

/** Decide if a gable/hip roof fits; returns nearRect info or null. */
function tryGable(b, poly) {
  if (!/^(gabled|gable|pitched|hipped|half-hipped|gambrel|saltbox)$/.test(b.roofShape || "")) return null;
  if (b.h > 42 || b.area < 16) return null;
  const r = nearRect(poly, 0.22);
  if (!r.ok) return null;
  const minSide = Math.min(r.w, r.h);
  if (minSide < 3.2 || Math.max(r.w, r.h) > 46 || b.h < 2.4) return null;
  return r;
}

function addGableRoof(geo, poly, baseY, wallTop, roofCell, tint, rect) {
  const n = poly.length / 2;
  // Shortest edges become the gable ends; ridge connects their midpoints.
  const edgeLens = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edgeLens.push({ i, j, len: Math.hypot(poly[j * 2] - poly[i * 2], poly[j * 2 + 1] - poly[i * 2 + 1]) });
  }
  const sorted = [...edgeLens].sort((a, b) => a.len - b.len);
  const s0 = sorted[0], s1 = sorted[1];
  const ridgeH = Math.min(3.6, Math.max(0.9, Math.min(rect.w, rect.h) * 0.3));
  const ridgeY = wallTop + ridgeH;
  const m0 = [(poly[s0.i * 2] + poly[s0.j * 2]) / 2, (poly[s0.i * 2 + 1] + poly[s0.j * 2 + 1]) / 2];
  const m1 = [(poly[s1.i * 2] + poly[s1.j * 2]) / 2, (poly[s1.i * 2 + 1] + poly[s1.j * 2 + 1]) / 2];

  const emit = (x, y, z, nx, ny, nz) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    return geo.addVertex(x, y, z, nx / l, ny / l, nz / l, x / ROOF_TILE, z / ROOF_TILE, roofCell[0], roofCell[1], tint[0], tint[1], tint[2]);
  };

  // Sloped quads: for each long edge, quad (a, b, ridge(b), ridge(a)).
  for (const e of edgeLens) {
    if (e.i === s0.i || e.j === s0.j || e.i === s1.i || e.j === s1.j) continue;
    const ax = poly[e.i * 2], az = poly[e.i * 2 + 1];
    const bx = poly[e.j * 2], bz = poly[e.j * 2 + 1];
    // Count the shared short edge for each endpoint to pick ridge points.
    const ridgeFor = (px, pz) => (distTo(m0, px, pz) < distTo(m1, px, pz) ? m0 : m1);
    const ra = ridgeFor(ax, az), rb = ridgeFor(bx, bz);
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    // Approximate outward/up normal: cross(edge, up-tilt).
    const nx0 = -dz / len, nz0 = dx / len;
    const vA = emit(ax, wallTop, az, nx0, ridgeH / (Math.min(rect.w, rect.h) * 0.5), nz0);
    const vB = emit(bx, wallTop, bz, nx0, ridgeH / (Math.min(rect.w, rect.h) * 0.5), nz0);
    const vC = emit(rb[0], ridgeY, rb[1], nx0, ridgeH / (Math.min(rect.w, rect.h) * 0.5), nz0);
    const vD = emit(ra[0], ridgeY, ra[1], nx0, ridgeH / (Math.min(rect.w, rect.h) * 0.5), nz0);
    geo.addQuad(vA, vB, vC, vD);
  }

  // Gable end triangles at the two short edges.
  for (const e of [s0, s1]) {
    const ax = poly[e.i * 2], az = poly[e.i * 2 + 1];
    const bx = poly[e.j * 2], bz = poly[e.j * 2 + 1];
    const dxx = bx - ax, dzz = bz - az;
    const len = Math.hypot(dxx, dzz) || 1;
    const mid = [(ax + bx) / 2, (az + bz) / 2];
    const ridge = distTo(m0, mid[0], mid[1]) < distTo(m1, mid[0], mid[1]) ? m0 : m1;
    // Pick triangle orientation so the normal points outward (away from ridge line).
    const nx = -dzz / len, nz = dxx / len;
    const outwardSign = Math.sign(nx * (mid[0] - ridge[0]) + nz * (mid[1] - ridge[1])) || 1;
    const vA = emit(ax, wallTop, az, nx * outwardSign, 0.2, nz * outwardSign);
    const vB = emit(bx, wallTop, bz, nx * outwardSign, 0.2, nz * outwardSign);
    const vC = emit(ridge[0], ridgeY, ridge[1], nx * outwardSign, 0.2, nz * outwardSign);
    geo.addTri(vA, vB, vC);
  }
}

function distTo(p, x, z) {
  return Math.hypot(p[0] - x, p[1] - z);
}

/* ---------------- collision index ---------------- */

export class BuildingIndex {
  constructor(buildings) {
    this.buildings = buildings;
    this.cellSize = 96;
    this.grid = new Map();
    this._stamp = 0;
    this._visited = new Int32Array(buildings.length);
    this.bounds = new Map();
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const bb = polyBounds(b.poly);
      this.bounds.set(i, bb);
      const gx0 = Math.floor(bb.minX / this.cellSize), gx1 = Math.floor(bb.maxX / this.cellSize);
      const gz0 = Math.floor(bb.minZ / this.cellSize), gz1 = Math.floor(bb.maxZ / this.cellSize);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const key = gx + "," + gz;
          let arr = this.grid.get(key);
          if (!arr) this.grid.set(key, (arr = []));
          arr.push(i);
        }
      }
    }
  }

  /**
   * Circle vs building extrusion collision. y is the entity's base height.
   * Returns {hit, nx, nz, pen} — push the entity by (nx*pen, nz*pen).
   */
  collideCircle(x, z, r, y, out = { hit: false, nx: 0, nz: 0, pen: 0 }) {
    out.hit = false; out.pen = 0; out.nx = 0; out.nz = 0;
    const cs = this.cellSize;
    const gx0 = Math.floor((x - r) / cs), gx1 = Math.floor((x + r) / cs);
    const gz0 = Math.floor((z - r) / cs), gz1 = Math.floor((z + r) / cs);
    const stamp = ++this._stamp;
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const arr = this.grid.get(gx + "," + gz);
        if (!arr) continue;
        for (const i of arr) {
          if (this._visited[i] === stamp) continue;
          this._visited[i] = stamp;
          const b = this.buildings[i];
          const top = (b.baseY ?? 0) + b.h;
          if (y > top - 0.4) continue; // above the roof
          const bb = this.bounds.get(i);
          if (x < bb.minX - r || x > bb.maxX + r || z < bb.minZ - r || z > bb.maxZ + r) continue;
          const inside = pointInPoly(x, z, b.poly);
          const cb = closestBoundary(x, z, b.poly);
          let pen = 0, nx = 0, nz = 0;
          if (inside) {
            pen = cb.dist + r;
            nx = -cb.nx; nz = -cb.nz;
          } else if (cb.dist < r) {
            pen = r - cb.dist;
            nx = cb.nx; nz = cb.nz;
          }
          if (pen > out.pen) {
            out.hit = true; out.pen = pen; out.nx = nx; out.nz = nz;
          }
        }
      }
    }
    return out;
  }
}
