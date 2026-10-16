// Terra3D world — road/street meshes draped over the terrain.
import { Geometry } from "../engine/builders.js";
import { ROAD_ATLAS, cellUV } from "./textures.js";

const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const CELL_BY_INDEX = [
  ROAD_ATLAS.motorway, ROAD_ATLAS.primary, ROAD_ATLAS.secondary, ROAD_ATLAS.residential,
  ROAD_ATLAS.service, ROAD_ATLAS.footway, ROAD_ATLAS.pedestrian, ROAD_ATLAS.gravel,
];

/**
 * One merged geometry for every road way. Roads drape on the terrain height
 * with a small lift; major roads crossing water float as simple bridges.
 */
export function buildRoadGeometry(roads, hf) {
  const geo = new Geometry();
  geo.beginGroup("roads");
  for (const r of roads) {
    const pts = r.pts;
    if (pts.length < 4) continue;
    const mid = pts.length / 2;
    const midX = pts[(mid >> 1) * 2], midZ = pts[(mid >> 1) * 2 + 1];
    const terrainMid = hf.sample(midX, midZ);
    let yFn;
    if (terrainMid < -0.6) {
      // Over water: keep major roads as elevated bridges, skip the rest.
      if (r.bridge || MAJOR.has(r.type)) {
        yFn = (x, z) => Math.max(hf.sample(x, z) + 0.13, 2.4);
      } else {
        continue;
      }
    } else {
      yFn = (x, z) => hf.sample(x, z) + 0.13;
    }
    const cell = cellUV(CELL_BY_INDEX[r.cell] ?? ROAD_ATLAS.residential);
    geo.addRibbon(pts, r.width, yFn, { vScale: 10, cell, tint: [1, 1, 1], lift: 0 });
  }
  geo.endGroup();
  return geo;
}
