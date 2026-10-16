// Terra3D engine — textures from procedurally drawn canvases.

export function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: false }) };
}

let _anisoExt = null;
let _anisoMax = 1;

function aniso(gl) {
  if (_anisoExt === null) {
    _anisoExt = gl.getExtension("EXT_texture_filter_anisotropic") || false;
    if (_anisoExt) _anisoMax = gl.getParameter(_anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  }
  return _anisoExt;
}

/**
 * Upload a canvas as a 2D texture.
 * opts: { repeat, srgb, mipmap, anisoLevel, flipY }
 */
export function textureFromCanvas(gl, canvas, opts = {}) {
  const { repeat = true, srgb = true, mipmap = true } = opts;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (srgb) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  const ext = aniso(gl);
  if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, _anisoMax));
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/** Build a texture from a draw callback. */
export function canvasTexture(gl, w, h, drawFn, opts = {}) {
  const { canvas, ctx } = makeCanvas(w, h);
  drawFn(ctx, w, h);
  return textureFromCanvas(gl, canvas, opts);
}

/** 1x1 white texture used when a material has no texture. */
export function whiteTexture(gl) {
  return canvasTexture(gl, 2, 2, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 2, 2);
  }, { repeat: false, srgb: true });
}

/** Single-channel float texture (terrain heights for water depth). */
export function r32fTexture(gl, data, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}
