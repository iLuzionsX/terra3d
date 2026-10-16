// Terra3D game — glue: renderer, input, camera, sky, world, vehicles, time of day.
import { Renderer } from "../engine/renderer.js";
import { Input } from "../engine/input.js";
import { Camera } from "../engine/camera.js";
import { Sky } from "../engine/sky.js";
import { Loop } from "../engine/loop.js";
import { Vec3 } from "../engine/vec3.js";
import { Mat4 } from "../engine/mat4.js";
import { clamp, DEG } from "../engine/math.js";
import { World, WORLD, QUALITY } from "../world/world.js";
import { createVehicles } from "./vehicles.js";

const CHASE_FOV = 62, COCKPIT_FOV = 70;
const CAM_MODES = ["chase", "cockpit", "orbit"];

export class Game {
  constructor(canvas, { quality = "medium", offline = false, hooks = {} } = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.quality = QUALITY[quality] ? quality : "medium";
    this.q = QUALITY[this.quality];
    this.offline = offline;

    this.renderer = new Renderer(canvas, {
      pixelRatio: this.q.pixelRatio,
      shadowSize: this.q.shadowSize,
    });
    this.input = new Input(canvas);
    this.camera = new Camera();
    this.sky = new Sky(this.renderer.gl);
    this.world = new World(this.renderer.gl, { quality: this.quality, offline });

    this.vehicles = {};
    this.active = null;
    this.camMode = "chase";
    this.look = { yaw: 0, pitch: 0, idle: 99 };
    this.orbitDist = 16;
    this.timeHours = 14.5;
    this.timeScale = 0;         // game seconds per real second
    this.elapsed = 0;           // seconds — wave/cloud clock (see water.js)
    this.paused = true;
    this.rebasing = false;
    this._rebasePromise = null;
    this.loaded = false;

    this.env = null;
    this.focus = { x: 0, y: 0, z: 0 };
    this._camPosArr = new Float32Array(3);
    this._models = [];
    this._smoothEye = new Vec3();
    this._smoothAim = new Vec3();
    this._eye = new Vec3();
    this._aim = new Vec3();
    this._aimLocal = new Vec3();
    this._up = new Vec3(0, 1, 0);
    this._camReady = false;

    this.loop = new Loop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
    });
    this.input.onEscape = () => this.pause();
  }

  /* ---------------- loading ---------------- */

  async load(lat, lon, title = "Building the world…") {
    this.hooks.onLoadStart?.(title);
    await this.world.load(lat, lon, {
      onStatus: (t, f) => this.hooks.onLoadProgress?.(t, f),
      onProgress: (f, t) => this.hooks.onLoadProgress?.(t, f),
    });
    this.vehicles = createVehicles(this.renderer.gl, this.world);
    this._spawnAll(0, 0);
    this.active = this.vehicles.car;
    this.orbitDist = Math.max(7, this.active.size.len * 2.2);
    this._camReady = false;
    this._updateEnv();
    this._updateCamera(1 / 60);
    this.loaded = true;
    this.hooks.onLoadProgress?.("ready", 1);
    return this;
  }

  start() { this.loop.start(); }
  stop() { this.loop.stop(); }

  /* ---------------- spawning ---------------- */

  /** Yaw that follows the terrain contour (level direction) at (x,z). */
  _contourYaw(x, z) {
    const hf = this.world.hf;
    if (!hf) return 0;
    const e = Math.max(3, hf.cell);
    const gx = hf.sample(x + e, z) - hf.sample(x - e, z);
    const gz = hf.sample(x, z + e) - hf.sample(x, z - e);
    if (Math.abs(gx) + Math.abs(gz) < 1e-5) return 0;
    return Math.atan2(gz, -gx);
  }

  _spawnAll(cx, cz) {
    const w = this.world;
    const { car, boat, plane } = this.vehicles;
    const AV = (v) => ({ x: v.pos.x, z: v.pos.z, r: 70 });

    const road = w.findRoadSpawn(cx, cz, w.offline ? 600 : 1500);
    const flat = w.findFlatSpot(cx, cz, 1200, 25);
    if (road) car.place(road.x, road.z, road.yaw);
    else if (flat) car.place(flat.x, flat.z, this._contourYaw(flat.x, flat.z));
    else car.place(cx, cz, 0);
    car.collide(car.radius, 0);

    // Boat: deepest water we can find; falls back to the lowest ground.
    const near = w.findLowestPoint(cx, cz, 2800);
    const far = near && near.h < -1.5 ? near : w.findLowestPoint(cx, cz, 3400);
    const water = far && far.h < -1.0 ? far : near;
    if (water) boat.place(water.x, water.z, 0);
    else boat.place(cx, cz, 0);
    boat.collide(boat.radius, 0);

    // Plane: flat ground kept clear of the car and boat. (A parked plane must
    // sit on the ground — inactive vehicles never update, so no air spawn here.)
    const pf = w.findFlatSpot(cx, cz, 1200, 25, [AV(car), AV(boat)]) || flat;
    if (pf) plane.place(pf.x, pf.z, this._contourYaw(pf.x, pf.z));
    else plane.place(cx, cz, 0);
    plane.collide(plane.radius, 0);
  }

  /** Avoid circles around every vehicle except v (parking spots stay separate). */
  _others(v) {
    const out = [];
    for (const k in this.vehicles) {
      const o = this.vehicles[k];
      if (o !== v) out.push({ x: o.pos.x, z: o.pos.z, r: 70 });
    }
    return out;
  }

  /** Move one vehicle to a good spot near (cx,cz) and stop it. */
  _relocate(v, cx, cz) {
    const w = this.world;
    const others = this._others(v);
    if (v.kind === "car") {
      const road = w.findRoadSpawn(cx, cz, 900);
      const flat = w.findFlatSpot(cx, cz, 700, 25, others);
      const p = road || flat;
      v.place(p ? p.x : cx, p ? p.z : cz, p && p.yaw !== undefined ? p.yaw : this._contourYaw(p ? p.x : cx, p ? p.z : cz));
    } else if (v.kind === "boat") {
      const low = w.findLowestPoint(cx, cz, 2800);
      v.place(low ? low.x : cx, low ? low.z : cz, 0);
    } else {
      const flat = w.findFlatSpot(cx, cz, 1100, 25, others);
      if (flat && Math.abs(flat.slope) < 0.5) v.place(flat.x, flat.z, this._contourYaw(flat.x, flat.z));
      else if (flat) v.placeAir(flat.x, flat.h + 280, flat.z, 0, 58);
      else v.place(cx, cz, 0);
    }
    v.collide(v.radius, 0);
    v.applyTransforms();
  }

  /* ---------------- per-frame ---------------- */

  update(dt) {
    const input = this.input;

    if (!this.paused) {
      if (this.timeScale > 0) this.timeHours = (this.timeHours + (this.timeScale * dt) / 3600) % 24;
      this._checkKeys(input, dt);
      if (this.active) this.active.update(dt, input, this.elapsed);
      this._updateCamera(dt);
      this.elapsed += dt;
      this._rebaseIfNeeded();
    }
    input.endFrame();
  }

  render() {
    const cw = this.canvas.clientWidth || 16;
    const ch = this.canvas.clientHeight || 9;
    this.camera.aspect = cw / ch;
    this.camera.fov = (this.camMode === "cockpit" ? COCKPIT_FOV : CHASE_FOV) * DEG;
    this.sky.updateCamera(this.camera.pos);
    const env = this._updateEnv();
    this.renderer.render(
      { models: this._sceneModels(), sky: this.sky.model },
      env,
      this.camera
    );
    this.hooks.onTick?.(this.getState());
  }

  _sceneModels() {
    const a = this._models;
    a.length = 0;
    for (const m of this.world.models) a.push(m);
    for (const k in this.vehicles) this.vehicles[k].collectModels(a);
    if (this.world.sea) a.push(this.world.sea.model);   // water drawn last
    return a;
  }

  _updateEnv() {
    const env = this.sky.computeEnvironment(this.timeHours, this.world.geo.lat0);
    env.time = this.elapsed;   // seconds — must match waveSlopes() phase
    env.waveAmp = 1;
    const p = this.camera.pos;
    const arr = this._camPosArr;
    arr[0] = p.x; arr[1] = p.y; arr[2] = p.z;
    env.camPos = arr;
    const v = this.active;
    const fx = v ? -Math.sin(v.yaw) : 0;
    const fz = v ? -Math.cos(v.yaw) : 0;
    this.focus.x = (v ? v.pos.x : p.x) + fx * 12;
    this.focus.y = (v ? v.pos.y : p.y) + 1;
    this.focus.z = (v ? v.pos.z : p.z) + fz * 12;
    env.focus = this.focus;
    env.cloudsTex = this.sky.cloudsTex;
    env.starsTex = this.sky.starsTex;
    env.heightTex = this.world.envPart.heightTex;
    env.heightRect = this.world.envPart.heightRect;
    env.heightSize = this.world.envPart.heightSize;
    this.env = env;
    return env;
  }

  /* ---------------- input actions ---------------- */

  _checkKeys(input, dt) {
    if (input.pressed("Digit1") || input.pressed("Numpad1")) this.selectVehicle("car");
    if (input.pressed("Digit2") || input.pressed("Numpad2")) this.selectVehicle("boat");
    if (input.pressed("Digit3") || input.pressed("Numpad3")) this.selectVehicle("plane");
    if (input.pressed("KeyC")) this.cycleCamera();
    if (input.pressed("KeyR")) this.resetVehicle();
    if (input.pressed("KeyH")) this.hooks.onHelp?.();
    if (input.pressed("KeyT")) this.setTime((this.timeHours + 1) % 24);
    if (input.pressed("KeyP")) this.setPaused(!this.paused);

    const md = input.consumeMouse();
    const sens = 0.0026;
    if (md.dx || md.dy) {
      this.look.yaw -= md.dx * sens;
      this.look.pitch -= md.dy * sens;
      this.look.idle = 0;
    } else {
      this.look.idle += dt;
    }
    const wheel = input.consumeWheel();
    if (wheel && this.camMode === "orbit") {
      this.orbitDist = clamp(this.orbitDist * (1 + wheel * 0.12), 3.5, 90);
    }

    // Per-mode limits + auto return to centre.
    if (this.camMode === "chase") {
      this.look.yaw = clamp(this.look.yaw, -2.6, 2.6);
      this.look.pitch = clamp(this.look.pitch, -0.45, 1.1);
      const k = 1 - Math.exp(-2.2 * dt);
      this.look.yaw -= this.look.yaw * k;
      this.look.pitch -= this.look.pitch * k;
    } else if (this.camMode === "cockpit") {
      this.look.yaw = clamp(this.look.yaw, -2.1, 2.1);
      this.look.pitch = clamp(this.look.pitch, -0.5, 0.95);
      if (this.look.idle > 1.2) {
        const k = 1 - Math.exp(-3 * dt);
        this.look.yaw -= this.look.yaw * k;
        this.look.pitch -= this.look.pitch * k;
      }
    } else {
      this.look.pitch = clamp(this.look.pitch, -0.25, 1.25);
    }
  }

  selectVehicle(kind) {
    const v = this.vehicles[kind];
    if (!v || v === this.active || !this.loaded) return;
    const cur = this.active;
    const far = cur ? cur.pos.distXZ(v.pos) : 0;
    if (cur && far > 350) {
      this._relocate(v, cur.pos.x, cur.pos.z);
      this.hooks.onToast?.(`${v.name} ready — it was ${(far / 1000).toFixed(1)} km away`);
    }
    this.active = v;
    this.camMode = "chase";
    this.look.yaw = 0; this.look.pitch = 0; this.look.idle = 99;
    this.orbitDist = Math.max(7, v.size.len * 2.2);
    this._camReady = false;
    return v;
  }

  resetVehicle() {
    const v = this.active;
    if (!v || !this.loaded) return;
    const fromX = v.pos.x, fromZ = v.pos.z;
    this._relocate(v, v.pos.x, v.pos.z);
    const moved = Math.hypot(v.pos.x - fromX, v.pos.z - fromZ);
    this._camReady = false;
    this.hooks.onToast?.(moved > 30 ? `${v.name} respawned ${Math.round(moved)} m away` : `${v.name} respawned`);
  }

  cycleCamera() {
    this._applyCamMode(CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length]);
    this.hooks.onToast?.(`${this.camMode} camera`);
  }

  /** Force a camera mode (used by the ?cam= URL parameter). */
  setCamMode(mode) {
    if (CAM_MODES.includes(mode)) this._applyCamMode(mode);
  }

  _applyCamMode(mode) {
    this.camMode = mode;
    this.look.yaw = 0;
    this.look.pitch = mode === "orbit" ? 0.2 : 0;
    this.look.idle = 99;
    this._camReady = false;
  }

  setTime(hours) {
    this.timeHours = ((hours % 24) + 24) % 24;
  }

  setTimeScale(s) { this.timeScale = Math.max(0, s); }

  pause() { this.setPaused(true); }

  setPaused(v) {
    if (this.paused === v) return;
    this.paused = v;
    this.input.setAllowLock(!v);
    if (v) document.exitPointerLock?.();
    else this.input.requestLock();
    this.hooks.onPause?.(v);
  }

  /* ---------------- camera ---------------- */

  _updateCamera(dt) {
    const v = this.active;
    if (!v) return;
    const cam = this.camera;
    const def = v.camAnchors;
    const eye = this._eye, aim = this._aim;
    let rigid = false;

    if (this.camMode === "orbit") {
      const d = this.orbitDist;
      const cp = Math.cos(this.look.pitch);
      eye.set(
        v.pos.x + Math.sin(this.look.yaw) * cp * d,
        v.pos.y + 1.4 + Math.sin(this.look.pitch) * d,
        v.pos.z + Math.cos(this.look.yaw) * cp * d
      );
      aim.set(v.pos.x, v.pos.y + 1.1, v.pos.z);
    } else if (this.camMode === "cockpit") {
      const a = def.cockpit;
      eye.set(a.eye[0], a.eye[1], a.eye[2]);
      Mat4.transformPoint(eye, v.matrix, eye);
      // Head look: rotate the aim offset in body space.
      const lp = this.look.pitch, ly = this.look.yaw;
      const cp = Math.cos(lp), sp = Math.sin(lp), cy = Math.cos(ly), sy = Math.sin(ly);
      const ax = a.aim[0], ay = a.aim[1], az = a.aim[2];
      const y1 = cp * ay - sp * az;
      const z1 = sp * ay + cp * az;
      this._aimLocal.set(cy * ax + sy * z1, y1, -sy * ax + cy * z1);
      Mat4.transformPoint(aim, v.matrix, this._aimLocal);
      Mat4.transformDir(this._up, v.matrix, UP_Y);
      rigid = true;
    } else {
      const a = def.chase;
      const yaw = v.yaw + this.look.yaw;
      const spd = Math.abs(v.speed);
      const oz = a.eye[2] + spd * (a.pull || 0);
      const oy = a.eye[1] + spd * (a.lift || 0) + Math.sin(this.look.pitch) * 5.5;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      eye.set(v.pos.x + c * a.eye[0] + s * oz, v.pos.y + oy, v.pos.z - s * a.eye[0] + c * oz);
      aim.set(v.pos.x + c * a.aim[0] + s * a.aim[2], v.pos.y + a.aim[1], v.pos.z - s * a.aim[0] + c * a.aim[2]);
      // Keep the chase camera out of the ground.
      const gy = this.world.heightAt(eye.x, eye.z);
      let minY = gy + 1.3;
      if (gy < 0.6) minY = Math.max(minY, 1.7);
      if (eye.y < minY) eye.y = minY;
      this._up.set(0, 1, 0);
    }

    if (rigid) {
      this._smoothEye.copy(eye);
      this._smoothAim.copy(aim);
    } else if (!this._camReady) {
      this._smoothEye.copy(eye);
      this._smoothAim.copy(aim);
      this._camReady = true;
    } else {
      const ke = 1 - Math.exp(-9 * dt);
      const ka = 1 - Math.exp(-12 * dt);
      this._smoothEye.x += (eye.x - this._smoothEye.x) * ke;
      this._smoothEye.y += (eye.y - this._smoothEye.y) * ke;
      this._smoothEye.z += (eye.z - this._smoothEye.z) * ke;
      this._smoothAim.x += (aim.x - this._smoothAim.x) * ka;
      this._smoothAim.y += (aim.y - this._smoothAim.y) * ka;
      this._smoothAim.z += (aim.z - this._smoothAim.z) * ka;
    }

    cam.pos.copy(this._smoothEye);
    cam.target.copy(this._smoothAim);
    cam.up.copy(this._up);
  }

  /* ---------------- streaming (rebase) ---------------- */

  _rebaseIfNeeded() {
    if (this.rebasing || !this.loaded) return;
    const v = this.active;
    if (!v) return;
    if (Math.hypot(v.pos.x, v.pos.z) < WORLD.rebaseThreshold) return;
    this.rebaseNow().catch((e) => {
      this.hooks.onStatus?.(null, 0, false);
      this.hooks.onToast?.(`Could not stream the next area: ${e.message}`);
    });
  }

  /** Rebuild the world patch around the player; shifts everything to keep
   *  positions. Reuses the in-flight rebase when one is already running. */
  rebaseNow() {
    if (this._rebasePromise) return this._rebasePromise;
    const v = this.active;
    if (!v) return Promise.resolve(null);
    this.rebasing = true;
    this._rebasePromise = this._runRebase(v).finally(() => {
      this.rebasing = false;
      this._rebasePromise = null;
    });
    return this._rebasePromise;
  }

  async _runRebase(v) {
    this.hooks.onStatus?.("streaming the next patch of planet…", 0.05, true);
    const res = await this.world.reloadAt(v.pos.x, v.pos.z, {
      onStatus: (t, f) => this.hooks.onStatus?.(t, f, true),
      onProgress: (f, t) => this.hooks.onStatus?.(t, f, true),
    });
    for (const k in this.vehicles) {
      const veh = this.vehicles[k];
      veh.pos.x += res.offsetX;
      veh.pos.z += res.offsetZ;
      veh.applyTransforms();
    }
    this._smoothEye.x += res.offsetX;
    this._smoothEye.z += res.offsetZ;
    this._smoothAim.x += res.offsetX;
    this._smoothAim.z += res.offsetZ;
    this.hooks.onStatus?.(null, 0, false);
    return res;
  }

  /* ---------------- HUD state ---------------- */

  getState() {
    const v = this.active;
    const w = this.world;
    const ll = v && w.hf ? w.geo.toLatLon(v.pos.x, v.pos.z) : { lat: 0, lon: 0 };
    const env = this.env;
    return {
      vehicle: v ? v.name : "—",
      kind: v ? v.kind : "",
      unit: v ? v.unit : "km/h",
      speed: v ? v.displaySpeed() : 0,
      speedFrac: v ? clamp(Math.abs(v.speed) / v.displayMax, 0, 1) : 0,
      altitude: v ? v.altitude() : null,
      lat: ll.lat,
      lon: ll.lon,
      heading: v ? v.headingDeg : 0,
      timeHours: this.timeHours,
      fps: this.loop.fps,
      sunElevation: env ? env.sunElevation : 0,
      night: env ? env.night : 0,
      camMode: this.camMode,
      hint: v ? v.hint : "",
      quality: this.quality,
      offline: this.offline,
      stats: this.renderer.stats,
      statsWorld: this.world.stats,
    };
  }
}

const UP_Y = new Vec3(0, 1, 0);
