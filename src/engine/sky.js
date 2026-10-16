// Terra3D engine — procedural sky: sun cycle, gradient, clouds, stars.
import { Geometry } from "./builders.js";
import { Mesh, Model } from "./mesh.js";
import { Material } from "./material.js";
import { canvasTexture, textureFromCanvas, makeCanvas } from "./texture.js";
import { Vec3 } from "./vec3.js";
import { clamp, lerp, smoothstep, createRng, fbm2D, DEG, RAD } from "./math.js";

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export class Sky {
  constructor(gl, seed = 7) {
    this.gl = gl;
    this.model = this._buildDome(gl);
    this.cloudsTex = this._makeClouds(gl, seed);
    this.starsTex = this._makeStars(gl, seed);
    this._camPos = new Vec3();
    this.env = {
      time: 14.5,
      sunDir: [0, 1, 0],
      sunColor: [1, 1, 1],
      sunDiscColor: [1, 1, 1],
      sunElevation: 0.5,
      ambSky: [0.3, 0.35, 0.45],
      ambGround: [0.15, 0.14, 0.12],
      fogColor: [0.6, 0.7, 0.8],
      fogDensity: 0.00017,
      zenith: [0.16, 0.34, 0.62],
      horizon: [0.6, 0.72, 0.85],
      cloudColor: [1, 1, 1],
      cloudAmount: 0.75,
      night: 0,
      waterShallow: [0.10, 0.30, 0.38],
      waterDeep: [0.015, 0.05, 0.10],
      waterFoam: [0.85, 0.92, 0.95],
      terrainGrass: [0.30, 0.38, 0.24],
      terrainRock: [0.42, 0.39, 0.35],
      terrainSnow: [0.92, 0.94, 0.97],
      terrainSand: [0.76, 0.70, 0.52],
      waveAmp: 1,
      camPos: [0, 0, 0],
      focus: { x: 0, y: 0, z: 0 },
      cloudsTex: null,
      starsTex: null,
      heightRect: [0, 0, 1, 1],
      heightSize: [2, 2],
      heightTex: null,
    };
  }

  _buildDome(gl) {
    const geo = new Geometry();
    const rings = 24, segs = 32;
    const ids = [];
    for (let r = 0; r <= rings; r++) {
      const lat = lerp(-70 * DEG, 88 * DEG, r / rings);
      const cy = Math.sin(lat), cr = Math.cos(lat);
      const row = [];
      for (let s = 0; s <= segs; s++) {
        const lon = (s / segs) * Math.PI * 2;
        const x = Math.cos(lon) * cr, z = Math.sin(lon) * cr;
        row.push(geo.addVertex(x, cy, z, x, cy, z, 0, 0, 0, 0, 1, 1, 1));
      }
      ids.push(row);
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        geo.addQuad(ids[r][s], ids[r][s + 1], ids[r + 1][s + 1], ids[r + 1][s]);
      }
    }
    const mesh = new Mesh(gl, geo);
    const mat = new Material({ program: "sky", castShadow: false, cull: false, depthWrite: false });
    return new Model(mesh, [mat], { castShadow: false, frustumCull: false });
  }

  _makeClouds(gl, seed) {
    const { canvas, ctx } = makeCanvas(256, 256);
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = fbm2D((x / 256) * 6, (y / 256) * 6, 5, 2, 0.55, seed) * 0.65
          + fbm2D((x / 256) * 13 + 40, (y / 256) * 13 + 40, 4, 2, 0.5, seed + 9) * 0.35;
        const p = Math.round(clamp((n - 0.38) * 2.9, 0, 1) * 255);
        const i = (y * 256 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = p;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return textureFromCanvas(gl, canvas, { repeat: true, srgb: false, mipmap: true });
  }

  _makeStars(gl, seed) {
    const { canvas, ctx } = makeCanvas(512, 512);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 512, 512);
    const rng = createRng(seed * 31 + 5);
    for (let i = 0; i < 900; i++) {
      const x = rng() * 512, y = rng() * 512;
      const b = rng();
      const r = b > 0.96 ? 1.4 : 0.6 + b * 0.6;
      const warm = rng();
      ctx.fillStyle = `rgba(${230 + warm * 25},${230 + (1 - warm) * 25},255,${0.25 + b * 0.75})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return textureFromCanvas(gl, canvas, { repeat: true, srgb: false, mipmap: true });
  }

  /** Keep the dome centered on the camera. */
  updateCamera(cameraPos) {
    this._camPos.copy(cameraPos);
    this.model.setTransform(this._camPos);
  }

  /**
   * Compute lighting/atmosphere for a given time of day and latitude.
   * Returns a shared env object (do not retain references to arrays after copying).
   */
  computeEnvironment(timeHours, latDeg) {
    const env = this.env;
    const phi = clamp(latDeg, -85, 85) * DEG;
    const delta = 15 * DEG; // decorative fixed season
    const H = (timeHours - 12) * 15 * DEG;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const sd = Math.sin(delta), cd = Math.cos(delta);
    const up = sp * sd + cp * cd * Math.cos(H);
    const east = -cd * Math.sin(H);
    const north = sd * cp - cd * sp * Math.cos(H);
    const dl = Math.hypot(east, north, up) || 1;
    env.sunDir[0] = east / dl;
    env.sunDir[1] = up / dl;
    env.sunDir[2] = -north / dl; // +z is south in world space
    const e = Math.asin(clamp(up / dl, -1, 1)); // elevation angle (rad)
    env.sunElevation = e;
    env.time = timeHours;

    const day = smoothstep(-0.10, 0.12, e);
    const dusk = Math.exp(-Math.pow((e * RAD - 2.5) / 10, 2));
    env.sunColor = mix3(mix3([0.10, 0.13, 0.22], [1.12, 1.06, 0.92], day), [1.5, 0.66, 0.32], dusk * 0.9);
    env.sunDiscColor = mix3(mix3([0.05, 0.07, 0.14], [1.0, 0.98, 0.92], day), [1.6, 0.55, 0.25], dusk);
    env.ambSky = mix3([0.035, 0.045, 0.08], [0.30, 0.36, 0.46], day);
    env.ambGround = mix3([0.02, 0.02, 0.03], [0.16, 0.15, 0.13], day);
    env.zenith = mix3(mix3([0.012, 0.02, 0.05], [0.15, 0.33, 0.62], day), [0.26, 0.28, 0.48], dusk * 0.55);
    let horizon = mix3([0.045, 0.06, 0.115], [0.62, 0.73, 0.86], day);
    horizon = mix3(horizon, [1.0, 0.55, 0.30], dusk * 0.85);
    env.horizon = horizon;
    env.fogColor = mix3(horizon, [0.62, 0.72, 0.84], day * 0.25);
    env.fogDensity = lerp(0.00022, 0.000165, day);
    env.night = 1 - smoothstep(-0.12, 0.05, e);
    env.cloudColor = mix3(mix3([0.07, 0.09, 0.14], [1.0, 1.0, 1.0], day), [1.0, 0.62, 0.45], dusk * 0.7);
    env.cloudAmount = 0.78;
    return env;
  }
}
