// Terra3D engine — main loop with fixed-timestep updates + fps stats.
export class Loop {
  constructor({ update, render, fixedStep = 1 / 60, maxSubSteps = 5 }) {
    this.update = update;
    this.render = render;
    this.fixedStep = fixedStep;
    this.maxSubSteps = maxSubSteps;
    this.running = false;
    this.fps = 0;
    this._acc = 0;
    this._last = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._raf = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > 0.25) dt = 0.25;
      this._acc += dt;
      let steps = 0;
      while (this._acc >= this.fixedStep && steps < this.maxSubSteps) {
        this.update(this.fixedStep);
        this._acc -= this.fixedStep;
        steps++;
      }
      if (steps === this.maxSubSteps) this._acc = 0; // avoid spiral of death
      this.render(this._acc / this.fixedStep);
      this._fpsAcc += dt;
      this._fpsFrames++;
      if (this._fpsAcc >= 0.5) {
        this.fps = this._fpsFrames / this._fpsAcc;
        this._fpsAcc = 0;
        this._fpsFrames = 0;
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }
}
