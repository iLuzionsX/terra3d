// Terra3D world — inland lakes/ponds and rivers as water surfaces.
import { Geometry } from "../engine/builders.js";

export function buildWaterGeometry(waterAreas, waterLines, hf) {
  const geo = new Geometry();
  geo.beginGroup("water");

  for (const w of waterAreas) {
    if (w.area < 80) continue;
    const poly = w.poly;
    let maxH = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      const h = hf.sample(poly[i], poly[i + 1]);
      if (h > maxH) maxH = h;
    }
    const level = Math.max(maxH + 0.25, 0.05);
    geo.addPolyFlat(poly, level, { uvScale: 20, cell: [0, 0], tint: [1, 1, 1] });
  }

  for (const w of waterLines) {
    if (w.pts.length < 4) continue;
    const yFn = (x, z) => Math.max(hf.sample(x, z), 0) + 0.22;
    geo.addRibbon(w.pts, w.width, yFn, { vScale: 12, cell: [0, 0], tint: [1, 1, 1], lift: 0 });
  }

  geo.endGroup();
  return geo;
}
