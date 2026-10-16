// Terra3D engine — shader compilation helper.
export class Shader {
  constructor(gl, vsSrc, fsSrc, label = "shader") {
    this.gl = gl;
    this.label = label;
    this.program = gl.createProgram();
    const vs = this._compile(gl.VERTEX_SHADER, vsSrc, label + ":vs");
    const fs = this._compile(gl.FRAGMENT_SHADER, fsSrc, label + ":fs");
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(this.program);
      throw new Error(`[${label}] link failed: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this._uniforms = new Map();
  }

  _compile(type, src, label) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      // Add line numbers to the error output to make debugging shaders bearable.
      const numbered = src.split("\n").map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join("\n");
      throw new Error(`[${label}] compile failed: ${log}\n${numbered}`);
    }
    return sh;
  }

  use() { this.gl.useProgram(this.program); return this; }

  u(name) {
    let loc = this._uniforms.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this._uniforms.set(name, loc);
    }
    return loc;
  }
}
