// Terra3D engine — perspective camera + frustum culling.
import { Vec3 } from "./vec3.js";
import { Mat4 } from "./mat4.js";
import { DEG } from "./math.js";

export class Camera {
  constructor() {
    this.pos = new Vec3(0, 10, 0);
    this.target = new Vec3(0, 0, 0);
    this.up = new Vec3(0, 1, 0);
    this.fov = 62 * DEG;
    this.aspect = 16 / 9;
    this.near = 0.4;
    this.far = 14000;
    this.view = new Mat4();
    this.proj = new Mat4();
    this.viewProj = new Mat4();
    this._planes = new Float32Array(24);
  }

  update() {
    Mat4.lookAt(this.view, this.pos, this.target, this.up);
    Mat4.perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    this.viewProj.copy(this.proj).multiply(this.view);
    this._extractFrustum();
    return this;
  }

  _extractFrustum() {
    const m = this.viewProj.m, p = this._planes;
    const rows = [
      [m[0], m[4], m[8], m[12]],
      [m[1], m[5], m[9], m[13]],
      [m[2], m[6], m[10], m[14]],
      [m[3], m[7], m[11], m[15]],
    ];
    const set = (i, a, b, sign) => {
      for (let k = 0; k < 4; k++) p[i * 4 + k] = rows[3][k] + sign * rows[a][k];
      const l = Math.hypot(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]) || 1;
      p[i * 4] /= l; p[i * 4 + 1] /= l; p[i * 4 + 2] /= l; p[i * 4 + 3] /= l;
      void b;
    };
    set(0, 0, 0, 1);   // left
    set(1, 0, 0, -1);  // right
    set(2, 1, 1, 1);   // bottom
    set(3, 1, 1, -1);  // top
    set(4, 2, 2, 1);   // near
    set(5, 2, 2, -1);  // far
  }

  sphereVisible(cx, cy, cz, r) {
    const p = this._planes;
    for (let i = 0; i < 6; i++) {
      if (p[i * 4] * cx + p[i * 4 + 1] * cy + p[i * 4 + 2] * cz + p[i * 4 + 3] < -r) return false;
    }
    return true;
  }
}
