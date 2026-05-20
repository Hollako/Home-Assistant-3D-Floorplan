# Next Release

- Sensor marker values: temperature and humidity sensors now show their live value on the marker by default, with per-marker `Auto`, `Icon`, and `Value` display controls in Edit Mode.
- YAML export/import: marker display overrides are saved as `marker_display: icon` or `marker_display: value`; omitted means Auto.
- 3D viewer recovery: the model canvas now rebuilds automatically when returning to a dashboard view, avoiding the marker-only/blank-map state that previously required a full page refresh.
- Offline marker focus: clicking an offline device moves the camera once for the current view, repeated clicks only replay the red pulsing ring, moving/rotating the map allows the next click to jump back again, and `offline_focus_distance` now uses model-relative zoom levels from 1-10 for consistent behavior across model scales.
- Lovelace UI editor: card options can now be configured through the visual editor, with a dedicated `markers:` YAML textarea for pasting marker exports from Edit Mode.
- Editor cleanup: removed fixed View Mode and advanced Three.js resource URL fields from the visual editor while keeping YAML support for advanced manual configuration.
- Editor cleanup: removed manual Default View fields from the visual editor because saved home view is managed from card Edit Mode.
- Marker icons: replaced the small hardcoded icon dropdown with Home Assistant's full icon picker and an Auto reset button.
- 3D view compass: the model viewer now has animated one-click Top, North, East, South, and West camera buttons, with the side views set at a 45-degree angle.
- Startup view: admins can save or clear the current 3D camera as the default load/refresh view, and YAML export now includes the saved `default_view`.
