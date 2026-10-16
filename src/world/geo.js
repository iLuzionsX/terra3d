// Terra3D world — geodetic helpers. Local tangent-plane coordinates:
// x = east (+), z = south (+), y = up. Origin is settable (used for rebasing).
import { DEG, RAD, hashSeed } from "../engine/math.js";

export const EARTH_R = 6371000;
const M_PER_DEG_LAT = 110574;

export class Geo {
  constructor(lat = 0, lon = 0) {
    this.setOrigin(lat, lon);
  }

  setOrigin(lat, lon) {
    this.lat0 = lat;
    this.lon0 = lon;
    this.mPerDegLat = M_PER_DEG_LAT;
    this.mPerDegLon = 111320 * Math.cos(lat * DEG);
    this.seed = hashSeed(lat.toFixed(4) + "," + lon.toFixed(4));
  }

  /** lat/lon -> local meters (x east, z south). */
  toLocal(lat, lon, out = { x: 0, z: 0 }) {
    out.x = (lon - this.lon0) * this.mPerDegLon;
    out.z = (this.lat0 - lat) * this.mPerDegLat;
    return out;
  }

  /** local meters -> lat/lon. */
  toLatLon(x, z, out = { lat: 0, lon: 0 }) {
    out.lat = this.lat0 - z / this.mPerDegLat;
    out.lon = this.lon0 + x / this.mPerDegLon;
    return out;
  }

  /** Offset in meters from anchor A to anchor B (local frame of A). */
  static offsetBetween(lat1, lon1, lat2, lon2) {
    const mLon = 111320 * Math.cos(((lat1 + lat2) / 2) * DEG);
    return { x: (lon2 - lon1) * mLon, z: (lat1 - lat2) * M_PER_DEG_LAT };
  }

  static lonLatToTile(lon, lat, z) {
    const n = 2 ** z;
    const latRad = lat * DEG;
    return {
      x: ((lon + 180) / 360) * n,
      y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
    };
  }

  static tileToLonLat(xt, yt, z) {
    const n = 2 ** z;
    return {
      lon: (xt / n) * 360 - 180,
      lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * yt) / n))) * RAD,
    };
  }

  static metersPerPixel(lat, z) {
    return (156543.03392 * Math.cos(lat * DEG)) / 2 ** z;
  }
}

export const dist2d = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
