// Terra3D world — parks/grass/forest ground patches + trees (billboard crosses).
import { Geometry } from "../engine/builders.js";
import { pointInPoly, polyBounds } from "../engine/geom2d.js";
import { createRng } from "../engine/math.js";

const TINT = {
  park: [0.66, 0.86, 0.50],
  grass: [0.70, 0.90, 0.55],
  pitch: [0.52, 0.80, 0.48],
  nature: [0.58, 0.76, 0.48],
  forest: [0.42, 0.62, 0.38],
  sand: [1.35, 1.24, 0.92],
  rough: [0.66, 0.72, 0.55],
};
const TREE_DENSITY = { forest: 130, nature: 420, park: 340, grass: 900, pitch: 1e9, sand: 1e9, rough: 700 };

export function buildGreensGeometry(greens, hf) {
  const geo = new Geometry();
  geo.beginGroup("greens");
  for (const g of greens) {
    const tint = TINT[g.kind] || TINT.grass;
    geo.addPolyFlat(g.poly, (x, z) => hf.sample(x, z) + 0.3, { uvScale: 13, cell: [0, 0], tint });
  }
  geo.endGroup();
  return geo;
}

function cellUV2(variant) {
  return [(variant % 2) / 2, 1 - (Math.floor(variant / 2) + 1) / 2];
}

/**
 * Trees: real OSM tree nodes + procedurally scattered in forests/parks.
 * Rendered as two-sided crossed billboards with wind sway.
 */
export function buildTreeGeometry(greens, treeNodes, hf, { maxTrees = 4000, seed = 1 } = {}) {
  const geo = new Geometry();
  geo.beginGroup("trees");
  const rng = createRng(seed ^ 0x5bd1e995);
  let count = 0;

  const emitTree = (x, z, kindBoost = 0) => {
    if (count >= maxTrees) return;
    const variant = kindBoost === 2 ? 1 : rng() < 0.18 ? 1 : rng() < 0.22 ? 2 : rng() < 0.1 ? 3 : 0;
    const h = variant === 3 ? 2 + rng() * 2.4 : 5.5 + rng() * 6.5;
    const w = h * (variant === 3 ? 0.95 : 0.62);
    const y = hf.sample(x, z) - 0.35;
    geo.addCross(x, z, y, w, h, { cell: cellUV2(variant), tint: [1, 1, 1], yaw: rng() * Math.PI });
    count++;
  };

  for (const t of treeNodes) emitTree(t.x, t.z);

  for (const g of greens) {
    const dens = TREE_DENSITY[g.kind] ?? 600;
    if (dens > 1e8) continue;
    const target = Math.min(Math.floor(g.area / dens), g.kind === "forest" ? 420 : 130);
    if (target <= 0) continue;
    const bb = polyBounds(g.poly);
    let placed = 0, tries = 0;
    while (placed < target && tries < target * 14) {
      tries++;
      const x = bb.minX + rng() * (bb.maxX - bb.minX);
      const z = bb.minZ + rng() * (bb.maxZ - bb.minZ);
      if (!pointInPoly(x, z, g.poly)) continue;
      emitTree(x, z, g.kind === "forest" || g.kind === "nature" ? 2 : 0);
      placed++;
    }
  }

  geo.endGroup();
  return { geo, count };
}
