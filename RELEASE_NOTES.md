# Next Release

- Sensor marker values: temperature and humidity sensors now show their live value on the marker by default, with per-marker `Auto`, `Icon`, and `Value` display controls in Edit Mode.
- YAML export/import: marker display overrides are saved as `marker_display: icon` or `marker_display: value`; omitted means Auto.
- 3D viewer recovery: the model canvas now rebuilds automatically when returning to a dashboard view, avoiding the marker-only/blank-map state that previously required a full page refresh.
- Offline marker focus: clicking an offline device moves the camera once for the current view, repeated clicks only replay the red pulsing ring, moving/rotating the map allows the next click to jump back again, and `offline_focus_distance` now uses model-relative zoom levels from 1-10 for consistent behavior across model scales.
- 3D view compass: the model viewer now has animated one-click Top, North, East, South, and West camera buttons, with the side views set at a 45-degree angle.
- Startup view: admins can save or clear the current 3D camera as the default load/refresh view, and YAML export now includes the saved `default_view`.
