// Terra3D — DOM HUD, start menu, loading + pause overlays.
const $ = (id) => document.getElementById(id);

export const LOCATIONS = [
  { id: "nyc", name: "New York", lat: 40.7061, lon: -74.0087 },
  { id: "london", name: "London", lat: 51.5007, lon: -0.1246 },
  { id: "paris", name: "Paris", lat: 48.8584, lon: 2.2945 },
  { id: "sf", name: "San Francisco", lat: 37.7955, lon: -122.3937 },
  { id: "venice", name: "Venice", lat: 45.4341, lon: 12.3388 },
  { id: "rio", name: "Rio de Janeiro", lat: -22.9519, lon: -43.2105 },
  { id: "tokyo", name: "Tokyo", lat: 35.6595, lon: 139.7005 },
  { id: "sydney", name: "Sydney", lat: -33.8568, lon: 151.2153 },
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function formatClock(hours) {
  const m = Math.round(((hours % 24) + 24) % 24 * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function formatLatLon(lat, lon) {
  const f = (v, pos, neg) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`;
  return `${f(lat, "N", "S")} ${f(lon, "E", "W")}`;
}

export function dayPart(sunElevation, night) {
  if (night > 0.6) return "night";
  if (sunElevation < 0.06) return "twilight";
  if (sunElevation < 0.35) return "golden hour";
  return "day";
}

export class Hud {
  constructor() {
    const el = this.el = {};
    for (const id of [
      "hud", "vehicleName", "speedVal", "speedUnit", "speedfill", "altRow", "altVal", "hintRow",
      "clock", "daypart", "fps", "coordsRow", "compass", "headingVal", "toast", "statusPill",
      "statusText", "help", "menu", "menuInner", "locChips", "latInput", "lonInput", "qualitySel",
      "timeInput", "timeLabel", "startBtn", "menuError", "loading", "loadTitle", "loadfill",
      "loadmsg", "pause", "pauseTime", "pauseTimeLabel", "pauseTimeScale", "resumeBtn", "menuBtn",
    ]) el[id] = $(id);

    this.onStart = null;        // ({lat, lon, quality, timeHours}) => void
    this.onResume = null;       // () => void
    this.onMenu = null;         // () => void
    this.onTimeChange = null;   // (hours) => void
    this.onTimeScaleChange = null;
    this._toastTimer = 0;
    this._last = {};
    this._selectedLoc = LOCATIONS[0].id;

    this._buildChips();
    this._buildHelp();

    el.timeInput.addEventListener("input", () => {
      el.timeLabel.textContent = formatClock(el.timeInput.value / 60);
    });
    el.pauseTime.addEventListener("input", () => {
      el.pauseTimeLabel.textContent = formatClock(el.pauseTime.value / 60);
      this.onTimeChange?.(el.pauseTime.value / 60);
    });
    el.pauseTimeScale.addEventListener("change", () => {
      this.onTimeScaleChange?.(Number(el.pauseTimeScale.value));
    });
    el.resumeBtn.addEventListener("click", () => this.onResume?.());
    el.menuBtn.addEventListener("click", () => this.onMenu?.());
    el.startBtn.addEventListener("click", () => this._start());
    el.latInput.addEventListener("input", () => this._clearChipSelection());
    el.lonInput.addEventListener("input", () => this._clearChipSelection());
  }

  /* ---------------- start menu ---------------- */

  _buildChips() {
    const box = this.el.locChips;
    box.innerHTML = "";
    for (const loc of LOCATIONS) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = loc.name;
      b.dataset.id = loc.id;
      b.addEventListener("click", () => this.selectLocation(loc));
      box.appendChild(b);
    }
  }

  selectLocation(loc) {
    this._selectedLoc = loc.id;
    this.el.latInput.value = loc.lat.toFixed(4);
    this.el.lonInput.value = loc.lon.toFixed(4);
    for (const c of this.el.locChips.children) c.classList.toggle("active", c.dataset.id === loc.id);
  }

  _clearChipSelection() {
    this._selectedLoc = null;
    for (const c of this.el.locChips.children) c.classList.remove("active");
  }

  /** Highlight the chip matching the inputs, if any. */
  syncChips() {
    if (this._selectedLoc) this.selectLocation(LOCATIONS.find((l) => l.id === this._selectedLoc) || LOCATIONS[0]);
  }

  _start() {
    const lat = Number.parseFloat(this.el.latInput.value);
    const lon = Number.parseFloat(this.el.lonInput.value);
    if (!Number.isFinite(lat) || lat < -85 || lat > 85) return this.setError("Latitude must be a number between -85 and 85.");
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return this.setError("Longitude must be a number between -180 and 180.");
    this.clearError();
    this.onStart?.({
      lat,
      lon,
      quality: this.el.qualitySel.value,
      timeHours: Number(this.el.timeInput.value) / 60,
    });
  }

  setError(msg) {
    const e = this.el.menuError;
    e.textContent = msg;
    e.classList.remove("hidden");
  }

  clearError() { this.el.menuError.classList.add("hidden"); }

  setStartBusy(busy) {
    this.el.startBtn.disabled = !!busy;
    this.el.startBtn.textContent = busy ? "BUILDING THE WORLD…" : "START EXPLORING";
  }

  /* ---------------- overlays ---------------- */

  showLoading(title) {
    this.el.menu.classList.add("hidden");
    this.el.loading.classList.remove("hidden");
    if (title) this.el.loadTitle.textContent = title;
    this.setLoad("contacting elevation + OpenStreetMap…", 0.02);
  }

  setLoad(text, frac) {
    if (text) this.el.loadmsg.textContent = text;
    if (typeof frac === "number") this.el.loadfill.style.width = `${Math.round(Math.min(1, Math.max(0.02, frac)) * 100)}%`;
  }

  hideLoading() { this.el.loading.classList.add("hidden"); }

  showHud() { this.el.hud.classList.remove("hidden"); }

  showMenu() {
    this.el.pause.classList.add("hidden");
    this.el.loading.classList.add("hidden");
    this.el.hud.classList.add("hidden");
    this.el.menu.classList.remove("hidden");
    this.setStartBusy(false);
  }

  showPause(on) {
    this.el.pause.classList.toggle("hidden", !on);
    if (on) this.el.resumeBtn.focus?.();
  }

  setStatus(text, frac, visible) {
    const pill = this.el.statusPill;
    if (!visible) { pill.classList.add("hidden"); return; }
    pill.classList.remove("hidden");
    this.el.statusText.textContent = text || "";
    void frac;
  }

  toast(msg, ms = 2800) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }

  toggleHelp() { this.el.help.classList.toggle("hidden"); }

  _buildHelp() {
    this.el.help.innerHTML = `
      <h3>Controls</h3>
      <table>
        <tr><td>W A S D</td><td>car: drive · boat: helm · plane: throttle (W/S) + rudder (A/D)</td></tr>
        <tr><td>← →</td><td>plane: bank left / right</td></tr>
        <tr><td>↑ ↓</td><td>plane: push = dive, pull = climb</td></tr>
        <tr><td>Space</td><td>car: handbrake</td></tr>
        <tr><td>1 / 2 / 3</td><td>car · boat · plane (summons it if it is far away)</td></tr>
        <tr><td>C</td><td>camera: chase → cockpit → orbit</td></tr>
        <tr><td>Mouse</td><td>look around (click the view to capture the pointer)</td></tr>
        <tr><td>Wheel</td><td>orbit camera: zoom</td></tr>
        <tr><td>R</td><td>respawn the current vehicle</td></tr>
        <tr><td>T</td><td>time of day +1 h</td></tr>
        <tr><td>H</td><td>toggle this panel</td></tr>
        <tr><td>Esc / P</td><td>pause menu</td></tr>
      </table>`;
  }

  /* ---------------- per-frame state ---------------- */

  update(s) {
    const el = this.el, last = this._last;
    const speed = Math.round(s.speed);
    if (speed !== last.speed) { el.speedVal.textContent = String(speed); last.speed = speed; }
    if (s.unit !== last.unit) { el.speedUnit.textContent = s.unit; last.unit = s.unit; }
    const pct = Math.round(s.speedFrac * 100);
    if (pct !== last.pct) { el.speedfill.style.width = `${pct}%`; last.pct = pct; }
    if (s.vehicle !== last.vehicle) { el.vehicleName.textContent = s.vehicle; last.vehicle = s.vehicle; }
    if (s.hint !== last.hint) { el.hintRow.innerHTML = s.hint; last.hint = s.hint; }

    const alt = s.altitude === null || s.altitude === undefined ? null : Math.round(s.altitude);
    if (alt !== last.alt) {
      el.altRow.classList.toggle("hidden", alt === null);
      if (alt !== null) el.altVal.textContent = String(alt);
      last.alt = alt;
    }

    const clock = formatClock(s.timeHours);
    if (clock !== last.clock) { el.clock.textContent = clock; last.clock = clock; }
    const part = dayPart(s.sunElevation, s.night);
    if (part !== last.part) { el.daypart.textContent = part; last.part = part; }
    const fps = Math.round(s.fps);
    if (fps !== last.fps) { el.fps.textContent = fps ? `${fps} fps` : ""; last.fps = fps; }

    const coords = `${s.lat.toFixed(4)}°, ${s.lon.toFixed(4)}°`;
    if (coords !== last.coords) { el.coordsRow.textContent = coords; last.coords = coords; }
    const hdg = ((Math.round(s.heading) % 360) + 360) % 360;
    const card = COMPASS[Math.round(hdg / 45) % 8];
    if (hdg !== last.hdg || card !== last.card) {
      el.compass.textContent = card;
      el.headingVal.textContent = `${hdg}°`;
      last.hdg = hdg; last.card = card;
    }

    // Keep the pause-menu time slider in sync with the game clock.
    if (this.el.pause.classList.contains("hidden") === false) {
      const v = Math.round(s.timeHours * 60) % 1440;
      if (String(v) !== this.el.pauseTime.value && document.activeElement !== this.el.pauseTime) {
        this.el.pauseTime.value = String(v);
        this.el.pauseTimeLabel.textContent = formatClock(s.timeHours);
      }
    }
  }
}
