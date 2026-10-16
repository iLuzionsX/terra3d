// Terra3D engine — 4x4 matrices (column-major, WebGL layout).
import { Vec3 } from "./vec3.js";

export class Mat4 {
  constructor() { this.m = new Float32Array(16); this.identity(); }

  identity() {
    const m = this.m;
    m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;
    return this;
  }

  copy(o) { this.m.set(o.m); return this; }

  /** this = this * b (b applied first). */
  multiply(b) {
    const a = this.m, bm = b.m, o = this.m;
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let c = 0; c < 4; c++) {
      const b0 = bm[c * 4], b1 = bm[c * 4 + 1], b2 = bm[c * 4 + 2], b3 = bm[c * 4 + 3];
      o[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
      o[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
      o[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
      o[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
    }
    return this;
  }

  fromTranslation(x, y, z) {
    this.identity(); this.m[12] = x; this.m[13] = y; this.m[14] = z;
    return this;
  }

  /**
   * Model matrix: T(pos) * Ry(yaw) * Rx(pitch) * Rz(roll) * S(scale).
   * Models are authored facing -Z (yaw 0 = north).
   */
  fromCompose(pos, yaw = 0, pitch = 0, roll = 0, scale = 1) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rx * Rz (row-major math), then stored column-major.
    const r00 = cy * cr + sy * sp * sr, r01 = -cy * sr + sy * sp * cr, r02 = sy * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -sy * cr + cy * sp * sr, r21 = sy * sr + cy * sp * cr, r22 = cy * cp;
    const m = this.m;
    m[0] = r00 * scale; m[1] = r10 * scale; m[2] = r20 * scale; m[3] = 0;
    m[4] = r01 * scale; m[5] = r11 * scale; m[6] = r21 * scale; m[7] = 0;
    m[8] = r02 * scale; m[9] = r12 * scale; m[10] = r22 * scale; m[11] = 0;
    m[12] = pos.x; m[13] = pos.y; m[14] = pos.z; m[15] = 1;
    return this;
  }

  static perspective(out, fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const m = out.m;
    m.fill(0);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) / (near - far); m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return out;
  }

  static ortho(out, l, r, b, t, n, f) {
    const m = out.m;
    m.fill(0);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n);
    m[15] = 1;
    return out;
  }

  static lookAt(out, eye, target, up = Vec3Y) {
    let zx = eye.x - target.x, zy = eye.y - target.y, zz = eye.z - target.z;
    let zl = Math.hypot(zx, zy, zz);
    if (zl < 1e-8) { zx = 0; zy = 0; zz = 1; zl = 1; }
    zx /= zl; zy /= zl; zz /= zl;
    let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz = up.x * zy - up.y * zx;
    let xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-8) { xx = 1; xy = 0; xz = 0; } else { xx /= xl; xy /= xl; xz /= xl; }
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const m = out.m;
    m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
    m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
    m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
    m[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
    m[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
    m[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
    m[15] = 1;
    return out;
  }

  static invert(out, a) {
    const m = a.m;
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return out.identity();
    det = 1 / det;
    out.m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out.m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out.m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out.m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out.m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out.m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out.m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out.m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out.m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out.m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out.m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out.m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out.m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out.m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out.m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out.m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  }

  /** out = m * (x, y, z, 1) / w — accepts a Mat4 instance or a raw 16-float array. */
  static transformPoint(out, m, v) {
    const a = m.m || m;
    const x = v.x, y = v.y, z = v.z;
    const w = a[3] * x + a[7] * y + a[11] * z + a[15];
    out.x = (a[0] * x + a[4] * y + a[8] * z + a[12]) / w;
    out.y = (a[1] * x + a[5] * y + a[9] * z + a[13]) / w;
    out.z = (a[2] * x + a[6] * y + a[10] * z + a[14]) / w;
    return out;
  }

  /** out = m * (x, y, z) — accepts a Mat4 instance or a raw 16-float array. */
  static transformDir(out, m, v) {
    const a = m.m || m;
    const x = v.x, y = v.y, z = v.z;
    out.x = a[0] * x + a[4] * y + a[8] * z;
    out.y = a[1] * x + a[5] * y + a[9] * z;
    out.z = a[2] * x + a[6] * y + a[10] * z;
    return out;
  }
}

const Vec3Y = new Vec3(0, 1, 0);
