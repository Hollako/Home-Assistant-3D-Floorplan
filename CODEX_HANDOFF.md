# Codex Handoff

Read this first when continuing this project in a new Codex session.

## Project

- Repository/folder: `Home Assistant 3D Floorplan`
- Main file: `Home-Assistant-3D-Floorplan.js`
- Custom card: `custom:home-assistant-3d-floorplan`
- Validation command after JavaScript edits:

```powershell
node --check Home-Assistant-3D-Floorplan.js
```

## Current State

- The card is a 3D-only Home Assistant floorplan card using GLB/GLTF/OBJ models.
- Markers are placed directly on the 3D model using raycasting and store real `x/y/z` model coordinates.
- Edit Mode is admin-only using Home Assistant frontend context:

```js
this._hass?.user?.is_admin === true
```

- User Mode marker behavior:
  - Tap/hold actions can be overridden per marker.
  - Domain defaults exist for light/switch/sensor/binary_sensor/climate.
- Edit Mode marker behavior:
  - Tap selects marker and shows parameters.
  - Hold moves marker.
- Camera/view should not reset during normal refreshes, marker edits, state changes, search, or display changes.

## Recent Features

- Brightness areas:
  - Draw room polygons in Edit Mode.
  - Per-area day/night shade values.
  - Optional illuminance sensor per area.
  - Optional lux label on the map.
  - Light marker `light_intensity` affects area brightness.
- Sensor value markers:
  - Temperature and humidity sensors show values in the marker by default.
  - Per-marker `Marker display`: `Auto`, `Icon`, `Value`.
  - YAML key: `marker_display`.
- Offline device notification:
  - Header says offline device(s).
  - Offline list shows only the entity/device name, no floor prefix.
  - Clicking an offline device focuses the marker.
  - Red pulsing ring appears around the marker for about 3 seconds.
  - Repeated clicks do not refocus if the view has not moved.
  - If the user rotates/pans/zooms away, clicking again refocuses once.
  - `offline_focus_distance` is model-relative for values `1-10`.
  - Current intended default is:

```yaml
offline_focus_distance: 2
```

## Important Recent Fixes

- 3D viewer recovery:
  - When Home Assistant switches views and returns, the WebGL canvas can disappear while marker DOM remains.
  - The card now checks whether the renderer canvas is connected before preserving the viewer.
  - It rebuilds the 3D viewer automatically if needed.
- Render sizing:
  - The render loop guards against zero-size containers so the canvas does not get stuck at a bad size after view changes.
- Offline focus distance:
  - Do not treat `offline_focus_distance: 2` as raw model units.
  - Values `1-10` are relative zoom levels based on the fitted camera distance.

## Files To Keep Updated

- `Home-Assistant-3D-Floorplan.js`: main implementation.
- `README.md`: public docs.
- `RELEASE_NOTES.md`: add every new feature/fix for the next release.

## Working Rules

- Use `apply_patch` for manual edits.
- Do not reset or revert unrelated user changes.
- Always run:

```powershell
node --check Home-Assistant-3D-Floorplan.js
```

- Before changing coordinate mapping, inspect existing code/config carefully. It was tuned many times.
- Preserve the 3D camera/view unless the user explicitly requests a camera movement.

## Current User Preference Notes

- User prefers practical UI controls in the sidebar/panel, not manual-only YAML.
- User tests heavily on Home Assistant and iPad Companion App.
- User wants “What’s New” text for releases and expects new features to be listed in `RELEASE_NOTES.md`.
- Tone with the user can be casual/direct; they often say “bro.”
