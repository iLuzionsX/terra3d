// Terra3D game — vehicles: shared base + car / boat / plane physics.
// Conventions: models face -Z, yaw 0 = north, forward = (-sin yaw, 0, -cos yaw),
// yaw grows counter-clockwise (left). x = east, z = south, y = up.
import { Vec3 } from "../engine/vec3.js";
import { Mat4 } from "../engine/mat4.js";
import { clamp, damp, moveTowards, RAD } from "../engine/math.js";
import { waveSlopes } from "../engine/water.js";
import { makeVehicleMaterials, buildCar, buildBoat, buildPlane } from "./vehicleModels.js";

const G = 9.81;
const TAU = Math.PI * 2;

const _f = new Vec3(), _r = new Vec3(), _n = new Vec3(), _off = new Vec3();

export class Vehicle {
  constructor(world, opts) {
    this.world = world;
    this.kind = opts.kind;
    this.name = opts.name;
    this.unit = opts.unit;
    this.parts = opts.built.parts;
    this.size = opts.built.size;
    this.radius = opts.radius ?? 1.2;
    this.maxSpeed = opts.maxSpeed ?? 40;
    this.displayScale = opts.displayScale ?? 3.6;
    this.displayMax = opts.displayMax ?? 200;
    this.hint = opts.hint || "";

    this.pos = new Vec3(0, 0, 0);
    this.vel = new Vec3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;            // signed speed along the heading (m/s)
    this.matrix = new Mat4();
    this.anim = { spin: 0, steer: 0, prop: 0 };
    this.onGround = true;
    this.airborne = false;
    this.hitWall = false;

    this.camAnchors = {
      chase: { eye: [0, 2.3, 6.4], aim: [0, 1.0, -8], pull: 0.05, lift: 0.02 },
      cockpit: { eye: [0, 1.2, -0.3], aim: [0, 1.1, -12] },
    };

    this._m = new Mat4();
    this._m2 = new Mat4();
    this._f1 = new Vec3();
    this._f2 = new Vec3();
    this._r2 = new Vec3();
    this._wave = { h: 0, dhx: 0, dhz: 0 };
    this._hit = { hit: false, nx: 0, nz: 0, pen: 0 };
  }

  /* ---------- small helpers ---------- */

  get headingDeg() { return ((-this.yaw * RAD) % 360 + 360) % 360; }
  displaySpeed() { return Math.abs(this.speed) * this.displayScale; }
  altitude() { return null; }

  flatForward(out = _f) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out = _r) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  fullForward(out = _f) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Circle-vs-building collision; pushes out and damps the impact velocity. */
  collide(r = this.radius, bounce = 1.4) {
    const out = this.world.collideBuildings(this.pos.x, this.pos.z, r, this.pos.y, this._hit);
    if (out.hit) {
      this.pos.x += out.nx * out.pen;
      this.pos.z += out.nz * out.pen;
      const vn = this.vel.x * out.nx + this.vel.z * out.nz;
      if (vn < 0) {
        this.vel.x -= out.nx * vn * bounce;
        this.vel.z -= out.nz * vn * bounce;
        this.hitWall = true;
      }
    }
    return out.hit;
  }

  _resetState() {
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.pitch = 0;
    this.roll = 0;
    this.anim.spin = 0;
    this.anim.steer = 0;
    this.anim.prop = 0;
    this.hitWall = false;
  }

  /** Default placement: on the terrain. */
  place(x, z, yaw = 0) {
    this._resetState();
    this.pos.set(x, this.world.heightAt(x, z), z);
    this.yaw = yaw;
    this.applyTransforms();
    return this;
  }

  /** Write part matrices from pos/yaw/pitch/roll + per-part animation. */
  applyTransforms() {
    this.matrix.fromCompose(this.pos, this.yaw, this.pitch, this.roll);
    for (const part of this.parts) {
      const dst = part.model.matrix;
      if (part.kind === "body") { dst.set(this.matrix.m); continue; }
      const lm = part.local.m;
      _off.set(lm[12], lm[13], lm[14]);
      if (part.kind === "wheel") {
        this._m.fromCompose(_off, part.steer ? this.anim.steer : 0, this.anim.spin, 0);
      } else if (part.kind === "prop") {
        this._m.fromCompose(_off, 0, 0, this.anim.prop);
      } else {
        this._m.fromCompose(_off, 0, 0, 0);
      }
      this._m2.copy(this.matrix).multiply(this._m);
      dst.set(this._m2.m);
    }
  }

  /** All GPU models of this vehicle (added to the render scene). */
  collectModels(into) {
    for (const p of this.parts) into.push(p.model);
    return into;
  }
}

/* ------------------------------------------------------------------ */
/* car                                                                 */
/* ------------------------------------------------------------------ */

export class Car extends Vehicle {
  constructor(world, built) {
    super(world, {
      kind: "car", name: "Sports car", unit: "km/h", built,
      radius: 1.15, maxSpeed: 52, displayScale: 3.6, displayMax: 200,
      hint: "<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · <kbd>Space</kbd> handbrake · <kbd>C</kbd> view · <kbd>R</kbd> respawn",
    });
    this.wheelBase = 2.82;
    this.wheelRadius = 0.33;
    this.steer = 0;
    this.floating = false;
    this.camAnchors = {
      chase: { eye: [0, 2.25, 6.3], aim: [0, 1.0, -7], pull: 0.055, lift: 0.018 },
      cockpit: { eye: [-0.36, 1.2, -0.36], aim: [-0.12, 1.1, -14] },
    };
  }

  update(dt, input, time) {
    const w = this.world;
    const throttle = input.isDown("KeyW") || input.isDown("ArrowUp");
    const brake = input.isDown("KeyS") || input.isDown("ArrowDown");
    const left = input.isDown("KeyA") || input.isDown("ArrowLeft");
    const right = input.isDown("KeyD") || input.isDown("ArrowRight");
    const hand = input.isDown("Space");

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vR = this.vel.x * rx + this.vel.z * rz;

    // Steering (speed-sensitive).
    const steerInput = (left ? 1 : 0) - (right ? 1 : 0);
    const maxSteer = 0.6 / (1 + Math.abs(vF) / 28);
    this.steer = damp(this.steer, steerInput * maxSteer, 9, dt);

    // Surface: how deep is the water here?
    const waterY = w.seaHeightAt(this.pos.x, this.pos.z, time);
    const gy = w.heightAt(this.pos.x, this.pos.z);
    const depth = waterY - gy;
    this.floating = depth > 0.95;

    // Longitudinal forces.
    let acc = 0;
    if (!this.floating) {
      if (throttle) acc += 12 * clamp(1 - vF / (this.maxSpeed * 1.15), 0, 1);
      if (brake) {
        if (vF > 0.6) acc -= 13;
        else acc -= 6.2 * clamp(1 + vF / 14, 0, 1);
      }
      const cs = 3.2;
      const hF = w.heightAt(this.pos.x + fx * cs, this.pos.z + fz * cs);
      const hB = w.heightAt(this.pos.x - fx * cs, this.pos.z - fz * cs);
      const slope = clamp((hF - hB) / (2 * cs), -2, 2);
      acc -= G * slope * 0.75;
      acc -= 0.0005 * vF * Math.abs(vF);
      vF = moveTowards(vF, 0, (throttle || brake ? 0.35 : 1.7) * dt);
      if (hand) vF = moveTowards(vF, 0, 12 * dt);
    } else {
      // Buoyant crawl: heavy drag, limited thrust.
      if (throttle) acc += 3.0 * clamp(1 - vF / 6, 0, 1);
      if (brake) acc -= 2.0 * clamp(1 + vF / 4, 0, 1);
      acc -= 1.7 * vF;
    }
    vF += acc * dt;

    // Lateral grip (low when handbraking, near-full in water).
    const grip = this.floating ? 6 : hand ? 2.4 : 9;
    vR -= vR * (1 - Math.exp(-grip * dt));

    // Yaw.
    if (!this.floating) {
      let yawRate = (vF / this.wheelBase) * Math.tan(this.steer);
      const cap = Math.abs(vF) > 1 ? (hand ? 5.0 : 8.5) / Math.abs(vF) : 2.2;
      yawRate = clamp(yawRate, -cap, cap);
      this.yaw += yawRate * dt;
    } else {
      this.yaw += this.steer * clamp(Math.abs(vF), 0, 6) * 0.16 * dt;
    }

    this.vel.x = fx * vF + rx * vR;
    this.vel.z = fz * vF + rz * vR;
    this.vel.y = 0;

    if (this.floating) {
      this.pos.y = damp(this.pos.y, waterY - 0.62, 6, dt);
    } else {
      const prevX = this.pos.x, prevZ = this.pos.z;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      const gy2 = w.heightAt(this.pos.x, this.pos.z);
      if (gy2 - gy > 1.5) {
        // Too steep to climb: treat as a wall.
        this.pos.x = prevX; this.pos.z = prevZ;
        this.vel.x *= 0.2; this.vel.z *= 0.2;
        this.hitWall = true;
      }
      const targetY = w.heightAt(this.pos.x, this.pos.z);
      this.pos.y = damp(this.pos.y, targetY, 22, dt);
      if (this.pos.y < targetY) this.pos.y = targetY;
    }

    this.collide();

    // Visual attitude follows the terrain surface.
    const n = w.normalAt(this.pos.x, this.pos.z, _n);
    const pitchT = -Math.asin(clamp(n.x * fx + n.z * fz, -1, 1)) + clamp(acc, -12, 12) * 0.006;
    const rollT = -Math.asin(clamp(n.x * rx + n.z * rz, -1, 1));
    this.pitch = damp(this.pitch, pitchT, 7, dt);
    this.roll = damp(this.roll, rollT, 7, dt);

    this.speed = vF;
    this.anim.spin = (this.anim.spin + (vF / this.wheelRadius) * dt) % TAU;
    this.anim.steer = this.steer;
    this.applyTransforms();
  }
}

/* ------------------------------------------------------------------ */
/* boat                                                                */
/* ------------------------------------------------------------------ */

export class Boat extends Vehicle {
  constructor(world, built) {
    super(world, {
      kind: "boat", name: "Motorboat", unit: "kn", built,
      radius: 1.5, maxSpeed: 19, displayScale: 1.9438, displayMax: 40,
      hint: "<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> helm · <kbd>C</kbd> view · <kbd>R</kbd> respawn",
    });
    this.length = 6.4;
    this.steer = 0;
    this.aground = false;
    this.camAnchors = {
      chase: { eye: [0, 3.3, 8.2], aim: [0, 1.0, -7], pull: 0.06, lift: 0.03 },
      cockpit: { eye: [0, 1.76, 0.9], aim: [0, 1.5, -16] },
    };
  }

  place(x, z, yaw = 0) {
    this._resetState();
    const waterY = this.world.seaHeightAt(x, z, 0);
    const gy = this.world.heightAt(x, z);
    this.pos.set(x, Math.max(waterY - 0.14, gy), z);
    this.yaw = yaw;
    this.applyTransforms();
    return this;
  }

  update(dt, input, time) {
    const w = this.world;
    const throttle = input.isDown("KeyW") || input.isDown("ArrowUp");
    const brake = input.isDown("KeyS") || input.isDown("ArrowDown");
    const left = input.isDown("KeyA") || input.isDown("ArrowLeft");
    const right = input.isDown("KeyD") || input.isDown("ArrowRight");

    const wv = waveSlopes(this.pos.x, this.pos.z, time, 1, this._wave);
    const gy = w.heightAt(this.pos.x, this.pos.z);
    this.aground = wv.h - gy < 0.5;

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vR = this.vel.x * rx + this.vel.z * rz;

    const steerInput = (left ? 1 : 0) - (right ? 1 : 0);
    this.steer = damp(this.steer, steerInput * 0.55, 4, dt);

    let acc = 0;
    if (!this.aground) {
      if (throttle) acc += 7.6 * clamp(1 - vF / this.maxSpeed, 0, 1);
      if (brake) {
        if (vF > 0.5) acc -= 6.0;
        else acc -= 3.2 * clamp(1 + vF / 6, 0, 1);
      }
      acc -= 0.019 * vF * Math.abs(vF);
      vF = moveTowards(vF, 0, (throttle || brake ? 0.25 : 0.9) * dt);
    } else {
      if (throttle) acc += 1.6;
      acc -= 3.2 * vF;
    }
    vF += acc * dt;

    const grip = this.aground ? 6 : 0.9;
    vR -= vR * (1 - Math.exp(-grip * dt));

    let yawRate = (vF / (this.length * 0.5)) * Math.tan(this.steer);
    const cap = Math.abs(vF) > 0.8 ? 4.2 / Math.abs(vF) : 0.9;
    this.yaw += clamp(yawRate, -cap, cap) * dt;

    // Buoyancy: critically-damped spring toward the wave surface.
    if (!this.aground) {
      this.vel.y += (wv.h - 0.14 - this.pos.y) * 30 * dt;
      this.vel.y *= Math.exp(-3.4 * dt);
    } else {
      this.vel.y = (gy - this.pos.y) * 9;
    }
    this.pos.y += this.vel.y * dt;
    if (this.pos.y < gy - 0.08) { this.pos.y = gy - 0.08; this.vel.y = Math.max(0, this.vel.y); }

    this.vel.x = fx * vF + rx * vR;
    this.vel.z = fz * vF + rz * vR;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    this.collide(1.5, 1.0);

    // Attitude: wave slopes + planing bow lift + a little bob.
    const slopeF = wv.dhx * fx + wv.dhz * fz;
    const slopeR = wv.dhx * rx + wv.dhz * rz;
    const bob = Math.sin(time * 1.35 + (this.pos.x + this.pos.z) * 0.06) * 0.022;
    const bow = clamp(vF, 0, this.maxSpeed) * 0.006 + (throttle ? 0.015 : 0);
    const pitchT = Math.atan(slopeF) + bow + bob;
    const rollT = Math.atan(slopeR) * 1.15 + bob * 0.7;
    this.pitch = damp(this.pitch, pitchT, 3, dt);
    this.roll = damp(this.roll, rollT, 3, dt);

    this.speed = vF;
    this.applyTransforms();
  }
}

/* ------------------------------------------------------------------ */
/* plane                                                               */
/* ------------------------------------------------------------------ */

export class Plane extends Vehicle {
  constructor(world, built) {
    super(world, {
      kind: "plane", name: "Light aircraft", unit: "km/h", built,
      radius: 2.4, maxSpeed: 92, displayScale: 3.6, displayMax: 340,
      hint: "<kbd>W</kbd>/<kbd>S</kbd> throttle · <kbd>↑</kbd>/<kbd>↓</kbd> pitch · <kbd>←</kbd>/<kbd>→</kbd> roll · <kbd>A</kbd>/<kbd>D</kbd> rudder",
    });
    this.throttle = 0;
    this.stall = 36;
    this.groundContact = true;
    this._pitch = 0;
    this._roll = 0;
    this.camAnchors = {
      chase: { eye: [0, 3.4, 11.5], aim: [0, 1.6, -9], pull: 0.045, lift: 0.02 },
      cockpit: { eye: [0, 2.05, -0.5], aim: [0, 2.0, -18] },
    };
  }

  surfaceAt(x, z, time) {
    const gy = this.world.heightAt(x, z);
    if (gy >= 0.05) return gy;
    return Math.max(gy, this.world.seaHeightAt(x, z, time));
  }

  altitude() {
    const surf = this.surfaceAt(this.pos.x, this.pos.z, this._lastTime || 0);
    return Math.max(0, this.pos.y - surf);
  }

  place(x, z, yaw = 0) {
    this._resetState();
    this.throttle = 0;
    this.pos.set(x, this.surfaceAt(x, z, 0), z);
    this.yaw = yaw;
    this.groundContact = true;
    this.airborne = false;
    this.applyTransforms();
    return this;
  }

  placeAir(x, y, z, yaw = 0, speed = 58) {
    this._resetState();
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.throttle = 0.7;
    this.groundContact = false;
    this.airborne = true;
    const f = this.fullForward(this._f1);
    this.vel.set(f.x * speed, f.y * speed, f.z * speed);
    this.speed = speed;
    this.applyTransforms();
    return this;
  }

  update(dt, input, time) {
    const w = this.world;
    this._lastTime = time;

    // Throttle.
    const thrUp = input.isDown("KeyW") || input.isDown("ShiftLeft");
    const thrDown = input.isDown("KeyS") || input.isDown("ControlLeft");
    this.throttle = clamp(this.throttle + ((thrUp ? 1 : 0) - (thrDown ? 1 : 0)) * 0.55 * dt, 0, 1);

    // Attitude controls.
    const pitchIn = (input.isDown("ArrowDown") ? 1 : 0) - (input.isDown("ArrowUp") ? 1 : 0);
    const rollIn = (input.isDown("ArrowLeft") ? 1 : 0) - (input.isDown("ArrowRight") ? 1 : 0);
    const yawIn = (input.isDown("KeyA") ? 1 : 0) - (input.isDown("KeyD") ? 1 : 0);

    const speed = this.vel.len();
    const ctl = clamp(speed / this.stall, 0.22, 1.4);

    this._pitch += pitchIn * 0.85 * dt * ctl;
    this._roll += rollIn * 1.5 * dt * ctl;
    if (!rollIn) this._roll = damp(this._roll, 0, 0.9, dt);
    if (!pitchIn) this._pitch = damp(this._pitch, 0, 0.4, dt);
    if (speed < this.stall) this._pitch -= (1 - speed / this.stall) * 0.85 * dt;
    if (this.groundContact && speed < 24) this._pitch = damp(this._pitch, 0, 6, dt);
    this._pitch = clamp(this._pitch, -1.25, 1.3);
    this._roll = clamp(this._roll, -1.55, 1.55);

    // Coordination: banked turns + rudder.
    const maxBank = 1.25;
    const turn = (G * Math.tan(clamp(this._roll, -maxBank, maxBank))) / Math.max(speed, 22);
    this.yaw += turn * dt;
    if (this.groundContact) this.yaw += yawIn * clamp(speed / 8, 0, 1) * 0.75 * dt;
    else this.yaw += yawIn * 0.35 * dt * ctl;

    // Forces.
    const fwd = this.fullForward(this._f1);
    this.vel.addScaled(fwd, this.throttle * 9.5 * dt);
    const sp = Math.max(this.vel.len(), 1e-3);
    const drag = 0.00105 * sp * sp + (this.groundContact ? 0.9 : 0.13);
    this.vel.scale(Math.max(0, 1 - (drag / sp) * dt));

    // Arcade flight model: the velocity tracks the nose, gravity tops it up.
    const align = 2.0 * clamp(sp / this.stall, 0, 1.5);
    const k = 1 - Math.exp(-align * dt);
    this.vel.x += (fwd.x * sp - this.vel.x) * k;
    this.vel.y += (fwd.y * sp - this.vel.y) * k;
    this.vel.z += (fwd.z * sp - this.vel.z) * k;
    const grav = 0.32 + 0.68 * clamp(1 - sp / (this.stall * 1.35), 0, 1);
    this.vel.y -= G * dt * grav;

    this.pos.addScaled(this.vel, dt);

    // Ground / water contact.
    const surf = this.surfaceAt(this.pos.x, this.pos.z, time);
    this.groundContact = this.pos.y <= surf + 0.45;
    this.airborne = !this.groundContact;
    if (this.groundContact) {
      if (this.vel.y < -8) {
        this.vel.y = -this.vel.y * 0.22;   // bounce
        this.vel.x *= 0.85; this.vel.z *= 0.85;
        this.hitWall = true;
      } else {
        this.vel.y = Math.max(this.vel.y, 0);
      }
      if (this.pos.y < surf) this.pos.y = surf;
      const fr = this.throttle > 0.05 ? 0.28 : 1.15;
      const fk = Math.exp(-fr * dt);
      this.vel.x *= fk; this.vel.z *= fk;

      const n = w.normalAt(this.pos.x, this.pos.z, _n);
      const ff = this.flatForward(this._f2);
      const rr = this.right(this._r2);
      const pitchGround = -Math.asin(clamp(n.x * ff.x + n.z * ff.z, -1, 1));
      const rollGround = -Math.asin(clamp(n.x * rr.x + n.z * rr.z, -1, 1));
      const rotate = sp > 24 && this._pitch > 0.03;
      this.pitch = damp(this.pitch, rotate ? this._pitch : pitchGround, 6, dt);
      this.roll = damp(this.roll, rotate ? this._roll * 0.35 : rollGround, 6, dt);
      if (sp < 3 && this.throttle < 0.05) { this.vel.x *= Math.exp(-2 * dt); this.vel.z *= Math.exp(-2 * dt); }
    } else {
      this.pitch = this._pitch;
      this.roll = this._roll;
    }

    this.collide(this.radius, 0.8);

    this.speed = this.vel.len();
    this.anim.prop = (this.anim.prop + (0.8 + this.throttle * 55) * dt) % TAU;
    this.applyTransforms();
  }
}

/* ------------------------------------------------------------------ */

export function createVehicles(gl, world) {
  const assets = world.assets;
  const car = new Car(world, buildCar(gl, makeVehicleMaterials(assets, {
    body: [0.70, 0.11, 0.12], accent: [0.08, 0.09, 0.10], trim: [0.11, 0.11, 0.12],
  })));
  const boat = new Boat(world, buildBoat(gl, makeVehicleMaterials(assets, {
    body: [0.90, 0.92, 0.93], accent: [0.05, 0.16, 0.32], trim: [0.55, 0.58, 0.6],
  })));
  const plane = new Plane(world, buildPlane(gl, makeVehicleMaterials(assets, {
    body: [0.88, 0.9, 0.92], accent: [0.09, 0.3, 0.66], trim: [0.35, 0.36, 0.38],
  })));
  return { car, boat, plane };
}
