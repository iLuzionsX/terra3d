// Terra3D world — procedural textures drawn on canvases at load time.
// No image assets: facades, roads, foliage, ground noise are all generated.
import { canvasTexture, makeCanvas, textureFromCanvas } from "../engine/texture.js";
import { createRng, clamp } from "../engine/math.js";

export const ATLAS = {
  brickF: 0, brickS: 1, concreteF: 2, concreteS: 3,
  glassF: 4, glassS: 5, plasterF: 6, plasterS: 7,
  officeF: 8, officeS: 9,
  roofFlat: 10, roofTiles: 11,
  lightWhite: 12, lightRed: 13, lightAmber: 14, plain: 15,
};

export const ROAD_ATLAS = {
  motorway: 0, primary: 1, secondary: 2, residential: 3,
  service: 4, footway: 5, pedestrian: 6, gravel: 7,
  asphaltDark: 8, concrete: 9, asphaltPlain: 10,
};

/** Atlas cell (4x4 grid) UV origin. Returns [u0, v0]. */
export function cellUV(index) {
  return [(index % 4) / 4, 1 - (Math.floor(index / 4) + 1) / 4];
}

function speckle(ctx, x, y, w, h, rng, count, colors) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = 1 + rng() * 2.5;
    ctx.fillRect(x + rng() * w, y + rng() * h, s, s);
  }
}

function vGrad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/* ---------------- facade atlas (1024², cells 256²) ---------------- */
export function makeFacadeAtlas(gl) {
  const { canvas, ctx } = makeCanvas(1024, 1024);
  const rng = createRng(1234567);

  const C = (i) => [(i % 4) * 256, Math.floor(i / 4) * 256]; // canvas coords of cell

  // --- window drawing helper (cell-local coords) ---
  const drawWindow = (x, y, w, h, opts = {}) => {
    const frame = opts.frame || "#e8e8e4";
    // glass
    ctx.fillStyle = vGrad(ctx, x, y, x + w, y + h, [
      [0, opts.glassTop || "#3d4d5c"],
      [0.55, opts.glassBottom || "#1d2730"],
      [1, "#141a20"],
    ]);
    ctx.fillRect(x, y, w, h);
    // sky reflection streak
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + w * 0.12, y);
    ctx.lineTo(x + w * 0.42, y);
    ctx.lineTo(x + w * 0.18, y + h);
    ctx.lineTo(x + w * 0.02, y + h);
    ctx.closePath();
    ctx.fillStyle = "rgba(190,215,235,0.20)";
    ctx.fill();
    ctx.restore();
    // mullions
    ctx.fillStyle = frame;
    ctx.fillRect(x + w * 0.48, y, Math.max(2, w * 0.035), h);
    ctx.fillRect(x, y + h * 0.42, w, Math.max(2, h * 0.045));
    // frame
    ctx.strokeStyle = frame;
    ctx.lineWidth = opts.frameW || 5;
    ctx.strokeRect(x, y, w, h);
  };

  // ---- cell 0: brick facade (one 3.2m floor) ----
  {
    const [ox, oy] = C(ATLAS.brickF);
    ctx.fillStyle = "#c08560";
    ctx.fillRect(ox, oy, 256, 256);
    // brick courses
    const bh = 10, bw = 22;
    for (let row = 0; row < 256 / bh; row++) {
      for (let col = -1; col < 256 / bw + 1; col++) {
        const off = row % 2 ? bw / 2 : 0;
        const shade = 0.82 + rng() * 0.32;
        ctx.fillStyle = `rgb(${Math.floor(192 * shade)},${Math.floor(129 * shade)},${Math.floor(94 * shade)})`;
        ctx.fillRect(ox + col * bw + off + 1, oy + row * bh + 1, bw - 2, bh - 2);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(ox, oy, 256, 6);
    drawWindow(ox + 70, oy + 46, 116, 128, { frame: "#d8d0c4" });
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(ox + 66, oy + 176, 124, 7); // sill shadow
  }

  // ---- cell 1: brick storefront (4m) ----
  {
    const [ox, oy] = C(ATLAS.brickS);
    ctx.fillStyle = "#b07a58";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 260, ["rgba(0,0,0,0.08)", "rgba(255,255,255,0.07)"]);
    ctx.fillStyle = "#2c2a28";
    ctx.fillRect(ox + 4, oy + 40, 248, 216);
    // shop glass
    ctx.fillStyle = vGrad(ctx, ox, oy + 60, ox, oy + 216, [[0, "#39434c"], [0.6, "#232b31"], [1, "#171c21"]]);
    ctx.fillRect(ox + 14, oy + 60, 228, 150);
    ctx.fillStyle = "rgba(200,220,240,0.14)";
    ctx.beginPath();
    ctx.moveTo(ox + 40, oy + 60); ctx.lineTo(ox + 96, oy + 60);
    ctx.lineTo(ox + 52, oy + 210); ctx.lineTo(ox + 20, oy + 210);
    ctx.closePath(); ctx.fill();
    // door
    ctx.fillStyle = "#20262b";
    ctx.fillRect(ox + 128, oy + 74, 54, 136);
    ctx.strokeStyle = "#c9c9c4"; ctx.lineWidth = 4;
    ctx.strokeRect(ox + 128, oy + 74, 54, 136);
    ctx.fillStyle = "#d8d8d2";
    ctx.fillRect(ox + 170, oy + 138, 5, 26); // handle
    // awning
    ctx.fillStyle = "#7a4038";
    ctx.fillRect(ox + 6, oy + 44, 244, 26);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? "#86463d" : "#6f3a33";
      ctx.fillRect(ox + 8 + i * 24.4, oy + 44, 24.4, 26);
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(ox + 6, oy + 68, 244, 5);
    // sign band
    ctx.fillStyle = "#3a3a3e";
    ctx.fillRect(ox + 6, oy + 4, 244, 34);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(${220 + rng() * 30},${200 + rng() * 40},${160 + rng() * 60},0.75)`;
      ctx.fillRect(ox + 18 + i * 38, oy + 14, 12 + rng() * 14, 12);
    }
  }

  // ---- cell 2: concrete facade ----
  {
    const [ox, oy] = C(ATLAS.concreteF);
    ctx.fillStyle = "#c9cbcd";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 420, ["rgba(0,0,0,0.05)", "rgba(255,255,255,0.06)", "rgba(120,124,128,0.10)"]);
    ctx.fillStyle = "rgba(0,0,0,0.13)";
    ctx.fillRect(ox, oy, 256, 10);          // slab line
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(ox, oy + 10, 256, 3);
    drawWindow(ox + 52, oy + 52, 152, 120, { frame: "#b9bcbf" });
    // balcony railing
    ctx.fillStyle = "rgba(60,64,70,0.85)";
    ctx.fillRect(ox + 40, oy + 182, 176, 4);
    for (let i = 0; i < 18; i++) ctx.fillRect(ox + 44 + i * 10, oy + 150, 2.5, 34);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(ox + 40, oy + 186, 176, 6); // railing shadow
  }

  // ---- cell 3: concrete storefront ----
  {
    const [ox, oy] = C(ATLAS.concreteS);
    ctx.fillStyle = "#b8babd";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 200, ["rgba(0,0,0,0.05)", "rgba(255,255,255,0.06)"]);
    ctx.fillStyle = "#2e3134";
    ctx.fillRect(ox + 4, oy + 42, 248, 214);
    ctx.fillStyle = vGrad(ctx, ox, oy + 62, ox, oy + 224, [[0, "#414c56"], [0.6, "#262e35"], [1, "#181d22"]]);
    ctx.fillRect(ox + 16, oy + 62, 224, 156);
    ctx.fillStyle = "rgba(205,225,245,0.13)";
    ctx.beginPath();
    ctx.moveTo(ox + 34, oy + 62); ctx.lineTo(ox + 84, oy + 62);
    ctx.lineTo(ox + 46, oy + 218); ctx.lineTo(ox + 16, oy + 218);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#9fa3a7"; ctx.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + 16 + i * 56, oy + 62);
      ctx.lineTo(ox + 16 + i * 56, oy + 218);
      ctx.stroke();
    }
    ctx.fillStyle = "#d5d7d9";
    ctx.fillRect(ox + 4, oy + 4, 248, 30);
    ctx.fillStyle = "#5a5e62";
    for (let i = 0; i < 5; i++) ctx.fillRect(ox + 26 + i * 44, oy + 13, 20 + rng() * 10, 12);
  }

  // ---- cell 4: glass curtain wall ----
  {
    const [ox, oy] = C(ATLAS.glassF);
    ctx.fillStyle = vGrad(ctx, ox, oy, ox + 256, oy + 256, [[0, "#2e4356"], [0.5, "#22323f"], [1, "#18242d"]]);
    ctx.fillRect(ox, oy, 256, 256);
    // spandrel band
    ctx.fillStyle = "#151c22";
    ctx.fillRect(ox, oy + 214, 256, 42);
    // mullions
    ctx.fillStyle = "rgba(160,175,185,0.85)";
    for (let i = 0; i <= 6; i++) ctx.fillRect(ox + i * 42.6 - 1.5, oy, 3, 256);
    ctx.fillRect(ox, oy, 256, 3);
    // reflection streaks
    ctx.fillStyle = "rgba(200,225,245,0.10)";
    ctx.beginPath();
    ctx.moveTo(ox + 30, oy + 256); ctx.lineTo(ox + 120, oy);
    ctx.lineTo(ox + 190, oy); ctx.lineTo(ox + 100, oy + 256);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(ox, oy + 100, 256, 26);
  }

  // ---- cell 5: glass lobby storefront ----
  {
    const [ox, oy] = C(ATLAS.glassS);
    ctx.fillStyle = "#1a232b";
    ctx.fillRect(ox, oy, 256, 256);
    ctx.fillStyle = vGrad(ctx, ox, oy + 20, ox, oy + 250, [[0, "#3b4d5c"], [0.55, "#242e36"], [1, "#141a1f"]]);
    ctx.fillRect(ox + 10, oy + 20, 236, 226);
    ctx.fillStyle = "rgba(210,230,250,0.16)";
    ctx.beginPath();
    ctx.moveTo(ox + 26, oy + 20); ctx.lineTo(ox + 80, oy + 20);
    ctx.lineTo(ox + 42, oy + 246); ctx.lineTo(ox + 14, oy + 246);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(150,165,178,0.9)";
    for (let i = 0; i <= 4; i++) ctx.fillRect(ox + 10 + i * 59 - 1.5, oy + 20, 3, 226);
    ctx.fillStyle = "#0f1418";
    ctx.fillRect(ox, oy, 256, 20);
    ctx.fillStyle = "#d8dde0";
    for (let i = 0; i < 4; i++) ctx.fillRect(ox + 30 + i * 52, oy + 6, 22, 8);
  }

  // ---- cell 6: plaster / classic ----
  {
    const [ox, oy] = C(ATLAS.plasterF);
    ctx.fillStyle = "#e3ded2";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 300, ["rgba(0,0,0,0.04)", "rgba(255,255,255,0.06)", "rgba(150,140,120,0.06)"]);
    // cornice
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(ox, oy, 256, 12);
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.fillRect(ox, oy + 12, 256, 4);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(ox, oy + 244, 256, 12);
    drawWindow(ox + 80, oy + 42, 96, 148, { frame: "#f2efe8", glassTop: "#46586a", glassBottom: "#202b35" });
    // window pediment
    ctx.fillStyle = "#d6d0c2";
    ctx.fillRect(ox + 72, oy + 32, 112, 12);
    ctx.fillStyle = "rgba(0,0,0,0.13)";
    ctx.fillRect(ox + 76, oy + 190, 104, 7);
  }

  // ---- cell 7: plaster storefront ----
  {
    const [ox, oy] = C(ATLAS.plasterS);
    ctx.fillStyle = "#d8d2c4";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 200, ["rgba(0,0,0,0.04)", "rgba(255,255,255,0.05)"]);
    ctx.fillStyle = "#31302e";
    ctx.fillRect(ox + 6, oy + 46, 244, 210);
    ctx.fillStyle = vGrad(ctx, ox, oy + 66, ox, oy + 222, [[0, "#3c4852"], [0.6, "#242c33"], [1, "#161b20"]]);
    ctx.fillRect(ox + 18, oy + 66, 220, 152);
    ctx.strokeStyle = "#cfcabe"; ctx.lineWidth = 4;
    ctx.strokeRect(ox + 18, oy + 66, 220, 152);
    ctx.fillStyle = "rgba(210,230,250,0.12)";
    ctx.beginPath();
    ctx.moveTo(ox + 40, oy + 66); ctx.lineTo(ox + 90, oy + 66);
    ctx.lineTo(ox + 50, oy + 216); ctx.lineTo(ox + 22, oy + 216);
    ctx.closePath(); ctx.fill();
    // awning (green)
    ctx.fillStyle = "#3f5e46";
    ctx.fillRect(ox + 8, oy + 48, 240, 24);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? "#47694e" : "#38543f";
      ctx.fillRect(ox + 10 + i * 24, oy + 48, 24, 24);
    }
    ctx.fillStyle = "#efe9dc";
    ctx.fillRect(ox + 6, oy + 4, 244, 36);
    ctx.fillStyle = "#6a635a";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("CAF\u00c9 \u00b7 BAR", ox + 62, oy + 32);
  }

  // ---- cell 8: modern office ----
  {
    const [ox, oy] = C(ATLAS.officeF);
    ctx.fillStyle = "#d3c8b6";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 260, ["rgba(0,0,0,0.04)", "rgba(255,255,255,0.06)"]);
    ctx.fillStyle = "#c2b7a4";
    ctx.fillRect(ox, oy, 256, 18);
    ctx.fillStyle = vGrad(ctx, ox, oy + 54, ox, oy + 148, [[0, "#31404d"], [1, "#1b242c"]]);
    ctx.fillRect(ox + 12, oy + 54, 232, 96);
    ctx.fillStyle = "rgba(170,185,196,0.9)";
    for (let i = 0; i <= 5; i++) ctx.fillRect(ox + 12 + i * 46.4 - 1.5, oy + 54, 3, 96);
    ctx.fillStyle = "rgba(200,225,245,0.10)";
    ctx.beginPath();
    ctx.moveTo(ox + 40, oy + 150); ctx.lineTo(ox + 110, oy + 54);
    ctx.lineTo(ox + 150, oy + 54); ctx.lineTo(ox + 80, oy + 150);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(ox, oy + 150, 256, 8);
  }

  // ---- cell 9: office storefront ----
  {
    const [ox, oy] = C(ATLAS.officeS);
    ctx.fillStyle = "#c7bcaa";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 180, ["rgba(0,0,0,0.04)"]);
    ctx.fillStyle = "#23282c";
    ctx.fillRect(ox + 4, oy + 40, 248, 216);
    ctx.fillStyle = vGrad(ctx, ox, oy + 60, ox, oy + 226, [[0, "#3a4650"], [0.6, "#232b32"], [1, "#151a1f"]]);
    ctx.fillRect(ox + 14, oy + 60, 228, 156);
    ctx.fillStyle = "rgba(150,165,178,0.9)";
    ctx.fillRect(ox + 126, oy + 60, 4, 156);
    ctx.fillStyle = "rgba(205,225,245,0.12)";
    ctx.beginPath();
    ctx.moveTo(ox + 30, oy + 60); ctx.lineTo(ox + 76, oy + 60);
    ctx.lineTo(ox + 40, oy + 216); ctx.lineTo(ox + 16, oy + 216);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e3ded2";
    ctx.fillRect(ox + 4, oy + 4, 248, 32);
    ctx.fillStyle = "#4a4e52";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("OFFICES", ox + 84, oy + 28);
  }

  // ---- cell 10: flat roof ----
  {
    const [ox, oy] = C(ATLAS.roofFlat);
    ctx.fillStyle = "#5d6165";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 700, ["rgba(0,0,0,0.09)", "rgba(255,255,255,0.05)", "rgba(90,95,100,0.2)"]);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * 64, oy); ctx.lineTo(ox + i * 64, oy + 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + i * 64); ctx.lineTo(ox + 256, oy + i * 64); ctx.stroke();
    }
    // AC units
    for (const [ax, ay, w, h] of [[30, 40, 52, 40], [150, 150, 60, 46], [60, 190, 40, 34]]) {
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(ox + ax + 5, oy + ay + 5, w, h);
      ctx.fillStyle = "#8b9095";
      ctx.fillRect(ox + ax, oy + ay, w, h);
      ctx.fillStyle = "#6f747a";
      ctx.fillRect(ox + ax + 4, oy + ay + 4, w - 8, h - 8);
      ctx.fillStyle = "#9aa0a6";
      ctx.beginPath();
      ctx.arc(ox + ax + w / 2, oy + ay + h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // vents
    for (let i = 0; i < 5; i++) {
      const vx = ox + 100 + rng() * 130, vy = oy + 20 + rng() * 200;
      ctx.fillStyle = "#404448";
      ctx.beginPath(); ctx.arc(vx, vy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8d9298";
      ctx.beginPath(); ctx.arc(vx, vy, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- cell 11: tiled roof ----
  {
    const [ox, oy] = C(ATLAS.roofTiles);
    ctx.fillStyle = "#8a4f3e";
    ctx.fillRect(ox, oy, 256, 256);
    const th = 16;
    for (let row = 0; row < 256 / th; row++) {
      for (let col = -1; col < 256 / 24 + 1; col++) {
        const off = row % 2 ? 12 : 0;
        const shade = 0.85 + rng() * 0.3;
        ctx.fillStyle = `rgb(${Math.floor(138 * shade)},${Math.floor(79 * shade)},${Math.floor(62 * shade)})`;
        ctx.fillRect(ox + col * 24 + off + 1, oy + row * th + 2, 22, th - 4);
      }
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(ox, oy + row * th, 256, 3);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(ox, oy + row * th + 3, 256, 2);
    }
    speckle(ctx, ox, oy, 256, 256, rng, 260, ["rgba(0,0,0,0.10)", "rgba(255,255,255,0.05)"]);
  }

  // ---- cells 12-14: light glows ----
  const glow = (index, color) => {
    const [ox, oy] = C(index);
    ctx.clearRect(ox, oy, 256, 256);
    const g = ctx.createRadialGradient(ox + 128, oy + 128, 8, ox + 128, oy + 128, 120);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color.replace("1)", "0.55)"));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 256, 256);
  };
  glow(ATLAS.lightWhite, "rgba(255,255,255,1)");
  glow(ATLAS.lightRed, "rgba(255,60,40,1)");
  glow(ATLAS.lightAmber, "rgba(255,190,90,1)");

  // ---- cell 15: plain ----
  {
    const [ox, oy] = C(ATLAS.plain);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ox, oy, 256, 256);
  }

  return textureFromCanvas(gl, canvas, { repeat: true, srgb: true, mipmap: true });
}

/* ---------------- road atlas (1024², 4x4 cells) ---------------- */
export function makeRoadAtlas(gl) {
  const { canvas, ctx } = makeCanvas(1024, 1024);
  const rng = createRng(987654);
  const C = (i) => [(i % 4) * 256, Math.floor(i / 4) * 256];

  const asphalt = (ox, oy, base = "#3d4045") => {
    ctx.fillStyle = base;
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 900, ["rgba(255,255,255,0.05)", "rgba(0,0,0,0.12)", "rgba(70,74,80,0.35)"]);
  };
  const edgeLines = (ox, oy, alpha = 0.8) => {
    ctx.fillStyle = `rgba(216,220,222,${alpha})`;
    ctx.fillRect(ox + 2, oy, 5, 256);
    ctx.fillRect(ox + 249, oy, 5, 256);
  };
  const dash = (ox, x, w, y0, len, color = "rgba(220,224,226,0.9)") => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, y0, w, len);
  };

  // 0 motorway: two dashed lane lines + edges
  {
    const [ox, oy] = C(ROAD_ATLAS.motorway);
    asphalt(ox, oy, "#3a3d42");
    edgeLines(ox, oy);
    dash(ox, 82, 6, oy + 20, 105);
    dash(ox, 168, 6, oy + 130, 105);
  }
  // 1 primary: center dashed + edges
  {
    const [ox, oy] = C(ROAD_ATLAS.primary);
    asphalt(ox, oy, "#3d4045");
    edgeLines(ox, oy, 0.7);
    dash(ox, 125, 6, oy + 15, 110);
  }
  // 2 secondary
  {
    const [ox, oy] = C(ROAD_ATLAS.secondary);
    asphalt(ox, oy, "#3f4247");
    edgeLines(ox, oy, 0.55);
    dash(ox, 125, 5, oy + 45, 90, "rgba(220,224,226,0.75)");
  }
  // 3 residential: faint edges only
  {
    const [ox, oy] = C(ROAD_ATLAS.residential);
    asphalt(ox, oy, "#42454a");
    edgeLines(ox, oy, 0.35);
  }
  // 4 service: plain
  {
    const [ox, oy] = C(ROAD_ATLAS.service);
    asphalt(ox, oy, "#47484c");
    speckle(ctx, ox, oy, 256, 256, rng, 500, ["rgba(120,110,95,0.10)"]);
  }
  // 5 footway: concrete slabs
  {
    const [ox, oy] = C(ROAD_ATLAS.footway);
    ctx.fillStyle = "#9aa0a3";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 700, ["rgba(0,0,0,0.05)", "rgba(255,255,255,0.05)"]);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(ox, oy + i * 64); ctx.lineTo(ox + 256, oy + i * 64); ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(ox, oy, 3, 256);
    ctx.fillRect(ox + 253, oy, 3, 256);
  }
  // 6 pedestrian: brick paving
  {
    const [ox, oy] = C(ROAD_ATLAS.pedestrian);
    ctx.fillStyle = "#9c7f72";
    ctx.fillRect(ox, oy, 256, 256);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const s = 0.86 + rng() * 0.26;
        ctx.fillStyle = `rgb(${Math.floor(156 * s)},${Math.floor(127 * s)},${Math.floor(114 * s)})`;
        ctx.fillRect(ox + col * 32 + 1, oy + row * 32 + 1, 30, 30);
      }
    }
  }
  // 7 gravel track
  {
    const [ox, oy] = C(ROAD_ATLAS.gravel);
    ctx.fillStyle = "#8f8674";
    ctx.fillRect(ox, oy, 256, 256);
    speckle(ctx, ox, oy, 256, 256, rng, 1600, ["rgba(0,0,0,0.14)", "rgba(255,255,255,0.10)", "rgba(110,100,80,0.4)"]);
  }
  // 8.. plain asphalt variants
  const plains = [[ROAD_ATLAS.asphaltDark, "#34373b"], [ROAD_ATLAS.concrete, "#8f9296"], [ROAD_ATLAS.asphaltPlain, "#41444a"]];
  for (const [idx, color] of plains) {
    const [ox, oy] = C(idx);
    asphalt(ox, oy, color);
  }
  // fill remaining cells (11..15)
  for (let i = 11; i < 16; i++) {
    const [ox, oy] = C(i);
    asphalt(ox, oy, "#3f4247");
  }

  return textureFromCanvas(gl, canvas, { repeat: true, srgb: true, mipmap: true });
}

/* ---------------- ground noise (grayscale) ---------------- */
export function makeGroundNoise(gl) {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const rng = createRng(555);

  // Seamlessly tileable value-noise fbm: lattice hash wraps at the octave
  // size, so the 512px tile repeats without visible seams or wave patterns.
  const hash = (ix, iy, n, seed) => {
    const x = ((ix % n) + n) % n, y = ((iy % n) + n) % n;
    let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(n + seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const vnoise = (fx, fy, n, seed) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = hash(x0, y0, n, seed), b = hash(x0 + 1, y0, n, seed);
    const c = hash(x0, y0 + 1, n, seed), d = hash(x0 + 1, y0 + 1, n, seed);
    const top = a + (b - a) * tx, bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  };

  const OCT = [4, 8, 16, 32, 64, 128];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let n = 0, amp = 0.5, tot = 0;
      for (let o = 0; o < OCT.length; o++) {
        const m = OCT[o];
        n += vnoise((x * m) / S, (y * m) / S, m, 101 + o * 17) * amp;
        tot += amp;
        amp *= 0.55;
      }
      n /= tot;
      const s = rng() < 0.05 ? (rng() - 0.5) * 0.5 : 0;
      const v = Math.round(clamp(0.91 + (n - 0.5) * 0.34 + s, 0, 1) * 255);
      const i = (y * S + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return textureFromCanvas(gl, canvas, { repeat: true, srgb: true, mipmap: true });
}

/* ---------------- foliage atlas (2x2 cells, trees) ---------------- */
export function makeTreeAtlas(gl) {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rng = createRng(31337);

  const canopy = (cx, cy, r, colors, count = 34) => {
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const rad = Math.pow(rng(), 0.6) * r * 0.75;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad * 0.82;
      const cr = r * (0.22 + rng() * 0.26);
      ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
      ctx.beginPath();
      ctx.arc(x, y, cr, 0, Math.PI * 2);
      ctx.fill();
    }
    // top-left light
    for (let i = 0; i < 10; i++) {
      const x = cx - r * 0.4 + rng() * r * 0.7;
      const y = cy - r * 0.45 + rng() * r * 0.5;
      ctx.fillStyle = "rgba(255,255,240,0.10)";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const trunk = (cx, y0, y1, w, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(cx - w / 2, y0, w, y1 - y0);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(cx + w * 0.1, y0, w * 0.4, y1 - y0);
  };

  // cell 0 (top-left): broadleaf
  canopy(128, 118, 92, ["#3e6b34", "#4a7a3c", "#57854a", "#356030", "#4f7f42"]);
  trunk(128, 170, 256, 15, "#5a4632");
  // cell 1 (top-right): conifer
  {
    for (let i = 0; i < 3; i++) {
      const y = 60 + i * 52;
      const w = 66 + i * 30;
      ctx.fillStyle = ["#2f5233", "#39603a", "#446a42"][i];
      ctx.beginPath();
      ctx.moveTo(128 + 256, y - 26);
      ctx.lineTo(128 + 256 - w, y + 60);
      ctx.lineTo(128 + 256 + w, y + 60);
      ctx.closePath();
      ctx.fill();
    }
    speckle(ctx, 256 + 60, 40, 140, 190, rng, 300, ["rgba(20,40,20,0.25)", "rgba(120,160,110,0.20)"]);
    trunk(384, 200, 256, 13, "#4c3b2a");
  }
  // cell 2 (bottom-left): autumn
  canopy(128, 118, 90, ["#a86a35", "#8a5a2c", "#b98246", "#7a5026"]);
  trunk(128, 172, 256, 14, "#59462f");
  // cell 3 (bottom-right): bush
  canopy(384, 190, 62, ["#4a6b3a", "#547a42", "#3f5e33"], 24);

  return textureFromCanvas(gl, canvas, { repeat: false, srgb: true, mipmap: true });
}
