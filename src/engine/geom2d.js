// Terra3D engine — 2D computational geometry for map footprints (flat [x0,z0,x1,z1,...] arrays).

// Orientation note (y-up world, footprints are (x,z) pairs):
// A polygon listed so its fan triangles face +Y (the only usable roof orientation)
// yields *negative* signedArea() with the shoelace formula below — the x-z chart
// is its own mirror image. All helpers normalize polygons to "up-facing" order.

export const UP_FACING = (poly) => signedArea(poly) < 0;

export function signedArea(poly) {
  let a = 0;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += poly[j * 2] * poly[i * 2 + 1] - poly[i * 2] * poly[j * 2 + 1];
  }
  return a / 2;
}

/** Ensure the polygon faces +Y (up) in 3D. */
export function ensureCCW(poly) {
  if (signedArea(poly) > 0) reversePoly(poly);
  return poly;
}

export function reversePoly(poly) {
  const n = poly.length / 2;
  for (let i = 0; i < n >> 1; i++) {
    const ax = poly[i * 2], az = poly[i * 2 + 1];
    poly[i * 2] = poly[(n - 1 - i) * 2];
    poly[i * 2 + 1] = poly[(n - 1 - i) * 2 + 1];
    poly[(n - 1 - i) * 2] = ax;
    poly[(n - 1 - i) * 2 + 1] = az;
  }
  return poly;
}

const cross2 = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);

function pointInTriangle(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = cross2(ax, az, bx, bz, px, pz);
  const d2 = cross2(bx, bz, cx, cz, px, pz);
  const d3 = cross2(cx, cz, ax, az, px, pz);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Ear-clipping triangulation of a simple polygon (no holes).
 * Returns Uint32Array of triangle indices. Falls back to a fan if the
 * polygon is degenerate or self-intersecting.
 */
export function triangulate(poly) {
  const n = poly.length / 2;
  if (n < 3) return new Uint32Array(0);
  if (n === 3) return new Uint32Array([0, 1, 2]);

  // Work on an index ring; normalize to up-facing (+Y) orientation first.
  if (signedArea(poly) > 0) poly = reversePoly(Float32Array.from(poly));
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);

  const out = [];
  let guard = n * n + 16;
  while (idx.length > 3 && guard-- > 0) {
    let earFound = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const ax = poly[i0 * 2], az = poly[i0 * 2 + 1];
      const bx = poly[i1 * 2], bz = poly[i1 * 2 + 1];
      const cx = poly[i2 * 2], cz = poly[i2 * 2 + 1];
      if (cross2(ax, az, bx, bz, cx, cz) >= 0) continue; // reflex vertex (up-facing polygons have convex = negative cross)
      let ok = true;
      for (let k = 0; k < idx.length; k++) {
        const iv = idx[k];
        if (iv === i0 || iv === i1 || iv === i2) continue;
        if (pointInTriangle(poly[iv * 2], poly[iv * 2 + 1], ax, az, bx, bz, cx, cz)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push(i0, i1, i2);
      idx.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break; // stuck: bail out to fan below
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  else if (idx.length > 3) {
    for (let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1]);
  }
  return Uint32Array.from(out);
}

export function pointInPoly(px, pz, poly) {
  const n = poly.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1];
    const xj = poly[j * 2], zj = poly[j * 2 + 1];
    if (zi > pz !== zj > pz) {
      const xInt = ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
      if (px < xInt) inside = !inside;
    }
  }
  return inside;
}

/**
 * Closest point on the polygon boundary to (px,pz).
 * Returns {dist, px, pz, nx, nz} where (nx,nz) points from the boundary
 * toward the query point (i.e. the push-out direction).
 */
export function closestBoundary(px, pz, poly) {
  const n = poly.length / 2;
  let best = { dist: Infinity, px: 0, pz: 0, nx: 0, nz: 0 };
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[j * 2], az = poly[j * 2 + 1];
    const bx = poly[i * 2], bz = poly[i * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = 0;
    if (len2 > 1e-12) t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    const cx = ax + dx * t, cz = az + dz * t;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < best.dist) {
      let nx = px - cx, nz = pz - cz;
      const nl = Math.hypot(nx, nz);
      if (nl > 1e-9) { nx /= nl; nz /= nl; } else { nx = dz; nz = -dx; } // inside: push across the edge
      best = { dist: d, px: cx, pz: cz, nx, nz };
    }
  }
  return best;
}

export function centroid(poly) {
  let x = 0, z = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) { x += poly[i * 2]; z += poly[i * 2 + 1]; }
  return { x: x / n, z: z / n };
}

export function polyBounds(poly) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x = poly[i * 2], z = poly[i * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Douglas-Peucker simplification of a flat polyline. */
export function simplifyPolyline(pts, tol) {
  const n = pts.length / 2;
  if (n <= 2) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = tol, maxI = -1;
    const ax = pts[i0 * 2], az = pts[i0 * 2 + 1];
    const bx = pts[i1 * 2], bz = pts[i1 * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    for (let i = i0 + 1; i < i1; i++) {
      const px = pts[i * 2], pz = pts[i * 2 + 1];
      let d;
      if (len < 1e-9) d = Math.hypot(px - ax, pz - az);
      else d = Math.abs(dz * (px - ax) - dx * (pz - az)) / len;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxI >= 0) {
      keep[maxI] = 1;
      stack.push([i0, maxI], [maxI, i1]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return Float32Array.from(out);
}

/**
 * Detect near-rectangular footprints (4 corners, ~90° angles) so roofs can
 * use gable geometry. Returns {ok, w, h, cx, cz, yaw} for the best-fit rect.
 */
export function nearRect(poly, tol = 0.28) {
  const n = poly.length / 2;
  if (n < 4 || n > 5) return { ok: false };
  // Gather the 4 extreme corners quickly: use min/max of x+z and x-z diagonals.
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
  let iMinS = 0, iMaxS = 0, iMinD = 0, iMaxD = 0;
  for (let i = 0; i < n; i++) {
    const x = poly[i * 2], z = poly[i * 2 + 1];
    const s = x + z, d = x - z;
    if (s < minS) { minS = s; iMinS = i; }
    if (s > maxS) { maxS = s; iMaxS = i; }
    if (d < minD) { minD = d; iMinD = i; }
    if (d > maxD) { maxD = d; iMaxD = i; }
  }
  const corners = [...new Set([iMinS, iMaxS, iMinD, iMaxD])];
  if (corners.length !== 4) return { ok: false };
  // Order corners around the centroid.
  const cx = (poly[iMinS * 2] + poly[iMaxS * 2] + poly[iMinD * 2] + poly[iMaxD * 2]) / 4;
  const cz = (poly[iMinS * 2 + 1] + poly[iMaxS * 2 + 1] + poly[iMinD * 2 + 1] + poly[iMaxD * 2 + 1]) / 4;
  const ordered = corners
    .map((i) => ({ x: poly[i * 2], z: poly[i * 2 + 1], a: Math.atan2(poly[i * 2 + 1] - cz, poly[i * 2] - cx) }))
    .sort((a, b) => a.a - b.a);
  // Check angles ~90°.
  for (let i = 0; i < 4; i++) {
    const p = ordered[i], q = ordered[(i + 1) % 4], r = ordered[(i + 2) % 4];
    const ux = p.x - q.x, uz = p.z - q.z;
    const vx = r.x - q.x, vz = r.z - q.z;
    const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if (lu < 1e-6 || lv < 1e-6) return { ok: false };
    const cosA = (ux * vx + uz * vz) / (lu * lv);
    if (Math.abs(cosA) > tol) return { ok: false };
  }
  const e0 = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].z - ordered[0].z);
  const e1 = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].z - ordered[1].z);
  const yaw = Math.atan2(ordered[1].z - ordered[0].z, ordered[1].x - ordered[0].x);
  return { ok: true, w: e0, h: e1, cx, cz, yaw, corners: ordered };
}
