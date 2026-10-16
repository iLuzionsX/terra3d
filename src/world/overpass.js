// Terra3D world — Overpass API client with endpoint fallback, retry/backoff and caching.
import { cacheGet, cachePut } from "./cache.js";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30;

export function buildOverpassQuery(lat, lon, radius) {
  const r = Math.round(radius);
  const small = Math.round(Math.min(700, radius * 0.5));
  const around = `(around:${r},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const aroundSmall = `(around:${small},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:90];
(
  way["building"]${around};
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"]${around};
  way["highway"~"^(footway|path|cycleway|track|steps)$"]${aroundSmall};
  way["waterway"~"^(river|canal|stream)$"]${around};
  way["water"~"^(lake|pond|river|canal|reservoir|basin)$"]${around};
  way["natural"="water"]${around};
  way["leisure"~"^(park|garden|playground|pitch|golf_course|nature_reserve|common)$"]${around};
  way["landuse"~"^(grass|meadow|forest|cemetery|village_green|recreation_ground|farmland|orchard|vineyard|scrub)$"]${around};
  way["natural"~"^(wood|scrub|heath|grassland|sand|beach|bare_rock|fell)$"]${around};
  node["natural"="tree"]${aroundSmall};
);
out tags geom qt;`;
}

/**
 * Fetch raw OSM data around a point. Returns an Overpass JSON object
 * ({ elements: [...] }) or throws after all endpoints fail.
 */
export async function fetchOsmData(lat, lon, radius, { onStatus, offline = false } = {}) {
  if (offline) return { elements: [], offline: true };
  const key = `osm:${lat.toFixed(3)},${lon.toFixed(3)},${Math.round(radius)}`;
  const cached = await cacheGet(key, CACHE_TTL);
  if (cached) {
    if (onStatus) onStatus("using cached OpenStreetMap data");
    return cached;
  }

  const query = buildOverpassQuery(lat, lon, radius);
  let lastErr = null;
  for (let round = 0; round < 2; round++) {
    for (const ep of ENDPOINTS) {
      const host = new URL(ep).host;
      if (onStatus) onStatus(`querying OpenStreetMap (${host})${round > 0 ? ", retry" : ""}\u2026`);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 150000);
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("invalid response (not JSON)");
        }
        if (!json.elements) throw new Error("missing elements");
        await cachePut(key, json);
        return json;
      } catch (e) {
        lastErr = e;
        if (onStatus) onStatus(`${host} unavailable (${e.message}), trying another mirror\u2026`);
      }
    }
    if (round === 0) await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error(`OpenStreetMap (Overpass) unreachable. ${lastErr ? lastErr.message : ""}`);
}
