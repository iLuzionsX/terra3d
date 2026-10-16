// Terra3D engine — forward renderer: shadow pass + world/water/sky passes.
import { Shader } from "./shader.js";
import { Mat4 } from "./mat4.js";
import { Vec3 } from "./vec3.js";
import { whiteTexture } from "./texture.js";

const WORLD_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec2 aCell;
layout(location=4) in vec3 aTint;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat4 uLightVP;
uniform float uTime;
uniform float uSway;
uniform float uAtlas;
uniform vec2 uCellSize;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec2 vCell;
out vec3 vTint;
out vec4 vLight;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  if (uSway > 0.5) {
    float phase = wp.x * 0.13 + wp.z * 0.17;
    float flex = (1.0 - clamp(aUv.y, 0.0, 1.0));
    wp.x += sin(uTime * 1.5 + phase) * 0.22 * flex * flex;
    wp.z += cos(uTime * 1.2 + phase * 1.7) * 0.18 * flex * flex;
  }
  vWorld = wp.xyz;
  vNormal = mat3(uModel) * aNormal;
  vUv = aUv;
  vCell = aCell;
  vTint = aTint;
  vLight = uLightVP * wp;
  gl_Position = uViewProj * wp;
}`;

const WORLD_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec2 vCell;
in vec3 vTint;
in vec4 vLight;
uniform sampler2D uTex;
uniform sampler2D uShadow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform vec3 uTerrainGrass;
uniform vec3 uTerrainRock;
uniform vec3 uTerrainSnow;
uniform vec3 uTerrainSand;
uniform float uSpec;
uniform float uEmissive;
uniform float uAlphaTest;
uniform float uFogDensity;
uniform float uAtlas;
uniform float uTerrain;
uniform float uShadowStrength;
uniform vec2 uCellSize;
out vec4 oColor;

float shadowFactor(vec4 lp) {
  if (uShadowStrength < 0.01) return 1.0;
  vec3 pc = lp.xyz / lp.w;
  if (pc.x < -1.0 || pc.x > 1.0 || pc.y < -1.0 || pc.y > 1.0 || pc.z > 1.0) return 1.0;
  vec2 uv = pc.xy * 0.5 + 0.5;
  float ref = pc.z - 0.0022;
  vec2 texel = vec2(1.0 / 2048.0);
  float sum = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float d = texture(uShadow, uv + vec2(float(i), float(j)) * texel * 1.15).r;
      sum += ref <= d ? 1.0 : 0.0;
    }
  }
  return sum / 9.0;
}

void main() {
  vec2 uv = vUv;
  vec4 tex;
  if (uAtlas > 0.5) {
    vec2 duvdx = dFdx(vUv) * uCellSize;
    vec2 duvdy = dFdy(vUv) * uCellSize;
    tex = textureGrad(uTex, vCell + fract(vUv) * uCellSize, duvdx, duvdy);
  } else {
    tex = texture(uTex, vUv);
  }
  if (uAlphaTest > 0.0 && tex.a < uAlphaTest) discard;

  vec3 albedo = tex.rgb * uColor * vTint;
  if (uTerrain > 0.5) {
    float slope = 1.0 - vNormal.y;
    float h = vWorld.y;
    vec3 g = mix(uTerrainGrass, uTerrainSand, smoothstep(3.5, 0.6, h));
    g = mix(g, uTerrainRock, smoothstep(0.12, 0.42, slope));
    g = mix(g, uTerrainSnow, smoothstep(380.0, 640.0, h));
    // Two extra rotated/scaled taps break up the ground tile repeat.
    mat2 rB = mat2(0.9272, -0.3746, 0.3746, 0.9272);
    float nA = tex.r * 0.62;
    float nB = texture(uTex, rB * vUv * 0.173 + vec2(0.37, 0.11)).r * 0.26;
    float nC = texture(uTex, vUv * 0.0437 + vec2(0.71, 0.53)).r * 0.12;
    albedo = vec3(nA + nB + nC) * g;
  }

  vec3 col;
  if (uEmissive > 0.5) {
    col = tex.rgb * uColor * 1.7;
  } else {
    vec3 N = normalize(vNormal);
    vec3 L = uSunDir;
    float ndl = max(dot(N, L), 0.0);
    float sh = shadowFactor(vLight) * uShadowStrength + (1.0 - uShadowStrength);
    vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
    col = albedo * (amb + uSunColor * ndl * sh);
    vec3 V = normalize(uCamPos - vWorld);
    vec3 H = normalize(L + V);
    float s = pow(max(dot(N, H), 0.0), 48.0) * uSpec;
    col += uSunColor * s * sh;
  }

  float dist = distance(uCamPos, vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  oColor = vec4(col, 1.0);
}`;

const WATER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uTime;
uniform float uWaveAmp;
out vec3 vWorld;
vec3 wave(vec2 p, float t, float amp) {
  float h = 0.16 * sin(dot(p, vec2(0.954, 0.300)) * 0.30 + t * 1.4)
          + 0.22 * sin(dot(p, vec2(-0.447, 0.894)) * 0.18 + t * 1.0)
          + 0.05 * sin(dot(p, vec2(0.752, -0.659)) * 0.85 + t * 2.4);
  return vec3(h * amp, 0.0, 0.0);
}
void main() {
  vec3 wp = (uModel * vec4(aPos, 1.0)).xyz;
  wp.y += wave(wp.xz, uTime, uWaveAmp).x;
  vWorld = wp;
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform sampler2D uHeightTex;
uniform vec4 uHeightRect;   // x0, z0, 1/(cell*w), 1/(cell*h)
uniform vec2 uHeightSize;   // texture dims
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCamPos;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uFogColor;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uFoamColor;
uniform float uTime;
uniform float uWaveAmp;
uniform float uFogDensity;
out vec4 oColor;

// Keep in sync with waveSlopes() in src/engine/water.js
vec3 wave(vec2 p, float t, float amp) {
  vec2 d1 = vec2(0.954, 0.300), d2 = vec2(-0.447, 0.894), d3 = vec2(0.752, -0.659);
  float k1 = 0.30, k2 = 0.18, k3 = 0.85;
  float a1 = 0.16, a2 = 0.22, a3 = 0.05;
  float s1 = 1.4, s2 = 1.0, s3 = 2.4;
  float p1 = dot(p, d1) * k1 + t * s1;
  float p2 = dot(p, d2) * k2 + t * s2;
  float p3 = dot(p, d3) * k3 + t * s3;
  float h = a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3);
  float dhx = a1 * k1 * d1.x * cos(p1) + a2 * k2 * d2.x * cos(p2) + a3 * k3 * d3.x * cos(p3);
  float dhz = a1 * k1 * d1.y * cos(p1) + a2 * k2 * d2.y * cos(p2) + a3 * k3 * d3.y * cos(p3);
  return vec3(h * amp, dhx * amp, dhz * amp);
}

float terrainH(vec2 p) {
  vec2 uv = (p - uHeightRect.xy) * uHeightRect.zw;
  uv = clamp(uv, 0.001, 0.999);
  vec2 tc = uv * uHeightSize - 0.5;
  vec2 f = fract(tc);
  vec2 base = (floor(tc) + 0.5) / uHeightSize;
  vec2 e = 1.0 / uHeightSize;
  float h00 = texture(uHeightTex, base).r;
  float h10 = texture(uHeightTex, base + vec2(e.x, 0.0)).r;
  float h01 = texture(uHeightTex, base + vec2(0.0, e.y)).r;
  float h11 = texture(uHeightTex, base + e).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

void main() {
  float gh = terrainH(vWorld.xz);
  float depth = vWorld.y - gh;
  if (depth <= 0.03) discard;
  vec3 w = wave(vWorld.xz, uTime, uWaveAmp);
  float dist = distance(uCamPos, vWorld);
  // Visual-only fine ripple: detail normals near the camera, faded out with
  // distance (not part of the physics wave set in water.js).
  float detail = 1.0 - smoothstep(8.0, 55.0, dist);
  if (detail > 0.001) {
    float p4 = (vWorld.x * 0.5221 + vWorld.z * 0.8529) * 3.1 + uTime * 3.4;
    float c4 = cos(p4) * detail;
    w.y += 0.045 * 0.5221 * c4;
    w.z += 0.045 * 0.8529 * c4;
  }
  vec3 N = normalize(vec3(-w.y * 9.0, 1.0, -w.z * 9.0));
  vec3 V = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 R = reflect(-V, N);
  vec3 refl = mix(uHorizonColor, uSkyColor, clamp(R.y * 1.35, 0.0, 1.0));
  vec3 body = mix(uShallowColor, uDeepColor, smoothstep(0.8, 26.0, depth));
  vec3 col = mix(body, refl, clamp(0.10 + fres * 0.82, 0.0, 0.92));
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 240.0) * 1.3;
  float foam = 1.0 - smoothstep(0.0, 1.5, depth);
  col = mix(col, uFoamColor, foam * 0.4);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  float alpha = clamp(0.38 + depth * 0.28 + fres * 0.25, 0.0, 0.96);
  oColor = vec4(col, alpha);
}`;

const SKY_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vDir;
void main() {
  vDir = aPos;
  vec4 p = uViewProj * uModel * vec4(aPos * 9000.0, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec3 vDir;
uniform sampler2D uClouds;
uniform sampler2D uStars;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uCloudColor;
uniform float uCloudAmount;
uniform float uNight;
uniform float uTime;
out vec4 oColor;
void main() {
  vec3 dir = normalize(vDir);
  float elev = dir.y;
  vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.02, 0.42, elev));
  // Stars
  if (uNight > 0.02 && elev > -0.05) {
    vec2 suv = dir.xz / (1.0 + max(dir.y, -0.1)) * 0.9 + 0.5;
    float st = texture(uStars, suv).r;
    sky += vec3(0.9, 0.95, 1.0) * st * uNight * smoothstep(-0.02, 0.12, elev);
  }
  // Clouds (planar projection)
  if (elev > 0.015) {
    vec2 cuv = dir.xz / max(elev, 0.06) * 0.24 + vec2(uTime * 0.0035, uTime * 0.0012);
    float c1 = texture(uClouds, cuv).r;
    float c2 = texture(uClouds, cuv * 2.13 + vec2(13.7, 31.1)).r;
    float c = smoothstep(0.38, 0.86, c1 * 0.65 + c2 * 0.35);
    float mask = smoothstep(0.015, 0.10, elev);
    sky = mix(sky, uCloudColor, c * mask * uCloudAmount);
  }
  // Sun
  float sd = dot(dir, uSunDir);
  float disc = smoothstep(0.99965, 0.99992, sd);
  float glow = pow(max(sd, 0.0), 380.0) * 0.4 + pow(max(sd, 0.0), 24.0) * 0.10;
  sky += uSunColor * (disc * 7.0 + glow);
  // Below horizon fades to the horizon color
  sky = mix(sky, uHorizon, smoothstep(0.0, -0.18, elev));
  vec3 col = sky / (sky + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  oColor = vec4(col, 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() {
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision mediump float;
void main() {}`;

export class Renderer {
  constructor(canvas, settings = {}) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true, // allows screenshots after rendering stops (smoke tests)
    });
    if (!gl) throw new Error("WebGL2 is not supported by this browser");
    this.gl = gl;
    this.canvas = canvas;
    this.settings = { pixelRatio: 1, shadowSize: 2048, ...settings };
    this.programs = {
      world: new Shader(gl, WORLD_VS, WORLD_FS, "world"),
      water: new Shader(gl, WATER_VS, WATER_FS, "water"),
      sky: new Shader(gl, SKY_VS, SKY_FS, "sky"),
      shadow: new Shader(gl, SHADOW_VS, SHADOW_FS, "shadow"),
    };
    this.white = whiteTexture(gl);
    this.stats = { calls: 0, tris: 0, frames: 0 };
    this._state = { program: null, cull: true, blend: false, depthWrite: true, texture: null };
    this._lightVP = new Mat4();
    this._lightView = new Mat4();
    this._lightProj = new Mat4();
    this._tmp = new Vec3();
    this._setupShadow();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    this.resize();
  }

  _setupShadow() {
    const gl = this.gl;
    const size = this.settings.shadowSize;
    if (!size) return;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowOk = ok;
    if (!ok) this.settings.shadowSize = 0;
  }

  resize() {
    const c = this.canvas;
    const dpr = this.settings.pixelRatio;
    const w = Math.floor(c.clientWidth * dpr) || 2;
    const h = Math.floor(c.clientHeight * dpr) || 2;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  _setState(program, cull, blend, depthWrite) {
    const gl = this.gl, s = this._state;
    if (s.program !== program) { gl.useProgram(program); s.program = program; }
    if (s.cull !== cull) { if (cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE); s.cull = cull; }
    if (s.blend !== blend) {
      if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      else gl.disable(gl.BLEND);
      s.blend = blend;
    }
    if (s.depthWrite !== depthWrite) { gl.depthMask(depthWrite); s.depthWrite = depthWrite; }
  }

  /** Compute the directional-light shadow matrix around a focus point. */
  _updateLightMatrix(sunDir, focus) {
    const R = 220;
    const dist = 420;
    const eye = this._tmp.set(focus.x + sunDir.x * dist, focus.y + sunDir.y * dist, focus.z + sunDir.z * dist);
    const up = Math.abs(sunDir.y) > 0.985 ? UP_X : UP_Y;
    Mat4.lookAt(this._lightView, eye, focus, up);
    Mat4.ortho(this._lightProj, -R, R, -R, R, 1, dist * 2.2);
    this._lightVP.copy(this._lightProj).multiply(this._lightView);
    return this._lightVP;
  }

  /**
   * scene: { models: Model[], sky: Model|null }
   * env: lighting/atmosphere uniforms (see Sky.update)
   */
  render(scene, env, camera) {
    const gl = this.gl;
    this.resize();
    this.stats.calls = 0;
    this.stats.tris = 0;
    this.stats.frames++;
    const lightVP = this._updateLightMatrix(env.sunDir, env.focus);

    // ---------- shadow pass ----------
    const shadowsOn = this.settings.shadowSize > 0 && this.shadowOk && env.sunElevation > 0.03;
    if (shadowsOn) {
      const prog = this.programs.shadow;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
      gl.viewport(0, 0, this.settings.shadowSize, this.settings.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this._setState(prog.program, true, false, true);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2.0, 4.0);
      prog.use();
      gl.uniformMatrix4fv(prog.u("uLightVP"), false, lightVP.m);
      for (const model of scene.models) {
        if (!model.visible || !model.castShadow) continue;
        const mats = model.materials;
        let casts = false;
        for (const m of mats) if (m.castShadow && m.program === "world" && m.alphaTest === 0 && !m.blend) { casts = true; break; }
        if (!casts) continue;
        const sp = model.worldSphere();
        if (!camera.sphereVisible(sp.x, sp.y, sp.z, sp.r * 1.1)) continue;
        gl.uniformMatrix4fv(prog.u("uModel"), false, model.matrix);
        gl.bindVertexArray(model.mesh.vao);
        gl.drawElements(gl.TRIANGLES, model.mesh.indexCount, gl.UNSIGNED_INT, 0);
        this.stats.calls++;
        this.stats.tris += model.mesh.indexCount / 3;
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---------- main pass ----------
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._state.program = null;

    camera.update();

    // Sky
    if (scene.sky) {
      const prog = this.programs.sky;
      this._setState(prog.program, false, false, false);
      prog.use();
      gl.uniformMatrix4fv(prog.u("uViewProj"), false, camera.viewProj.m);
      gl.uniformMatrix4fv(prog.u("uModel"), false, scene.sky.matrix);
      gl.uniform3fv(prog.u("uSunDir"), env.sunDir);
      gl.uniform3fv(prog.u("uSunColor"), env.sunDiscColor);
      gl.uniform3fv(prog.u("uZenith"), env.zenith);
      gl.uniform3fv(prog.u("uHorizon"), env.horizon);
      gl.uniform3fv(prog.u("uCloudColor"), env.cloudColor);
      gl.uniform1f(prog.u("uCloudAmount"), env.cloudAmount);
      gl.uniform1f(prog.u("uNight"), env.night);
      gl.uniform1f(prog.u("uTime"), env.time);
      gl.activeTexture(gl.TEXTURE0 + 1);
      gl.bindTexture(gl.TEXTURE_2D, env.cloudsTex);
      gl.uniform1i(prog.u("uClouds"), 1);
      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, env.starsTex);
      gl.uniform1i(prog.u("uStars"), 2);
      gl.bindVertexArray(scene.sky.mesh.vao);
      gl.drawElements(gl.TRIANGLES, scene.sky.mesh.indexCount, gl.UNSIGNED_INT, 0);
      this.stats.calls++;
      gl.depthMask(true);
    }

    // World + water
    const world = this.programs.world;
    const water = this.programs.water;
    let curProgramKey = null;
    for (const model of scene.models) {
      if (!model.visible) continue;
      if (model.frustumCull) {
        const sp = model.worldSphere();
        if (!camera.sphereVisible(sp.x, sp.y, sp.z, sp.r + model.frustumRadius)) continue;
      }
      const hasWater = model.materials.some((m) => m.program === "water" && m.blend);
      // Water materials are only drawn when the water program is active; the
      // scene builder guarantees water models come last.
      for (let gi = 0; gi < model.mesh.groups.length; gi++) {
        const group = model.mesh.groups[gi];
        const mat = model.materials[Math.min(gi, model.materials.length - 1)];
        if (mat.program === "water") {
          curProgramKey = "water";
          this._setState(water.program, mat.cull, mat.blend, mat.depthWrite);
          water.use();
          gl.uniformMatrix4fv(water.u("uViewProj"), false, camera.viewProj.m);
          gl.uniformMatrix4fv(water.u("uModel"), false, model.matrix);
          gl.uniform1f(water.u("uTime"), env.time);
          gl.uniform1f(water.u("uWaveAmp"), env.waveAmp * mat.waveAmp);
          gl.uniform3fv(water.u("uSunDir"), env.sunDir);
          gl.uniform3fv(water.u("uSunColor"), env.sunColor);
          gl.uniform3fv(water.u("uCamPos"), env.camPos);
          gl.uniform3fv(water.u("uSkyColor"), env.zenith);
          gl.uniform3fv(water.u("uHorizonColor"), env.horizon);
          gl.uniform3fv(water.u("uFogColor"), env.fogColor);
          gl.uniform3fv(water.u("uShallowColor"), env.waterShallow);
          gl.uniform3fv(water.u("uDeepColor"), env.waterDeep);
          gl.uniform3fv(water.u("uFoamColor"), env.waterFoam);
          gl.uniform1f(water.u("uFogDensity"), env.fogDensity);
          gl.uniform4fv(water.u("uHeightRect"), env.heightRect);
          gl.uniform2fv(water.u("uHeightSize"), env.heightSize);
          gl.activeTexture(gl.TEXTURE0 + 1);
          gl.bindTexture(gl.TEXTURE_2D, env.heightTex);
          gl.uniform1i(water.u("uHeightTex"), 1);
          gl.bindVertexArray(model.mesh.vao);
          gl.drawElements(gl.TRIANGLES, group.count, gl.UNSIGNED_INT, group.start * 4);
          this.stats.calls++;
          this.stats.tris += group.count / 3;
          continue;
        }
        // world program
        if (curProgramKey !== "world") {
          curProgramKey = "world";
          this._setState(world.program, mat.cull, false, true);
          world.use();
          gl.uniformMatrix4fv(world.u("uViewProj"), false, camera.viewProj.m);
          gl.uniformMatrix4fv(world.u("uLightVP"), false, lightVP.m);
          gl.uniform1f(world.u("uTime"), env.time);
          gl.uniform3fv(world.u("uSunDir"), env.sunDir);
          gl.uniform3fv(world.u("uSunColor"), env.sunColor);
          gl.uniform3fv(world.u("uAmbSky"), env.ambSky);
          gl.uniform3fv(world.u("uAmbGround"), env.ambGround);
          gl.uniform3fv(world.u("uFogColor"), env.fogColor);
          gl.uniform3fv(world.u("uCamPos"), env.camPos);
          gl.uniform1f(world.u("uFogDensity"), env.fogDensity);
          gl.uniform1f(world.u("uShadowStrength"), shadowsOn ? 0.65 : 0.0);
          gl.uniform3fv(world.u("uTerrainGrass"), env.terrainGrass);
          gl.uniform3fv(world.u("uTerrainRock"), env.terrainRock);
          gl.uniform3fv(world.u("uTerrainSnow"), env.terrainSnow);
          gl.uniform3fv(world.u("uTerrainSand"), env.terrainSand);
          gl.uniform1i(world.u("uShadow"), 1);
          gl.activeTexture(gl.TEXTURE0 + 1);
          gl.bindTexture(gl.TEXTURE_2D, this.shadowTex && shadowsOn ? this.shadowTex : this.white);
        } else {
          this._setState(world.program, mat.cull, false, true);
        }
        gl.uniformMatrix4fv(world.u("uModel"), false, model.matrix);
        gl.uniform1f(world.u("uSpec"), mat.spec);
        gl.uniform1f(world.u("uEmissive"), mat.emissive);
        gl.uniform1f(world.u("uAlphaTest"), mat.alphaTest);
        gl.uniform1f(world.u("uAtlas"), mat.atlas ? 1 : 0);
        gl.uniform1f(world.u("uTerrain"), mat.terrain ? 1 : 0);
        gl.uniform1f(world.u("uSway"), mat.sway ? 1 : 0);
        gl.uniform2f(world.u("uCellSize"), mat.cellSize, mat.cellSize);
        gl.uniform3fv(world.u("uColor"), mat.color);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, mat.texture || this.white);
        gl.uniform1i(world.u("uTex"), 0);
        gl.bindVertexArray(model.mesh.vao);
        gl.drawElements(gl.TRIANGLES, group.count, gl.UNSIGNED_INT, group.start * 4);
        this.stats.calls++;
        this.stats.tris += group.count / 3;
      }
      void hasWater;
    }

    // Restore defaults
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this._state.depthWrite = true;
    this._state.blend = false;
  }
}

const UP_Y = new Vec3(0, 1, 0);
const UP_X = new Vec3(1, 0, 0);
