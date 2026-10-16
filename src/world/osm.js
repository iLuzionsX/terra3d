// Terra3D world — parse Overpass JSON into world-space features (local meters).
import { smoothstep, createRng } from "../engine/math.js";
import { simplifyPolyline, ensureCCW } from "../engine/geom2d.js";
import { dist2d } from "./geo.js";

const NAMED_COLORS = {
  white: [0.93, 0.92, 0.89], beige: [0.85, 0.80, 0.70], grey: [0.72, 0.73, 0.75],
  gray: [0.72, 0.73, 0.75], silver: [0.80, 0.81, 0.83], black: [0.16, 0.17, 0.19],
  brown: [0.55, 0.42, 0.30], red: [0.65, 0.30, 0.24], maroon: [0.48, 0.22, 0.20],
  terracotta: [0.72, 0.41, 0.30], orange: [0.80, 0.53, 0.30], yellow: [0.85, 0.75, 0.42],
  green: [0.44, 0.56, 0.36], blue: [0.37, 0.50, 0.66], pink: [0.85, 0.66, 0.66],
  tan: [0.80, 0.70, 0.54], cream: [0.93, 0.90, 0.83], sandstone: [0.78, 0.70, 0.55],
  "dark grey": [0.5, 0.51, 0.53], "dark gray": [0.5, 0.51, 0.53], lightgrey: [0.83, 0.84, 0.85],
};

export function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];
  let m = s.match(/^#([0-9a-f]{6})$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = s.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16) / 255);
    return [r, g, b];
  }
  m = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
  return null;
}

function parseLength(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase();
  const num = parseFloat(s);
  if (!isFinite(num)) return null;
  if (s.includes("ft") || s.includes("'")) return num * 0.3048;
  return num;
}

/** Building style: 0 brick, 1 concrete, 2 glass, 3 plaster, 4 office. */
export function buildingStyle(tags, height, rng) {
  const material = (tags["building:material"] || "").toLowerCase();
  const type = (tags.building || "").toLowerCase();
  if (material.includes("brick") || material.includes("stone_brick")) return 0;
  if (material.includes("glass") || material.includes("metal")) return 2;
  if (material.includes("concrete")) return 1;
  if (material.includes("plaster") || material.includes("stone")) return 3;
  if (material.includes("wood")) return 0;
  if (type.includes("church") || type.includes("cathedral") || type.includes("chapel") || type.includes("museum")) return 3;
  if (type.includes("industrial") || type.includes("warehouse") || type.includes("garage") || type.includes("hangar") || type.includes("roof")) return 1;
  if (type.includes("house") || type.includes("detached") || type.includes("terrace") || type.includes("residential") || type.includes("apartments") || type.includes("dormitory")) {
    return rng() < 0.62 ? 0 : 3;
  }
  if (type.includes("commercial") || type.includes("retail") || type.includes("office") || type.includes("hotel")) {
    return height > 32 ? (rng() < 0.6 ? 2 : 4) : (rng() < 0.5 ? 4 : 1);
  }
  // Default by height.
  if (height > 65) return rng() < 0.62 ? 2 : 4;
  if (height > 26) return rng() < 0.45 ? 4 : 1;
  return rng() < 0.34 ? 0 : rng() < 0.66 ? 3 : 1;
}

const STYLE_TINTS = [
  [1.06, 0.94, 0.86], // brick
  [0.96, 0.97, 1.00], // concrete
  [0.78, 0.92, 1.06], // glass
  [1.05, 1.02, 0.96], // plaster
  [0.94, 0.95, 1.00], // office
];

export const ROAD_WIDTHS = {
  motorway: 17, trunk: 15, primary: 13, secondary: 11, tertiary: 9.5,
  unclassified: 7.5, residential: 7.5, living_street: 6.5, service: 5,
  pedestrian: 5, footway: 2.6, path: 2.2, cycleway: 2.6, track: 4, steps: 2.4,
};
export const ROAD_CELL = {
  motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 2,
  unclassified: 3, residential: 3, living_street: 3, service: 4,
  pedestrian: 6, footway: 5, path: 5, cycleway: 5, track: 7, steps: 5,
};

/**
 * Convert raw Overpass elements into features in local meters.
 * origin: {lat, lon} of the local frame.
 */
export function parseOsm(raw, origin, seed = 1) {
  const rng = createRng(seed);
  const mLon = 111320 * Math.cos(origin.lat * Math.PI / 180);
  const mLat = 110574;
  const px = (lon) => (lon - origin.lon) * mLon;
  const pz = (lat) => (origin.lat - lat) * mLat;

  const buildings = [];
  const roads = [];
  const waterAreas = [];
  const waterLines = [];
  const greens = [];
  const treeNodes = [];

  for (const el of raw.elements || []) {
    const tags = el.tags || {};
    if (el.type === "node") {
      if (tags.natural === "tree") treeNodes.push({ x: px(el.lon), z: pz(el.lat) });
      continue;
    }
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const geo = el.geometry;
    let count = geo.length;
    const closed = geo[0].lat === geo[count - 1].lat && geo[0].lon === geo[count - 1].lon;
    const span = closed ? count - 1 : count;
    const pts = new Float32Array(span * 2);
    for (let i = 0; i < span; i++) {
      pts[i * 2] = px(geo[i].lon);
      pts[i * 2 + 1] = pz(geo[i].lat);
    }

    // ---- buildings ----
    if (tags.building && tags.building !== "no" && span >= 3) {
      const poly = dedupe(pts);
      if (poly.length >= 6) {
        const { area, cx, cz } = polyStats(poly);
        if (area >= 11) {
          const levels = parseFloat(tags["building:levels"]);
          let h = parseLength(tags.height);
          if (h == null) {
            if (isFinite(levels) && levels > 0) h = levels * 3.2 + 1.1;
            else h = Math.max(3.4, Math.min(34, Math.sqrt(area) * 1.15 + rng() * 4));
          }
          h = Math.min(h, 520);
          const minH = parseLength(tags["min_height"]) || 0;
          const style = buildingStyle(tags, h, rng);
          let tint = parseColor(tags["building:colour"] || tags["building:color"]);
          if (tint) tint = [tint[0] * 1.22, tint[1] * 1.22, tint[2] * 1.22];
          else {
            const base = STYLE_TINTS[style];
            const j = 0.92 + rng() * 0.16;
            tint = [base[0] * j, base[1] * j, base[2] * j];
          }
          const roofShape = (tags["roof:shape"] || "").toLowerCase();
          buildings.push({
            poly, h, minH, area, cx, cz, style,
            tint: [Math.min(tint[0], 1.5), Math.min(tint[1], 1.5), Math.min(tint[2], 1.5)],
            roofShape,
            tall: h > 55,
            name: tags.name || null,
          });
        }
      }
      continue;
    }

    // ---- roads ----
    if (tags.highway && ROAD_WIDTHS[tags.highway]) {
      const simple = simplifyPolyline(pts, 1.3);
      if (simple.length >= 4) {
        roads.push({
          type: tags.highway,
          width: ROAD_WIDTHS[tags.highway],
          cell: ROAD_CELL[tags.highway] ?? 3,
          pts: simple,
          bridge: tags.bridge === "yes" || tags.bridge === "viaduct",
          layer: parseFloat(tags.layer) || 0,
        });
      }
      continue;
    }

    // ---- water ----
    if (tags.natural === "water" || tags.water || /^(riverbank|lake|pond|reservoir|canal|basin|dock)$/.test(tags.water || "")) {
      if (closed && span >= 3) waterAreas.push({ poly: dedupe(pts), area: polyStats(pts).area });
      else if (span >= 2) waterLines.push({ kind: "river", pts: simplifyPolyline(pts, 2), width: 14 });
      continue;
    }
    if (tags.waterway && /^(river|canal|stream)$/.test(tags.waterway)) {
      const width = tags.waterway === "river" ? 16 : tags.waterway === "canal" ? 11 : 4.5;
      waterLines.push({ kind: tags.waterway, pts: simplifyPolyline(pts, 2), width: parseLength(tags.width) || width });
      continue;
    }

    // ---- greens ----
    if (tags.leisure || tags.landuse || tags.natural) {
      const kind =
        tags.leisure === "park" || tags.leisure === "garden" || tags.leisure === "common" ? "park" :
        tags.leisure === "pitch" || tags.leisure === "playground" ? "pitch" :
        tags.leisure === "golf_course" || tags.leisure === "nature_reserve" ? "nature" :
        tags.landuse === "forest" || tags.natural === "wood" ? "forest" :
        tags.natural === "sand" || tags.natural === "beach" ? "sand" :
        tags.natural === "bare_rock" || tags.natural === "scrub" || tags.natural === "heath" || tags.natural === "fell" ? "rough" :
        tags.landuse === "grass" || tags.landuse === "meadow" || tags.landuse === "village_green" ||
        tags.landuse === "recreation_ground" || tags.natural === "grassland" ? "grass" :
        tags.landuse === "cemetery" || tags.landuse === "farmland" || tags.landuse === "orchard" || tags.landuse === "vineyard" ? "grass" : null;
      if (kind && span >= 3) {
        const poly = dedupe(pts);
        if (!closed) continue;
        const { area, cx, cz } = polyStats(poly);
        if (area >= 60) greens.push({ kind, poly, area, cx, cz });
      }
      continue;
    }
  }

  return { buildings, roads, waterAreas, waterLines, greens, treeNodes };
}

function dedupe(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], z = pts[i + 1];
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - x) < 0.05 && Math.abs(out[n - 1] - z) < 0.05) continue;
    out.push(x, z);
  }
  const poly = ensureCCW(Float32Array.from(out));
  // Drop exact duplicate closing vertex.
  if (poly.length >= 4 && poly[0] === poly[poly.length - 2] && poly[1] === poly[poly.length - 1]) {
    return poly.slice(0, poly.length - 2);
  }
  return poly;
}

function polyStats(poly) {
  let a = 0, cx = 0, cz = 0;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x0 = poly[j * 2], z0 = poly[j * 2 + 1];
    const x1 = poly[i * 2], z1 = poly[i * 2 + 1];
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (let i = 0; i < n; i++) { sx += poly[i * 2]; sz += poly[i * 2 + 1]; }
    return { area: 0, cx: sx / n, cz: sz / n };
  }
  return { area: Math.abs(a) / 2, cx: cx / (3 * a), cz: cz / (3 * a) };
}

export { smoothstep, dist2d };
