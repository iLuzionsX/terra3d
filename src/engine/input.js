// Terra3D engine — keyboard/mouse input with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.justPressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.mouseButtons = new Set();
    this.pointerLocked = false;
    this.testDown = null; // smoke-test override {KeyW:true,...}
    this.testMouse = null; // {dx,dy}
    this.onEscape = null;  // called when pointer lock is exited
    this._lockRequested = false;

    window.addEventListener("keydown", (e) => {
      if (e.code === "F5" || e.code === "F12") return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.justPressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());

    canvas.addEventListener("mousedown", (e) => {
      this.mouseButtons.add(e.button);
      if (!this.pointerLocked && this.allowLock()) this.requestLock();
    });
    window.addEventListener("mouseup", (e) => this.mouseButtons.delete(e.button));
    window.addEventListener("mousemove", (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    window.addEventListener("wheel", (e) => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked && this._lockRequested) {
        this._lockRequested = false;
        if (this.onEscape) this.onEscape();
      }
    });
  }

  allowLock() { return this.allowLockFlag !== false; }
  setAllowLock(v) { this.allowLockFlag = v; }

  requestLock() {
    if (this.pointerLocked || this.allowLockFlag === false) return;
    this._lockRequested = true;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    // Some browsers return a promise; swallow rejection (unadjustedMovement unsupported).
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }

  isDown(code) {
    if (this.testDown) return !!this.testDown[code];
    return this.down.has(code);
  }

  /** Edge-triggered: true once per key press. */
  pressed(code) {
    if (this.testDown) {
      if (this.testDown[code] && !this._testConsumed) return true;
      return false;
    }
    if (this.justPressed.has(code)) { this.justPressed.delete(code); return true; }
    return false;
  }

  isMouseDown(btn = 0) { return this.mouseButtons.has(btn); }

  consumeMouse() {
    let dx = this.mouseDX, dy = this.mouseDY;
    if (this.testMouse) { dx += this.testMouse.dx; dy += this.testMouse.dy; this.testMouse = null; }
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  consumeWheel() { const w = this.wheelDelta; this.wheelDelta = 0; return w; }

  endFrame() { this.justPressed.clear(); }
}
