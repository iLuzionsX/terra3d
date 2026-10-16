// Terra3D engine — ocean/lake surface mesh + wave functions shared with physics.
import { Geometry } from "./builders.js";
import { Mesh, Model } from "./mesh.js";
import { Material } from "./material.js";

// Wave parameters. MUST stay in sync with the wave() function in renderer.js GLSL.
const D1 = [0.954, 0.300], D2 = [-0.447, 0.894], D3 = [0.752, -0.659];
const K1 = 0.30, K2 = 0.18, K3 = 0.85;
const A1 = 0.16, A2 = 0.22, A3 = 0.05;
const S1 = 1.4, S2 = 1.0, S3 = 2.4;

export function waveHeight(x, z, t, amp = 1) {
  return amp * (
    A1 * Math.sin((x * D1[0] + z * D1[1]) * K1 + t * S1) +
    A2 * Math.sin((x * D2[0] + z * D2[1]) * K2 + t * S2) +
    A3 * Math.sin((x * D3[0] + z * D3[1]) * K3 + t * S3)
  );
}

/** Height + slopes at (x,z) — used for boat buoyancy and wave-aligned visuals. */
export function waveSlopes(x, z, t, amp = 1, out = { h: 0, dhx: 0, dhz: 0 }) {
  const p1 = (x * D1[0] + z * D1[1]) * K1 + t * S1;
  const p2 = (x * D2[0] + z * D2[1]) * K2 + t * S2;
  const p3 = (x * D3[0] + z * D3[1]) * K3 + t * S3;
  out.h = amp * (A1 * Math.sin(p1) + A2 * Math.sin(p2) + A3 * Math.sin(p3));
  out.dhx = amp * (A1 * K1 * D1[0] * Math.cos(p1) + A2 * K2 * D2[0] * Math.cos(p2) + A3 * K3 * D3[0] * Math.cos(p3));
  out.dhz = amp * (A1 * K1 * D1[1] * Math.cos(p1) + A2 * K2 * D2[1] * Math.cos(p2) + A3 * K3 * D3[1] * Math.cos(p3));
  return out;
}

export class Sea {
  /** halfExtent: half-size of the water plane in meters. level: base water height. */
  constructor(gl, halfExtent, level = 0, quality = 1) {
    this.level = level;
    this.waveAmp = 1;
    const step = Math.max(48, Math.floor((halfExtent * 2) / (quality === 0 ? 40 : 72)));
    const cols = Math.ceil((halfExtent * 2) / step), rows = cols;
    const geo = new Geometry();
    geo.beginGroup("water");
    geo.addGrid(-halfExtent, -halfExtent, step, cols, rows, () => level, {
      uvScale: 100, cell: [0, 0], tint: [1, 1, 1],
    });
    const mesh = new Mesh(gl, geo);
    const mat = new Material({
      program: "water", blend: true, depthWrite: false, cull: false,
      castShadow: false, receiveShadow: false,
    });
    this.model = new Model(mesh, [mat], { castShadow: false, frustumCull: false });
  }
}
