# Terra3D

A 3D planet explorer that streams **real OpenStreetMap data** (buildings, roads, water, greenery)
and **real elevation** into a drivable, sailable, flyable world — rendered by a hand-written
WebGL2 engine with **zero dependencies** and **no build step**.

Type a place, press START, and the world appears around you: extruded buildings with facades and
roofs, roads cut into the terrain, rivers and lakes, trees, shadows, a day/night sky — all from
live map data.

```
python serve.py 8000        # or:  node serve.mjs 8000
# open http://localhost:8000
```

Any static web server works. You need a WebGL2-capable browser and (for real data) an internet
connection. With `?offline=1` the game generates a deterministic procedural island instead, so it
also runs completely offline.

## Highlights

- **Real world streaming** — buildings, roads, waterbodies and green areas fetched live from the
  Overpass API for the area around you; terrain built from real elevation tiles.
- **Hand-written engine** — no Three.js, no map SDK. Own math library, geometry builders, forward
  renderer with shadow pass, sky, fog, water shader, and a custom game loop.
- **Three vehicles** — a car that drives on roads and hills, a boat that floats on analytic waves,
  and a plane with flight physics (throttle, rudder, bank, stall, ground roll).
- **Camera modes** — chase, cockpit, free-orbit, with mouse-look and smooth blending.
- **World rebasing** — travel far and the world re-streams around you; terrain stays anchored to
  global lat/lon so geography never shifts.
- **Day/night cycle** — move the clock and the sun, sky gradient, ambient light and shadows follow.
- **Quality presets** — low / medium / high trade terrain resolution, tree count, shadow map and
  pixel ratio.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | car: drive · boat: helm · plane: throttle (W/S) + rudder (A/D) |
| `←` `→` | plane: bank left / right |
| `↑` `↓` | plane: push = dive, pull = climb |
| `Space` | car: handbrake |
| `1` / `2` / `3` | switch to car / boat / plane (summons it if it is far away) |
| `C` | camera: chase → cockpit → orbit |
| Mouse | look around (click the view to capture the pointer) |
| Wheel | orbit camera: zoom |
| `R` | respawn the current vehicle |
| `T` | time of day +1 h |
| `H` | toggle the controls panel |
| `Esc` / `P` | pause menu |

## URL parameters

| Parameter | Example | Meaning |
| --- | --- | --- |
| `loc` | `?loc=nyc` | preset location (autostarts): `nyc`, `london`, `paris`, `sf`, `venice`, `rio`, `tokyo`, `sydney` |
| `lat`, `lon` | `?lat=48.8584&lon=2.2945` | explicit coordinates (autostarts) |
| `quality` | `?quality=high` | `low` \| `medium` \| `high` |
| `time` | `?time=20.5` | time of day in hours (0–24) |
| `offline` | `?offline=1` | procedural terrain, no network access |
| `v` | `?v=plane` | start with `car` \| `boat` \| `plane` |
| `cam` | `?cam=orbit` | start camera: `chase` \| `cockpit` \| `orbit` |
| `smoke` | `?smoke=1` | headless self-test: sets `document.title` to `SMOKE-OK` / `SMOKE-FAIL` |

Example: `http://localhost:8000/?loc=venice&v=boat&cam=chase&time=18`

## How it works

```
src/
  engine/     — the game engine
    mat4.js vec3.js math.js    matrix/vector math, fbm noise
    builders.js                Geometry: boxes, cylinders, extrusions, grids
    mesh.js material.js        GPU buffers, draw groups, material mapping
    shader.js renderer.js      WebGL2 forward renderer (world / water / sky / shadow passes)
    texture.js                 GL texture upload + mipmaps
    camera.js input.js loop.js rig, keyboard/pointer input, frame loop
    water.js                   sea mesh + wave functions shared with physics
    sky.js geom2d.js           sky dome, polygon triangulation/clipping helpers
  world/      — the real-world data pipeline
    geo.js                     local tangent-plane coordinates (x east, z south, y up)
    elevation.js               terrarium PNG tiles -> heightfield; procedural fallback
    overpass.js cache.js       Overpass API with endpoint fallback + 30-day IndexedDB cache
    osm.js                     OSM JSON -> buildings, roads, water, green areas
    buildings.js terrain.js    extruded buildings (facade atlas, gable roofs), terrain mesh
    roads.js waterbodies.js greens.js    thematic geometry builders
    textures.js                all textures generated procedurally on <canvas>
    world.js                   build / swap / rebase, spawn search, quality presets
  game/
    game.js                    spawn & relocate, rebase, cameras, state
    vehicles.js vehicleModels.js          car/boat/plane physics and meshes
  hud.js  main.js              HUD/menu/help, URL parameters, smoke test
```

**Data flow.** The browser fetches terrarium elevation tiles (encoded PNG heights, decoded in
JS) and an Overpass API response for the neighbourhood. OSM ways are classified into buildings,
roads, waterways, lakes and green areas; building footprints are extruded into prisms with
per-wall UVs into a generated facade atlas (storefront band on tall buildings, flat or gable
roofs), roads are ribbons draped on the terrain, water areas are flattened into polygons floating
at water level. Everything is merged into a handful of draw calls, uploaded to the GPU, and the
previous world is swapped out seamlessly.

**Coordinates & rebasing.** All gameplay happens in a local tangent plane centred on your current
position. When you travel far enough, the world rebases: it re-streams data around the new centre
and shifts the scene graph so you never notice — the terrain is sampled in global lat/lon, so
landforms are stable across rebases.

**Waves.** The ocean surface is displaced by three sine waves in the vertex shader; the same
wave function exists in JavaScript so the boat's buoyancy and rocking match what you see.

## Data sources & attribution

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
  Fetched at runtime via the [Overpass API](https://overpass-api.de/).
- Elevation: [Mapzen/Tilezen terrarium](https://registry.opendata.aws/terrain-tiles/) tiles (AWS Open Data).

No map data is bundled with the repository — everything is streamed at runtime, and the game
displays the required attribution in its UI.

## Development

- Zero dependencies, zero build: edit a file, reload the page.
- `?smoke=1` runs an offline self-test in the page (Windows headless Edge friendly): it exercises
  all three vehicles, the camera modes, a world rebase and collision, then reports
  `SMOKE-OK n/n` (or `SMOKE-FAIL`) in `document.title` with a full report in `#smokeout`.

## License

MIT — see [LICENSE](LICENSE). The map and elevation data keep their own licenses (see above).
