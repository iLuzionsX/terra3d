// Terra3D engine — material description (matched to shader programs by key).
export class Material {
  constructor(opts = {}) {
    this.program = opts.program || "world";
    this.color = opts.color || [1, 1, 1];
    this.texture = opts.texture || null;     // GL texture object
    this.spec = opts.spec ?? 0.05;           // specular strength
    this.emissive = opts.emissive ?? 0;      // >= 1: draw unlit (fullbright)
    this.alphaTest = opts.alphaTest ?? 0;    // 0: opaque
    this.atlas = opts.atlas ?? false;        // cell-based texture atlas sampling
    this.cellSize = opts.cellSize || 0.25;   // atlas cell size in uv units
    this.sway = opts.sway ?? false;          // wind sway (foliage)
    this.terrain = opts.terrain ?? false;    // height/slope based ground coloring
    this.castShadow = opts.castShadow ?? true;
    this.receiveShadow = opts.receiveShadow ?? true;
    this.cull = opts.cull !== false;
    this.blend = opts.blend ?? false;        // alpha blending (water)
    this.depthWrite = opts.depthWrite !== false;
    this.waveAmp = opts.waveAmp ?? 1;        // water wave amplitude multiplier
  }
}
