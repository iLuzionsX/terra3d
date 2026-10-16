// Terra3D engine — minimal mutable 3D vector.
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }
  len() { return Math.hypot(this.x, this.y, this.z); }
  lenSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() {
    const l = this.len();
    if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }
  dist(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distXZ(v) { return Math.hypot(this.x - v.x, this.z - v.z); }
  lerpTo(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
}

export const v3 = (x = 0, y = 0, z = 0) => new Vec3(x, y, z);
