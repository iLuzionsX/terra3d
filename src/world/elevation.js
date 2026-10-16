// Terra3D world — elevation: Mapzen/Tilezen "terrarium" tiles (AWS Open Data), decoded to a heightfield.
// Fallback: procedural noise terrain (offline mode / test mode).
import { Geo } from "./geo.js";
import { cacheGet, cachePut } from "./cache.js";
import { fbm2D, DEG } from "../engine/math.js";

const TILE_URLS = [
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
];
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30;
// Fixed seed: the offline world must be the same terrain for everyone, and must
// stay identical across rebases (which move the local origin).
const OFFLINE_SEED = 0x7e44a3;

export class Heightfield {
  /** Samples on a regular grid: x = x0 + i*cell, z = z0 + j*cell, size (w x h). */
  constructor(x0, z0, cell, w, h, data) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.w = w; this.h = h;
    this.data = data;
  }

  sample(x, z) {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0) i = 0; else if (i > this.w - 2) i = this.w - 2;
    if (j < 0) j = 0; else if (j > this.h - 2) j = this.h - 2;
    const tx = Math.min(Math.max(fx - i, 0), 1);
    const tz = Math.min(Math.max(fz - j, 0), 1);
    const d = this.data, w = this.w;
    const h00 = d[j * w + i], h10 = d[j * w + i + 1];
    const h01 = d[(j + 1) * w + i], h11 = d[(j + 1) * w + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  sampleNormal(x, z, out) {
    const e = this.cell;
    const hL = this.sample(x - e, z), hR = this.sample(x + e, z);
    const hD = this.sample(x, z - e), hU = this.sample(x, z + e);
    let nx = hL - hR, ny = 2 * e, nz = hD - hU;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  /** Approximate slope (0 flat .. 1 vertical) at a point. */
  slopeAt(x, z) {
    const n = this.sampleNormal(x, z, _n);
    return 1 - n.y;
  }
}
const _n = { x: 0, y: 1, z: 0 };

// ---- terrarium tile decode ----
const _tileCanvas = { canvas: null, ctx: null };
function decodeTerrarium(imageData) {
  const px = imageData.data;
  const out = new Float32Array(256 * 256);
  for (let i = 0, o = 0; i < px.length; i += 4, o++) {
    out[o] = px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768;
  }
  return out;
}

async function fetchTile(z, x, y) {
  const key = `terrarium:${z}/${x}/${y}`;
  const cached = await cacheGet(key, CACHE_TTL);
  if (cached) return new Float32Array(cached);
  let lastErr = null;
  let buf = null;
  for (const tmpl of TILE_URLS) {
    const url = tmpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await res.arrayBuffer();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!buf) throw lastErr || new Error("tile fetch failed");
  const blob = new Blob([buf], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  if (!_tileCanvas.canvas) {
    _tileCanvas.canvas = document.createElement("canvas");
    _tileCanvas.canvas.width = 256;
    _tileCanvas.canvas.height = 256;
    _tileCanvas.ctx = _tileCanvas.canvas.getContext("2d", { willReadFrequently: true });
  }
  _tileCanvas.ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = _tileCanvas.ctx.getImageData(0, 0, 256, 256);
  const heights = decodeTerrarium(img);
  await cachePut(key, heights.buffer);
  return heights;
}

/**
 * Load a heightfield centered at local (cx, cz) covering +/- halfSize.
 * onProgress(frac, text) reports tile fetching progress.
 */
export async function loadElevation(geo, cx, cz, halfSize, { offline = false, onProgress } = {}) {
  const z = 14;
  const center = geo.toLatLon(cx, cz);
  const mpp = Math.max(2, Geo.metersPerPixel(center.lat, z));
  let cols = Math.ceil((halfSize * 2) / mpp);
  cols = Math.min(cols, 1200);
  const cell = (halfSize * 2) / cols;
  const w = cols + 1, h = cols + 1;
  const data = new Float32Array(w * h);
  const x0 = cx - halfSize, z0 = cz - halfSize;

  if (offline) {
    // Anchor the noise to *global* coordinates (equirectangular meters) so any
    // spot on the planet always gets the same terrain, no matter where the
    // local origin currently sits (survives streaming/rebasing).
    const ll = { lat: 0, lon: 0 };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = x0 + i * cell, z = z0 + j * cell;
        geo.toLatLon(x, z, ll);
        const gx = ll.lon * 111320 * Math.cos(ll.lat * DEG);
        const gz = ll.lat * -110574;
        const big = fbm2D(gx / 1800, gz / 1800, 4, 2, 0.5, OFFLINE_SEED) - 0.55;
        const mid = fbm2D(gx / 360 + 11, gz / 360 + 7, 3, 2, 0.5, OFFLINE_SEED + 3) - 0.5;
        data[j * w + i] = big * 420 + mid * 55;
      }
    }
    if (onProgress) onProgress(1, "procedural terrain");
    return new Heightfield(x0, z0, cell, w, h, data);
  }

  // Determine the tile range that covers the area.
  const nw = geo.toLatLon(x0, z0);
  const se = geo.toLatLon(x0 + halfSize * 2, z0 + halfSize * 2);
  const tNW = Geo.lonLatToTile(nw.lon, nw.lat, z);
  const tSE = Geo.lonLatToTile(se.lon, se.lat, z);
  const txMin = Math.floor(tNW.x) - 1, txMax = Math.floor(tSE.x) + 1;
  const tyMin = Math.floor(tNW.y) - 1, tyMax = Math.floor(tSE.y) + 1;
  const tiles = new Map();
  const jobs = [];
  let done = 0;
  const total = (txMax - txMin + 1) * (tyMax - tyMin + 1);
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const wrappedX = ((tx % 2 ** z) + 2 ** z) % 2 ** z;
      if (ty < 0 || ty >= 2 ** z) continue;
      const key = wrappedX + "_" + ty;
      jobs.push(
        fetchTile(z, wrappedX, ty)
          .then((tile) => {
            tiles.set(key, tile);
          })
          .catch(() => {
            tiles.set(key, null);
          })
          .finally(() => {
            done++;
            if (onProgress) onProgress(done / total, `elevation tiles ${done}/${total}`);
          })
      );
    }
  }
  await Promise.all(jobs);

  // Bilinear-sample within the owning tile for each grid point (tile borders
  // share edge values in terrarium data, so seams are negligible).
  const tileBilinear = (tile, u, v) => {
    if (!tile) return 0;
    const px = Math.min(255.999, Math.max(0, u * 256 - 0.5));
    const py = Math.min(255.999, Math.max(0, v * 256 - 0.5));
    const i0 = Math.floor(px), j0 = Math.floor(py);
    const i1 = Math.min(255, i0 + 1), j1 = Math.min(255, j0 + 1);
    const fx = px - i0, fy = py - j0;
    const a = tile[j0 * 256 + i0], b = tile[j0 * 256 + i1];
    const c = tile[j1 * 256 + i0], d = tile[j1 * 256 + i1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const wrapX = (tx) => ((tx % 2 ** z) + 2 ** z) % 2 ** z;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i * cell, zz = z0 + j * cell;
      const ll = geo.toLatLon(x, zz);
      const t = Geo.lonLatToTile(ll.lon, ll.lat, z);
      const tx = wrapX(Math.floor(t.x));
      let ty = Math.floor(t.y);
      ty = Math.min(Math.max(ty, 0), 2 ** z - 1);
      const tile = tiles.get(tx + "_" + ty);
      data[j * w + i] = tileBilinear(tile, t.x - Math.floor(t.x), t.y - Math.floor(t.y));
    }
  }
  return new Heightfield(x0, z0, cell, w, h, data);
}
