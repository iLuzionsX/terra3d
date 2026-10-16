// Terra3D world — terrain mesh built from the heightfield.
import { Geometry } from "../engine/builders.js";
import { Mesh, Model } from "../engine/mesh.js";

/**
 * Single terrain mesh over the whole heightfield, sampled every `step` cells.
 * step 1 = full res, 2 = half, ... Visual LOD traded against triangle count.
 */
export function buildTerrainModel(gl, hf, material, step = 2) {
  const spanX = hf.cell * (hf.w - 1);
  const spanZ = hf.cell * (hf.h - 1);
  const cols = Math.max(2, Math.floor((hf.w - 1) / step));
  const rows = Math.max(2, Math.floor((hf.h - 1) / step));
  const stepX = spanX / cols, stepZ = spanZ / rows;
  const stepM = Math.max(stepX, stepZ);
  const geo = new Geometry();
  geo.beginGroup("terrain");
  geo.addGrid(hf.x0, hf.z0, stepM, Math.round(spanX / stepM), Math.round(spanZ / stepM), (x, z) => hf.sample(x, z), {
    uvScale: 22,
    cell: [0, 0],
    tint: [1, 1, 1],
  });
  geo.endGroup();
  const mesh = new Mesh(gl, geo);
  const model = new Model(mesh, [material], { castShadow: true, frustumCull: false });
  return model;
}
