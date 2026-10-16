// Terra3D — entry point: URL parameters, menu wiring, crash reporting, smoke test.
//   ?loc=nyc|london|…      pick a preset place (autostarts)
//   ?lat=…&lon=…           explicit coordinates (autostarts)
//   ?quality=low|medium|high
//   ?time=14.5             time of day in hours
//   ?offline=1             procedural terrain, no network
//   ?v=car|boat|plane      start with a specific vehicle
//   ?cam=chase|cockpit|orbit  start in a specific camera mode
//   ?smoke=1               headless self-test (offline) -> document.title = SMOKE-OK/FAIL
import { Game } from "./game/game.js";
import { Hud, LOCATIONS, formatClock } from "./hud.js";

const canvas = document.getElementById("gl");
const params = new URLSearchParams(location.search);
const smoke = params.get("smoke") === "1";
const offline = params.get("offline") === "1" || smoke;

const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const locParam = (params.get("loc") || "").toLowerCase();
const preset = LOCATIONS.find((l) => l.id === locParam) || LOCATIONS[0];
const startLat = num(params.get("lat")) ?? preset.lat;
const startLon = num(params.get("lon")) ?? preset.lon;
const startQuality = ["low", "medium", "high"].includes(params.get("quality")) ? params.get("quality") : "medium";
const startTime = num(params.get("time")) ?? 14.5;
const startVehicle = ["car", "boat", "plane"].includes(params.get("v")) ? params.get("v") : null;
const startCam = ["chase", "cockpit", "orbit"].includes(params.get("cam")) ? params.get("cam") : null;
const autostart = smoke ? false : !!(locParam && LOCATIONS.some((l) => l.id === locParam)) || num(params.get("lat")) !== null;

const hud = new Hud();
hud.selectLocation(preset);
hud.el.qualitySel.value = startQuality;
hud.el.timeInput.value = String(Math.round(startTime * 60));
hud.el.timeLabel.textContent = formatClock(startTime);

/* ---------------- crash reporting ---------------- */

function smokeOut(text) {
  document.title = text;
  let pre = document.getElementById("smokeout");
  if (!pre) {
    pre = document.createElement("pre");
    pre.id = "smokeout";
    document.body.appendChild(pre);
  }
  pre.textContent = text;
}

function reportError(msg) {
  if (smoke) {
    smokeOut(`SMOKE-FAIL ${msg}`);
    return;
  }
  hud.hideLoading();
  hud.showMenu();
  hud.setError(`Something went wrong: ${msg}`);
}

window.addEventListener("error", (e) => reportError(String((e && e.message) || "script error")));
window.addEventListener("unhandledrejection", (e) => {
  const r = e && e.reason;
  reportError(String((r && r.message) || r || "unhandled rejection"));
});

/* ---------------- normal flow ---------------- */

function makeHooks() {
  return {
    onLoadStart: (t) => hud.showLoading(t),
    onLoadProgress: (text, frac) => hud.setLoad(text, frac),
    onStatus: (text, frac, visible) => hud.setStatus(text, frac, visible),
    onToast: (msg) => hud.toast(msg),
    onPause: (p) => hud.showPause(p),
    onHelp: () => hud.toggleHelp(),
    onTick: (state) => hud.update(state),
  };
}

let game = null;

async function startGame({ lat, lon, quality, timeHours }) {
  if (game) { game.stop(); game = null; }
  hud.setStartBusy(true);
  hud.showLoading("Building the world…");
  game = new Game(canvas, { quality, offline, hooks: makeHooks() });
  window.__game = game;
  try {
    await game.load(lat, lon);
  } catch (e) {
    hud.hideLoading();
    hud.showMenu();
    hud.setStartBusy(false);
    hud.setError(
      `Could not build the world: ${e.message}. ` +
      (offline ? "Offline mode failed — reload and try again." :
        "The Overpass API is often busy; press START again, or open ?offline=1 for procedural terrain.")
    );
    return;
  }
  game.setTime(timeHours);
  if (startVehicle) game.selectVehicle(startVehicle);
  if (startCam) game.setCamMode(startCam);
  game.paused = false;
  game.input.setAllowLock(true);
  hud.setStartBusy(false);
  hud.hideLoading();
  hud.showHud();
  hud.toast("Click the view to capture the mouse · H = help · 1/2/3 = car/boat/plane", 5200);
  game.start();
}

hud.onStart = (opts) => startGame(opts);
hud.onResume = () => game?.setPaused(false);
hud.onMenu = () => location.reload();
hud.onTimeChange = (h) => game?.setTime(h);
hud.onTimeScaleChange = (s) => game?.setTimeScale(s);

if (autostart) startGame({ lat: startLat, lon: startLon, quality: startQuality, timeHours: startTime });

/* ---------------- smoke test ---------------- */

async function runSmoke() {
  document.title = "SMOKE-RUN";
  const lines = [];
  const checks = [];
  const ok = (cond, msg) => {
    checks.push({ cond: !!cond, msg });
    lines.push(`${cond ? "ok  " : "FAIL"} ${msg}`);
    if (!cond) throw new Error(msg);
  };
  const fin = (...xs) => xs.every((x) => Number.isFinite(x));

  let g = null;
  const shot = (name) => {
    try {
      const img = document.createElement("img");
      img.id = name;
      img.alt = name;
      img.src = g.renderer.gl.canvas.toDataURL("image/png");
      document.body.appendChild(img);
    } catch (e) {
      lines.push(`shot ${name} failed: ${e.message}`);
    }
  };
  try {
    g = new Game(canvas, { quality: startQuality, offline: true, hooks: {} });
    g.input.setAllowLock(false);
    lines.push(`gl: ${g.renderer.gl.getParameter(g.renderer.gl.VERSION)}`);
    await g.load(startLat, startLon);
    ok(g.world.hf, "world heightfield loaded");
    ok(g.world.models.length > 0, `world models: ${g.world.models.length}`);
    ok(g.vehicles.car && g.vehicles.boat && g.vehicles.plane, "car + boat + plane built");
    const dCP = Math.hypot(g.vehicles.car.pos.x - g.vehicles.plane.pos.x, g.vehicles.car.pos.z - g.vehicles.plane.pos.z);
    const dCB = Math.hypot(g.vehicles.car.pos.x - g.vehicles.boat.pos.x, g.vehicles.car.pos.z - g.vehicles.boat.pos.z);
    ok(dCP > 40 && dCB > 40, `spawns separated (car-plane ${dCP.toFixed(0)} m, car-boat ${dCB.toFixed(0)} m)`);
    g.paused = false;

    const dt = 1 / 60;
    const run = (n, keys, every = 0) => {
      for (let i = 0; i < n; i++) {
        g.input.testDown = keys || {};
        g.update(dt);
        if (every && i % every === 0) g.render();
      }
      g.input.testDown = null;
    };

    // ---- car ----
    const car = g.vehicles.car;
    g.selectVehicle("car");
    lines.push(`car spawn: (${car.pos.x.toFixed(0)}, ${car.pos.z.toFixed(0)}) h ${car.pos.y.toFixed(1)} m yaw ${((car.yaw * 180) / Math.PI).toFixed(0)}`);
    const c0 = { x: car.pos.x, z: car.pos.z };
    run(300, { KeyW: true }, 150);
    const dist = Math.hypot(car.pos.x - c0.x, car.pos.z - c0.z);
    lines.push(`car end: h ${car.pos.y.toFixed(1)} m, ground ${g.world.heightAt(car.pos.x, car.pos.z).toFixed(1)} m, water ${g.world.seaHeightAt(car.pos.x, car.pos.z, g.elapsed).toFixed(1)} m`);
    ok(fin(car.pos.x, car.pos.y, car.pos.z), "car position finite");
    ok(car.speed > 8, `car speed ${car.speed.toFixed(1)} m/s${car.floating ? " (floating - drove into water)" : ""}`);
    ok(dist > 40, `car travelled ${dist.toFixed(0)} m`);
    ok(car.pos.y > g.world.heightAt(car.pos.x, car.pos.z) - 0.7, "car rests on the ground");
    run(90, { KeyW: true, KeyA: true });
    ok(fin(car.yaw), "car steering ok");

    // ---- render passes ----
    g.render();
    const st = g.renderer.stats;
    ok(st.calls > 3, `draw calls: ${st.calls}`);
    ok(st.tris > 500, `triangles: ${st.tris}`);
    ok(!!g.world.sea, "sea plane present");
    shot("shot-car-chase");

    // ---- boat ----
    const boat = g.vehicles.boat;
    g.selectVehicle("boat");
    run(200, { KeyW: true }, 200);
    ok(fin(boat.pos.x, boat.pos.y, boat.pos.z), "boat position finite");
    const boatWater = g.world.seaHeightAt(boat.pos.x, boat.pos.z, g.elapsed);
    ok(Math.abs(boat.pos.y - boatWater) < 2.5, `boat floats (dy ${(boat.pos.y - boatWater).toFixed(2)} m)`);
    lines.push(`boat spot: depth ${(boatWater - g.world.heightAt(boat.pos.x, boat.pos.z)).toFixed(1)} m below sea`);
    g.render();
    shot("shot-boat-chase");

    // ---- plane: airborne flight ----
    const plane = g.vehicles.plane;
    g.selectVehicle("plane");
    plane.placeAir(plane.pos.x, g.world.heightAt(plane.pos.x, plane.pos.z) + 320, plane.pos.z, 0, 60);
    run(420, { KeyW: true }, 210);
    ok(fin(plane.pos.x, plane.pos.y, plane.pos.z), "plane position finite");
    ok(plane.speed > 20, `plane airspeed ${plane.speed.toFixed(1)} m/s`);
    ok(plane.altitude() > 5, `plane altitude ${plane.altitude().toFixed(1)} m`);

    // ---- plane: ground roll ----
    plane.place(plane.pos.x, plane.pos.z, 0);
    run(240, { KeyW: true });
    ok(plane.speed > 5, `plane rolling at ${plane.speed.toFixed(1)} m/s`);

    // ---- cameras ----
    for (const mode of ["chase", "cockpit", "orbit"]) {
      g.camMode = mode;
      g._camReady = false;
      run(4, {});
      ok(fin(g.camera.pos.x, g.camera.pos.y, g.camera.pos.z), `camera ${mode} finite (pos ${g.camera.pos.x.toFixed(1)}, ${g.camera.pos.y.toFixed(1)}, ${g.camera.pos.z.toFixed(1)})`);
      g.render();
    }
    shot("shot-plane-orbit");

    // ---- rebase / streaming ----
    const oldGeo = g.world.geo;
    const before = { x: plane.pos.x, z: plane.pos.z };
    const llBefore = oldGeo.toLatLon(before.x, before.z);
    const res = await g.rebaseNow();
    ok(res && fin(res.offsetX, res.offsetZ), "world rebased");
    const llAfter = g.world.geo.toLatLon(plane.pos.x, plane.pos.z);
    ok(
      Math.abs(llAfter.lat - llBefore.lat) < 0.0006 && Math.abs(llAfter.lon - llBefore.lon) < 0.0006,
      `geographic position kept (${llAfter.lat.toFixed(4)}, ${llAfter.lon.toFixed(4)})`
    );
    run(1, {});   // let the camera re-derive from the shifted smoothing buffers
    g.render();
    shot("shot-plane-rebased");
    lines.push(`post-rebase: cam (${g.camera.pos.x.toFixed(0)}, ${g.camera.pos.y.toFixed(0)}, ${g.camera.pos.z.toFixed(0)}) plane (${plane.pos.x.toFixed(0)}, ${plane.pos.y.toFixed(0)}, ${plane.pos.z.toFixed(0)}) dist ${plane.pos.distXZ(g.camera.pos).toFixed(1)}`);

    const fails = checks.filter((c) => !c.cond).length;
    smokeFinalise(fails === 0, [`${checks.length - fails}/${checks.length} checks passed`, ...lines]);
  } catch (e) {
    smokeFinalise(false, [`error: ${String((e && e.message) || e)}`, ...lines]);
  } finally {
    if (g) g.stop();
  }
}

function smokeFinalise(passed, lines) {
  const report = `${passed ? "SMOKE-OK" : "SMOKE-FAIL"} ${lines.slice(0, 2).join(" · ")}\n${lines.join("\n")}`;
  document.title = report.split("\n")[0];
  let pre = document.getElementById("smokeout");
  if (!pre) {
    pre = document.createElement("pre");
    pre.id = "smokeout";
    document.body.appendChild(pre);
  }
  pre.textContent = report;
}

if (smoke) {
  runSmoke();
} else {
  window.__terra = { hud, params };
}
