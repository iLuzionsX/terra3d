// Terra3D engine — CPU-side geometry: interleaved vertex attributes + groups.
// Vertex layout (13 floats): pos(3) normal(3) uv(2) cell(2) tint(3)
import { triangulate, polyBounds } from "./geom2d.js";

export const VERTEX_FLOATS = 13;

export class Geometry {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.cells = [];
    this.tints = [];
    this.indices = [];
    this.groups = [];
    this._group = null;
  }

  get vertexCount() { return this.positions.length / 3; }
  get triCount() { return this.indices.length / 3; }

  beginGroup(name) {
    this.endGroup();
    this._group = { name, start: this.indices.length, count: 0 };
    this.groups.push(this._group);
    return this;
  }
  endGroup() { this._group = null; return this; }

  addVertex(x, y, z, nx, ny, nz, u, v, cx = 0, cy = 0, tx = 1, ty = 1, tz = 1) {
    const i = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    this.cells.push(cx, cy);
    this.tints.push(tx, ty, tz);
    return i;
  }

  addTri(a, b, c) {
    this.indices.push(a, b, c);
    if (this._group) this._group.count += 3;
    return this;
  }

  addQuad(a, b, c, d) {
    this.indices.push(a, b, c, a, c, d);
    if (this._group) this._group.count += 6;
    return this;
  }

  /** Append another geometry, offsetting indices and groups. */
  append(other) {
    const base = this.vertexCount;
    this.positions.push(...other.positions);
    this.normals.push(...other.normals);
    this.uvs.push(...other.uvs);
    this.cells.push(...other.cells);
    this.tints.push(...other.tints);
    const gStart = this.indices.length;
    for (let i = 0; i < other.indices.length; i++) this.indices.push(other.indices[i] + base);
    for (const g of other.groups) {
      this.groups.push({ name: g.name, start: gStart + g.start, count: g.count });
    }
    return this;
  }

  /** Bake a transform into positions/normals. */
  transform(mat) {
    const m = mat.m;
    const p = this.positions, nrm = this.normals;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const nx = nrm[i], ny = nrm[i + 1], nz = nrm[i + 2];
      let ox = m[0] * nx + m[4] * ny + m[8] * nz;
      let oy = m[1] * nx + m[5] * ny + m[9] * nz;
      let oz = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      nrm[i] = ox / l; nrm[i + 1] = oy / l; nrm[i + 2] = oz / l;
    }
    return this;
  }

  bounds() {
    const p = this.positions;
    if (p.length === 0) return { x: 0, y: 0, z: 0, r: 0 };
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < minX) minX = p[i]; if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1]; if (p[i + 1] > maxY) maxY = p[i + 1];
      if (p[i + 2] < minZ) minZ = p[i + 2]; if (p[i + 2] > maxZ) maxZ = p[i + 2];
    }
    const x = (minX + maxX) / 2, y = (minY + maxY) / 2, z = (minZ + maxZ) / 2;
    const r = Math.hypot(maxX - x, maxY - y, maxZ - z);
    return { x, y, z, r };
  }

  // ---------------- primitives ----------------

  /** Axis-aligned box. uv is in meters / uvScale. */
  addBox(cx, cy, cz, sx, sy, sz, opts = {}) {
    const { uvScale = 1, cell = [0, 0], tint = [1, 1, 1], noBottom = false } = opts;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const faces = [
      // normal, 4 corners (ccw viewed from outside), axis mapping for uv
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], (p) => [p[0], p[1]]],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], (p) => [-p[0], p[1]]],
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], (p) => [-p[2], p[1]]],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], (p) => [p[2], p[1]]],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], (p) => [p[0], -p[2]]],
    ];
    if (!noBottom) {
      faces.push([[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], (p) => [p[0], p[2]]]);
    }
    for (const [n, corners, uvFn] of faces) {
      const idx = [];
      for (const p of corners) {
        const [u, v] = uvFn(p);
        idx.push(this.addVertex(cx + p[0], cy + p[1], cz + p[2], n[0], n[1], n[2], u / uvScale, v / uvScale, cell[0], cell[1], tint[0], tint[1], tint[2]));
      }
      this.addQuad(idx[0], idx[1], idx[2], idx[3]);
    }
    return this;
  }

  /** Cylinder along an axis ('x' for wheels). */
  addCylinder(center, radius, width, axis = "x", segments = 12, opts = {}) {
    const { cell = [0, 0], tint = [1, 1, 1], uvScale = 1 } = opts;
    const ringA = [], ringB = [];
    const half = width / 2;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const c = Math.cos(a) * radius, sn = Math.sin(a) * radius;
      let pA, pB, nA, nB;
      if (axis === "x") {
        pA = [center.x - half, center.y + sn, center.z + c];
        pB = [center.x + half, center.y + sn, center.z + c];
        nA = nB = [0, sn / radius, c / radius];
      } else if (axis === "y") {
        pA = [center.x + c, center.y - half, center.z + sn];
        pB = [center.x + c, center.y + half, center.z + sn];
        nA = nB = [c / radius, 0, sn / radius];
      } else {
        pA = [center.x + c, center.y + sn, center.z - half];
        pB = [center.x + c, center.y + sn, center.z + half];
        nA = nB = [c / radius, sn / radius, 0];
      }
      const u = (s / segments) * Math.PI * 2 * radius / uvScale;
      const u2 = ((s + 1) / segments) * Math.PI * 2 * radius / uvScale;
      ringA.push(this.addVertex(pA[0], pA[1], pA[2], nA[0], nA[1], nA[2], u, 0, cell[0], cell[1], tint[0], tint[1], tint[2]));
      ringB.push(this.addVertex(pB[0], pB[1], pB[2], nB[0], nB[1], nB[2], u, width / uvScale, cell[0], cell[1], tint[0], tint[1], tint[2]));
      void u2;
    }
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      this.addQuad(ringA[s], ringB[s], ringB[s2], ringA[s2]);
    }
    // Caps
    for (const side of [-1, 1]) {
      const cIdx = [];
      const n = axis === "x" ? [side, 0, 0] : axis === "y" ? [0, side, 0] : [0, 0, side];
      const cx = center.x + (axis === "x" ? side * half : 0);
      const cy = center.y + (axis === "y" ? side * half : 0);
      const cz = center.z + (axis === "z" ? side * half : 0);
      const cCenter = this.addVertex(cx, cy, cz, n[0], n[1], n[2], 0.5, 0.5, cell[0], cell[1], tint[0], tint[1], tint[2]);
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2 * side;
        const c = Math.cos(a) * radius, sn = Math.sin(a) * radius;
        let p;
        if (axis === "x") p = [cx, cy + sn, cz + c];
        else if (axis === "y") p = [cx + c, cy, cz + sn];
        else p = [cx + c, cy + sn, cz];
        cIdx.push(this.addVertex(p[0], p[1], p[2], n[0], n[1], n[2], 0.5 + c / (2 * radius), 0.5 + sn / (2 * radius), cell[0], cell[1], tint[0], tint[1], tint[2]));
      }
      for (let s = 0; s < segments; s++) {
        if (side > 0) this.addTri(cCenter, cIdx[s], cIdx[s + 1]);
        else this.addTri(cCenter, cIdx[s + 1], cIdx[s]);
      }
    }
    return this;
  }

  /**
   * Height/surface grid. fn(x,z) -> [y] or {y, tint}. Flat array row-major.
   */
  addGrid(x0, z0, step, cols, rows, fn, opts = {}) {
    const { uvScale = 1, cell = [0, 0], tint = [1, 1, 1] } = opts;
    const grid = [];
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const x = x0 + c * step, z = z0 + r * step;
        const res = fn(x, z);
        const y = typeof res === "number" ? res : res.y;
        const tt = typeof res === "number" ? tint : res.tint || tint;
        // Normal from neighbors (central difference).
        const e = Math.max(step * 0.5, 0.5);
        const yL = sampleY(fn, x - e, z), yR = sampleY(fn, x + e, z);
        const yD = sampleY(fn, x, z - e), yU = sampleY(fn, x, z + e);
        let nx = yL - yR, ny = 2 * e, nz = yD - yU;
        const nl = Math.hypot(nx, ny, nz) || 1;
        grid.push(this.addVertex(x, y, z, nx / nl, ny / nl, nz / nl, x / uvScale, z / uvScale, cell[0], cell[1], tt[0], tt[1], tt[2]));
      }
    }
    const stride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = grid[r * stride + c], b = grid[r * stride + c + 1];
        const d = grid[(r + 1) * stride + c], e2 = grid[(r + 1) * stride + c + 1];
        this.addQuad(a, d, e2, b);
      }
    }
    return this;
  }

  /**
   * Ribbon along a flat polyline [x0,z0,x1,z1,...]. yFn(x,z) -> ground y.
   * u spans 0..1 across, v tiles every vScale meters along.
   */
  addRibbon(points, width, yFn, opts = {}) {
    const { vScale = 10, cell = [0, 0], tint = [1, 1, 1], lift = 0.13 } = opts;
    const n = points.length / 2;
    if (n < 2) return this;
    const hw = width / 2;
    let arc = 0;
    let prevX = points[0], prevZ = points[1];
    const lefts = [], rights = [];
    for (let i = 0; i < n; i++) {
      const x = points[i * 2], z = points[i * 2 + 1];
      const px = i > 0 ? points[(i - 1) * 2] : x, pz = i > 0 ? points[(i - 1) * 2 + 1] : z;
      const nx2 = i < n - 1 ? points[(i + 1) * 2] : x, nz2 = i < n - 1 ? points[(i + 1) * 2 + 1] : z;
      let dx = nx2 - px, dz = nz2 - pz;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      // Perpendicular (left side).
      const lx = -dz, lz = dx;
      if (i > 0) arc += Math.hypot(x - prevX, z - prevZ);
      const y = (yFn ? yFn(x, z) : 0) + lift;
      const v = arc / vScale;
      lefts.push(this.addVertex(x + lx * hw, y, z + lz * hw, 0, 1, 0, 0, v, cell[0], cell[1], tint[0], tint[1], tint[2]));
      rights.push(this.addVertex(x - lx * hw, y, z - lz * hw, 0, 1, 0, 1, v, cell[0], cell[1], tint[0], tint[1], tint[2]));
      prevX = x; prevZ = z;
    }
    for (let i = 0; i < n - 1; i++) {
      this.addQuad(lefts[i], rights[i], rights[i + 1], lefts[i + 1]);
    }
    return this;
  }

  /** Triangulated flat polygon at height yFn(x,z). */
  addPolyFlat(poly, yFn, opts = {}) {
    const { cell = [0, 0], tint = [1, 1, 1], uvScale = 8 } = opts;
    const tris = triangulate(poly);
    const n = poly.length / 2;
    const ids = [];
    for (let i = 0; i < n; i++) {
      const x = poly[i * 2], z = poly[i * 2 + 1];
      const y = typeof yFn === "number" ? yFn : yFn(x, z);
      ids.push(this.addVertex(x, y, z, 0, 1, 0, x / uvScale, z / uvScale, cell[0], cell[1], tint[0], tint[1], tint[2]));
    }
    for (let i = 0; i < tris.length; i += 3) this.addTri(ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]]);
    return this;
  }

  /** Crossed billboard pair (trees). */
  addCross(cx, cz, baseY, w, h, opts = {}) {
    const { cell = [0, 0], tint = [1, 1, 1], yaw = 0 } = opts;
    for (let k = 0; k < 2; k++) {
      const a = yaw + k * Math.PI / 2;
      const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
      const v0 = this.addVertex(cx - dx, baseY, cz - dz, 0, 1, 0, 0, 1, cell[0], cell[1], tint[0], tint[1], tint[2]);
      const v1 = this.addVertex(cx + dx, baseY, cz + dz, 0, 1, 0, 1, 1, cell[0], cell[1], tint[0], tint[1], tint[2]);
      const v2 = this.addVertex(cx + dx, baseY + h, cz + dz, 0, 1, 0, 1, 0, cell[0], cell[1], tint[0], tint[1], tint[2]);
      const v3 = this.addVertex(cx - dx, baseY + h, cz - dz, 0, 1, 0, 0, 0, cell[0], cell[1], tint[0], tint[1], tint[2]);
      this.addQuad(v0, v1, v2, v3);
      this.addQuad(v3, v2, v1, v0); // back side (two-sided foliage)
    }
    return this;
  }
}

function sampleY(fn, x, z) {
  const r = fn(x, z);
  return typeof r === "number" ? r : r.y;
}

export function polyBoundsOf(poly) { return polyBounds(poly); }

/**
 * Reorder/merge geometry groups into a fixed name order and rebuild the index
 * buffer so that group index i always maps to order[i]. The renderer matches a
 * model's materials to mesh groups by index, so any mesh built with several
 * interleaved groups (vehicles) must be canonicalized before upload.
 * Returns the list of group names actually present (in material order).
 */
export function canonicalizeGroups(geo, order) {
  const buckets = new Map();
  for (const g of geo.groups) {
    if (!buckets.has(g.name)) buckets.set(g.name, []);
    buckets.get(g.name).push(g);
  }
  const names = [];
  const indices = [];
  const groups = [];
  // Listed names first (fixed order), then anything else, so nothing is lost.
  const queue = order.slice();
  for (const g of geo.groups) if (!queue.includes(g.name)) queue.push(g.name);
  for (const name of queue) {
    const list = buckets.get(name);
    if (!list) continue;
    let count = 0;
    const start = indices.length;
    for (const g of list) {
      for (let i = 0; i < g.count; i++) indices.push(geo.indices[g.start + i]);
      count += g.count;
    }
    if (count === 0) continue;
    names.push(name);
    groups.push({ name, start, count });
  }
  geo.indices = indices;
  geo.groups = groups;
  return names;
}
