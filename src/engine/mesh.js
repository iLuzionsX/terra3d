// Terra3D engine — GPU mesh upload + drawable model.
import { Mat4 } from "./mat4.js";

const FLOATS_PER_VERT = 13;

export function identityMat4() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export class Mesh {
  constructor(gl, geo) {
    this.gl = gl;
    const vcount = geo.vertexCount;
    const interleaved = new Float32Array(vcount * FLOATS_PER_VERT);
    const { positions, normals, uvs, cells, tints } = geo;
    for (let i = 0; i < vcount; i++) {
      const o = i * FLOATS_PER_VERT;
      interleaved[o] = positions[i * 3];
      interleaved[o + 1] = positions[i * 3 + 1];
      interleaved[o + 2] = positions[i * 3 + 2];
      interleaved[o + 3] = normals[i * 3];
      interleaved[o + 4] = normals[i * 3 + 1];
      interleaved[o + 5] = normals[i * 3 + 2];
      interleaved[o + 6] = uvs[i * 2];
      interleaved[o + 7] = uvs[i * 2 + 1];
      interleaved[o + 8] = cells[i * 2];
      interleaved[o + 9] = cells[i * 2 + 1];
      interleaved[o + 10] = tints[i * 3];
      interleaved[o + 11] = tints[i * 3 + 1];
      interleaved[o + 12] = tints[i * 3 + 2];
    }
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);

    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geo.indices), gl.STATIC_DRAW);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 32);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 40);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);

    this.indexCount = geo.indices.length;
    this.groups = geo.groups;
    if (!this.groups.length && this.indexCount) {
      // Safety net: geometry built without beginGroup() still draws as one group.
      this.groups = [{ name: "default", start: 0, count: this.indexCount }];
    }
    this.bounds = geo.bounds();
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}

/** A drawable: mesh + one material per group + a model matrix. */
export class Model {
  constructor(mesh, materials, opts = {}) {
    this.mesh = mesh;
    this.materials = Array.isArray(materials) ? materials : [materials];
    this.matrix = identityMat4();
    this.visible = true;
    this.castShadow = opts.castShadow !== false;
    this.frustumCull = opts.frustumCull !== false;
    this.frustumRadius = opts.frustumRadius || 0; // extra padding
  }

  setTransform(pos, yaw = 0, pitch = 0, roll = 0, scale = 1) {
    const t = new Mat4().fromCompose(pos, yaw, pitch, roll, scale);
    this.matrix.set(t.m);
    return this;
  }

  worldSphere() {
    const b = this.mesh.bounds;
    const m = this.matrix;
    const x = m[0] * b.x + m[4] * b.y + m[8] * b.z + m[12];
    const y = m[1] * b.x + m[5] * b.y + m[9] * b.z + m[13];
    const z = m[2] * b.x + m[6] * b.y + m[10] * b.z + m[14];
    const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
    return { x, y, z, r: b.r * scale + this.frustumRadius };
  }

  dispose() { this.mesh.dispose(); }
}
