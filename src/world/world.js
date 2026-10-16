// Terra3D world — loads and owns everything for a patch of planet:
// heightfield, terrain mesh, OSM features, building chunks, water, spawn points.
import { Geo } from "./geo.js";
import { loadElevation } from "./elevation.js";
import { fetchOsmData } from "./overpass.js";
import { parseOsm } from "./osm.js";
import { buildChunkGeometry, BuildingIndex } from "./buildings.js";
import { buildRoadGeometry } from "./roads.js";
import { buildGreensGeometry, buildTreeGeometry } from "./greens.js";
import { buildWaterGeometry } from "./waterbodies.js";
import { buildTerrainModel } from "./terrain.js";
import { makeFacadeAtlas, makeRoadAtlas, makeGroundNoise, makeTreeAtlas } from "./textures.js";
import { Sea, waveHeight } from "../engine/water.js";
import { Mesh, Model } from "../engine/mesh.js";
import { Material } from "../engine/material.js";
import { r32fTexture } from "../engine/texture.js";

export const WORLD = {
  fetchRadius: 1300,      // OSM query radius (m)
  terrainHalf: 3600,      // heightfield half-extent (m)
  buildingChunk: 480,     // building merge chunk size (m)
  rebaseThreshold: 1800,  // rebase when player is this far from origin (m)
};

export const QUALITY = {
  low: { terrainStep: 3, trees: 1600, seaQ: 0, shadowSize: 0, pixelRatio: 1 },
  medium: { terrainStep: 2, trees: 3200, seaQ: 1, shadowSize: 2048, pixelRatio: 1.25 },
  high: { terrainStep: 1, trees: 5000, seaQ: 1, shadowSize: 2048, pixelRatio: 1.5 },
};

export class World {
  constructor(gl, { quality = "medium", offline = false } = {}) {
    this.gl = gl;
    this.quality = QUALITY[quality] ? quality : "medium";
    this.q = QUALITY[this.quality];
    this.offline = offline;
    this.geo = new Geo();
    this.models = [];
    this.sea = null;
    this.hf = null;
    this.buildingIndex = null;
    this.features = null;
    this.heightTex = null;
    this.assets = null;
    this.roadPoints = [];
    this.envPart = {
      heightRect: new Float32Array([0, 0, 1, 1]),
      heightSize: new Float32Array([2, 2]),
      heightTex: null,
      waveAmp: 1,
    };
    this.stats = { buildings: 0, roads: 0, trees: 0 };
  }

  _ensureAssets() {
    if (this.assets) return;
    const gl = this.gl;
    this.assets = {
      facade: makeFacadeAtlas(gl),
      road: makeRoadAtlas(gl),
      noise: makeGroundNoise(gl),
      tree: makeTreeAtlas(gl),
    };
    this.materials = {
      terrain: new Material({ texture: this.assets.noise, terrain: true, spec: 0.01, castShadow: true }),
      road: new Material({ texture: this.assets.road, atlas: true, spec: 0.3, castShadow: false }),
      green: new Material({ texture: this.assets.noise, spec: 0.0, castShadow: false }),
      tree: new Material({
        texture: this.assets.tree, atlas: true, cellSize: 0.5, alphaTest: 0.5,
        sway: true, cull: false, castShadow: false,
      }),
      building: new Material({ texture: this.assets.facade, atlas: true, spec: 0.22 }),
      water: new Material({
        program: "water", blend: true, depthWrite: false, cull: false,
        castShadow: false, receiveShadow: false, waveAmp: 0.35,
      }),
    };
  }

  /** Build a full world patch around (lat, lon) without touching current state. */
  async _build(lat, lon, { onStatus, onProgress } = {}) {
    const gl = this.gl;
    this._ensureAssets();
    const status = (t, f) => onStatus && onStatus(t, f);
    const geo = new Geo(lat, lon);
    const staged = { geo, models: [], sea: null, index: null, hf: null, features: null, heightTex: null, roadPoints: [] };

    status("downloading elevation (terrarium tiles)\u2026", 0.03);
    staged.hf = await loadElevation(geo, 0, 0, WORLD.terrainHalf, {
      offline: this.offline,
      onProgress: (f, text) => status(text, 0.03 + f * 0.45),
    });

    if (!this.offline) {
      const raw = await fetchOsmData(lat, lon, WORLD.fetchRadius, {
        onStatus: (t) => status(t, 0.55),
        offline: this.offline,
      });
      staged.features = parseOsm(raw, { lat, lon }, geo.seed);
    } else {
      staged.features = { buildings: [], roads: [], waterAreas: [], waterLines: [], greens: [], treeNodes: [] };
    }

    const f = staged.features;
    this.stats = { buildings: f.buildings.length, roads: f.roads.length, trees: 0 };
    status(`building terrain, ${f.buildings.length} buildings, ${f.roads.length} roads\u2026`, 0.68);

    staged.models.push(buildTerrainModel(gl, staged.hf, this.materials.terrain, this.q.terrainStep));
    staged.sea = new Sea(gl, WORLD.terrainHalf * 1.5, 0, this.q.seaQ);

    if (f.roads.length) {
      const g = buildRoadGeometry(f.roads, staged.hf);
      if (g.triCount > 0) {
        staged.models.push(new Model(new Mesh(gl, g), [this.materials.road], { castShadow: false, frustumCull: false }));
        for (const r of f.roads) {
          if (r.width < 4.5) continue;
          const pts = r.pts;
          for (let i = 0; i + 3 < pts.length; i += 4) {
            const dx = pts[i + 2] - pts[i], dz = pts[i + 3] - pts[i + 1];
            const l = Math.hypot(dx, dz) || 1;
            staged.roadPoints.push({ x: pts[i], z: pts[i + 1], dx: dx / l, dz: dz / l, width: r.width });
          }
        }
      }
    }

    if (f.greens.length) {
      const g = buildGreensGeometry(f.greens, staged.hf);
      if (g.triCount > 0) staged.models.push(new Model(new Mesh(gl, g), [this.materials.green], { castShadow: false, frustumCull: false }));
    }

    const { geo: tg, count } = buildTreeGeometry(f.greens, f.treeNodes, staged.hf, {
      maxTrees: this.q.trees,
      seed: geo.seed,
    });
    this.stats.trees = count;
    if (tg.triCount > 0) staged.models.push(new Model(new Mesh(gl, tg), [this.materials.tree], { castShadow: false, frustumCull: false }));

    if (f.waterAreas.length || f.waterLines.length) {
      const g = buildWaterGeometry(f.waterAreas, f.waterLines, staged.hf);
      if (g.triCount > 0) staged.models.push(new Model(new Mesh(gl, g), [this.materials.water], { castShadow: false, frustumCull: false }));
    }

    // Buildings, merged per chunk for culling.
    status(`constructing ${f.buildings.length} buildings\u2026`, 0.78);
    const chunkSize = WORLD.buildingChunk;
    const chunks = new Map();
    for (const b of f.buildings) {
      const key = Math.floor(b.cx / chunkSize) + "," + Math.floor(b.cz / chunkSize);
      let arr = chunks.get(key);
      if (!arr) chunks.set(key, (arr = []));
      arr.push(b);
    }
    let chunkDone = 0;
    for (const list of chunks.values()) {
      const g = buildChunkGeometry(list, staged.hf);
      if (g.triCount === 0) continue;
      staged.models.push(new Model(new Mesh(gl, g), [this.materials.building], { castShadow: true, frustumCull: true }));
      chunkDone++;
      if (chunkDone % 10 === 0) status(`constructing buildings\u2026 ${chunkDone}/${chunks.size}`, 0.78 + 0.16 * (chunkDone / chunks.size));
    }
    staged.index = new BuildingIndex(f.buildings);

    staged.heightTex = r32fTexture(gl, staged.hf.data, staged.hf.w, staged.hf.h);
    staged.features = f;
    status("finalizing\u2026", 0.97);
    return staged;
  }

  _swap(staged) {
    // Dispose previous GPU resources.
    for (const m of this.models) m.mesh.dispose();
    if (this.sea) this.sea.model.mesh.dispose();
    if (this.heightTex) this.gl.deleteTexture(this.heightTex);
    this.models = staged.models;
    this.sea = staged.sea;
    this.hf = staged.hf;
    this.buildingIndex = staged.index;
    this.features = staged.features;
    this.heightTex = staged.heightTex;
    this.roadPoints = staged.roadPoints;
    this.geo = staged.geo;
    const hf = this.hf;
    this.envPart.heightRect.set([hf.x0, hf.z0, 1 / (hf.cell * (hf.w - 1)), 1 / (hf.cell * (hf.h - 1))]);
    this.envPart.heightSize.set([hf.w, hf.h]);
    this.envPart.heightTex = this.heightTex;
  }

  /** Initial load. */
  async load(lat, lon, opts = {}) {
    const staged = await this._build(lat, lon, opts);
    this._swap(staged);
    return this;
  }

  /**
   * Rebase the world so its origin sits at local point globalPos = geo.toLatLon(x,z) ... (x,z)
   * are current local coords. Resolves with the offset entities must be shifted by
   * to keep their real-world position.
   */
  async reloadAt(x, z, opts = {}) {
    const ll = this.geo.toLatLon(x, z);
    const off = Geo.offsetBetween(this.geo.lat0, this.geo.lon0, ll.lat, ll.lon);
    const staged = await this._build(ll.lat, ll.lon, opts);
    this._swap(staged);
    return { offsetX: -off.x, offsetZ: -off.z, geo: this.geo };
  }

  // ---- queries ----
  heightAt(x, z) { return this.hf ? this.hf.sample(x, z) : 0; }
  normalAt(x, z, out) { return this.hf ? this.hf.sampleNormal(x, z, out) : { x: 0, y: 1, z: 0 }; }
  seaHeightAt(x, z, t) { return waveHeight(x, z, t, 1); }

  collideBuildings(x, z, r, y, out) {
    if (!this.buildingIndex) { out.hit = false; out.pen = 0; out.nx = 0; out.nz = 0; return out; }
    return this.buildingIndex.collideCircle(x, z, r, y, out);
  }

  /** Lowest terrain point within maxR of (cx,cz) (used to find water for the boat). */
  findLowestPoint(cx = 0, cz = 0, maxR = 2600) {
    if (!this.hf) return null;
    const hf = this.hf;
    const stride = Math.max(1, Math.round(12 / hf.cell));
    let best = null;
    const i0 = Math.max(0, Math.floor((cx - maxR - hf.x0) / hf.cell));
    const i1 = Math.min(hf.w - 1, Math.ceil((cx + maxR - hf.x0) / hf.cell));
    const j0 = Math.max(0, Math.floor((cz - maxR - hf.z0) / hf.cell));
    const j1 = Math.min(hf.h - 1, Math.ceil((cz + maxR - hf.z0) / hf.cell));
    for (let j = j0; j <= j1; j += stride) {
      const z = hf.z0 + j * hf.cell;
      for (let i = i0; i <= i1; i += stride) {
        const x = hf.x0 + i * hf.cell;
        if (Math.hypot(x - cx, z - cz) > maxR) continue;
        const h = hf.data[j * hf.w + i];
        if (!best || h < best.h) best = { x, z, h };
      }
    }
    return best;
  }

  /** Flattest above-water spot within maxR of (cx,cz) (used for the plane).
   *  minH softly biases the search inland (no penalty at/above minH m elevation).
   *  avoid: optional array of {x,z,r} circles to steer clear of (other vehicles).
   *  If the primary radius finds nothing, the search widens automatically. */
  findFlatSpot(cx = 0, cz = 0, maxR = 1300, minH = 2.5, avoid = null) {
    const best = this._scanFlatSpot(cx, cz, maxR, minH, avoid);
    if (best) return best;
    const wide = Math.min(maxR * 2.6, this.hf ? this.hf.w * this.hf.cell * 0.45 : maxR);
    return wide > maxR * 1.3 ? this._scanFlatSpot(cx, cz, wide, minH, avoid) : null;
  }

  _scanFlatSpot(cx, cz, maxR, minH, avoid) {
    const hf = this.hf;
    const stride = Math.max(1, Math.round(16 / hf.cell));
    let best = null;
    const i0 = Math.max(1, Math.floor((cx - maxR - hf.x0) / hf.cell));
    const i1 = Math.min(hf.w - 2, Math.ceil((cx + maxR - hf.x0) / hf.cell));
    const j0 = Math.max(1, Math.floor((cz - maxR - hf.z0) / hf.cell));
    const j1 = Math.min(hf.h - 2, Math.ceil((cz + maxR - hf.z0) / hf.cell));
    for (let j = j0; j <= j1; j += stride) {
      const z = hf.z0 + j * hf.cell;
      for (let i = i0; i <= i1; i += stride) {
        const x = hf.x0 + i * hf.cell;
        const r = Math.hypot(x - cx, z - cz);
        if (r > maxR) continue;
        if (avoid) {
          let blocked = false;
          for (const a of avoid) {
            if (Math.hypot(x - a.x, z - a.z) < a.r) { blocked = true; break; }
          }
          if (blocked) continue;
        }
        const h = hf.data[j * hf.w + i];
        if (h < 2.5) continue;
        const d = hf.data;
        const sl = Math.abs(d[j * hf.w + i + 1] - d[j * hf.w + i - 1]) + Math.abs(d[(j + 1) * hf.w + i] - d[(j - 1) * hf.w + i]);
        const dry = h < minH ? (minH - h) * 0.35 : 0;
        const score = sl + r * 0.0025 + dry;
        if (!best || score < best.score) best = { x, z, h, score, slope: sl };
      }
    }
    return best;
  }

  /** Nearest drivable road point to (cx,cz) (used for the car). */
  findRoadSpawn(cx = 0, cz = 0, maxDist = 1500) {
    let best = null;
    for (const p of this.roadPoints) {
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d < maxDist && (!best || d < best.d)) best = { d, p };
    }
    if (!best) return null;
    const p = best.p;
    const yaw = Math.atan2(-p.dx, -p.dz);
    return { x: p.x, z: p.z, yaw };
  }

  dispose() {
    for (const m of this.models) m.mesh.dispose();
    if (this.sea) this.sea.model.mesh.dispose();
    this.models = [];
    this.sea = null;
  }
}
