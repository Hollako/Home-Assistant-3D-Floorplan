const VERSION = "2.10.0";
class HomeAssistant3DFloorplan extends HTMLElement {
  static getConfigElement() {
    return document.createElement("home-assistant-3d-floorplan-editor");
  }

  static getStubConfig() {
    return {
      title: "3D Floorplan",
      model: "/local/floorplans/home.glb",
      view_mode: "3d",
      default_view: null,
      offline_states: ["unavailable", "unknown"],
      markers: [],
      floors: [],
      brightness_zones: [],
      animations: [],
      interactive_objects: [],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._registriesLoaded = false;
    this._entities = [];
    this._devices = [];
    this._areas = [];
    this._floors = [];
    this._activeFloorId = "";
    this._floorMarkers = {};
    this._markers = {};
    this._floorZones = {};
    this._zones = {};
    this._activeZoneId = "";
    this._zoneDrawing = false;
    this._activeZonePointIndex = null;
    this._filters = {
      placement: "all",
      availability: "all",
      domain: "all",
      integration: "all",
      area: "all",
      search: "",
    };
    this._mode = "user";
    this._placementMode = "auto";
    this._sidebarCollapsed = false;
    this._sidebarTab = "markers";
    this._filtersCollapsed = true;
    this._zoom = 1;
    this._exportOpen = false;
    this._display = {
      markerSize: 18,
      showLabels: true,
      nudgeStep: 1,
    };
    this._mapScroll = {
      left: 0,
      top: 0,
      leftRatio: 0,
      topRatio: 0,
    };
    this._mapAlertScrollLeft = 0;
    this._deviceListScrollTop = 0;
    this._isPanning = false;
    this._isSelecting = false;
    this._isJumping = false;
    this._suppressMapRestoreUntil = 0;
    this._selectedMarkers = new Set();
    this._advancedRenderParamsOpen = new Set();
    this._pendingDeviceKey = null;
    this._pendingSubSpot = null;
    this._pendingLightPath = null;
    this._dragMarkerKey = null;
    this._selectionBox = null;
    this._selectionBoxElement = null;
    this._pendingMarkerFocus = null;
    this._offlineFocusedMarkers = new Map();
    this._history = {};
    this._historyLimit = 30;
    this._modelViewer = null;
    this._modelKeyboardNavigationActive = false;
    this._modelRenderToken = 0;
    this._modelCameraState = null;
    this._modelDefaultViews = {};
    this._modelViewAnimation = 0;
    this._modelLoadingUrl = "";
    this._modelLoadFailedUrl = "";
    this._threeModules = null;
    this._threeModulesPromise = null;
    this._boundKeydown = (event) => this._handleKeydown(event);
    this._boundVisibilityChange = () => {
      // Resume with a fresh render when the tab becomes visible again.
      if (!document.hidden) this._requestRender();
    };
  }

  setConfig(config) {
    this._config = {
      title: "3D Floorplan",
      image: "",
      offline_states: ["unavailable", "unknown"],
      domains: [],
      integrations: [],
      areas: [],
      markers: [],
      floors: [],
      brightness_zones: [],
      animations: [],
      interactive_objects: [],
      view_mode: "3d",
      default_view: null,
      model: "",
      allow_edit: true,
      marker_tap_action: "auto",
      marker_hold_action: "auto",
      edit_marker_tap_action: "select",
      edit_marker_hold_action: "move",
      marker_hold_ms: 650,
      offline_focus_distance: 2,
      coordinate_map: { x: "x", y: "y", z: "z" },
      vertical_axis: "y",
      light_presets: {},
      model_background: "",
      ambient_darkness: {
        entity: "sun.sun",
        day_opacity: 0.5,
        night_opacity: 1,
      },
      three_url: "https://esm.sh/three@0.165.0",
      three_bundle_urls: [
        "/hacsfiles/Home-Assistant-3D-Floorplan/dist/three.bundle.min.js",
        "/local/three.bundle.min.js",
      ],
      three_bundle_url: "",
      model_performance_profile: "quality",
      model_antialias: null,
      model_pixel_ratio: 0,
      gltf_loader_url: "https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js",
      gltf_loader_urls: ["https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js", "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js"],
      obj_loader_url: "https://esm.sh/three@0.165.0/examples/jsm/loaders/OBJLoader.js",
      obj_loader_urls: ["https://esm.sh/three@0.165.0/examples/jsm/loaders/OBJLoader.js", "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/OBJLoader.js"],
      orbit_controls_url: "https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js",
      orbit_controls_urls: ["https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js", "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js"],
      three_urls: ["https://esm.sh/three@0.165.0", "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.min.js"],
      projection_tilt: 58,
      projection_rotate: -32,
      projection_depth: 28,
      persist_layout: true,
      storage_key: "",
      marker_size: 18,
      show_labels: true,
      show_entity_state: true,
      nudge_step: 1,
      ...config,
    };
    this._floors = this._normalizedFloors(this._config);
    if (!this._floors.some((floor) => floor.id === this._activeFloorId)) {
      this._activeFloorId = this._floors[0]?.id || "default";
    }
    this._modelDefaultViews = this._mergedModelDefaultViews(this._configModelDefaultViews(), this._loadModelDefaultViews());
    this._display = this._normalizedDisplay({
      markerSize: this._config.marker_size,
      showLabels: this._config.show_labels,
      nudgeStep: this._config.nudge_step,
      ...this._loadDisplay(),
    });
    this._floorMarkers = this._mergedFloorMarkers(this._configFloorMarkers(), this._loadMarkers());
    this._markers = this._floorMarkers[this._activeFloorId] || {};
    this._floorZones = this._mergedFloorZones(this._configFloorZones(), this._loadZones());
    this._zones = this._floorZones[this._activeFloorId] || {};
    // Merge saved presets (localStorage) on top of config presets (YAML) so user presets survive JS updates
    this._config.light_presets = { ...(this._config.light_presets || {}), ...this._loadPresets() };
    this._render();
  }

  set hass(hass) {
    const previousCanEdit = this._canEdit();
    this._hass = hass;
    const nextCanEdit = this._canEdit();
    this._loadRegistries(hass);
    if (previousCanEdit !== nextCanEdit && !this._isControlActive()) {
      this._render();
      return;
    }
    if (this._shouldPreserveModelViewer()) {
      this._refresh3DMarkerOverlay();
      this._refresh3DZoneOverlay();
      this._refreshOfflineAlert();
      return;
    }
    if (this._isControlActive()) return;
    this._render();
  }

  getCardSize() {
    return 8;
  }

  connectedCallback() {
    window.addEventListener("keydown", this._boundKeydown, { capture: true });
    document.addEventListener("visibilitychange", this._boundVisibilityChange);
    this._queueModelViewerRecovery();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._boundKeydown, { capture: true });
    document.removeEventListener("visibilitychange", this._boundVisibilityChange);
    window.clearTimeout(this._modelRecoveryTimer);
    this._disposeModelViewer();
  }

  _canEdit() {
    if (this._config.allow_edit === false) return false;
    return this._hass?.user?.is_admin === true;
  }

  _isControlActive() {
    const active = this.shadowRoot?.activeElement;
    return this._isPanning || this._isSelecting || this._isJumping || ["INPUT", "SELECT", "TEXTAREA"].includes(active?.tagName);
  }

  _isInteractiveControl(target) {
    return Boolean(target?.closest?.("button, select, input, textarea, label, option, [data-no-row-drag]"));
  }

  _shouldPreserveModelViewer() {
    if (this._config.view_mode !== "3d" && !this._config.model) return false;
    const activeFloor = this._activeFloor();
    const model = activeFloor.model || this._config.model || "";
    const container = this.shadowRoot?.querySelector("[data-model-viewer]");
    if (model && container?.isConnected && this.shadowRoot?.contains(container)) {
      if (this._modelLoadingUrl === model || this._modelLoadFailedUrl === model) return true;
    }
    return Boolean(
      model &&
        this._modelViewer?.container?.isConnected &&
        this._modelViewer?.renderer?.domElement?.isConnected &&
        this.shadowRoot?.contains(this._modelViewer.container)
    );
  }

  _queueModelViewerRecovery() {
    if (!this._config) return;
    window.clearTimeout(this._modelRecoveryTimer);
    this._modelRecoveryTimer = window.setTimeout(() => this._recoverModelViewer(), 50);
  }

  _recoverModelViewer() {
    if (!this.isConnected || !this.shadowRoot || !this._config) return;
    const activeFloor = this._activeFloor();
    const model = activeFloor.model || this._config.model || "";
    if (!model) return;
    const container = this.shadowRoot.querySelector("[data-model-viewer]");
    const hasRenderer = Boolean(this._modelViewer?.renderer?.domElement?.isConnected && this.shadowRoot.contains(this._modelViewer.container));
    if (container && !hasRenderer) {
      this._renderModelViewer(model);
      return;
    }
    if (!container) this._render();
  }

  _handleKeydown(event) {
    const path = event.composedPath?.() || [];
    if (path.some((node) => ["INPUT", "SELECT", "TEXTAREA"].includes(node?.tagName) || node?.isContentEditable)) return;
    const active = this.shadowRoot?.activeElement || document.activeElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(active?.tagName)) return;
    if (this._handle3DNavigationKey(event)) return;
    if (!(this._canEdit() && this._mode === "edit")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this._undoLastMarkerChange();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (!this._selectedMarkers.size) return;

    event.preventDefault();
    this._pushMarkerHistory();
    for (const key of this._selectedMarkers) {
      delete this._markers[key];
      if (this._pendingSubSpot?.key === key) this._pendingSubSpot = null;
      if (this._pendingLightPath?.key === key) this._pendingLightPath = null;
    }
    this._selectedMarkers.clear();
    this._saveMarkers();
    this._render();
  }

  _handle3DNavigationKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const key = String(event.key || "").toLowerCase();
    if (!["w", "a", "s", "d", "q", "e"].includes(key)) return false;
    if (!this._modelKeyboardNavigationActive) return false;
    const viewer = this._modelViewer;
    if (!viewer?.camera || !viewer?.controls || !viewer?.THREE) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const { THREE, camera, controls } = viewer;
    const verticalModelAxis = this._coordinateMap()[this._verticalAxis()] || "y";
    const up = new THREE.Vector3(
      verticalModelAxis === "x" ? 1 : 0,
      verticalModelAxis === "y" ? 1 : 0,
      verticalModelAxis === "z" ? 1 : 0
    );
    const flatten = (vector) => {
      const result = vector.clone().sub(up.clone().multiplyScalar(vector.dot(up)));
      return result.lengthSq() > 0.000001 ? result.normalize() : result;
    };
    let right = flatten(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0));
    let forward = flatten(camera.getWorldDirection(new THREE.Vector3()));
    if (!right.lengthSq()) right = new THREE.Vector3(1, 0, 0);
    if (!forward.lengthSq()) forward = flatten(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1));
    if (!forward.lengthSq()) forward = new THREE.Vector3().crossVectors(up, right).normalize();

    const distance = Math.max(1, camera.position.distanceTo(controls.target));
    const step = distance * (event.shiftKey ? 0.12 : 0.045);
    const move = new THREE.Vector3();
    if (key === "w") move.add(forward.multiplyScalar(step));
    if (key === "s") move.add(forward.multiplyScalar(-step));
    if (key === "d") move.add(right.multiplyScalar(step));
    if (key === "a") move.add(right.multiplyScalar(-step));
    if (key === "e") move.add(up.clone().multiplyScalar(step));
    if (key === "q") move.add(up.clone().multiplyScalar(-step));

    camera.position.add(move);
    controls.target.add(move);
    controls.update();
    this._captureModelCameraState();
    this._requestRender();
    return true;
  }

  async _loadRegistries(hass) {
    if (this._registriesLoaded || !hass?.callWS) return;
    this._registriesLoaded = true;

    try {
      const [entities, devices, areas] = await Promise.all([
        hass.callWS({ type: "config/entity_registry/list" }),
        hass.callWS({ type: "config/device_registry/list" }),
        hass.callWS({ type: "config/area_registry/list" }),
      ]);
      this._entities = entities || [];
      this._devices = devices || [];
      this._areas = areas || [];
      if (this._shouldPreserveModelViewer()) {
        this._refresh3DMarkerOverlay();
        this._refreshOfflineAlert();
        return;
      }
      if (this._isControlActive()) return;
      this._render();
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: registry lookup failed", error);
    }
  }

  _deviceRows() {
    if (!this._hass?.states) return [];

    const entityRegistry = new Map(this._entities.map((entity) => [entity.entity_id, entity]));
    const deviceRegistry = new Map(this._devices.map((device) => [device.id, device]));
    const areaRegistry = new Map(this._areas.map((area) => [area.area_id || area.id, area]));
    const rows = [];

    for (const [entityId, stateObj] of Object.entries(this._hass.states)) {
      const domain = entityId.split(".")[0];
      if (this._config.domains.length && !this._config.domains.includes(domain)) continue;

      const entity = entityRegistry.get(entityId);
      const device = entity?.device_id ? deviceRegistry.get(entity.device_id) : null;
      const integration = this._integration(entity, stateObj);
      if (this._config.integrations.length && !this._config.integrations.includes(integration)) continue;

      const areaId = entity?.area_id || device?.area_id || stateObj.attributes?.area_id || "unknown";
      const area = areaRegistry.get(areaId);
      const areaName = area?.name || stateObj.attributes?.area || (areaId === "unknown" ? "No area" : areaId);
      if (this._config.areas.length && !this._config.areas.includes(areaName) && !this._config.areas.includes(areaId)) continue;

      const isOffline = this._isOffline(stateObj.state);
      const deviceName = device?.name_by_user || device?.name || "";
      const name = stateObj.attributes?.friendly_name || entity?.name || entity?.original_name || entityId;
      const icon = stateObj.attributes?.icon || "";
      const deviceClass = stateObj.attributes?.device_class || "";
      const unit = stateObj.attributes?.unit_of_measurement || "";

      rows.push({
        key: entityId,
        entityId,
        name,
        deviceName,
        offline: isOffline,
        domain,
        integration,
        state: stateObj.state,
        domains: [domain],
        integrations: [integration],
        states: [stateObj.state],
        icons: icon ? [icon] : [],
        deviceClasses: deviceClass ? [deviceClass] : [],
        primaryState: stateObj.state,
        unit,
        primaryDomain: domain,
        primaryDeviceClass: deviceClass,
        offlineEntities: isOffline ? [{ entityId, name }] : [],
        entityCount: 1,
        areaId,
        areaName,
        lastChanged: stateObj.last_changed,
      });
    }

    return rows.sort((a, b) => a.areaName.localeCompare(b.areaName) || a.name.localeCompare(b.name));
  }

  _integration(entity, stateObj) {
    if (entity?.platform) return entity.platform;
    const attr = stateObj.attributes || {};
    return attr.integration || attr.platform || "unknown";
  }

  _isOffline(state) {
    return this._config.offline_states.includes(String(state).toLowerCase());
  }

  _stateClass(row) {
    if (row.offline) return "state-offline";
    if (!this._config.show_entity_state) return "state-online";
    const state = String(row.primaryState || "").toLowerCase();
    const activeStates = ["on", "open", "opening", "unlocked", "detected", "motion", "home", "playing", "heat", "cool", "heating", "cooling", "active", "running"];
    const inactiveStates = ["off", "closed", "closing", "locked", "clear", "none", "not_home", "idle", "standby", "paused", "stopped"];

    if (activeStates.includes(state)) return "state-active";
    if (inactiveStates.includes(state)) return "state-inactive";
    if (row.primaryDomain === "binary_sensor") return state === "on" ? "state-active" : "state-inactive";
    if (row.primaryDomain === "light" || row.primaryDomain === "switch") return state === "on" ? "state-active" : "state-inactive";
    return "state-neutral";
  }

  /**
   * Normalizes a raw color_thresholds config array into a sorted, validated array.
   * Each entry must have a numeric `value` and a CSS color string `color`.
   * Entries are sorted ascending by value so threshold lookup is deterministic.
   * Invalid entries (missing value or color) are silently dropped.
   */
  _normalizeColorThresholds(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const entries = raw
      .map((entry) => ({ value: Number(entry?.value), color: String(entry?.color || "").trim() }))
      .filter((entry) => Number.isFinite(entry.value) && entry.color.length > 0);
    if (entries.length === 0) return null;
    return entries.sort((a, b) => a.value - b.value);
  }

  /**
   * Given a sorted color_thresholds array and a numeric state value, returns the
   * CSS color string for the appropriate threshold band.
   *
   * Threshold semantics (step, not interpolated):
   *   - Below the first threshold value  → first threshold color
   *   - Between thresholds N and N+1     → threshold N color
   *   - At or above the last threshold   → last threshold color
   *
   * Example with thresholds [{value:18, color:"blue"}, {value:22, color:"green"}, {value:26, color:"red"}]:
   *   state 15  → blue   (below first threshold)
   *   state 20  → blue   (between 18 and 22, i.e., >= 18 but < 22)
   *   state 22  → green  (>= 22 but < 26)
   *   state 30  → red    (>= last threshold)
   */
  _markerColorFromThresholds(thresholds, numericState) {
    if (!thresholds || thresholds.length === 0 || !Number.isFinite(numericState)) return null;
    // Walk from highest to lowest; return color of the first threshold <= state
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (numericState >= thresholds[i].value) return thresholds[i].color;
    }
    // State is below all thresholds — use the lowest threshold color
    return thresholds[0].color;
  }

  _markerIcon(row) {
    const markerIcon = this._markers[row.key]?.icon;
    if (markerIcon) return markerIcon;
    return this._defaultIcon(row);
  }

  _defaultIcon(row) {
    const deviceClass = row.deviceClasses[0];
    if (deviceClass) {
      const classIcons = {
        motion: "mdi:motion-sensor",
        occupancy: "mdi:motion-sensor",
        door: "mdi:door",
        window: "mdi:window-closed",
        garage_door: "mdi:garage",
        opening: "mdi:door-open",
        smoke: "mdi:smoke-detector",
        gas: "mdi:gas-cylinder",
        moisture: "mdi:water-alert",
        temperature: "mdi:thermometer",
        humidity: "mdi:water-percent",
        illuminance: "mdi:brightness-5",
        battery: "mdi:battery",
        power: "mdi:flash",
        energy: "mdi:lightning-bolt",
        voltage: "mdi:sine-wave",
        current: "mdi:current-ac",
        plug: "mdi:power-plug",
        lock: "mdi:lock",
      };
      if (classIcons[deviceClass]) return classIcons[deviceClass];
    }

    if (row.icons[0]) return row.icons[0];

    const domainIcons = {
      light: "mdi:lightbulb",
      switch: "mdi:toggle-switch",
      sensor: "mdi:eye",
      binary_sensor: "mdi:checkbox-marked-circle-outline",
      climate: "mdi:thermostat",
      cover: "mdi:blinds",
      lock: "mdi:lock",
      camera: "mdi:cctv",
      media_player: "mdi:speaker",
      fan: "mdi:fan",
      vacuum: "mdi:robot-vacuum",
      alarm_control_panel: "mdi:shield-home",
      device_tracker: "mdi:map-marker",
      person: "mdi:account",
      button: "mdi:gesture-tap-button",
      scene: "mdi:palette",
      script: "mdi:script-text",
      automation: "mdi:home-automation",
    };

    return domainIcons[row.domains[0]] || "mdi:devices";
  }

  _filteredRows(rows) {
    const search = this._filters.search.trim().toLowerCase();
    const placementFilter = this._filters.placement || (["placed", "unplaced"].includes(this._filters.status) ? this._filters.status : "all");
    const availabilityFilter = this._filters.availability || (["offline", "online"].includes(this._filters.status) ? this._filters.status : "all");
    return rows.filter((row) => {
      if (placementFilter === "placed" && !this._markers[row.key]) return false;
      if (placementFilter === "unplaced" && this._markers[row.key]) return false;
      if (availabilityFilter === "offline" && !row.offline) return false;
      if (availabilityFilter === "online" && row.offline) return false;
      if (this._filters.domain !== "all" && !row.domains.includes(this._filters.domain)) return false;
      if (this._filters.integration !== "all" && !row.integrations.includes(this._filters.integration)) return false;
      if (this._filters.area !== "all" && row.areaName !== this._filters.area) return false;
      if (!search) return true;

      const haystack = `${row.name} ${row.entityId} ${row.areaName} ${row.domain} ${row.integration}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  _normalizedFloors(config) {
    const configuredFloors = Array.isArray(config.floors) ? config.floors : [];
    const source = configuredFloors.length
      ? configuredFloors
      : [
          {
            id: "default",
            name: config.title || "Floor",
            image: config.image || "",
            model: config.model || "",
            markers: config.markers || [],
            animations: config.animations || [],
            interactive_objects: config.interactive_objects || [],
          },
        ];
    const seen = new Set();

    return source.map((floor, index) => {
      const fallback = `floor-${index + 1}`;
      const rawId = floor.id || floor.name || fallback;
      let id = String(rawId)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || fallback;
      while (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      return {
        id,
        name: floor.name || floor.title || rawId || `Floor ${index + 1}`,
        image: floor.image || "",
        model: floor.model || config.model || "",
        default_view: floor.default_view || floor.defaultView || null,
        markers: Array.isArray(floor.markers) ? floor.markers : [],
        brightness_zones: Array.isArray(floor.brightness_zones) ? floor.brightness_zones : [],
        animations: Array.isArray(floor.animations) ? floor.animations : [],
        interactive_objects: Array.isArray(floor.interactive_objects) ? floor.interactive_objects : [],
      };
    });
  }

  _hasMultipleFloors() {
    return Array.isArray(this._config.floors) && this._config.floors.length > 0;
  }

  _activeFloor() {
    return this._floors.find((floor) => floor.id === this._activeFloorId) || this._floors[0] || { id: "default", name: this._config.title, image: this._config.image, model: this._config.model };
  }

  _options(rows, key) {
    const values = rows.flatMap((row) => {
      const value = row[key];
      return Array.isArray(value) ? value : [value];
    });
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  _activeFilterCount() {
    return ["placement", "availability", "domain", "integration", "area"].reduce((count, key) => {
      const value = this._filters[key];
      return count + (value && value !== "all" ? 1 : 0);
    }, 0);
  }

  _configMarkers() {
    return this._markersFromList(this._config.markers || []);
  }

  _configFloorMarkers() {
    if (!this._hasMultipleFloors()) {
      return { [this._activeFloorId || "default"]: this._configMarkers() };
    }

    return this._floors.reduce((result, floor) => {
      result[floor.id] = this._markersFromList(floor.markers || []);
      return result;
    }, {});
  }

  _markersFromList(markersList) {
    return (markersList || []).reduce((markers, marker) => {
      const key = marker.entity || marker.key || marker.device;
      if (!key) return markers;
      const point = marker.coordinate_space === "display" ? this._displayToModelPoint(marker) : marker;
      markers[key] = {
        key,
        entityId: marker.entity || key,
        name: marker.name || "",
        icon: marker.icon || "",
        markerDisplay: this._normalizeMarkerDisplay(marker.marker_display || marker.markerDisplay),
        tapAction: this._normalizeMarkerAction(marker.tap_action || marker.tapAction, "tap"),
        holdAction: this._normalizeMarkerAction(marker.hold_action || marker.holdAction, "hold"),
        navigationPath: this._normalizeNavigationPath(marker.navigation_path || marker.navigationPath),
        lightIntensity: this._normalizeLightIntensity(marker.light_intensity ?? marker.lightIntensity),
        lightType: this._normalizeLightType(marker.light_type ?? marker.lightType),
        lightRadius: this._normalizeLightRadius(marker.light_radius ?? marker.lightRadius),
        lightPreset: marker.light_preset || marker.lightPreset || "",
        renderParams: marker.render_params || marker.renderParams || {},
        subSpots: this._normalizedSubSpots(marker.sub_spots || marker.subSpots, marker),
        lightPath: this._normalizedLightPath(marker.light_path || marker.lightPath, marker),
        lightShape: marker.light_shape || marker.lightShape || "path",
        lightRect: marker.light_rect || marker.lightRect || { width: 100, depth: 80, angle: 0 },
        _configLightShapeExplicit: marker.light_shape !== undefined || marker.lightShape !== undefined,
        _configLightRectExplicit: marker.light_rect !== undefined || marker.lightRect !== undefined,
        _configLightPathExplicit: marker.light_path !== undefined || marker.lightPath !== undefined,
        colorThresholds: this._normalizeColorThresholds(marker.color_thresholds || marker.colorThresholds),
        x: Number(point.x),
        y: Number(point.y),
        z: Number(point.z),
      };
      return markers;
    }, {});
  }

  _normalizedMarkers(markers) {
    return Object.entries(markers || {}).reduce((result, [key, marker]) => {
      const x = Number(marker.x);
      const y = Number(marker.y);
      const z = Number(marker.z);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return result;
      const entityId = marker.entityId || marker.entity || key;
      const markerKey = entityId || key;
      const is3DMarker = Number.isFinite(z);
      result[markerKey] = {
        key: markerKey,
        entityId,
        name: marker.name || "",
        icon: marker.icon || "",
        markerDisplay: this._normalizeMarkerDisplay(marker.markerDisplay || marker.marker_display),
        tapAction: this._normalizeMarkerAction(marker.tapAction || marker.tap_action, "tap"),
        holdAction: this._normalizeMarkerAction(marker.holdAction || marker.hold_action, "hold"),
        navigationPath: this._normalizeNavigationPath(marker.navigationPath || marker.navigation_path),
        lightIntensity: this._normalizeLightIntensity(marker.lightIntensity ?? marker.light_intensity),
        lightType: this._normalizeLightType(marker.lightType ?? marker.light_type),
        lightRadius: this._normalizeLightRadius(marker.lightRadius ?? marker.light_radius),
        lightPreset: marker.lightPreset || marker.light_preset || "",
        renderParams: marker.renderParams || marker.render_params || {},
        subSpots: this._normalizedSubSpots(marker.subSpots || marker.sub_spots, marker),
        lightPath: this._normalizedLightPath(marker.lightPath || marker.light_path, marker),
        lightShape: marker.lightShape || marker.light_shape || "path",
        lightRect: marker.lightRect || marker.light_rect || { width: 100, depth: 80, angle: 0 },
        ...(marker._configLightShapeExplicit ? { _configLightShapeExplicit: true } : {}),
        ...(marker._configLightRectExplicit ? { _configLightRectExplicit: true } : {}),
        ...(marker._configLightPathExplicit ? { _configLightPathExplicit: true } : {}),
        colorThresholds: this._normalizeColorThresholds(marker.colorThresholds || marker.color_thresholds),
        x: is3DMarker ? x : Math.max(0, Math.min(100, x)),
        y: is3DMarker ? y : Math.max(0, Math.min(100, y)),
        ...(is3DMarker ? { z } : {}),
      };
      return result;
    }, {});
  }

  _normalizedSubSpots(subSpots, parentMarker = {}) {
    const parentUsesDisplay = parentMarker.coordinate_space === "display";
    return (subSpots || [])
      .map((spot, index) => {
        const sourcePoint = parentUsesDisplay || spot?.coordinate_space === "display" ? this._displayToModelPoint(spot) : spot;
        const x = Number(sourcePoint?.x);
        const y = Number(sourcePoint?.y);
        const z = Number(sourcePoint?.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return {
          name: spot?.name || `Spot ${index + 1}`,
          lightRadius: this._normalizeLightRadius(spot?.light_radius ?? spot?.lightRadius),
          lightPreset: spot?.light_preset || spot?.lightPreset || "",
          renderParams: spot?.render_params || spot?.renderParams || {},
          x,
          y,
          z,
        };
      })
      .filter(Boolean);
  }

  _normalizedLightPath(points, parentMarker = {}) {
    const parentUsesDisplay = parentMarker.coordinate_space === "display";
    return (points || [])
      .map((point) => {
        const sourcePoint = parentUsesDisplay || point?.coordinate_space === "display" ? this._displayToModelPoint(point) : point;
        const x = Number(sourcePoint?.x);
        const y = Number(sourcePoint?.y);
        const z = Number(sourcePoint?.z);
        if (!this._isSafeModelPoint({ x, y, z })) return null;
        return { x, y, z };
      })
      .filter(Boolean);
  }

  _storageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:${this._hasMultipleFloors() ? "floors" : "markers"}${this._coordinateStorageSuffix()}:${path}:${cardKey}`;
  }

  _zonesStorageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:brightness-zones${this._coordinateStorageSuffix()}:${path}:${cardKey}`;
  }

  _displayStorageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:display:${path}:${cardKey}`;
  }

  _modelDefaultViewStorageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:model-default-view${this._coordinateStorageSuffix()}:${path}:${cardKey}`;
  }

  _presetsStorageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:light-presets:${path}:${cardKey}`;
  }

  _coordinateStorageSuffix() {
    const map = this._coordinateMap();
    const vertical = this._verticalAxis();
    const signature = `map-${map.x}${map.y}${map.z}-up-${vertical}`;
    return signature === "map-xyz-up-y" ? "" : `:${signature}`;
  }

  _loadPresets() {
    try {
      const value = localStorage.getItem(this._presetsStorageKey());
      return value ? JSON.parse(value) : {};
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: light presets could not be loaded", error);
      return {};
    }
  }

  _savePresets() {
    try {
      localStorage.setItem(this._presetsStorageKey(), JSON.stringify(this._config.light_presets || {}));
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: light presets could not be saved", error);
    }
    this._refreshYamlExport();
  }

  /** Exports markers, zones and light presets to a downloadable JSON file. */
  _exportSettingsFile() {
    const data = {
      version: VERSION,
      exported_at: new Date().toISOString(),
      markers: this._markers || {},
      zones: this._zones || {},
      light_presets: this._config.light_presets || {},
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorplan-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const status = this.shadowRoot?.querySelector("[data-settings-io-status]");
    if (status) {
      status.textContent = "Exported!";
      window.setTimeout(() => { if (status.textContent === "Exported!") status.textContent = ""; }, 2000);
    }
  }

  /** Imports markers, zones and presets from a JSON file exported by _exportSettingsFile. */
  _importSettingsFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const status = this.shadowRoot?.querySelector("[data-settings-io-status]");
      try {
        const data = JSON.parse(e.target.result);
        if (data.markers) {
          this._markers = this._normalizedMarkers(data.markers);
          this._floorMarkers[this._activeFloorId] = this._markers;
          this._saveMarkers();
        }
        if (data.zones) {
          this._zones = this._normalizedZones(data.zones);
          this._floorZones[this._activeFloorId] = this._zones;
          this._saveZones();
        }
        if (data.light_presets) {
          this._config.light_presets = { ...(this._config.light_presets || {}), ...data.light_presets };
          this._savePresets();
        }
        this._refresh3DMarkerOverlay();
        this._refresh3DZoneOverlay();
        this._render();
        if (status) {
          status.textContent = "Imported!";
          window.setTimeout(() => { if (status.textContent === "Imported!") status.textContent = ""; }, 2000);
        }
      } catch (err) {
        console.error("home-assistant-3d-floorplan: settings import failed", err);
        if (status) status.textContent = "Import failed!";
      }
    };
    reader.readAsText(file);
  }

  _loadMarkers() {
    if (this._config.persist_layout === false) return {};

    try {
      const value = localStorage.getItem(this._storageKey());
      return value ? JSON.parse(value) : {};
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: saved marker layout could not be loaded", error);
      return {};
    }
  }

  _saveMarkers() {
    if (this._config.persist_layout !== false) {
      try {
        this._floorMarkers[this._activeFloorId] = this._markers;
        localStorage.setItem(this._storageKey(), JSON.stringify(this._hasMultipleFloors() ? this._floorMarkers : this._markers));
      } catch (error) {
        console.warn("home-assistant-3d-floorplan: marker layout could not be saved", error);
      }
    }
    this._refreshYamlExport();
  }

  _loadZones() {
    if (this._config.persist_layout === false) return {};

    try {
      const value = localStorage.getItem(this._zonesStorageKey());
      return value ? JSON.parse(value) : {};
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: brightness zones could not be loaded", error);
      return {};
    }
  }

  _saveZones() {
    if (this._config.persist_layout !== false) {
      try {
        this._floorZones[this._activeFloorId] = this._zones;
        localStorage.setItem(this._zonesStorageKey(), JSON.stringify(this._hasMultipleFloors() ? this._floorZones : this._zones));
      } catch (error) {
        console.warn("home-assistant-3d-floorplan: brightness zones could not be saved", error);
      }
    }
    this._refreshYamlExport();
  }

  _configFloorZones() {
    if (!this._hasMultipleFloors()) {
      return { [this._activeFloorId || "default"]: this._zonesFromList(this._config.brightness_zones || []) };
    }

    return this._floors.reduce((result, floor) => {
      result[floor.id] = this._zonesFromList(floor.brightness_zones || []);
      return result;
    }, {});
  }

  _zonesFromList(zonesList) {
    return (zonesList || []).reduce((zones, zone, index) => {
      const id = this._zoneId(zone.id || zone.name || `area-${index + 1}`, zones);
      zones[id] = {
        id,
        name: zone.name || `Area ${index + 1}`,
        color: zone.color || "#f8d66d",
        height: this._zoneHeight(zone),
        dayOpacity: this._zoneOpacityValue(zone.day_opacity ?? zone.dayOpacity, 0.5),
        nightOpacity: this._zoneOpacityValue(zone.night_opacity ?? zone.nightOpacity, 1),
        illuminanceEnabled: zone.illuminance_enabled === true || zone.illuminanceEnabled === true || Boolean(zone.illuminance?.enabled),
        illuminanceEntity: zone.illuminance_entity || zone.illuminanceEntity || zone.illuminance?.entity || "",
        showLux: zone.show_lux === true || zone.showLux === true || zone.illuminance?.show_lux === true,
        lightingMode: zone.lighting_mode || zone.lightingMode || "area",
        points: (zone.points || []).map((point) => this._zoneDisplayPointToModel(point)).filter((point) => this._isSafeModelPoint(point)),
      };
      return zones;
    }, {});
  }

  _cloneMarkers(markers = this._markers) {
    return JSON.parse(JSON.stringify(markers || {}));
  }

  _pushMarkerHistory() {
    const floorId = this._activeFloorId || "default";
    const history = this._history[floorId] || [];
    history.push(this._cloneMarkers());
    if (history.length > this._historyLimit) history.shift();
    this._history[floorId] = history;
  }

  _undoLastMarkerChange() {
    const floorId = this._activeFloorId || "default";
    const history = this._history[floorId] || [];
    const previousMarkers = history.pop();
    if (!previousMarkers) return;

    this._markers = this._normalizedMarkers(previousMarkers);
    this._floorMarkers[floorId] = this._markers;
    this._selectedMarkers.clear();
    this._selectionBox = null;
    this._saveMarkers();
    this._render();
  }

  _mergedFloorMarkers(configMarkers, savedMarkers) {
    const result = {};
    for (const floor of this._floors) {
      result[floor.id] = this._normalizedMarkers(configMarkers[floor.id] || {});
    }

    if (this._hasMultipleFloors()) {
      const savedByFloor = this._looksLikeFloorMarkers(savedMarkers)
        ? savedMarkers
        : { [this._activeFloorId || this._floors[0]?.id || "default"]: savedMarkers };
      for (const floor of this._floors) {
        result[floor.id] = this._mergeMarkerMaps(result[floor.id], savedByFloor[floor.id] || {});
      }
      return result;
    }

    const floorId = this._floors[0]?.id || "default";
    result[floorId] = this._mergeMarkerMaps(result[floorId] || {}, this._looksLikeFloorMarkers(savedMarkers) ? savedMarkers[floorId] || {} : savedMarkers || {});
    return result;
  }

  _mergeMarkerMaps(configMarkers = {}, savedMarkers = {}) {
    const normalizedConfig = this._normalizedMarkers(configMarkers);
    const normalizedSaved = this._normalizedMarkers(savedMarkers);
    return [...new Set([...Object.keys(normalizedConfig), ...Object.keys(normalizedSaved)])].reduce((merged, key) => {
      const configMarker = normalizedConfig[key];
      const savedMarker = normalizedSaved[key];
      if (configMarker && savedMarker) {
        merged[key] = { ...configMarker, ...savedMarker };
        if (configMarker._configLightShapeExplicit || configMarker._configLightPathExplicit) {
          merged[key].lightShape = configMarker.lightShape;
        }
        if (configMarker._configLightRectExplicit) {
          merged[key].lightRect = configMarker.lightRect;
        }
        if (configMarker._configLightPathExplicit) {
          merged[key].lightPath = configMarker.lightPath;
        }
      } else {
        merged[key] = savedMarker || configMarker;
      }
      this._stripConfigMarkerFlags(merged[key]);
      return merged;
    }, {});
  }

  _stripConfigMarkerFlags(marker) {
    if (!marker) return marker;
    delete marker._configLightShapeExplicit;
    delete marker._configLightRectExplicit;
    delete marker._configLightPathExplicit;
    return marker;
  }

  _looksLikeFloorMarkers(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value).some((entry) => entry && typeof entry === "object" && !("x" in entry) && !("y" in entry));
  }

  _loadDisplay() {
    if (this._config.persist_layout === false) return {};

    try {
      const value = localStorage.getItem(this._displayStorageKey());
      return value ? JSON.parse(value) : {};
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: display settings could not be loaded", error);
      return {};
    }
  }

  _saveDisplay() {
    if (this._config.persist_layout === false) return;

    try {
      localStorage.setItem(this._displayStorageKey(), JSON.stringify(this._display));
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: display settings could not be saved", error);
    }
  }

  _loadModelDefaultViews() {
    if (this._config.persist_layout === false) return {};

    try {
      const value = localStorage.getItem(this._modelDefaultViewStorageKey());
      return value ? JSON.parse(value) : {};
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: default model view could not be loaded", error);
      return {};
    }
  }

  _saveModelDefaultViews() {
    if (this._config.persist_layout === false) return;

    try {
      localStorage.setItem(this._modelDefaultViewStorageKey(), JSON.stringify(this._modelDefaultViews));
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: default model view could not be saved", error);
    }
    this._refreshYamlExport();
  }

  _configModelDefaultViews() {
    if (!this._hasMultipleFloors()) {
      return {
        [this._activeFloorId || "default"]: this._normalizeModelView(this._config.default_view || this._config.defaultView),
      };
    }

    return this._floors.reduce((result, floor) => {
      result[floor.id] = this._normalizeModelView(floor.default_view || floor.defaultView);
      return result;
    }, {});
  }

  _mergedModelDefaultViews(configViews, savedViews) {
    const result = {};
    for (const floor of this._floors) {
      const view = this._normalizeModelView(configViews?.[floor.id]);
      if (view) result[floor.id] = view;
    }

    const savedByFloor = this._hasMultipleFloors()
      ? savedViews || {}
      : this._looksLikeFloorViews(savedViews)
        ? savedViews || {}
        : { [this._activeFloorId || this._floors[0]?.id || "default"]: savedViews };

    for (const floor of this._floors) {
      const view = this._normalizeModelView(savedByFloor?.[floor.id]);
      if (view) result[floor.id] = view;
    }
    return result;
  }

  _looksLikeFloorViews(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value).some((entry) => entry && typeof entry === "object" && Array.isArray(entry.position));
  }

  _normalizeModelView(view) {
    if (!view || typeof view !== "object") return null;
    const position = this._numberArray(view.position, 3);
    const target = this._numberArray(view.target, 3);
    if (!position || !target) return null;
    const zoom = Number(view.zoom);
    const near = Number(view.near);
    const far = Number(view.far);
    return {
      position,
      target,
      ...(Number.isFinite(zoom) && zoom > 0 ? { zoom } : {}),
      ...(Number.isFinite(near) && near > 0 ? { near } : {}),
      ...(Number.isFinite(far) && far > 0 ? { far } : {}),
    };
  }

  _numberArray(value, length) {
    if (!Array.isArray(value) || value.length < length) return null;
    const numbers = value.slice(0, length).map((item) => Number(item));
    return numbers.every(Number.isFinite) ? numbers.map((number) => Number(number.toFixed(4))) : null;
  }

  _normalizedDisplay(display) {
    const markerSize = Number(display.markerSize);
    const nudgeStep = Number(display.nudgeStep);
    return {
      markerSize: Number.isFinite(markerSize) ? Math.max(12, Math.min(48, markerSize)) : 18,
      nudgeStep: Number.isFinite(nudgeStep) ? Math.max(0.05, Math.min(10, nudgeStep)) : 1,
      showLabels: display.showLabels !== false && display.showLabels !== "false",
    };
  }

  _mergedFloorZones(configZones, savedZones) {
    const result = {};
    for (const floor of this._floors) {
      result[floor.id] = this._normalizedZones(configZones[floor.id] || {});
    }

    if (this._hasMultipleFloors()) {
      const savedByFloor = this._looksLikeFloorZones(savedZones)
        ? savedZones
        : { [this._activeFloorId || this._floors[0]?.id || "default"]: savedZones };
      for (const floor of this._floors) {
        result[floor.id] = this._normalizedZones({
          ...result[floor.id],
          ...(savedByFloor[floor.id] || {}),
        });
      }
      return result;
    }

    const floorId = this._floors[0]?.id || "default";
    result[floorId] = this._normalizedZones({
      ...(result[floorId] || {}),
      ...(this._looksLikeFloorZones(savedZones) ? savedZones[floorId] || {} : savedZones || {}),
    });
    return result;
  }

  _looksLikeFloorZones(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value).some((entry) => entry && typeof entry === "object" && !Array.isArray(entry.points));
  }

  _normalizedZones(zones) {
    return Object.entries(zones || {}).reduce((result, [key, zone], index) => {
      const id = this._zoneId(zone.id || key || `area-${index + 1}`, result);
      const points = (zone.points || [])
        .map((point) => {
          const modelPoint = this._normalizeModelPoint(point);
          if (!modelPoint) return null;
          return this._zoneDisplayPointToModel(this._modelToDisplayPoint(modelPoint));
        })
        .filter(Boolean);
      result[id] = {
        id,
        name: zone.name || `Area ${index + 1}`,
        color: zone.color || "#f8d66d",
        height: this._zoneHeight(zone),
        dayOpacity: this._zoneOpacityValue(zone.dayOpacity ?? zone.day_opacity, 0.5),
        nightOpacity: this._zoneOpacityValue(zone.nightOpacity ?? zone.night_opacity, 1),
        illuminanceEnabled: zone.illuminanceEnabled === true || zone.illuminance_enabled === true || Boolean(zone.illuminance?.enabled),
        illuminanceEntity: zone.illuminanceEntity || zone.illuminance_entity || zone.illuminance?.entity || "",
        showLux: zone.showLux === true || zone.show_lux === true || zone.illuminance?.show_lux === true,
        lightingMode: zone.lightingMode || zone.lighting_mode || "area",
        points,
      };
      return result;
    }, {});
  }

  _normalizeModelPoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    const z = Number(point?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z };
  }

  _zoneHeight(zone = {}) {
    const direct = Number(zone.height);
    if (Number.isFinite(direct)) return Number(direct.toFixed(4));
    const firstPoint = (zone.points || [])[0];
    if (firstPoint) {
      const displayPoint = ["x", "y", "z"].every((axis) => Number.isFinite(Number(firstPoint?.[axis]))) ? firstPoint : this._modelToDisplayPoint(firstPoint);
      const height = Number(displayPoint[this._verticalAxis()]);
      if (Number.isFinite(height)) return Number(height.toFixed(4));
    }
    return 0;
  }

  _zoneOpacity(zone = {}, mode) {
    return mode === "night" ? this._zoneOpacityValue(zone.nightOpacity ?? zone.night_opacity, 1) : this._zoneOpacityValue(zone.dayOpacity ?? zone.day_opacity, 0.5);
  }

  _zoneOpacityValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, Number(number.toFixed(4)))) : fallback;
  }

  _zoneShadeHeight(zone = {}) {
    return this._zoneHeight(zone);
  }

  _zoneDisplayPointToModel(point) {
    // Keep all floor-plane axes; zero out only the vertical axis so zone points
    // stay on the floor regardless of where the user clicked in 3D space.
    const displayPoint = { x: 0, y: 0, z: 0 };
    const floorAxes = this._floorAxes();
    const hasFullDisplayPoint = ["x", "y", "z"].every((axis) => Number.isFinite(Number(point?.[axis])));
    if (hasFullDisplayPoint) {
      displayPoint.x = Number(point?.x);
      displayPoint.y = Number(point?.y);
      displayPoint.z = Number(point?.z);
    } else {
      displayPoint[floorAxes[0]] = Number(point?.x);
      displayPoint[floorAxes[1]] = Number(point?.[floorAxes[1]] ?? point?.y);
    }
    displayPoint[this._verticalAxis()] = 0;
    return this._displayToModelPoint(displayPoint);
  }

  _zoneId(value, existing = this._zones) {
    const base = String(value || "area")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "area";
    let id = base;
    let index = 2;
    while (existing?.[id]) id = `${base}-${index++}`;
    return id;
  }

  _numberOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  _render() {
    if (!this.shadowRoot) return;

    this._disposeModelViewer();
    this._captureMapScroll();
    this._captureMapAlertScroll();
    this._captureDeviceListScroll();
    const activeElement = this.shadowRoot.activeElement;
    const activeFilter = activeElement?.dataset?.filter || "";
    const activeDisplay = activeElement?.dataset?.display || "";
    const selectionStart = typeof activeElement?.selectionStart === "number" ? activeElement.selectionStart : null;
    const selectionEnd = typeof activeElement?.selectionEnd === "number" ? activeElement.selectionEnd : null;

    const rows = this._deviceRows();
    const filteredRows = this._filteredRows(rows);
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const activeFloor = this._activeFloor();
    const floorTitle = this._hasMultipleFloors() ? `${this._config.title} - ${activeFloor.name}` : this._config.title;
    const offlineMarkers = this._offlineMarkersByFloor(rowByKey);
    this._syncOfflineFocusMemory(offlineMarkers);
    const placedRows = Object.keys(this._markers)
      .map((key) => rowByKey.get(key))
      .filter(Boolean);
    const offlineCount = placedRows.filter((row) => row.offline).length;
    const canEdit = this._canEdit();
    if (!canEdit && this._mode !== "user") {
      this._mode = "user";
      this._selectedMarkers.clear();
      this._sidebarCollapsed = false;
      this._zoneDrawing = false;
    }
    const isEditing = canEdit && this._mode === "edit";
    const modeLabel = isEditing ? "Edit Mode" : "User Mode";
    const activeModel = activeFloor.model || this._config.model || "";
    const isModelView = Boolean(activeModel);

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="panel ${isEditing ? "editing" : "viewing"} ${isEditing && this._sidebarCollapsed ? "sidebar-collapsed" : ""}">
          ${
            isEditing && !this._sidebarCollapsed
              ? `
          <aside>
            <div class="sidebar-status">${this._escape(modeLabel)} - ${placedRows.length} placed / ${offlineCount} offline</div>
            <div class="sidebar-tabs" role="tablist" aria-label="Edit tools">
              <button type="button" data-sidebar-tab="markers" class="${this._sidebarTab === "markers" ? "active" : ""}">Markers</button>
              <button type="button" data-sidebar-tab="areas" class="${this._sidebarTab === "areas" ? "active" : ""}">Areas</button>
            </div>
            ${
              this._sidebarTab === "areas"
                ? `
            <div class="sidebar-tab-panel areas-panel">
              <section class="zone-tools">
                <div class="zone-tools-title">
                  <strong>Brightness Areas</strong>
                  <button type="button" data-zone-add>Add Area</button>
                </div>
                ${this._zoneToolsTemplate()}
              </section>
            </div>
            `
                : `
            <div class="sidebar-tab-panel markers-panel">
              <section class="filters">
                <button type="button" class="filters-toggle" data-filters-toggle aria-expanded="${this._filtersCollapsed ? "false" : "true"}">
                  <span>Filters</span>
                  <span>${this._activeFilterCount() ? `${this._activeFilterCount()} active` : "All"}</span>
                </button>
                ${this._filtersCollapsed ? "" : `
                <div class="filters-options">
                  ${this._select("placement", "Placement", [
                    ["all", "All placements"],
                    ["placed", "Placed"],
                    ["unplaced", "Unplaced"],
                  ])}
                  ${this._select("availability", "Availability", [
                    ["all", "All"],
                    ["offline", "Offline"],
                    ["online", "Online"],
                  ])}
                  ${this._select("domain", "Domain", [["all", "All domains"], ...this._options(rows, "domains").map((value) => [value, value])])}
                  ${this._select("integration", "Integration", [["all", "All integrations"], ...this._options(rows, "integrations").map((value) => [value, value])])}
                  ${this._select("area", "Area", [["all", "All areas"], ...this._options(rows, "areaName").map((value) => [value, value])])}
                </div>
                `}
                <label>
                  <span>Search</span>
                  <input data-filter="search" value="${this._escape(this._filters.search)}" placeholder="Device, entity, area..." />
                </label>
              </section>
              <section class="bulk-actions">
                <label class="placement-mode">
                  <span>Move Mode</span>
                  <select data-placement-mode>
                    ${[
                      ["surface", "Surface click"],
                      ["floor", "Floor only"],
                      ["height", "Height only"],
                      ["auto", "Auto by view"],
                    ]
                      .map(([value, label]) => `<option value="${value}" ${this._placementMode === value ? "selected" : ""}>${label}</option>`)
                      .join("")}
                  </select>
                </label>
                <button type="button" data-auto-place="filtered">Add visible unplaced</button>
              </section>
              <section class="devices">
                ${filteredRows.map((row) => this._deviceListItem(row)).join("") || `<div class="empty-list">No devices match</div>`}
              </section>
            </div>
            `
            }
            <details class="export" data-export ${this._exportOpen ? "open" : ""}>
              <summary>Export YAML</summary>
              <div class="export-actions">
                <button type="button" data-copy-yaml>Copy YAML</button>
                <span data-copy-yaml-status></span>
              </div>
              <textarea readonly data-yaml-export>${this._escape(this._yamlExport(rows))}</textarea>
            </details>
          </aside>
          `
              : ""
          }
          <main>
            <div class="map-toolbar">
              <div class="toolbar-title">${this._escape(floorTitle)}</div>
              ${
                this._hasMultipleFloors()
                  ? `
              <label class="floor-switch" title="Floor">
                <span>Floor</span>
                <select data-floor>
                  ${this._floors
                    .map((floor) => `<option value="${this._escape(floor.id)}" ${floor.id === this._activeFloorId ? "selected" : ""}>${this._escape(floor.name)}</option>`)
                    .join("")}
                </select>
              </label>
              `
                  : ""
              }
              ${
                isModelView
                  ? ""
                  : `
              <div class="zoom-controls" aria-label="Map zoom">
                <span>Zoom</span>
                <input data-zoom-slider type="range" min="50" max="400" step="10" value="${this._escape(Math.round(this._zoom * 100))}" title="Map zoom" />
                <output data-zoom-output>${Math.round(this._zoom * 100)}%</output>
                <button type="button" data-zoom="reset" title="Reset zoom">Reset</button>
              </div>
              `
              }
              <div class="display-controls" aria-label="Marker display">
                <div class="marker-size-stepper" title="Marker size">
                  <span>Size</span>
                  <button type="button" data-marker-size="down" title="Smaller markers" aria-label="Smaller markers">-</button>
                  <output data-marker-size-output>${this._escape(this._display.markerSize)}</output>
                  <button type="button" data-marker-size="up" title="Bigger markers" aria-label="Bigger markers">+</button>
                </div>
                <label class="toolbar-toggle" title="Show marker names">
                  <input data-display="showLabels" type="checkbox" ${this._display.showLabels ? "checked" : ""} />
                  <span>Names</span>
                </label>
              </div>
              ${
                canEdit
                  ? `
              ${
                isEditing
                  ? `<button type="button" class="sidebar-toggle" data-sidebar-toggle title="${this._sidebarCollapsed ? "Show device sidebar" : "Hide device sidebar"}">
                ${this._sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
              </button>`
                  : ""
              }
              <div class="mode-switch" aria-label="Map mode">
                <button type="button" data-mode="user" class="${!isEditing ? "active" : ""}">User Mode</button>
                <button type="button" data-mode="edit" class="${isEditing ? "active" : ""}">Edit Mode</button>
              </div>
              `
                  : ""
              }
            </div>
            <div data-offline-alert>${offlineMarkers.length ? this._offlineMarkerAlertTemplate(offlineMarkers) : ""}</div>
            ${
              isModelView
                ? `
            <div class="model-viewer ${isEditing ? "editable" : ""}" data-model-viewer data-model-url="${this._escape(activeModel)}">
              <div class="model-marker-layer" data-model-marker-layer></div>
              <div class="model-zone-label-layer" data-zone-label-layer></div>
              <div class="model-zone-point-layer" data-zone-point-layer></div>
              ${this._modelCompassTemplate()}
              ${isEditing ? `<div class="selected-marker-panel" data-selected-marker-panel>${this._selectedMarkerPanel()}</div>` : ""}
              <div class="model-status" data-model-status>${isEditing ? "Select an entity, then click the 3D model to place it." : "Loading 3D model..."}</div>
              <div class="version-badge">v${VERSION}</div>
              ${isEditing ? `<canvas class="axes-gizmo" data-axes-gizmo></canvas><div class="axes-legend">${this._axesLegendHTML()}</div>` : ""}
            </div>
            `
                : `<div class="missing-image">Add a model URL in the card YAML.</div>`
            }
          </main>
        </div>
      </ha-card>
      ${this._styles()}
    `;

    this._attachEvents();
    if (isModelView) this._renderModelViewer(activeModel);
    requestAnimationFrame(() => {
      if (this._pendingMarkerFocus) {
        const pendingFocus = this._pendingMarkerFocus;
        if (!isModelView || this._modelViewer) {
          this._focusMarker(pendingFocus.key || pendingFocus, pendingFocus.options || {});
          this._pendingMarkerFocus = null;
        }
      } else {
        this._restoreMapScrollSoon();
      }
      this._restoreMapAlertScroll();
      this._restoreDeviceListScroll();
      const activeSelector = activeFilter
        ? `[data-filter="${this._cssEscape(activeFilter)}"]`
        : activeDisplay
          ? `[data-display="${this._cssEscape(activeDisplay)}"]`
          : "";
      if (activeSelector) {
        const restoredInput = this.shadowRoot.querySelector(activeSelector);
        restoredInput?.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          restoredInput?.setSelectionRange?.(selectionStart, selectionEnd);
        }
      }
    });
  }

  _attachEvents() {
    const isEditing = this._canEdit() && this._mode === "edit";

    this.shadowRoot.querySelectorAll("[data-mode]").forEach((element) => {
      element.addEventListener("click", (event) => {
        this._mode = event.currentTarget.dataset.mode === "edit" ? "edit" : "user";
        if (this._mode !== "edit") {
          this._selectedMarkers.clear();
          this._sidebarCollapsed = false;
          this._zoneDrawing = false;
        }
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-floor]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const floorId = event.currentTarget.value;
        if (!this._floors.some((floor) => floor.id === floorId)) return;
        this._floorMarkers[this._activeFloorId] = this._markers;
        this._floorZones[this._activeFloorId] = this._zones;
        this._activeFloorId = floorId;
        this._markers = this._floorMarkers[floorId] || {};
        this._zones = this._floorZones[floorId] || {};
        this._activeZoneId = "";
        this._zoneDrawing = false;
        this._selectedMarkers.clear();
        this._selectionBox = null;
        this._mapScroll = { left: 0, top: 0, leftRatio: 0, topRatio: 0 };
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-sidebar-toggle]").forEach((element) => {
      element.addEventListener("click", () => {
        this._sidebarCollapsed = !this._sidebarCollapsed;
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-sidebar-tab]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const tab = event.currentTarget.dataset.sidebarTab === "areas" ? "areas" : "markers";
        if (this._sidebarTab === tab) return;
        this._sidebarTab = tab;
        if (tab !== "areas") this._setZoneDrawing("", false);
        this._render();
      });
    });

    this._bindOfflineAlertControls();

    this._bindModelViewControls();

    this.shadowRoot.querySelectorAll("[data-zoom]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const action = event.currentTarget.dataset.zoom;
        if (action === "reset") this._zoom = 1;
        this._applyZoomToDom();
      });
    });

    this.shadowRoot.querySelectorAll("[data-zoom-slider]").forEach((element) => {
      element.addEventListener("input", (event) => {
        const value = Number(event.currentTarget.value);
        this._zoom = Math.max(0.5, Math.min(4, value / 100));
        this._applyZoomToDom();
      });
    });

    this.shadowRoot.querySelectorAll("[data-marker-size]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const direction = event.currentTarget.dataset.markerSize === "up" ? 2 : -2;
        this._display.markerSize = Number(this._display.markerSize || 18) + direction;
        this._display = this._normalizedDisplay(this._display);
        this._saveDisplay();
        this._refreshMarkerSizeOutput();
        if (this._modelViewer) {
          this._refresh3DMarkerOverlay();
        } else {
          this._render();
        }
      });
    });

    this.shadowRoot.querySelectorAll("[data-display]").forEach((element) => {
      element.addEventListener("input", (event) => {
        const key = event.currentTarget.dataset.display;
        if (key === "showLabels") this._display.showLabels = event.currentTarget.checked;
        if (key === "nudgeStep") this._display.nudgeStep = Number(event.currentTarget.value);
        this._display = this._normalizedDisplay(this._display);
        this._saveDisplay();
        if (this._modelViewer && key === "showLabels") {
          this._refresh3DMarkerOverlay();
        } else {
          this._render();
        }
      });
    });

    const map = this.shadowRoot.querySelector("[data-map]");
    if (map) {
      map.addEventListener("scroll", () => {
        this._captureMapScroll();
        this._positionNudgePad();
      });
      const image = map.querySelector("img");
      if (image) {
        image.addEventListener("error", () => {
          map.classList.add("image-failed");
        });
        image.addEventListener("load", () => {
          map.classList.remove("image-failed");
          this._restoreMapScrollSoon();
        });
      }
      this._attachPanEvents(map);
      requestAnimationFrame(() => this._positionNudgePad());
    }

    const mapAlertList = this.shadowRoot.querySelector(".map-alert-list");
    if (mapAlertList) {
      mapAlertList.addEventListener("scroll", () => this._captureMapAlertScroll());
    }

    const deviceList = this.shadowRoot.querySelector(".devices");
    if (deviceList) {
      deviceList.addEventListener("scroll", () => this._captureDeviceListScroll());
    }

    if (!isEditing) {
      this.shadowRoot.querySelectorAll("[data-marker]").forEach((element) => {
        element.addEventListener("click", (event) => {
          const entityId = event.currentTarget.dataset.entity;
          if (!entityId) return;
          const moreInfoEvent = new Event("hass-more-info", { bubbles: true, composed: true });
          moreInfoEvent.detail = { entityId };
          this.dispatchEvent(moreInfoEvent);
        });
      });
      return;
    }

    this.shadowRoot.querySelectorAll("[data-filter]").forEach((element) => {
      element.addEventListener("input", (event) => {
        this._filters[event.target.dataset.filter] = event.target.value;
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-filters-toggle]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._filtersCollapsed = !this._filtersCollapsed;
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-device]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (!isEditing) return;
        if (this._isInteractiveControl(event.target)) return;
        this._pendingDeviceKey = event.currentTarget.dataset.device;
        const status = this.shadowRoot.querySelector("[data-model-status]");
        if (status) {
          const row = this._deviceRows().find((item) => item.key === this._pendingDeviceKey);
          status.hidden = false;
          status.textContent = row ? `Click the 3D model to place ${row.name}.` : "Click the 3D model to place the selected entity.";
        }
        this.shadowRoot.querySelectorAll("[data-device]").forEach((row) => {
          row.classList.toggle("is-pending", row.dataset.device === this._pendingDeviceKey);
          const badge = row.querySelector(".select-marker");
          if (badge && !row.classList.contains("is-placed")) badge.textContent = row.dataset.device === this._pendingDeviceKey ? "Click model…" : "Add";
        });
      });
      element.addEventListener("dragstart", (event) => {
        if (element.classList.contains("is-placed") || this._isInteractiveControl(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.dataTransfer.setData("text/plain", event.currentTarget.dataset.device);
        event.dataTransfer.effectAllowed = "copyMove";
      });
    });

    this.shadowRoot.querySelectorAll("[data-remove]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.remove;
        this._pushMarkerHistory();
        delete this._markers[key];
        this._selectedMarkers.delete(key);
        if (this._pendingDeviceKey === key) this._pendingDeviceKey = null;
        if (this._pendingSubSpot?.key === key) this._pendingSubSpot = null;
        if (this._pendingLightPath?.key === key) this._pendingLightPath = null;
        this._saveMarkers();
        this._refresh3DMarkerOverlay();
        this._refresh3DZoneOverlay();
        this._refreshSelectedMarkerPanel();
        event.currentTarget.closest("[data-device]")?.classList.remove("is-placed", "is-pending");
      });
    });

    this.shadowRoot.querySelectorAll("[data-edit-marker]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._startMarkerMove(event.currentTarget.dataset.editMarker);
      });
    });

    this.shadowRoot.querySelectorAll("[data-export]").forEach((element) => {
      element.addEventListener("toggle", (event) => {
        this._exportOpen = event.currentTarget.open;
      });
    });

    this.shadowRoot.querySelectorAll("[data-copy-yaml]").forEach((element) => {
      element.addEventListener("click", () => this._copyYamlExport());
    });


    this.shadowRoot.querySelectorAll("[data-icon]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => this._updateMarkerIcon(event.currentTarget.dataset.icon, event.detail?.value ?? event.currentTarget.value));
      element.addEventListener("value-changed", (event) => this._updateMarkerIcon(event.currentTarget.dataset.icon, event.detail?.value ?? event.currentTarget.value));
    });

    this.shadowRoot.querySelectorAll("[data-icon-auto]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._updateMarkerIcon(event.currentTarget.dataset.iconAuto, "");
      });
    });

    this.shadowRoot.querySelectorAll("[data-marker-display]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateMarkerDisplay(event.currentTarget.dataset.markerDisplay, event.currentTarget.value);
      });
    });

    this.shadowRoot.querySelectorAll("[data-add-color-threshold]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._addColorThreshold(event.currentTarget.dataset.addColorThreshold);
      });
    });

    this.shadowRoot.querySelectorAll("[data-remove-color-threshold]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._removeColorThreshold(event.currentTarget.dataset.removeColorThreshold, Number(event.currentTarget.dataset.thresholdIndex));
      });
    });

    this.shadowRoot.querySelectorAll("[data-color-threshold-value]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateColorThreshold(event.currentTarget.dataset.colorThresholdValue, Number(event.currentTarget.dataset.thresholdIndex), {
          value: event.currentTarget.value,
        });
      });
    });

    this.shadowRoot.querySelectorAll("[data-color-threshold-color]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("input", (event) => {
        this._syncColorThresholdText(event.currentTarget);
      });
      element.addEventListener("change", (event) => {
        this._updateColorThreshold(event.currentTarget.dataset.colorThresholdColor, Number(event.currentTarget.dataset.thresholdIndex), {
          color: event.currentTarget.value,
        });
      });
    });

    this.shadowRoot.querySelectorAll("[data-color-threshold-text]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateColorThreshold(event.currentTarget.dataset.colorThresholdText, Number(event.currentTarget.dataset.thresholdIndex), {
          color: event.currentTarget.value,
        });
      });
    });

    this.shadowRoot.querySelectorAll("[data-marker-action]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateMarkerAction(event.currentTarget.dataset.markerActionKey, event.currentTarget.dataset.markerAction, event.currentTarget.value);
      });
    });

    this.shadowRoot.querySelectorAll("[data-light-intensity]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateLightIntensity(event.currentTarget.dataset.lightIntensity, event.currentTarget.value);
      });
      element.addEventListener("input", (event) => {
        this._updateLightIntensity(event.currentTarget.dataset.lightIntensity, event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
      });
    });

    this.shadowRoot.querySelectorAll("[data-light-type]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.lightType;
        if (!this._markers[key]) return;
        this._markers[key].lightType = this._normalizeLightType(event.currentTarget.value);
        if ((this._markers[key].lightType || "spot") !== "spot" && this._pendingSubSpot?.key === key) this._pendingSubSpot = null;
        if (!this._supportsLightPath(this._markers[key].lightType) && this._pendingLightPath?.key === key) this._pendingLightPath = null;
        this._saveMarkers();
        this._refresh3DMarkerOverlay();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    this.shadowRoot.querySelectorAll("[data-light-radius]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      const onRadiusChange = (event) => {
        const key = event.currentTarget.dataset.lightRadius;
        if (!this._markers[key]) return;
        const val = this._normalizeLightRadius(event.currentTarget.value) || 1.5;
        this._markers[key].lightRadius = val;
        this._refresh3DZoneOverlay();
      };
      element.addEventListener("input", onRadiusChange);
      element.addEventListener("change", (event) => {
        onRadiusChange(event);
        this._saveMarkers();
      });
    });

    // Render preset selector
    this.shadowRoot.querySelectorAll("[data-light-preset]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.lightPreset;
        if (!this._markers[key]) return;
        this._markers[key].lightPreset = event.currentTarget.value;
        this._saveMarkers();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    this.shadowRoot.querySelectorAll("[data-toggle-render-advanced]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.toggleRenderAdvanced;
        if (!key) return;
        if (this._advancedRenderParamsOpen.has(key)) this._advancedRenderParamsOpen.delete(key);
        else this._advancedRenderParamsOpen.add(key);
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
        else this._refreshDeviceRow(key);
      });
    });

    this._bindRenderParamControls(this.shadowRoot);

    // Export render params to JSON file
    this.shadowRoot.querySelectorAll("[data-export-render-params]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.exportRenderParams;
        const marker = this._markers[key];
        if (!marker) return;
        const name = (marker.name || key).replace(/[^a-z0-9_-]/gi, "_");
        const data = {
          lightType: this._normalizeLightType(marker.lightType) || "spot",
          lightPreset: marker.lightPreset || "",
          renderParams: this._resolveRenderParams(marker),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `light-params-${name}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });

    // Import render params from JSON file
    this.shadowRoot.querySelectorAll("[data-import-render-params]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.importRenderParams;
        const file = event.currentTarget.files[0];
        if (!file || !this._markers[key]) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            const params = data.renderParams || data;
            const cleaned = this._cleanRenderPresetParams(params);
            this._markers[key].renderParams = cleaned;
            if (data.lightPreset) this._markers[key].lightPreset = data.lightPreset;
            this._saveMarkers();
            this._refresh3DZoneOverlay();
            if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
          } catch (err) {
            console.error("home-assistant-3d-floorplan: render params import failed", err);
          }
        };
        reader.readAsText(file);
        event.currentTarget.value = "";
      });
    });

    // Reset render params to built-in defaults
    this.shadowRoot.querySelectorAll("[data-reset-render-params]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.resetRenderParams;
        if (!this._markers[key]) return;
        this._markers[key].renderParams = {};
        this._markers[key].lightPreset = "";
        this._saveMarkers();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    // Save current params as a named preset
    this.shadowRoot.querySelectorAll("[data-save-render-preset]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.saveRenderPreset;
        const marker = this._markers[key];
        if (!marker) return;
        const name = window.prompt("Preset name:");
        if (!name?.trim()) return;
        const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        if (!this._config.light_presets) this._config.light_presets = {};
        this._config.light_presets[safeName] = this._cleanRenderPresetParams(this._resolveRenderParams(marker));
        marker.lightPreset = safeName;
        this._savePresets();
        this._saveMarkers();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    this.shadowRoot.querySelectorAll("[data-coordinate]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.coordinateKey;
        const axis = event.currentTarget.dataset.coordinate;
        this._update3DMarkerCoordinate(key, axis, event.currentTarget.value);
      });
      element.addEventListener("input", (event) => {
        const key = event.currentTarget.dataset.coordinateKey;
        const axis = event.currentTarget.dataset.coordinate;
        this._update3DMarkerCoordinate(key, axis, event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
      });
    });
    this._bindSubSpotControls(this.shadowRoot);
    this._bindLightPathControls(this.shadowRoot);

    this.shadowRoot.querySelectorAll("[data-placement-mode]").forEach((element) => {
      element.addEventListener("change", (event) => {
        this._placementMode = event.currentTarget.value || "surface";
        const status = this.shadowRoot.querySelector("[data-model-status]");
        if (status && this._mode === "edit") {
          status.hidden = false;
          status.textContent = this._placementModeText();
        }
      });
    });

    this._bindZoneTools();

    this.shadowRoot.querySelectorAll("[data-auto-place]").forEach((element) => {
      element.addEventListener("click", (event) => {
        this._autoPlaceMarkers(event.currentTarget.dataset.autoPlace);
      });
    });

    this.shadowRoot.querySelectorAll("[data-nudge]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._nudgeSelectedMarkers(event.currentTarget.dataset.nudge);
      });
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("pointerup", (event) => event.stopPropagation());
    });

    this.shadowRoot.querySelectorAll("[data-marker]").forEach((element) => {
      element.addEventListener("dragstart", (event) => {
        if (this._isInteractiveControl(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const key = event.currentTarget.dataset.marker;
        this._dragMarkerKey = key;
        event.dataTransfer.setData("text/plain", key);
        event.dataTransfer.effectAllowed = "move";
        if ((event.ctrlKey || event.metaKey) && key) this._selectedMarkers.add(key);
      });
      element.addEventListener("dragend", () => {
        this._dragMarkerKey = null;
      });
      element.addEventListener("click", (event) => {
        const key = event.currentTarget.dataset.marker;
        if (key) {
          event.preventDefault();
          event.stopPropagation();
          if (event.ctrlKey || event.metaKey) {
            if (this._selectedMarkers.has(key)) this._selectedMarkers.delete(key);
            else this._selectedMarkers.add(key);
          } else {
            this._selectedMarkers.clear();
            this._selectedMarkers.add(key);
          }
          this._render();
          return;
        }

        const entityId = event.currentTarget.dataset.entity;
        if (!entityId) return;
        const moreInfoEvent = new Event("hass-more-info", { bubbles: true, composed: true });
        moreInfoEvent.detail = { entityId };
        this.dispatchEvent(moreInfoEvent);
      });
    });

    if (map) {
      map.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      map.addEventListener("drop", (event) => {
        event.preventDefault();
        const key = event.dataTransfer.getData("text/plain");
        const row = this._deviceRows().find((item) => item.key === key);
        if (!row) return;

        const point = this._pointFromEvent(map.querySelector(".map-content") || map, event);
        const existingMarker = this._markers[key];
        const moveSelectedGroup = (event.ctrlKey || event.metaKey) && existingMarker && this._selectedMarkers.has(key) && this._selectedMarkers.size > 1;
        this._pushMarkerHistory();

        if (moveSelectedGroup) {
          const deltaX = point.x - existingMarker.x;
          const deltaY = point.y - existingMarker.y;
          for (const selectedKey of this._selectedMarkers) {
            const marker = this._markers[selectedKey];
            if (!marker) continue;
            marker.x = Math.max(0, Math.min(100, marker.x + deltaX));
            marker.y = Math.max(0, Math.min(100, marker.y + deltaY));
          }
        } else {
          this._markers[key] = {
            key,
            entityId: row.entityId,
            name: row.name,
            icon: existingMarker?.icon || "",
            x: point.x,
            y: point.y,
          };
          this._selectedMarkers.clear();
          this._selectedMarkers.add(key);
        }
        this._dragMarkerKey = null;
        this._saveMarkers();
        this._render();
      });
    }
  }

  _pointFromEvent(element, event) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  }

  _bindModelViewControls(root = this.shadowRoot) {
    root?.querySelectorAll?.("[data-model-view]").forEach((element) => {
      element.addEventListener("click", (event) => {
        this._setModelView(event.currentTarget.dataset.modelView);
      });
    });

    root?.querySelectorAll?.("[data-model-default-view]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const action = event.currentTarget.dataset.modelDefaultView;
        if (action === "save") this._saveCurrentModelDefaultView();
        if (action === "clear") this._clearCurrentModelDefaultView();
      });
    });
  }

  _selectionBoxTemplate() {
    const box = this._normalizedSelectionBox();
    return `
      <div
        class="selection-box"
        style="left: ${this._escape(box.left)}%; top: ${this._escape(box.top)}%; width: ${this._escape(box.width)}%; height: ${this._escape(box.height)}%;"
      ></div>
    `;
  }

  _normalizedSelectionBox() {
    const box = this._selectionBox || { startX: 0, startY: 0, endX: 0, endY: 0 };
    const left = Math.min(box.startX, box.endX);
    const right = Math.max(box.startX, box.endX);
    const top = Math.min(box.startY, box.endY);
    const bottom = Math.max(box.startY, box.endY);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  _updateSelectionFromBox(additive = false) {
    if (!this._selectionBox) return;
    const box = this._normalizedSelectionBox();
    if (!additive) this._selectedMarkers.clear();

    for (const [key, marker] of Object.entries(this._markers)) {
      if (marker.x >= box.left && marker.x <= box.right && marker.y >= box.top && marker.y <= box.bottom) {
        this._selectedMarkers.add(key);
      }
    }
  }

  _updateSelectionBoxElement(map) {
    if (!this._selectionBox) return;
    const content = map.querySelector(".map-content");
    if (!content) return;
    if (!this._selectionBoxElement || !content.contains(this._selectionBoxElement)) {
      this._selectionBoxElement = document.createElement("div");
      this._selectionBoxElement.className = "selection-box";
      content.appendChild(this._selectionBoxElement);
    }

    const box = this._normalizedSelectionBox();
    this._selectionBoxElement.style.left = `${box.left}%`;
    this._selectionBoxElement.style.top = `${box.top}%`;
    this._selectionBoxElement.style.width = `${box.width}%`;
    this._selectionBoxElement.style.height = `${box.height}%`;
  }

  _removeSelectionBoxElement() {
    this._selectionBoxElement?.remove();
    this._selectionBoxElement = null;
  }

  _syncSelectedMarkerClasses(map) {
    map.querySelectorAll("[data-marker]").forEach((marker) => {
      marker.classList.toggle("selected", this._selectedMarkers.has(marker.dataset.marker));
    });
  }

  _captureMapScroll() {
    const map = this.shadowRoot?.querySelector("[data-map]");
    if (!map) return;
    const maxLeft = Math.max(0, map.scrollWidth - map.clientWidth);
    const maxTop = Math.max(0, map.scrollHeight - map.clientHeight);
    this._mapScroll = {
      left: map.scrollLeft,
      top: map.scrollTop,
      leftRatio: maxLeft ? map.scrollLeft / maxLeft : 0,
      topRatio: maxTop ? map.scrollTop / maxTop : 0,
    };
  }

  _restoreMapScroll() {
    const map = this.shadowRoot?.querySelector("[data-map]");
    if (!map) return;
    const maxLeft = Math.max(0, map.scrollWidth - map.clientWidth);
    const maxTop = Math.max(0, map.scrollHeight - map.clientHeight);
    const left = this._mapScroll.left <= maxLeft ? this._mapScroll.left : maxLeft * (this._mapScroll.leftRatio || 0);
    const top = this._mapScroll.top <= maxTop ? this._mapScroll.top : maxTop * (this._mapScroll.topRatio || 0);
    map.scrollLeft = Math.max(0, Math.min(maxLeft, left));
    map.scrollTop = Math.max(0, Math.min(maxTop, top));
    this._positionNudgePad();
  }

  _restoreMapScrollSoon() {
    if (Date.now() < this._suppressMapRestoreUntil) return;
    this._restoreMapScroll();
    requestAnimationFrame(() => this._restoreMapScroll());
    window.setTimeout(() => this._restoreMapScroll(), 80);
    window.setTimeout(() => this._restoreMapScroll(), 250);
  }

  _captureMapAlertScroll() {
    const mapAlertList = this.shadowRoot?.querySelector(".map-alert-list");
    if (!mapAlertList) return;
    this._mapAlertScrollLeft = mapAlertList.scrollLeft;
  }

  _restoreMapAlertScroll() {
    const mapAlertList = this.shadowRoot?.querySelector(".map-alert-list");
    if (!mapAlertList) return;
    mapAlertList.scrollLeft = this._mapAlertScrollLeft;
  }

  _positionNudgePad() {
    const map = this.shadowRoot?.querySelector("[data-map]");
    const pad = this.shadowRoot?.querySelector(".nudge-pad");
    if (!map || !pad) return;

    const rightOffset = 22;
    const bottomOffset = 34;
    const left = map.scrollLeft + map.clientWidth - pad.offsetWidth - rightOffset;
    const top = map.scrollTop + map.clientHeight - pad.offsetHeight - bottomOffset;
    pad.style.left = `${Math.max(0, left)}px`;
    pad.style.top = `${Math.max(0, top)}px`;
  }

  _captureDeviceListScroll() {
    const deviceList = this.shadowRoot?.querySelector(".devices");
    if (!deviceList) return;
    this._deviceListScrollTop = deviceList.scrollTop;
  }

  _restoreDeviceListScroll() {
    const deviceList = this.shadowRoot?.querySelector(".devices");
    if (!deviceList) return;
    deviceList.scrollTop = this._deviceListScrollTop;
  }

  _attachPanEvents(map) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let panning = false;
    let selecting = false;
    let moved = false;
    let emptyPointerActive = false;
    let pointerId = null;

    map.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-marker]")) return;
      if (event.target.closest(".nudge-pad")) return;
      if (event.button !== undefined && event.button !== 0) return;

      event.preventDefault();
      pointerId = event.pointerId;
      moved = false;
      emptyPointerActive = true;
      if (event.shiftKey && this._canEdit() && this._mode === "edit") {
        const point = this._pointFromEvent(map.querySelector(".map-content") || map, event);
        selecting = true;
        this._isSelecting = true;
        this._selectionBox = {
          startX: point.x,
          startY: point.y,
          endX: point.x,
          endY: point.y,
        };
        map.classList.add("selecting");
        map.setPointerCapture?.(event.pointerId);
        this._updateSelectionFromBox(event.ctrlKey || event.metaKey);
        this._updateSelectionBoxElement(map);
        this._syncSelectedMarkerClasses(map);
        return;
      }

      const canScrollX = map.scrollWidth > map.clientWidth;
      const canScrollY = map.scrollHeight > map.clientHeight;
      if (!canScrollX && !canScrollY) return;

      panning = true;
      this._isPanning = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = map.scrollLeft;
      startTop = map.scrollTop;
      map.classList.add("panning");
      map.setPointerCapture?.(event.pointerId);
    });

    const movePan = (event) => {
      if (selecting) {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        event.preventDefault();
        const point = this._pointFromEvent(map.querySelector(".map-content") || map, event);
        moved = true;
        this._selectionBox = {
          ...this._selectionBox,
          endX: point.x,
          endY: point.y,
        };
        this._updateSelectionFromBox(event.ctrlKey || event.metaKey);
        this._updateSelectionBoxElement(map);
        this._syncSelectedMarkerClasses(map);
        return;
      }

      if (!panning) return;
      if (pointerId !== null && event.pointerId !== pointerId) return;
      event.preventDefault();
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) moved = true;
      map.scrollLeft = startLeft - (event.clientX - startX);
      map.scrollTop = startTop - (event.clientY - startY);
      this._captureMapScroll();
    };

    map.addEventListener("pointermove", movePan);

    const stopPan = (event) => {
      if (selecting) {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        selecting = false;
        this._isSelecting = false;
        pointerId = null;
        emptyPointerActive = false;
        this._selectionBox = null;
        this._removeSelectionBoxElement();
        map.classList.remove("selecting");
        try {
          map.releasePointerCapture?.(event.pointerId);
        } catch (error) {
          // Pointer capture may already be gone after browser/HA interruption.
        }
        this._render();
        return;
      }

      if (!panning) {
        if (!emptyPointerActive) return;
        if (pointerId !== null && event.pointerId !== pointerId) return;
        pointerId = null;
        emptyPointerActive = false;
        if (!moved && this._selectedMarkers.size && this._canEdit() && this._mode === "edit") {
          this._selectedMarkers.clear();
          this._syncSelectedMarkerClasses(map);
          this._render();
        }
        return;
      }
      if (pointerId !== null && event.pointerId !== pointerId) return;
      panning = false;
      pointerId = null;
      emptyPointerActive = false;
      this._isPanning = false;
      this._captureMapScroll();
      map.classList.remove("panning");
      try {
        map.releasePointerCapture?.(event.pointerId);
      } catch (error) {
        // Pointer capture may already be gone after browser/HA interruption.
      }
      if (!moved && this._selectedMarkers.size && this._canEdit() && this._mode === "edit") {
        this._selectedMarkers.clear();
        this._syncSelectedMarkerClasses(map);
        this._render();
      }
    };

    map.addEventListener("pointerup", stopPan);
    map.addEventListener("pointercancel", stopPan);
    map.addEventListener("lostpointercapture", stopPan);
  }

  _nudgeSelectedMarkers(direction) {
    const selected = [...this._selectedMarkers]
      .map((key) => this._markers[key])
      .filter(Boolean);
    if (!selected.length) return;

    const configuredStep = Number(this._display.nudgeStep);
    const step = Number.isFinite(configuredStep) && configuredStep > 0 ? Math.min(10, configuredStep) : 1;
    const mapContent = this.shadowRoot?.querySelector(".map-content");
    const aspectCompensation = mapContent?.offsetWidth && mapContent?.offsetHeight ? mapContent.offsetHeight / mapContent.offsetWidth : 1;
    const xStep = step * aspectCompensation;
    const delta = {
      left: [-xStep, 0],
      right: [xStep, 0],
      up: [0, -step],
      down: [0, step],
    }[direction];
    if (!delta) return;

    this._pushMarkerHistory();
    for (const marker of selected) {
      marker.x = Math.max(0, Math.min(100, marker.x + delta[0]));
      marker.y = Math.max(0, Math.min(100, marker.y + delta[1]));
    }

    this._saveMarkers();
    this._render();
  }

  _autoPlaceMarkers(scope) {
    const rows = this._deviceRows();
    const sourceRows = scope === "all" ? rows : this._filteredRows(rows);
    const unplaced = sourceRows.filter((row) => !this._markers[row.key]);
    if (!unplaced.length) return;

    const columns = Math.ceil(Math.sqrt(unplaced.length));
    const rowsCount = Math.ceil(unplaced.length / columns);
    const xMin = 8;
    const xMax = 92;
    const yMin = 8;
    const yMax = 92;
    const xStep = columns > 1 ? (xMax - xMin) / (columns - 1) : 0;
    const yStep = rowsCount > 1 ? (yMax - yMin) / (rowsCount - 1) : 0;

    this._pushMarkerHistory();
    this._selectedMarkers.clear();

    unplaced.forEach((row, index) => {
      const column = index % columns;
      const rowIndex = Math.floor(index / columns);
      const jitterX = columns > 1 ? (Math.random() - 0.5) * Math.min(4, xStep * 0.35) : 0;
      const jitterY = rowsCount > 1 ? (Math.random() - 0.5) * Math.min(4, yStep * 0.35) : 0;

      this._markers[row.key] = {
        key: row.key,
        entityId: row.entityId,
        name: row.name,
        icon: this._markers[row.key]?.icon || "",
        x: Math.max(0, Math.min(100, xMin + xStep * column + jitterX)),
        y: Math.max(0, Math.min(100, yMin + yStep * rowIndex + jitterY)),
      };
      this._selectedMarkers.add(row.key);
    });

    this._saveMarkers();
    this._render();
  }

  _offlineMarkersByFloor(rowByKey) {
    return this._floors
      .flatMap((floor) => {
        const markers = floor.id === this._activeFloorId ? this._markers : this._floorMarkers[floor.id] || {};
        return Object.keys(markers)
          .map((key) => {
            const row = rowByKey.get(key);
            if (!row?.offline) return null;
            return {
              key,
              name: row.name,
              areaName: row.areaName,
              floorId: floor.id,
              floorName: floor.name,
            };
          })
          .filter(Boolean);
      })
      .sort((a, b) => a.floorName.localeCompare(b.floorName) || a.areaName.localeCompare(b.areaName) || a.name.localeCompare(b.name));
  }

  _offlineMarkerAlertTemplate(markers) {
    return `
      <section class="map-alert" aria-label="Offline devices">
        <div class="map-alert-title">
          <span>!</span>
          <strong>${this._escape(markers.length)} offline ${markers.length === 1 ? "device" : "devices"}</strong>
        </div>
        <div class="map-alert-list">
          ${markers
            .map(
              (marker) => `
          <button
            type="button"
            data-jump-floor="${this._escape(marker.floorId)}"
            data-jump-marker="${this._escape(marker.key)}"
            title="${this._escape(`${marker.floorName} - ${marker.name}`)}"
          >
            ${this._escape(marker.name)}
          </button>
          `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  _offlineFocusId(floorId, markerKey) {
    return `${floorId || ""}::${markerKey || ""}`;
  }

  _syncOfflineFocusMemory(markers) {
    const current = new Set((markers || []).map((marker) => this._offlineFocusId(marker.floorId, marker.key)));
    [...this._offlineFocusedMarkers.keys()].forEach((id) => {
      if (!current.has(id)) this._offlineFocusedMarkers.delete(id);
    });
  }

  _offlineCurrentViewSignature() {
    if (this._modelViewer?.camera && this._modelViewer?.controls) {
      const { camera, controls } = this._modelViewer;
      return {
        type: "3d",
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        zoom: camera.zoom,
      };
    }
    const map = this.shadowRoot?.querySelector("[data-map]");
    if (!map) return null;
    return {
      type: "2d",
      left: map.scrollLeft,
      top: map.scrollTop,
      zoom: this._zoom,
    };
  }

  _offlineFocusMatchesCurrentView(id) {
    const stored = this._offlineFocusedMarkers.get(id);
    if (!stored) return false;
    if (stored.pending) return true;
    const current = this._offlineCurrentViewSignature();
    if (!current || stored.type !== current.type) return false;
    if (current.type === "3d") {
      return this._vectorDistance(stored.position, current.position) < 0.06 && this._vectorDistance(stored.target, current.target) < 0.06 && Math.abs((stored.zoom || 1) - (current.zoom || 1)) < 0.01;
    }
    return Math.abs((stored.left || 0) - current.left) < 8 && Math.abs((stored.top || 0) - current.top) < 8 && Math.abs((stored.zoom || 1) - (current.zoom || 1)) < 0.01;
  }

  _markOfflineFocusView(id) {
    if (!id) return;
    const signature = this._offlineCurrentViewSignature();
    if (signature) this._offlineFocusedMarkers.set(id, signature);
  }

  _vectorDistance(a = [], b = []) {
    return Math.hypot(Number(a[0] || 0) - Number(b[0] || 0), Number(a[1] || 0) - Number(b[1] || 0), Number(a[2] || 0) - Number(b[2] || 0));
  }

  _bindOfflineAlertControls(root = this.shadowRoot) {
    root?.querySelectorAll("[data-jump-marker]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const floorId = event.currentTarget.dataset.jumpFloor;
        const markerKey = event.currentTarget.dataset.jumpMarker;
        this._jumpToMarker(floorId, markerKey);
      });
    });
  }

  _refreshOfflineAlert() {
    const container = this.shadowRoot?.querySelector("[data-offline-alert]");
    if (!container) return;
    const rows = this._deviceRows();
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const offlineMarkers = this._offlineMarkersByFloor(rowByKey);
    this._syncOfflineFocusMemory(offlineMarkers);
    container.innerHTML = offlineMarkers.length ? this._offlineMarkerAlertTemplate(offlineMarkers) : "";
    this._bindOfflineAlertControls(container);
    this._restoreMapAlertScroll();
  }

  _jumpToMarker(floorId, markerKey) {
    if (!floorId || !markerKey || !this._floors.some((floor) => floor.id === floorId)) return;
    const offlineFocusId = this._offlineFocusId(floorId, markerKey);
    const shouldMoveCamera = floorId !== this._activeFloorId || !this._offlineFocusMatchesCurrentView(offlineFocusId);
    if (shouldMoveCamera) this._offlineFocusedMarkers.set(offlineFocusId, { pending: true });
    const focusOptions = { moveCamera: shouldMoveCamera, offlineFocusId };
    if (floorId === this._activeFloorId) {
      this._pendingMarkerFocus = null;
      this._focusMarker(markerKey, focusOptions);
      return;
    }

    this._floorMarkers[this._activeFloorId] = this._markers;
    this._floorZones[this._activeFloorId] = this._zones;
    this._activeFloorId = floorId;
    this._markers = this._floorMarkers[floorId] || {};
    this._zones = this._floorZones[floorId] || {};
    this._activeZoneId = "";
    this._zoneDrawing = false;
    this._selectedMarkers.clear();
    this._selectionBox = null;
    this._pendingMarkerFocus = { key: markerKey, options: focusOptions };
    this._render();
  }

  _applyZoomToDom() {
    const zoomPercent = Math.round(this._zoom * 100);
    const map = this.shadowRoot?.querySelector("[data-map]");
    const content = this.shadowRoot?.querySelector(".map-content");
    const slider = this.shadowRoot?.querySelector("[data-zoom-slider]");
    const output = this.shadowRoot?.querySelector("[data-zoom-output]");
    const centerX = map?.scrollWidth ? (map.scrollLeft + map.clientWidth / 2) / map.scrollWidth : 0.5;
    const centerY = map?.scrollHeight ? (map.scrollTop + map.clientHeight / 2) / map.scrollHeight : 0.5;
    if (content) content.style.width = `${zoomPercent}%`;
    if (map) {
      map.classList.toggle("zoomed-out", this._zoom < 1);
      const maxLeft = Math.max(0, map.scrollWidth - map.clientWidth);
      const maxTop = Math.max(0, map.scrollHeight - map.clientHeight);
      const targetLeft = centerX * map.scrollWidth - map.clientWidth / 2;
      const targetTop = centerY * map.scrollHeight - map.clientHeight / 2;
      map.scrollLeft = Math.max(0, Math.min(maxLeft, targetLeft));
      map.scrollTop = Math.max(0, Math.min(maxTop, targetTop));
      this._captureMapScroll();
    }
    if (slider) slider.value = String(zoomPercent);
    if (output) output.textContent = `${zoomPercent}%`;
    this._positionNudgePad();
  }

  _focusMarker(markerKey, options = {}) {
    if (this._modelViewer) {
      this._focus3DMarker(markerKey, options);
      return;
    }

    const map = this.shadowRoot?.querySelector("[data-map]");
    const marker = this.shadowRoot?.querySelector(`[data-marker="${this._cssEscape(markerKey)}"]`);
    if (!map || !marker) {
      if (options.offlineFocusId) this._offlineFocusedMarkers.delete(options.offlineFocusId);
      return;
    }

    const shouldMoveCamera = options.moveCamera !== false;
    if (shouldMoveCamera) {
      this._isJumping = true;
      this._suppressMapRestoreUntil = Date.now() + 900;
      const left = marker.offsetLeft - map.clientWidth / 2 + marker.offsetWidth / 2;
      const top = marker.offsetTop - map.clientHeight / 2 + marker.offsetHeight / 2;
      const targetLeft = Math.max(0, Math.min(left, map.scrollWidth - map.clientWidth));
      const targetTop = Math.max(0, Math.min(top, map.scrollHeight - map.clientHeight));
      const maxLeft = Math.max(0, map.scrollWidth - map.clientWidth);
      const maxTop = Math.max(0, map.scrollHeight - map.clientHeight);
      this._mapScroll = {
        left: targetLeft,
        top: targetTop,
        leftRatio: maxLeft ? targetLeft / maxLeft : 0,
        topRatio: maxTop ? targetTop / maxTop : 0,
      };
      map.scrollTo({
        left: targetLeft,
        top: targetTop,
        behavior: "smooth",
      });
      window.setTimeout(() => {
        this._isJumping = false;
        this._captureMapScroll();
        this._markOfflineFocusView(options.offlineFocusId);
      }, 900);
    }
    this._restartMarkerFocusAnimation(marker);
    window.setTimeout(() => marker.classList.remove("jump-focus"), 3000);
  }

  _focus3DMarker(markerKey, options = {}) {
    const viewer = this._modelViewer;
    const markerButton = viewer?.markerButtons?.find((marker) => marker.button?.dataset?.marker === markerKey);
    if (!viewer || !markerButton) {
      if (options.offlineFocusId) this._offlineFocusedMarkers.delete(options.offlineFocusId);
      return;
    }

    this._restartMarkerFocusAnimation(markerButton.button);
    if (this._mode === "edit") {
      this._selectedMarkers.clear();
      this._selectedMarkers.add(markerKey);
      this._refreshSelectedMarkerPanel();
      this._highlightSelectedDeviceRow(markerKey);
    }

    if (options.moveCamera !== false) {
      const { THREE, camera, controls } = viewer;
      const target = markerButton.position.clone();
      const currentOffset = camera.position.clone().sub(controls.target);
      const currentDistance = Math.max(0.001, currentOffset.length());
      const direction = currentOffset.length() ? currentOffset.normalize() : new THREE.Vector3(1, 0.8, 1).normalize();
      const targetDistance = Math.max(1.2, Number(viewer.offlineFocusDistance) || 1.2);
      const startPosition = camera.position.clone();
      const startTarget = controls.target.clone();
      const endTarget = target.clone();
      const endPosition = target.clone().add(direction.multiplyScalar(targetDistance));
      const startedAt = performance.now();
      const duration = 650;

      const step = (now) => {
        if (this._modelViewer !== viewer) return;
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        camera.position.lerpVectors(startPosition, endPosition, eased);
        controls.target.lerpVectors(startTarget, endTarget, eased);
        camera.updateProjectionMatrix();
        controls.update();
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          this._markOfflineFocusView(options.offlineFocusId);
        }
      };

      requestAnimationFrame(step);
    }
    window.setTimeout(() => markerButton.button.classList.remove("jump-focus"), 3000);
  }

  _restartMarkerFocusAnimation(element) {
    if (!element) return;
    element.classList.remove("jump-focus");
    void element.offsetWidth;
    element.classList.add("jump-focus");
  }

  _select(key, label, options) {
    const optionHtml = options
      .map(([value, text]) => `<option value="${this._escape(value)}" ${this._filters[key] === value ? "selected" : ""}>${this._escape(text)}</option>`)
      .join("");

    return `
      <label>
        <span>${this._escape(label)}</span>
        <select data-filter="${this._escape(key)}">${optionHtml}</select>
      </label>
    `;
  }

  _zoneToolsTemplate() {
    const zones = Object.values(this._zones || {}).sort((a, b) => a.name.localeCompare(b.name));
    const activeZone = this._zones[this._activeZoneId] || zones[0] || null;
    if (activeZone && !this._activeZoneId) this._activeZoneId = activeZone.id;
    if (!zones.length) {
      return `<div class="zone-empty">Add an area, then click the room corners on the 3D model.</div>`;
    }

    return `
      <label>
        <span>Area</span>
        <select data-zone-select>
          ${zones.map((zone) => `<option value="${this._escape(zone.id)}" ${zone.id === this._activeZoneId ? "selected" : ""}>${this._escape(zone.name)}</option>`).join("")}
        </select>
      </label>
      ${activeZone ? `
      <label>
        <span>Name</span>
        <input data-zone-name="${this._escape(activeZone.id)}" value="${this._escape(activeZone.name)}" />
      </label>
      <label>
        <span>Color</span>
        <input data-zone-color="${this._escape(activeZone.id)}" type="color" value="${this._escape(activeZone.color || "#f8d66d")}" />
      </label>
      <label>
        <span>Height</span>
        <input data-zone-height="${this._escape(activeZone.id)}" type="number" step="0.01" value="${this._escape(this._formatCoordinate(this._zoneHeight(activeZone)))}" />
      </label>
      <label>
        <span>Lighting mode</span>
        <select data-zone-lighting-mode="${this._escape(activeZone.id)}">
          <option value="area" ${(activeZone.lightingMode || "area") === "area" ? "selected" : ""}>Area (zone-wide glow)</option>
          <option value="positional" ${activeZone.lightingMode === "positional" ? "selected" : ""}>Positional (per-light pools)</option>
        </select>
      </label>
      ${this._zoneShadeTemplate(activeZone)}
      <div class="zone-actions">
        <button type="button" data-zone-draw="${this._escape(activeZone.id)}">${this._zoneDrawing && this._activeZoneId === activeZone.id ? "Stop Drawing" : "Draw"}</button>
        <button type="button" data-zone-clear="${this._escape(activeZone.id)}">Clear Points</button>
        <button type="button" data-zone-remove="${this._escape(activeZone.id)}">Remove</button>
      </div>
      <small>${this._escape(activeZone.points.length)} point${activeZone.points.length === 1 ? "" : "s"}${this._zoneDrawing && this._activeZoneId === activeZone.id ? ` - top view locked; clicks save ${this._floorAxes().map((a) => a.toUpperCase()).join("/")} only.` : ""}</small>
      ${this._zonePointEditor(activeZone)}
      ` : ""}
    `;
  }

  _ambientDarknessTemplate() {
    const ambient = this._ambientDarknessConfig();
    return `
      <div class="zone-shade-grid">
        <label>
          <span>Day Shade</span>
          <input data-ambient-opacity="day" type="number" min="0" max="1" step="0.01" value="${this._escape(this._formatCoordinate(ambient.day_opacity))}" />
        </label>
        <label>
          <span>Night Shade</span>
          <input data-ambient-opacity="night" type="number" min="0" max="1" step="0.01" value="${this._escape(this._formatCoordinate(ambient.night_opacity))}" />
        </label>
      </div>
    `;
  }

  _zoneShadeTemplate(zone) {
    const illuminanceEnabled = zone.illuminanceEnabled === true;
    const illuminance = this._zoneIlluminanceInfo(zone);
    return `
      <div class="zone-shade-grid">
        <label>
          <span>Day Shade</span>
          <input data-zone-opacity="day" data-zone-opacity-key="${this._escape(zone.id)}" type="number" min="0" max="1" step="0.01" value="${this._escape(this._formatCoordinate(this._zoneOpacity(zone, "day")))}" />
        </label>
        <label>
          <span>Night Shade</span>
          <input data-zone-opacity="night" data-zone-opacity-key="${this._escape(zone.id)}" type="number" min="0" max="1" step="0.01" value="${this._escape(this._formatCoordinate(this._zoneOpacity(zone, "night")))}" />
        </label>
        <label class="zone-illuminance-toggle">
          <span>Illuminance Sensor</span>
          <input data-zone-illuminance-enabled="${this._escape(zone.id)}" type="checkbox" ${illuminanceEnabled ? "checked" : ""} />
        </label>
        <label class="zone-illuminance-entity">
          <input
            type="text"
            list="illuminance-list-${this._escape(zone.id)}"
            data-zone-illuminance-entity="${this._escape(zone.id)}"
            value="${this._escape(zone.illuminanceEntity || "")}"
            placeholder="Search sensor…"
            autocomplete="off"
            ${illuminanceEnabled ? "" : "disabled"}
          />
          <datalist id="illuminance-list-${this._escape(zone.id)}">
            ${Object.keys(this._hass?.states || {})
              .filter((id) => id.startsWith("sensor.") || id.startsWith("input_number."))
              .sort()
              .map((id) => {
                const name = this._hass.states[id]?.attributes?.friendly_name || id;
                return `<option value="${this._escape(id)}">${this._escape(name)}</option>`;
              }).join("")}
          </datalist>
        </label>
        <label class="zone-illuminance-toggle">
          <span>Show Lux Value</span>
          <input data-zone-show-lux="${this._escape(zone.id)}" type="checkbox" ${zone.showLux === true ? "checked" : ""} ${illuminanceEnabled ? "" : "disabled"} />
        </label>
        ${illuminanceEnabled ? `<small class="zone-illuminance-status">${this._escape(illuminance ? `${this._formatLux(illuminance.lux)} lux -> shade ${this._formatCoordinate(illuminance.opacity)}` : "No valid lux value, using day/night shade")}</small>` : ""}
      </div>
    `;
  }

  _zonePointEditor(zone) {
    if (!(zone.points || []).length) return "";
    const selectedIndex = Number.isInteger(this._activeZonePointIndex) && zone.points[this._activeZonePointIndex] ? this._activeZonePointIndex : 0;
    this._activeZonePointIndex = selectedIndex;
    const selectedPoint = this._modelToDisplayPoint(zone.points[selectedIndex]);
    return `
      <div class="zone-point-editor">
        <div class="zone-point-title">
          <strong>Point ${selectedIndex + 1}</strong>
          <button type="button" data-zone-point-remove="${this._escape(zone.id)}" data-zone-point-index="${selectedIndex}">Remove Point</button>
        </div>
        <div class="zone-coordinate-editor">
          ${this._floorAxes()
            .map((axis) => `
          <label>
            <span>${this._axisLabelHTML(axis)}</span>
            <input data-zone-point-coordinate="${axis}" data-zone-point-key="${this._escape(zone.id)}" data-zone-point-index="${selectedIndex}" type="number" step="1" value="${this._escape(this._formatCoordinateInteger(selectedPoint[axis]))}" />
          </label>
          `)
            .join("")}
        </div>
        <div class="zone-point-list">
          ${(zone.points || [])
            .map((point, index) => {
              const displayPoint = this._modelToDisplayPoint(point);
              const [fa0, fa1] = this._floorAxes();
              return `
          <button type="button" data-zone-point-select="${this._escape(zone.id)}" data-zone-point-index="${index}" class="${index === selectedIndex ? "active" : ""}">
            ${index + 1}. ${fa0.toUpperCase()} ${this._escape(this._formatCoordinateInteger(displayPoint[fa0]))} / ${fa1.toUpperCase()} ${this._escape(this._formatCoordinateInteger(displayPoint[fa1]))}
          </button>
          `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  _refreshZoneTools() {
    const tools = this.shadowRoot?.querySelector(".zone-tools");
    if (!tools) return;
    tools.innerHTML = `
      <div class="zone-tools-title">
        <strong>Brightness Areas</strong>
        <button type="button" data-zone-add>Add Area</button>
      </div>
      ${this._zoneToolsTemplate()}
    `;
    this._bindZoneTools(tools);
  }

  _bindZoneTools(root = this.shadowRoot) {
    root?.querySelectorAll("[data-zone-add]").forEach((element) => {
      element.addEventListener("click", () => this._addBrightnessZone());
    });
    root?.querySelectorAll("[data-zone-select]").forEach((element) => {
      element.addEventListener("change", (event) => {
        this._activeZoneId = event.currentTarget.value;
        this._activeZonePointIndex = this._zones[this._activeZoneId]?.points?.length ? 0 : null;
        this._refreshZoneTools();
        this._refresh3DZonePointOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-name]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneName];
        if (!zone) return;
        zone.name = event.currentTarget.value.trim() || zone.name;
        this._saveZones();
        this._refreshZoneTools();
      });
    });
    root?.querySelectorAll("[data-zone-lighting-mode]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneLightingMode];
        if (!zone) return;
        zone.lightingMode = event.currentTarget.value === "positional" ? "positional" : "area";
        this._saveZones();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
        this._refreshSelectedMarkerPanel();
      });
    });
    root?.querySelectorAll("[data-zone-color]").forEach((element) => {
      element.addEventListener("input", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneColor];
        if (!zone) return;
        zone.color = event.currentTarget.value || zone.color;
        this._saveZones();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-height]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneHeight];
        if (!zone) return;
        const height = Number(event.currentTarget.value);
        if (!Number.isFinite(height)) return;
        zone.height = Number(height.toFixed(4));
        zone.points = (zone.points || []).map((point) => {
          const displayPoint = this._modelToDisplayPoint(point);
          return this._zoneDisplayPointToModel(displayPoint);
        });
        this._saveZones();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-opacity]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneOpacityKey];
        if (!zone) return;
        const opacity = Number(event.currentTarget.value);
        if (!Number.isFinite(opacity)) return;
        const property = event.currentTarget.dataset.zoneOpacity === "night" ? "nightOpacity" : "dayOpacity";
        zone[property] = this._zoneOpacityValue(opacity, property === "nightOpacity" ? 1 : 0.5);
        this._saveZones();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-illuminance-enabled]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneIlluminanceEnabled];
        if (!zone) return;
        zone.illuminanceEnabled = event.currentTarget.checked;
        if (!zone.illuminanceEnabled) zone.showLux = false;
        this._saveZones();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-illuminance-entity]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneIlluminanceEntity];
        if (!zone) return;
        zone.illuminanceEntity = event.currentTarget.value.trim();
        this._saveZones();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-show-lux]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneShowLux];
        if (!zone) return;
        zone.showLux = event.currentTarget.checked;
        this._saveZones();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-ambient-opacity]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const opacity = Number(event.currentTarget.value);
        if (!Number.isFinite(opacity)) return;
        const ambient = { ...this._ambientDarknessConfig() };
        const key = event.currentTarget.dataset.ambientOpacity === "night" ? "night_opacity" : "day_opacity";
        ambient[key] = Math.max(0, Math.min(1, Number(opacity.toFixed(4))));
        this._config.ambient_darkness = ambient;
        this._refreshYamlExport();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-draw]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const id = event.currentTarget.dataset.zoneDraw;
        this._setZoneDrawing(id, !(this._zoneDrawing && this._activeZoneId === id));
        const status = this.shadowRoot?.querySelector("[data-model-status]");
        if (status && this._mode === "edit") {
          status.hidden = false;
          status.textContent = this._zoneDrawing ? `Click the 3D model to outline ${this._zones[id]?.name || "the area"}.` : "Area drawing stopped.";
        }
        this._refreshZoneTools();
      });
    });
    root?.querySelectorAll("[data-zone-clear]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const zone = this._zones[event.currentTarget.dataset.zoneClear];
        if (!zone) return;
        zone.points = [];
        this._saveZones();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-remove]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const id = event.currentTarget.dataset.zoneRemove;
        delete this._zones[id];
        if (this._activeZoneId === id) this._activeZoneId = Object.keys(this._zones)[0] || "";
        this._activeZonePointIndex = this._zones[this._activeZoneId]?.points?.length ? 0 : null;
        if (!this._activeZoneId) this._setZoneDrawing("", false);
        this._saveZones();
        this._refreshZoneTools();
        this._refresh3DZoneOverlay();
      });
    });
    root?.querySelectorAll("[data-zone-point-select]").forEach((element) => {
      element.addEventListener("click", (event) => {
        this._selectZonePoint(event.currentTarget.dataset.zonePointSelect, Number(event.currentTarget.dataset.zonePointIndex));
      });
    });
    root?.querySelectorAll("[data-zone-point-coordinate]").forEach((element) => {
      element.addEventListener("change", (event) => {
        this._updateZonePointCoordinate(
          event.currentTarget.dataset.zonePointKey,
          Number(event.currentTarget.dataset.zonePointIndex),
          event.currentTarget.dataset.zonePointCoordinate,
          event.currentTarget.value
        );
      });
    });
    root?.querySelectorAll("[data-zone-point-remove]").forEach((element) => {
      element.addEventListener("click", (event) => {
        this._removeZonePoint(event.currentTarget.dataset.zonePointRemove, Number(event.currentTarget.dataset.zonePointIndex));
      });
    });
  }

  _addBrightnessZone() {
    const existing = Object.keys(this._zones || {}).length;
    const name = `Area ${existing + 1}`;
    const id = this._zoneId(name);
    this._zones[id] = {
      id,
      name,
      color: "#f8d66d",
      height: 0,
      dayOpacity: 0.5,
      nightOpacity: 1,
      illuminanceEnabled: false,
      illuminanceEntity: "",
      showLux: false,
      lightingMode: "area",
      points: [],
    };
    this._setZoneDrawing(id, true);
    this._saveZones();
    this._refreshZoneTools();
    this._refresh3DZoneOverlay();
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status && this._mode === "edit") {
      status.hidden = false;
      status.textContent = `Click the 3D model to outline ${name}.`;
    }
  }

  _setZoneDrawing(zoneId, enabled) {
    this._activeZoneId = zoneId || this._activeZoneId;
    this._zoneDrawing = Boolean(enabled && this._activeZoneId);
    if (this._zoneDrawing) this._pendingDeviceKey = null;
    this._applyZoneDrawingState();
  }

  _applyZoneDrawingState() {
    const viewer = this._modelViewer;
    viewer?.container?.classList.toggle("zone-drawing", this._zoneDrawing);
    if (!viewer?.controls) return;
    viewer.controls.enableRotate = !this._zoneDrawing;
    viewer.controls.enablePan = true;
    viewer.controls.enableZoom = true;
    if (this._zoneDrawing) this._lockZoneTopView();
  }

  _selectZonePoint(zoneId, index) {
    const zone = this._zones[zoneId];
    if (!zone || !zone.points[index]) return;
    this._activeZoneId = zoneId;
    this._activeZonePointIndex = index;
    this._refreshZoneTools();
    this._refresh3DZonePointOverlay();
  }

  _updateZonePointCoordinate(zoneId, index, axis, value) {
    const zone = this._zones[zoneId];
    if (!zone || !zone.points[index] || !this._floorAxes().includes(axis)) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const displayPoint = this._modelToDisplayPoint(zone.points[index]);
    displayPoint[axis] = Math.round(number);
    zone.points[index] = this._zoneDisplayPointToModel(displayPoint);
    this._activeZoneId = zoneId;
    this._activeZonePointIndex = index;
    this._saveZones();
    this._refreshZoneTools();
    this._refresh3DZoneOverlay();
  }

  _removeZonePoint(zoneId, index) {
    const zone = this._zones[zoneId];
    if (!zone || !zone.points[index]) return;
    zone.points.splice(index, 1);
    this._activeZoneId = zoneId;
    this._activeZonePointIndex = zone.points.length ? Math.max(0, Math.min(index, zone.points.length - 1)) : null;
    this._saveZones();
    this._refreshZoneTools();
    this._refresh3DZoneOverlay();
  }

  _lockZoneTopView() {
    const viewer = this._modelViewer;
    if (!viewer?.THREE || !viewer?.camera || !viewer?.controls) return;
    const { THREE, camera, controls } = viewer;
    const target = controls.target.clone();
    const distance = Math.max(1, camera.position.distanceTo(target));
    const modelVertical = this._coordinateMap()[this._verticalAxis()] || "z";
    const direction = new THREE.Vector3(
      modelVertical === "x" ? 1 : 0,
      modelVertical === "y" ? 1 : 0,
      modelVertical === "z" ? 1 : 0
    );
    camera.position.copy(target).add(direction.multiplyScalar(distance));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
  }

  _setModelView(viewName) {
    const viewer = this._modelViewer;
    if (!viewer?.THREE || !viewer?.camera || !viewer?.controls) return;
    if (viewName === "default") {
      const view = this._modelDefaultViews?.[this._activeFloorId || "default"];
      if (view) this._animateModelCameraView(view, viewer.camera, viewer.controls);
      return;
    }

    const direction = this._modelViewDirection(viewName, viewer.THREE);
    if (!direction) return;
    const { camera, controls } = viewer;
    const target = controls.target.clone();
    const distance = Math.max(1, camera.position.distanceTo(target));
    this._animateModelCameraView({
      position: target.clone().add(direction.multiplyScalar(distance)).toArray(),
      target: target.toArray(),
      zoom: camera.zoom,
      near: camera.near,
      far: camera.far,
    }, camera, controls);
  }

  _modelViewDirection(viewName, THREE) {
    const map = this._coordinateMap();
    const vectorForDisplayAxis = (displayAxis, sign = 1) => {
      const modelAxis = map[displayAxis] || displayAxis;
      return new THREE.Vector3(
        modelAxis === "x" ? sign : 0,
        modelAxis === "y" ? sign : 0,
        modelAxis === "z" ? sign : 0
      );
    };
    const vertical = vectorForDisplayAxis(this._verticalAxis(), 1);
    const east = vectorForDisplayAxis("x", 1);
    const north = vectorForDisplayAxis("y", 1);
    const views = {
      top: vertical,
      north: north.clone().add(vertical),
      east: east.clone().add(vertical),
      south: north.clone().negate().add(vertical),
      west: east.clone().negate().add(vertical),
    };
    return views[viewName]?.normalize?.() || null;
  }

  _currentModelCameraView() {
    const viewer = this._modelViewer;
    if (!viewer?.camera || !viewer?.controls) return null;
    const { camera, controls } = viewer;
    return this._normalizeModelView({
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      zoom: camera.zoom,
      near: camera.near,
      far: camera.far,
    });
  }

  _applyModelCameraView(view, camera, controls) {
    const normalized = this._normalizeModelView(view);
    if (!normalized) return false;
    this._modelViewAnimation += 1;
    camera.position.fromArray(normalized.position);
    controls.target.fromArray(normalized.target);
    camera.zoom = Number.isFinite(normalized.zoom) ? normalized.zoom : camera.zoom;
    camera.near = Number.isFinite(normalized.near) ? normalized.near : camera.near;
    camera.far = Number.isFinite(normalized.far) ? normalized.far : camera.far;
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    controls.update();
    this._captureModelCameraState();
    return true;
  }

  _animateModelCameraView(view, camera, controls) {
    const viewer = this._modelViewer;
    const normalized = this._normalizeModelView(view);
    if (!viewer || !normalized) return false;
    const THREE = viewer.THREE;
    const animationId = ++this._modelViewAnimation;
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPosition = new THREE.Vector3().fromArray(normalized.position);
    const endTarget = new THREE.Vector3().fromArray(normalized.target);
    const startZoom = Number(camera.zoom) || 1;
    const endZoom = Number.isFinite(normalized.zoom) ? normalized.zoom : startZoom;
    const startedAt = performance.now();
    const duration = 1400;

    const step = (now) => {
      if (this._modelViewer !== viewer || animationId !== this._modelViewAnimation) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      camera.position.lerpVectors(startPosition, endPosition, eased);
      controls.target.lerpVectors(startTarget, endTarget, eased);
      camera.zoom = startZoom + (endZoom - startZoom) * eased;
      camera.near = Number.isFinite(normalized.near) ? normalized.near : camera.near;
      camera.far = Number.isFinite(normalized.far) ? normalized.far : camera.far;
      camera.lookAt(controls.target);
      camera.updateProjectionMatrix();
      controls.update();
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        this._captureModelCameraState();
      }
    };

    requestAnimationFrame(step);
    return true;
  }

  _saveCurrentModelDefaultView() {
    const view = this._currentModelCameraView();
    if (!view) return;
    this._modelDefaultViews[this._activeFloorId || "default"] = view;
    this._saveModelDefaultViews();
    this._refreshModelCompass();
    this._showModelStatus("Startup view saved.");
  }

  _clearCurrentModelDefaultView() {
    delete this._modelDefaultViews[this._activeFloorId || "default"];
    this._saveModelDefaultViews();
    this._refreshModelCompass();
    this._showModelStatus("Startup view cleared.");
  }

  _refreshModelCompass() {
    const compass = this.shadowRoot?.querySelector(".model-compass");
    if (!compass) return;
    const template = document.createElement("template");
    template.innerHTML = this._modelCompassTemplate().trim();
    const nextCompass = template.content.firstElementChild;
    compass.replaceWith(nextCompass);
    this._bindModelViewControls(nextCompass);
  }

  _showModelStatus(message) {
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
    window.setTimeout(() => {
      if (status.textContent === message) {
        status.hidden = this._mode !== "edit";
        status.textContent = this._mode === "edit" ? "Select an entity, then click the 3D model to place it." : "";
      }
    }, 1400);
  }

  _refreshMarkerSizeOutput() {
    this.shadowRoot?.querySelectorAll("[data-marker-size-output]").forEach((output) => {
      output.textContent = String(this._display.markerSize);
    });
  }

  _deviceListItem(row) {
    const placed = Boolean(this._markers[row.key]);
    return `
      <div class="device-row ${placed ? "is-placed" : ""} ${this._pendingDeviceKey === row.key ? "is-pending" : ""} ${row.offline ? "offline" : "online"}" draggable="${placed ? "false" : "true"}" data-device="${this._escape(row.key)}">
        ${this._deviceRowInner(row)}
      </div>
    `;
  }

  _deviceRowInner(row) {
    const placed = Boolean(this._markers[row.key]);
    return `
        <span class="dot"><ha-icon icon="${this._escape(this._markerIcon(row))}"></ha-icon></span>
        <span class="device-text">
          <strong>${this._escape(row.name)}</strong>
          <small>${this._escape(row.areaName)} - ${this._escape(row.deviceName || row.domain || row.integration)}</small>
        </span>
        ${
          placed
            ? `<div class="row-actions">
                <button type="button" class="remove" data-remove="${this._escape(row.key)}" title="Remove from map">Remove</button>
              </div>`
            : `<button type="button" class="select-marker" data-pending-device="${this._escape(row.key)}">${this._pendingDeviceKey === row.key ? "Click model…" : "Add"}</button>`
        }
    `;
  }

  _actionEditor(row) {
    return `
      <div class="action-editor">
        ${[
          ["tap", "Tap"],
          ["hold", "Hold"],
        ]
          .map(([type, label]) => {
            const marker = this._markers[row.key] || {};
            const selected = this._normalizeMarkerAction(type === "tap" ? marker.tapAction : marker.holdAction, type) || this._defaultDomainAction(row, type);
            const options = this._markerActionOptions(type)
              .map(([value, optionLabel]) => `<option value="${this._escape(value)}" ${selected === value ? "selected" : ""}>${this._escape(optionLabel)}</option>`)
              .join("");
            return `
        <label>
          <span>${this._escape(label)}</span>
          <select data-marker-action="${this._escape(type)}" data-marker-action-key="${this._escape(row.key)}">${options}</select>
        </label>
        `;
          })
          .join("")}
      </div>
    `;
  }

  _lightIntensityEditor(row) {
    if (row?.primaryDomain !== "light") return "";
    const marker = this._markers[row.key] || {};
    const intensity = this._normalizeLightIntensity(marker.lightIntensity);
    const lightType = this._normalizeLightType(marker.lightType) || "spot";
    const lightRadius = marker.lightRadius !== "" && marker.lightRadius !== undefined ? marker.lightRadius : "";

    // Find the zone this marker belongs to
    const zone = Object.values(this._zones || {}).find((z) => this._pointInZone(marker, z));
    const zoneMode = zone?.lightingMode || "area";
    const isPositional = zoneMode === "positional";

    // User-defined presets from config
    const userPresets = Object.keys(this._config.light_presets || {});
    const currentPreset = marker.lightPreset || "";

    // Render params (resolved) for showing current values in sliders
    const rp = this._resolveRenderParams(marker);
    const advancedOpen = this._advancedRenderParamsOpen.has(row.key);

    return `
      <label class="light-intensity-editor">
        <span>Light intensity</span>
        <input data-light-intensity="${this._escape(row.key)}" type="number" min="0" max="100" step="1" value="${this._escape(intensity)}" />
        <small>%</small>
      </label>
      ${isPositional ? `
      <label class="light-type-editor">
        <span>Light type</span>
        <select data-light-type="${this._escape(row.key)}">
          <option value="spot" ${(!lightType || lightType === "spot") ? "selected" : ""}>Spot (ceiling downlight)</option>
          <option value="cove" ${lightType === "cove" ? "selected" : ""}>Cove (indirect ceiling bounce)</option>
          <option value="linear" ${lightType === "linear" ? "selected" : ""}>Linear (LED strip)</option>
          <option value="lamp" ${lightType === "lamp" ? "selected" : ""}>Lamp (floor/table)</option>
        </select>
      </label>
      ${lightType ? `
      <label class="light-radius-editor">
        <span>Light radius</span>
        <input data-light-radius="${this._escape(row.key)}" type="number" min="1" max="2000" step="5" value="${this._escape(lightRadius)}" />
      </label>
      <div class="render-params-section">
        <div class="render-params-header">
          <span>Render parameters</span>
          <label class="render-preset-label">
            Preset:
            <select data-light-preset="${this._escape(row.key)}">
              <option value="">Default (${lightType})</option>
              ${userPresets.map((p) => `<option value="${this._escape(p)}" ${currentPreset === p ? "selected" : ""}>${this._escape(p)}</option>`).join("")}
            </select>
          </label>
        </div>
        <button type="button" class="render-advanced-toggle" data-toggle-render-advanced="${this._escape(row.key)}" aria-expanded="${advancedOpen ? "true" : "false"}">
          ${advancedOpen ? "Hide advanced" : "Advanced"}
        </button>
        ${advancedOpen ? `
        <div class="render-params-grid advanced">
          ${this._renderParamSliders(row.key, lightType, rp, marker.renderParams || {})}
        </div>
        <div class="render-params-actions">
          <button type="button" data-reset-render-params="${this._escape(row.key)}" title="Reset to defaults">Reset</button>
          <button type="button" data-save-render-preset="${this._escape(row.key)}" title="Save current values as a named preset">Save as preset…</button>
          <button type="button" data-export-render-params="${this._escape(row.key)}" title="Export parameters to file">Export</button>
          <label class="rp-import-label" title="Import parameters from file">
            Import
            <input type="file" accept=".json" data-import-render-params="${this._escape(row.key)}" style="display:none" />
          </label>
        </div>
        ` : ""}
      </div>
      ${lightType === "spot" ? this._subSpotsEditor(row, marker, userPresets) : ""}
      ${this._supportsLightPath(lightType) ? this._lightPathEditor(row, marker, lightType) : ""}
      ` : ""}
      ` : ""}
    `;
  }

  _subSpotsEditor(row, marker, userPresets = []) {
    const subSpots = Array.isArray(marker.subSpots) ? marker.subSpots : [];
    const parentKey = row.key;
    const spotRows = subSpots.map((subSpot, index) => {
      const editorKey = this._subSpotEditorKey(parentKey, index);
      const displayPoint = this._modelToDisplayPoint(subSpot);
      const effective = this._effectiveSubSpotMarker(marker, subSpot);
      const rp = this._resolveRenderParams(effective);
      const advancedOpen = this._advancedRenderParamsOpen.has(editorKey);
      const currentPreset = subSpot.lightPreset || "";
      const lightRadius = subSpot.lightRadius !== "" && subSpot.lightRadius !== undefined ? subSpot.lightRadius : "";
      return `
        <div class="sub-spot-row" data-sub-spot-row="${this._escape(editorKey)}">
          <div class="sub-spot-title">
            <strong>${this._escape(subSpot.name || `Spot ${index + 1}`)}</strong>
            <div>
              <button type="button" class="move" data-move-sub-spot="${this._escape(parentKey)}" data-sub-spot-index="${index}">Move</button>
              <button type="button" class="remove" data-delete-sub-spot="${this._escape(parentKey)}" data-sub-spot-index="${index}">Remove</button>
            </div>
          </div>
          <label class="light-radius-editor">
            <span>Light radius</span>
            <input data-sub-spot-light-radius="${this._escape(parentKey)}" data-sub-spot-index="${index}" type="number" min="1" max="2000" step="5" value="${this._escape(lightRadius)}" placeholder="Parent" />
          </label>
          <label class="render-preset-label sub-spot-preset">
            Preset:
            <select data-sub-spot-preset="${this._escape(parentKey)}" data-sub-spot-index="${index}">
              <option value="">Parent/default</option>
              ${userPresets.map((p) => `<option value="${this._escape(p)}" ${currentPreset === p ? "selected" : ""}>${this._escape(p)}</option>`).join("")}
            </select>
          </label>
          <div class="coordinate-editor sub-spot-coordinates">
            ${["x", "y", "z"].map((axis) => `
              <label>
                <span>${this._axisLabelHTML(axis)}</span>
                <input data-sub-spot-coordinate="${axis}" data-sub-spot-coordinate-key="${this._escape(parentKey)}" data-sub-spot-index="${index}" type="number" step="1" value="${this._escape(this._formatCoordinateInteger(displayPoint[axis]))}" />
              </label>
            `).join("")}
          </div>
          <button type="button" class="render-advanced-toggle" data-toggle-sub-spot-advanced="${this._escape(parentKey)}" data-sub-spot-index="${index}" aria-expanded="${advancedOpen ? "true" : "false"}">
            ${advancedOpen ? "Hide advanced" : "Advanced"}
          </button>
          ${advancedOpen ? `
            <div class="render-params-grid advanced">
              ${this._renderParamSliders(editorKey, "spot", rp, subSpot.renderParams || {})}
            </div>
            <div class="render-params-actions">
              <button type="button" data-reset-sub-spot-render-params="${this._escape(parentKey)}" data-sub-spot-index="${index}" title="Reset to parent/default">Reset</button>
              <button type="button" data-save-sub-spot-render-preset="${this._escape(parentKey)}" data-sub-spot-index="${index}" title="Save current values as a named preset">Save as preset…</button>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");

    return `
      <div class="sub-spots-section">
        <div class="sub-spots-header">
          <span>Sub-spots</span>
          <button type="button" data-add-sub-spot="${this._escape(parentKey)}">Add sub-spot</button>
        </div>
        ${spotRows || `<div class="sub-spots-empty">No render-only sub-spots yet.</div>`}
      </div>
    `;
  }

  _lightPathEditor(row, marker, lightType) {
    const parentKey = row.key;
    const lightShape = marker.lightShape || "path";
    const isRect = lightShape === "rect";
    const path = Array.isArray(marker.lightPath) ? marker.lightPath : [];
    const drawing = this._pendingLightPath?.key === parentKey && this._pendingLightPath?.mode === "add";
    const rect = marker.lightRect || { width: 100, depth: 80, angle: 0 };

    const pointRows = path.map((point, index) => {
      const displayPoint = this._modelToDisplayPoint(point);
      return `
        <div class="light-path-point-row">
          <strong>Point ${index + 1}</strong>
          <div class="light-path-actions">
            <button type="button" class="move" data-move-light-path-point="${this._escape(parentKey)}" data-light-path-index="${index}">Move</button>
            <button type="button" class="remove" data-delete-light-path-point="${this._escape(parentKey)}" data-light-path-index="${index}">Remove</button>
          </div>
          <div class="coordinate-editor light-path-coordinates">
            ${["x", "y", "z"].map((axis) => `
              <label>
                <span>${this._axisLabelHTML(axis)}</span>
                <input data-light-path-coordinate="${axis}" data-light-path-coordinate-key="${this._escape(parentKey)}" data-light-path-index="${index}" type="number" step="1" value="${this._escape(this._formatCoordinateInteger(displayPoint[axis]))}" />
              </label>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="light-path-section">
        <div class="light-path-header">
          <span>${lightType === "linear" ? "LED strip path" : "Indirect light path"}</span>
          <div class="light-shape-toggle">
            <button type="button" class="${!isRect ? "active" : ""}" data-light-shape="${this._escape(parentKey)}" data-shape="path">Line</button>
            <button type="button" class="${isRect ? "active" : ""}" data-light-shape="${this._escape(parentKey)}" data-shape="rect">Rectangle</button>
          </div>
        </div>

        ${isRect ? `
          <div class="light-rect-editor">
            <label class="light-rect-field">
              <span>Width</span>
              <input type="number" data-light-rect="width" data-light-rect-key="${this._escape(parentKey)}" min="1" max="5000" step="5" value="${this._escape(Number(rect.width) || 100)}" />
            </label>
            <label class="light-rect-field">
              <span>Depth</span>
              <input type="number" data-light-rect="depth" data-light-rect-key="${this._escape(parentKey)}" min="1" max="5000" step="5" value="${this._escape(Number(rect.depth) || 80)}" />
            </label>
            <label class="light-rect-field">
              <span>Rotation°</span>
              <input type="number" data-light-rect="angle" data-light-rect-key="${this._escape(parentKey)}" min="-180" max="180" step="1" value="${this._escape(Number(rect.angle) || 0)}" />
            </label>
            <small class="light-rect-hint">Center = marker position. Move marker to reposition.</small>
          </div>
        ` : `
          <div class="light-path-actions-bar">
            <button type="button" data-toggle-light-path-draw="${this._escape(parentKey)}">${drawing ? "Stop drawing" : "Draw line"}</button>
            <button type="button" class="remove" data-clear-light-path="${this._escape(parentKey)}" ${path.length ? "" : "disabled"}>Clear</button>
          </div>
          ${path.length ? pointRows : `<div class="light-path-empty">Click "Draw line", then click the 3D model to add path points.</div>`}
        `}
      </div>
    `;
  }

  /** Descriptions and effectiveness notes for each render parameter. */
  _renderParamDescriptions() {
    return {
      intensity:          { desc: "Overall brightness multiplier for this light.",                       effective: "All types" },
      distance:           { desc: "How far the light reaches - affects wall reach and floor pool size.", effective: "All types" },
      decay:              { desc: "Falloff speed. Low = very soft wide wash. High = sharp tight edge.",  effective: "All types - Most visible on Spot, Cove" },
      angle:              { desc: "Spot cone half-angle in radians. Smaller = narrower beam.",           effective: "Spot only - ignored by others" },
      penumbra:           { desc: "Softness of the spot cone edge. 0 = hard cut, 1 = fully feathered.", effective: "Spot only - ignored by others" },
      tilt_x:             { desc: "Tilts the light in the X floor direction. Moves wall cone sideways.", effective: "Spot, Linear, Cove" },
      tilt_y:             { desc: "Tilts the light up/down. Affects wall cone angle and floor offset.",  effective: "Spot, Linear, Cove" },
      width:              { desc: "Width of the rectangular light source (model units).",                effective: "Linear, Cove - ignored by Spot, Lamp" },
      height:             { desc: "Height of the rectangular light source. Affects emission spread.",    effective: "Linear, Cove - ignored by Spot, Lamp" },
      floor_hotspot_size: { desc: "Size of the bright core of the floor pool relative to main pool.",   effective: "Spot, Lamp - minimal effect on Cove (no hotspot)" },
      floor_saturation:   { desc: "Color saturation of the floor pool glow. 0 = grey, 1.5 = vivid.",   effective: "All types" },
      floor_outer_size:   { desc: "Radius of the wide ambient scatter layer around the floor pool.",    effective: "Spot, Lamp - less relevant for Cove/Linear" },
      floor_outer_brightness: { desc: "Brightness of the outer ambient scatter layer.",                 effective: "Spot, Lamp - less relevant for Cove/Linear" },
      gi_brightness:      { desc: "GI bounce intensity - soft secondary floor fill. 0 = disabled.",    effective: "Spot, Lamp - disabled by default on Cove/Linear" },
      gi_radius:          { desc: "Radius multiplier of the GI bounce mesh (x pool radius).",           effective: "Spot, Lamp" },
      gi_warmth:          { desc: "Warms the GI bounce color (simulates warm floor reflection).",       effective: "Spot, Lamp" },
      wall_intensity_scale: { desc: "Multiplier for overall wall glow brightness.",                     effective: "All types" },
      wall_height_limit:  { desc: "Fraction of zone height the wall mesh covers. 1.0 = full wall.",    effective: "All types" },
      wall_lower_bias:    { desc: "Shifts glow center down the wall. 0 = near fixture, 1 = near floor.", effective: "All types - Most visible on Spot, Cove" },
    };
  }

  /** Renders per-type param number steppers for the render params editor. */
  _renderParamSliders(key, lightType, rp, overrides) {
    const esc = (v) => this._escape(v);
    const isOverridden = (param) => overrides && param in overrides;
    const descs = this._renderParamDescriptions();

    const slider = (param, label, min, max, step, value) => {
      const info = descs[param];
      const tooltip = info ? `${info.desc} | Best for: ${info.effective}` : param;
      return `
        <label class="rp-slider ${isOverridden(param) ? "rp-overridden" : ""}" data-rp-tooltip="${esc(tooltip)}">
          <span>${esc(label)}</span>
          <div class="rp-stepper">
            <button type="button" data-render-param-step="-1" data-render-param-target="${esc(param)}" data-render-param-key="${esc(key)}" aria-label="Decrease ${esc(label)}">-</button>
            <input type="number" data-render-param="${esc(param)}" data-render-param-key="${esc(key)}"
                   min="${min}" max="${max}" step="${step}" value="${Number(value).toFixed(2)}" />
            <button type="button" data-render-param-step="1" data-render-param-target="${esc(param)}" data-render-param-key="${esc(key)}" aria-label="Increase ${esc(label)}">+</button>
          </div>
        </label>
      `;
    };

    const section = (title, body) => `
      <div class="render-param-group">
        <div class="render-param-group-title">${esc(title)}</div>
        <div class="render-param-group-grid">${body}</div>
      </div>
    `;

    const spotShape = lightType === "spot" ? `
      ${slider("angle",    "Angle",    0.1, 1.4, 0.05, rp.angle)}
      ${slider("penumbra", "Penumbra", 0,   1,   0.05, rp.penumbra)}
    ` : "";
    const rectShape = lightType === "linear" || lightType === "cove" ? `
      ${slider("width",  "Width",  1, 500, 5, rp.width)}
      ${slider("height", "Height", 1, 80,  1, rp.height)}
    ` : "";
    const orientation = lightType === "spot"
      ? `${slider("tilt_x", "Tilt X", -60, 60, 1, rp.tilt_x ?? 0)}
         ${slider("tilt_y", "Tilt Y", -60, 60, 1, rp.tilt_y ?? 0)}`
      : this._supportsLightPath(lightType)
        ? `${slider("tilt_x", "Tilt X", -60, 60, 1, rp.tilt_x ?? 0)}
           ${slider("tilt_y", "Tilt Y", -90, 90, 1, rp.tilt_y ?? 0)}`
        : "";

    return `
      ${section("Core", `
        ${slider("intensity", "Intensity", 0, 5,    0.05, rp.intensity)}
        ${slider("distance",  "Distance",  1, 2000, 5,    rp.distance)}
        ${slider("decay",     "Decay",     0, 4,    0.05, rp.decay)}
      `)}
      ${spotShape || rectShape ? section("Light Shape", `
        ${spotShape}${rectShape}${orientation}
      `) : ""}
      ${section("Floor Pool", `
        ${slider("floor_hotspot_size",    "Hotspot size",   0.05, 1.2, 0.05, rp.floor_hotspot_size)}
        ${slider("floor_saturation",      "Saturation",     0,    1.5, 0.05, rp.floor_saturation)}
        ${slider("floor_outer_size",      "Outer size",     1.05, 5,   0.1,  rp.floor_outer_size ?? 2.2)}
        ${slider("floor_outer_brightness","Outer glow",     0,    1.5, 0.05, rp.floor_outer_brightness ?? 0.28)}
        ${slider("gi_brightness",         "GI bounce",      0,    1,   0.02, rp.gi_brightness ?? 0)}
        ${slider("gi_radius",             "GI radius",      1.2,  8,   0.1,  rp.gi_radius ?? 3.2)}
        ${slider("gi_warmth",             "GI warmth",      0,    1,   0.05, rp.gi_warmth ?? 0.35)}
      `)}
      ${section("Wall Glow", `
        ${slider("wall_intensity_scale", "Intensity",   0,   3,   0.05, rp.wall_intensity_scale)}
        ${slider("wall_height_limit",    "Height",      0.1, 1,   0.05, rp.wall_height_limit)}
        ${slider("wall_lower_bias",      "Shift up/down", 0, 1,   0.05, rp.wall_lower_bias ?? 0)}
      `)}
    `;
  }

  _coordinateEditor(row) {
    const marker = this._markers[row.key] || {};
    const displayPoint = this._modelToDisplayPoint(marker);
    return `
      <div class="coordinate-editor">
        ${["x", "y", "z"]
          .map(
            (axis) => `
        <label>
          <span>${this._axisLabelHTML(axis)}</span>
          <input data-coordinate="${axis}" data-coordinate-key="${this._escape(row.key)}" type="number" step="1" value="${this._escape(this._formatCoordinateInteger(displayPoint[axis]))}" />
        </label>
        `
          )
          .join("")}
      </div>
    `;
  }

  _formatCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(4) : "";
  }

  _formatCoordinateInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number)) : "";
  }

  _coordinateSafetyLimit() {
    const bounds = this._modelViewer?.modelBounds;
    if (bounds?.isBox3) {
      const maxAbs = Math.max(
        Math.abs(bounds.min.x), Math.abs(bounds.min.y), Math.abs(bounds.min.z),
        Math.abs(bounds.max.x), Math.abs(bounds.max.y), Math.abs(bounds.max.z)
      );
      const size = bounds.getSize(new this._modelViewer.THREE.Vector3());
      return Math.max(1000, (maxAbs + Math.max(size.x, size.y, size.z, 1)) * 8);
    }
    return 10000;
  }

  _isSafeCoordinateValue(value) {
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= this._coordinateSafetyLimit();
  }

  _isSafeModelPoint(point) {
    return ["x", "y", "z"].every((axis) => this._isSafeCoordinateValue(point?.[axis]));
  }

  _coordinateMap() {
    const raw = this._config.coordinate_map || {};
    const defaultMap = { x: "x", y: "y", z: "z" };
    const used = new Set();
    const fallback = { x: "x", y: "y", z: "z" };
    return ["x", "y", "z"].reduce((map, axis) => {
      const requestedAxis = raw[axis] || defaultMap[axis];
      const modelAxis = ["x", "y", "z"].includes(requestedAxis) && !used.has(requestedAxis) ? requestedAxis : fallback[axis];
      map[axis] = modelAxis;
      used.add(modelAxis);
      return map;
    }, {});
  }

  _displayToModelPoint(point) {
    const map = this._coordinateMap();
    const modelPoint = {};
    for (const displayAxis of ["x", "y", "z"]) {
      modelPoint[map[displayAxis]] = Number(point[displayAxis]);
    }
    return modelPoint;
  }

  _modelToDisplayPoint(point) {
    const map = this._coordinateMap();
    return ["x", "y", "z"].reduce((displayPoint, displayAxis) => {
      displayPoint[displayAxis] = Number(point[map[displayAxis]]);
      return displayPoint;
    }, {});
  }

  _markerModelPoint(marker) {
    return this._displayToModelPoint(marker || {});
  }

  _hitDisplayPoint(point) {
    return this._modelToDisplayPoint(point || {});
  }

  _markerActionOptions(type) {
    const base = [
      ["toggle", "Toggle"],
      ["more-info", "More info"],
      ["navigate", "Navigate"],
      ["none", "None"],
    ];
    if (type === "hold") {
      return [...base, ["move", "Move"], ["select", "Select"]];
    }
    return base;
  }

  _normalizeMarkerAction(action, type) {
    const value = String(action || "").trim();
    if (!value) return "";
    return this._markerActionOptions(type).some(([option]) => option === value) ? value : "";
  }

  _normalizeMarkerDisplay(value) {
    const display = String(value || "").trim();
    return ["icon", "value"].includes(display) ? display : "";
  }

  _markerDisplayMode(row) {
    const marker = this._markers[row?.key] || {};
    const override = this._normalizeMarkerDisplay(marker.markerDisplay);
    if (override) return override;
    if (row?.primaryDomain === "sensor" && ["temperature", "humidity"].includes(row.primaryDeviceClass)) return "value";
    return "icon";
  }

  _markerFace(row) {
    if (this._markerDisplayMode(row) === "value") {
      return { type: "value", value: this._formatMarkerValue(row) };
    }
    return { type: "icon", icon: this._markerIcon(row) };
  }

  _formatMarkerValue(row) {
    const state = row?.primaryState;
    if (state === undefined || state === null || state === "") return "-";
    if (this._isOffline(state)) return "-";
    const number = Number(state);
    const value = Number.isFinite(number) ? (Math.abs(number) >= 100 ? number.toFixed(0) : Math.abs(number) >= 10 ? number.toFixed(1) : number.toFixed(1)) : String(state);
    return `${value}${row?.unit || ""}`;
  }

  _normalizeLightIntensity(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 100;
  }

  _normalizeLightType(value) {
    const normalized = String(value || "").trim();
    const aliases = {
      SpotLight: "spot",
      spotlight: "spot",
      PointLight: "lamp",
      pointlight: "lamp",
      RectAreaLight: "linear",
      rectarealight: "linear",
      spot: "spot",
      cove: "cove",
      linear: "linear",
      lamp: "lamp",
    };
    return aliases[normalized] || aliases[normalized.toLowerCase?.()] || "";
  }

  _threeLightTypeName(lightType) {
    const type = this._normalizeLightType(lightType);
    if (type === "spot") return "SpotLight";
    if (type === "lamp") return "PointLight";
    if (type === "linear" || type === "cove") return "RectAreaLight";
    return "";
  }

  _normalizeLightRadius(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : "";
  }

  _normalOrientationDeg(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(-180, Math.min(180, number));
  }

  _orientationBlend(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(-1, Math.min(1, number)) : 0;
  }

  _orientationSpread(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.05, Math.min(1, number)) : 1;
  }

  /** Built-in default rendering parameters for each light type. */
  _lightRenderDefaults() {
    return {
      spot: {
        intensity: 0.9,
        distance: 150,
        decay: 2,
        angle: 0.95,
        penumbra: 0.45,
        floor_hotspot_size: 0.46,
        floor_saturation: 0.72,
        wall_intensity_scale: 0.82,
        wall_height_limit: 1.0,
        wall_lower_bias: 0.35,
        tilt_x: 0,
        tilt_y: 0,
      },
      cove: {
        intensity: 0.9,
        distance: 220,   // larger reach = samples overlap more, no circles
        decay: 0.5,      // very flat falloff — no visible circular boundary
        width: 120,
        height: 8,
        floor_hotspot_size: 0.4,
        floor_saturation: 0.65,
        wall_intensity_scale: 0.85,
        wall_height_limit: 1.0,
        wall_lower_bias: 0.0,
        tilt_x: 0,
        tilt_y: 0,
      },
      linear: {
        intensity: 1.1,
        distance: 200,   // larger reach
        decay: 0.55,     // very flat falloff
        width: 140,
        height: 6,
        floor_hotspot_size: 0.42,
        floor_saturation: 0.8,
        wall_intensity_scale: 0.9,
        wall_height_limit: 1.0,
        wall_lower_bias: 0.0,
        tilt_x: 0,
        tilt_y: 0,
      },
      lamp: {
        intensity: 1.0,
        distance: 90,
        decay: 2,
        floor_hotspot_size: 0.34,
        floor_saturation: 0.82,
        wall_intensity_scale: 0.7,
        wall_height_limit: 0.75,
        wall_lower_bias: 0.3,
      },
    };
  }

  _threeFriendlyRenderParams(params = {}) {
    const number = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const migrated = { ...params };
    migrated.intensity = number(migrated.intensity, number(migrated.floor_brightness, 1));
    migrated.distance = Math.max(1, number(migrated.distance, number(migrated.wall_reach, 3) * 45));
    migrated.decay = Math.max(0, Math.min(4, number(migrated.decay, number(migrated.wall_falloff, 2))));
    migrated.angle = Math.max(0.1, Math.min(1.4, number(migrated.angle, number(migrated.cone_outer_deg, 56) * Math.PI / 180)));
    migrated.penumbra = Math.max(0, Math.min(1, number(
      migrated.penumbra,
      (() => {
        const inner = number(migrated.cone_inner_deg, 30);
        const outer = number(migrated.cone_outer_deg, 56);
        return outer > 0 ? Math.max(0, Math.min(1, (outer - inner) / outer)) : 0.45;
      })()
    )));
    migrated.width = Math.max(1, number(migrated.width, number(migrated.floor_elongation, 3.5) * 40));
    migrated.height = Math.max(1, number(migrated.height, 8));
    migrated.floor_hotspot_size = Math.max(0.05, Math.min(1.2, number(migrated.floor_hotspot_size, number(migrated.floor_core_size, 0.4))));
    migrated.floor_saturation = Math.max(0, Math.min(1.5, number(migrated.floor_saturation, 0.8)));
    migrated.wall_intensity_scale = Math.max(0, Math.min(3, number(migrated.wall_intensity_scale, number(migrated.wall_peak, 1))));
    migrated.wall_height_limit = Math.max(0.1, Math.min(1, number(migrated.wall_height_limit, number(migrated.wall_height_fraction, 1))));

    // Compatibility fields used by the current overlay renderers.
    migrated.floor_brightness = migrated.intensity;
    migrated.floor_core_brightness = migrated.intensity;
    migrated.floor_core_size = migrated.floor_hotspot_size;
    // Auto-computed compat fields — only overwrite if user hasn't explicitly set them
    const userSet = (key) => Number.isFinite(Number(params[key]));
    migrated.floor_outer_size       = userSet("floor_outer_size")       ? number(params.floor_outer_size, 5)       : Math.max(1.05, Math.min(6, Math.sqrt(migrated.distance / 55)));
    migrated.floor_outer_brightness = userSet("floor_outer_brightness") ? number(params.floor_outer_brightness, 0.12) : Math.max(0.04, Math.min(1.5, migrated.intensity * 0.28));
    migrated.floor_softness = Math.max(0.4, Math.min(2.5, migrated.decay <= 0 ? 1.8 : 2.4 / (migrated.decay + 0.6)));
    migrated.wall_peak = migrated.wall_intensity_scale;
    migrated.wall_falloff = migrated.decay || 1;
    migrated.wall_reach = Math.max(0.5, Math.min(40, migrated.distance / 45));
    migrated.wall_height_fraction = migrated.wall_height_limit;
    migrated.wall_lower_bias = number(migrated.wall_lower_bias, 0);
    migrated.ceiling_light_reduction = Math.max(0.05, Math.min(1, migrated.intensity * 0.35));
    migrated.cone_outer_deg = migrated.angle * 180 / Math.PI;
    migrated.cone_inner_deg = migrated.cone_outer_deg * (1 - migrated.penumbra);
    migrated.floor_elongation = Math.max(1, migrated.width / 40);
    migrated.gi_brightness = userSet("gi_brightness") ? number(params.gi_brightness, 0)    : 0;
    migrated.gi_radius     = userSet("gi_radius")     ? number(params.gi_radius, 3.2)       : Math.max(1.2, Math.min(8, migrated.distance / 55));
    migrated.gi_warmth     = userSet("gi_warmth")     ? number(params.gi_warmth, 0.35)      : 0.35;
    migrated.path_angle = migrated.tilt_y ?? migrated.path_angle ?? 0;
    migrated.path_side = migrated.tilt_x ? Math.max(-1, Math.min(1, migrated.tilt_x / 60)) : (migrated.path_side ?? 0);
    migrated.path_spread = Math.max(0.05, Math.min(1, 1 - migrated.penumbra * 0.65));
    return migrated;
  }

  _cleanRenderPresetParams(params = {}) {
    const allowed = [
      "intensity", "distance", "decay",
      "width", "height",
      "angle", "penumbra", "tilt_x", "tilt_y",
      "floor_hotspot_size", "floor_saturation",
      "floor_outer_size", "floor_outer_brightness",
      "gi_brightness", "gi_radius", "gi_warmth",
      "wall_intensity_scale", "wall_height_limit", "wall_lower_bias",
    ];
    return allowed.reduce((result, key) => {
      if (params[key] !== undefined && params[key] !== null && params[key] !== "") result[key] = params[key];
      return result;
    }, {});
  }

  /**
   * Resolves the final rendering parameters for a marker by merging:
   *   built-in type defaults → named preset overrides → per-marker overrides.
   */
  _resolveRenderParams(marker) {
    const lightType = this._normalizeLightType(marker?.lightType) || "spot";
    const defaults = this._lightRenderDefaults()[lightType] || this._lightRenderDefaults().spot;
    const namedPreset = marker?.lightPreset ? (this._config.light_presets?.[marker.lightPreset] || {}) : {};
    const perMarker = marker?.renderParams || {};
    return this._threeFriendlyRenderParams({ ...defaults, ...namedPreset, ...perMarker });
  }

  _subSpotEditorKey(key, index) {
    return `${key}::sub-spot::${index}`;
  }

  _parseSubSpotEditorKey(editorKey) {
    const parts = String(editorKey || "").split("::sub-spot::");
    const index = Number(parts[1]);
    if (!parts[0] || !Number.isInteger(index) || index < 0) return null;
    return { key: parts[0], index };
  }

  _effectiveSubSpotMarker(marker, subSpot) {
    return {
      ...marker,
      ...subSpot,
      lightType: "spot",
      lightRadius: subSpot?.lightRadius || marker?.lightRadius || "",
      lightPreset: subSpot?.lightPreset || marker?.lightPreset || "",
      renderParams: {
        ...(marker?.renderParams || {}),
        ...(subSpot?.renderParams || {}),
      },
    };
  }

  _lightPathTypes() {
    return ["cove", "linear"];
  }

  _supportsLightPath(lightType) {
    return this._lightPathTypes().includes(this._normalizeLightType(lightType));
  }

  _defaultDomainAction(row, type) {
    const domain = row?.primaryDomain || row?.domain || row?.entityId?.split(".")[0] || "";
    const moreInfoDomains = ["sensor", "binary_sensor", "climate"];
    if (moreInfoDomains.includes(domain)) return "more-info";
    if (domain === "light" || domain === "switch") return type === "tap" ? "toggle" : "more-info";
    return type === "tap" ? "more-info" : "more-info";
  }

  _effectiveMarkerAction(row, type) {
    const marker = this._markers[row?.key] || {};
    if (this._mode === "edit") {
      return this._normalizeMarkerAction(type === "tap" ? this._config.edit_marker_tap_action : this._config.edit_marker_hold_action, "hold") || (type === "tap" ? "select" : "move");
    }
    const override = this._normalizeMarkerAction(type === "tap" ? marker.tapAction : marker.holdAction, type);
    if (override) return override;
    return this._normalizeMarkerAction(type === "tap" ? this._config.marker_tap_action : this._config.marker_hold_action, type) || this._defaultDomainAction(row, type);
  }

  _exportMarkerAction(row, marker, type) {
    const override = this._normalizeMarkerAction(type === "tap" ? marker.tapAction : marker.holdAction, type);
    if (override) return override;
    return this._defaultDomainAction(row, type);
  }

  _selectedMarkerPanel() {
    const key = [...this._selectedMarkers][0];
    if (!key || this._selectedMarkers.size !== 1 || !this._markers[key]) {
      return `<div class="selected-empty">Select a placed marker to edit coordinates.</div>`;
    }
    const row = this._deviceRows().find((item) => item.key === key);
    const name = row?.name || this._markers[key].name || key;
    const displayPoint = this._modelToDisplayPoint(this._markers[key]);
    return `
      <div class="selected-title">
        <strong>${this._escape(name)}</strong>
        <div class="selected-title-actions">
          <button type="button" data-edit-marker="${this._escape(key)}">Move</button>
          <button type="button" class="remove" data-remove="${this._escape(key)}">Remove</button>
        </div>
      </div>
      ${row ? this._iconSelect(row) : ""}
      ${row ? this._markerDisplayEditor(row) : ""}
      ${row ? this._colorThresholdEditor(row) : ""}
      ${row ? this._actionEditor(row) : ""}
      ${row ? this._lightIntensityEditor(row) : ""}
      <div class="coordinate-editor selected-coordinates">
        ${["x", "y", "z"]
          .map(
            (axis) => `
        <label>
          <span>${this._axisLabelHTML(axis)}</span>
          <input data-coordinate="${axis}" data-coordinate-key="${this._escape(key)}" type="number" step="1" value="${this._escape(this._formatCoordinateInteger(displayPoint[axis]))}" />
        </label>
        `
          )
          .join("")}
      </div>
    `;
  }

  _refreshDeviceRow(key) {
    const rowData = this._deviceRows().find((item) => item.key === key);
    const rowElement = this.shadowRoot?.querySelector(`[data-device="${this._cssEscape(key)}"]`);
    if (!rowData || !rowElement) return;
    const placed = Boolean(this._markers[key]);
    rowElement.classList.toggle("is-placed", placed);
    rowElement.classList.toggle("is-pending", this._pendingDeviceKey === key);
    rowElement.innerHTML = this._deviceRowInner(rowData);
    this._bindDeviceRowControls(rowElement);
  }

  _refreshSelectedMarkerPanel() {
    const panel = this.shadowRoot?.querySelector("[data-selected-marker-panel]");
    if (!panel) return;
    panel.innerHTML = this._selectedMarkerPanel();
    this._bindDeviceRowControls(panel);
  }

  _highlightSelectedDeviceRow(key) {
    this.shadowRoot?.querySelectorAll("[data-device]").forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.device === key);
    });
    const selectedRow = this.shadowRoot?.querySelector(`[data-device="${this._cssEscape(key)}"]`);
    selectedRow?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    const rowData = this._deviceRows().find((item) => item.key === key);
    if (status) {
      status.hidden = false;
      status.textContent = rowData ? `${rowData.name} selected. Adjust X/Y/Z or press Move.` : "Marker selected. Adjust X/Y/Z or press Move.";
    }
  }

  _startMarkerMove(key) {
    this._pendingDeviceKey = key;
    this._pendingSubSpot = null;
    this._pendingLightPath = null;
    const row = this._deviceRows().find((item) => item.key === this._pendingDeviceKey);
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status) {
      status.hidden = false;
      status.textContent = row ? `Click the 3D model to move ${row.name}. ${this._placementModeText()}` : "Click the 3D model to move the selected marker.";
    }
    this.shadowRoot?.querySelectorAll("[data-device]").forEach((deviceRow) => {
      deviceRow.classList.toggle("is-pending", deviceRow.dataset.device === this._pendingDeviceKey);
    });
  }

  _bindDeviceRowControls(rowElement) {
    rowElement.querySelectorAll("[data-remove]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.remove;
        this._pushMarkerHistory();
        delete this._markers[key];
        this._selectedMarkers.delete(key);
        if (this._pendingDeviceKey === key) this._pendingDeviceKey = null;
        if (this._pendingSubSpot?.key === key) this._pendingSubSpot = null;
        if (this._pendingLightPath?.key === key) this._pendingLightPath = null;
        this._saveMarkers();
        this._refresh3DMarkerOverlay();
        this._refreshDeviceRow(key);
      });
    });

    rowElement.querySelectorAll("[data-edit-marker]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._startMarkerMove(event.currentTarget.dataset.editMarker);
      });
    });

    rowElement.querySelectorAll("[data-copy-yaml]").forEach((element) => {
      element.addEventListener("click", () => this._copyYamlExport());
    });

    rowElement.querySelectorAll("[data-icon]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => this._updateMarkerIcon(event.currentTarget.dataset.icon, event.detail?.value ?? event.currentTarget.value));
      element.addEventListener("value-changed", (event) => this._updateMarkerIcon(event.currentTarget.dataset.icon, event.detail?.value ?? event.currentTarget.value));
    });

    rowElement.querySelectorAll("[data-icon-auto]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._updateMarkerIcon(event.currentTarget.dataset.iconAuto, "");
      });
    });

    rowElement.querySelectorAll("[data-marker-display]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateMarkerDisplay(event.currentTarget.dataset.markerDisplay, event.currentTarget.value);
      });
    });

    rowElement.querySelectorAll("[data-marker-action]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateMarkerAction(event.currentTarget.dataset.markerActionKey, event.currentTarget.dataset.markerAction, event.currentTarget.value);
      });
    });

    rowElement.querySelectorAll("[data-light-intensity]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateLightIntensity(event.currentTarget.dataset.lightIntensity, event.currentTarget.value);
      });
      element.addEventListener("input", (event) => {
        this._updateLightIntensity(event.currentTarget.dataset.lightIntensity, event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
      });
    });

    rowElement.querySelectorAll("[data-light-type]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.lightType;
        if (!this._markers[key]) return;
        this._markers[key].lightType = this._normalizeLightType(event.currentTarget.value);
        if ((this._markers[key].lightType || "spot") !== "spot" && this._pendingSubSpot?.key === key) this._pendingSubSpot = null;
        if (!this._supportsLightPath(this._markers[key].lightType) && this._pendingLightPath?.key === key) this._pendingLightPath = null;
        this._saveMarkers();
        this._refresh3DMarkerOverlay();
        this._refresh3DZoneOverlay();
        // Re-render panel so the radius field appears/disappears based on type selection
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    rowElement.querySelectorAll("[data-light-radius]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      const onRadiusChange = (event) => {
        const key = event.currentTarget.dataset.lightRadius;
        if (!this._markers[key]) return;
        const val = this._normalizeLightRadius(event.currentTarget.value) || 1.5;
        this._markers[key].lightRadius = val;
        this._refresh3DZoneOverlay();
      };
      element.addEventListener("input", onRadiusChange);
      element.addEventListener("change", (event) => {
        onRadiusChange(event);
        this._saveMarkers();
      });
    });

    rowElement.querySelectorAll("[data-light-preset]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.lightPreset;
        if (!this._markers[key]) return;
        this._markers[key].lightPreset = event.currentTarget.value;
        this._saveMarkers();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    rowElement.querySelectorAll("[data-toggle-render-advanced]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.toggleRenderAdvanced;
        if (!key) return;
        if (this._advancedRenderParamsOpen.has(key)) this._advancedRenderParamsOpen.delete(key);
        else this._advancedRenderParamsOpen.add(key);
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
        else this._refreshDeviceRow(key);
      });
    });

    this._bindRenderParamControls(rowElement);

    rowElement.querySelectorAll("[data-reset-render-params]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.resetRenderParams;
        if (!this._markers[key]) return;
        this._markers[key].renderParams = {};
        this._markers[key].lightPreset = "";
        this._saveMarkers();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    rowElement.querySelectorAll("[data-save-render-preset]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.saveRenderPreset;
        const marker = this._markers[key];
        if (!marker) return;
        const name = window.prompt("Preset name:");
        if (!name?.trim()) return;
        const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        if (!this._config.light_presets) this._config.light_presets = {};
        this._config.light_presets[safeName] = this._cleanRenderPresetParams(this._resolveRenderParams(marker));
        marker.lightPreset = safeName;
        this._savePresets();
        this._saveMarkers();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    rowElement.querySelectorAll("[data-export-render-params]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.exportRenderParams;
        const marker = this._markers[key];
        if (!marker) return;
        const name = (marker.name || key).replace(/[^a-z0-9_-]/gi, "_");
        const data = {
          lightType: this._normalizeLightType(marker.lightType) || "spot",
          lightPreset: marker.lightPreset || "",
          renderParams: this._resolveRenderParams(marker),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `light-params-${name}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });

    rowElement.querySelectorAll("[data-import-render-params]").forEach((element) => {
      element.addEventListener("change", (event) => {
        const key = event.currentTarget.dataset.importRenderParams;
        const file = event.currentTarget.files[0];
        if (!file || !this._markers[key]) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            const params = data.renderParams || data;
            const cleaned = this._cleanRenderPresetParams(params);
            this._markers[key].renderParams = cleaned;
            if (data.lightPreset) this._markers[key].lightPreset = data.lightPreset;
            this._saveMarkers();
            this._refresh3DZoneOverlay();
            if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
          } catch (err) {
            console.error("home-assistant-3d-floorplan: render params import failed", err);
          }
        };
        reader.readAsText(file);
        event.currentTarget.value = "";
      });
    });

    rowElement.querySelectorAll("[data-coordinate]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._update3DMarkerCoordinate(event.currentTarget.dataset.coordinateKey, event.currentTarget.dataset.coordinate, event.currentTarget.value);
      });
      element.addEventListener("input", (event) => {
        this._update3DMarkerCoordinate(event.currentTarget.dataset.coordinateKey, event.currentTarget.dataset.coordinate, event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
      });
    });
    this._bindSubSpotControls(rowElement);
    this._bindLightPathControls(rowElement);
  }

  _bindSubSpotControls(rootElement) {
    if (!rootElement) return;
    rootElement.querySelectorAll("[data-add-sub-spot]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._addSubSpot(event.currentTarget.dataset.addSubSpot);
      });
    });

    rootElement.querySelectorAll("[data-delete-sub-spot]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._deleteSubSpot(event.currentTarget.dataset.deleteSubSpot, Number(event.currentTarget.dataset.subSpotIndex));
      });
    });

    rootElement.querySelectorAll("[data-move-sub-spot]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._startSubSpotMove(event.currentTarget.dataset.moveSubSpot, Number(event.currentTarget.dataset.subSpotIndex));
      });
    });

    rootElement.querySelectorAll("[data-sub-spot-coordinate]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateSubSpotCoordinate(event.currentTarget.dataset.subSpotCoordinateKey, Number(event.currentTarget.dataset.subSpotIndex), event.currentTarget.dataset.subSpotCoordinate, event.currentTarget.value);
      });
      element.addEventListener("input", (event) => {
        this._updateSubSpotCoordinate(event.currentTarget.dataset.subSpotCoordinateKey, Number(event.currentTarget.dataset.subSpotIndex), event.currentTarget.dataset.subSpotCoordinate, event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
      });
    });

    rootElement.querySelectorAll("[data-sub-spot-light-radius]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      const onRadiusChange = (event) => {
        this._updateSubSpotLightRadius(event.currentTarget.dataset.subSpotLightRadius, Number(event.currentTarget.dataset.subSpotIndex), event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
      };
      element.addEventListener("input", onRadiusChange);
      element.addEventListener("change", (event) => {
        this._updateSubSpotLightRadius(event.currentTarget.dataset.subSpotLightRadius, Number(event.currentTarget.dataset.subSpotIndex), event.currentTarget.value);
      });
    });

    rootElement.querySelectorAll("[data-sub-spot-preset]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateSubSpotPreset(event.currentTarget.dataset.subSpotPreset, Number(event.currentTarget.dataset.subSpotIndex), event.currentTarget.value);
      });
    });

    rootElement.querySelectorAll("[data-toggle-sub-spot-advanced]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.toggleSubSpotAdvanced;
        const index = Number(event.currentTarget.dataset.subSpotIndex);
        const editorKey = this._subSpotEditorKey(key, index);
        if (this._advancedRenderParamsOpen.has(editorKey)) this._advancedRenderParamsOpen.delete(editorKey);
        else this._advancedRenderParamsOpen.add(editorKey);
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    this._bindRenderParamControls(rootElement);

    rootElement.querySelectorAll("[data-reset-sub-spot-render-params]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._resetSubSpotRenderParams(event.currentTarget.dataset.resetSubSpotRenderParams, Number(event.currentTarget.dataset.subSpotIndex));
      });
    });

    rootElement.querySelectorAll("[data-save-sub-spot-render-preset]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._saveSubSpotRenderPreset(event.currentTarget.dataset.saveSubSpotRenderPreset, Number(event.currentTarget.dataset.subSpotIndex));
      });
    });
  }

  _bindRenderParamControls(rootElement) {
    if (!rootElement) return;
    rootElement.querySelectorAll("[data-render-param]").forEach((element) => {
      if (element._renderParamBound) return;
      element._renderParamBound = true;
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("input", (event) => {
        this._applyRenderParamInput(event.currentTarget, { skipSave: true });
      });
      element.addEventListener("change", (event) => {
        this._applyRenderParamInput(event.currentTarget);
      });
      element.addEventListener("wheel", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._stepRenderParamInput(event.currentTarget, event.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    });

    rootElement.querySelectorAll("[data-render-param-step]").forEach((element) => {
      if (element._renderParamStepBound) return;
      element._renderParamStepBound = true;
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = event.currentTarget.closest(".rp-stepper")?.querySelector("[data-render-param]");
        this._stepRenderParamInput(input, Number(event.currentTarget.dataset.renderParamStep));
      });
    });
  }

  _renderParamDecimals(step) {
    const text = String(step || "1");
    return text.includes(".") ? text.split(".")[1].length : 0;
  }

  _stepRenderParamInput(input, direction) {
    if (!input) return;
    const step = Number(input.step) || 1;
    const min = Number(input.min);
    const max = Number(input.max);
    const current = Number(input.value);
    const base = Number.isFinite(current) ? current : 0;
    let next = base + (Number(direction) || 0) * step;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    input.value = next.toFixed(this._renderParamDecimals(step));
    this._applyRenderParamInput(input);
  }

  _applyRenderParamInput(input, options = {}) {
    if (!input) return;
    const key = input.dataset.renderParamKey;
    const param = input.dataset.renderParam;
    const value = Number(input.value);
    if (!key || !param || !Number.isFinite(value)) return;

    const parsed = this._parseSubSpotEditorKey(key);
    if (parsed) {
      this._updateSubSpotRenderParam(parsed.key, parsed.index, param, value, {
        skipHistory: true,
        skipSave: options.skipSave === true,
        skipPanelRefresh: true,
      });
      return;
    }

    if (!this._markers[key]) return;
    if (!this._markers[key].renderParams) this._markers[key].renderParams = {};
    this._markers[key].renderParams[param] = parseFloat(value);
    if (options.skipSave === true) this._refreshYamlExport();
    else this._saveMarkers();
    this._refresh3DZoneOverlay();
  }

  _bindLightPathControls(rootElement) {
    if (!rootElement) return;
    // Shape toggle: Line ↔ Rectangle
    rootElement.querySelectorAll("[data-light-shape]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const key = event.currentTarget.dataset.lightShape;
        const shape = event.currentTarget.dataset.shape;
        if (!this._markers[key]) return;
        this._markers[key].lightShape = shape;
        this._saveMarkers();
        this._refresh3DZoneOverlay();
        if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
      });
    });

    // Rectangle dimension inputs
    rootElement.querySelectorAll("[data-light-rect]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      const onRectChange = (event) => {
        const key = event.currentTarget.dataset.lightRectKey;
        const field = event.currentTarget.dataset.lightRect;
        if (!this._markers[key]) return;
        if (!this._markers[key].lightRect) this._markers[key].lightRect = { width: 100, depth: 80, angle: 0 };
        this._markers[key].lightRect[field] = parseFloat(event.currentTarget.value) || 0;
        this._refresh3DZoneOverlay();
      };
      element.addEventListener("input", onRectChange);
      element.addEventListener("change", (event) => { onRectChange(event); this._saveMarkers(); });
    });

    rootElement.querySelectorAll("[data-toggle-light-path-draw]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._toggleLightPathDrawing(event.currentTarget.dataset.toggleLightPathDraw);
      });
    });

    rootElement.querySelectorAll("[data-clear-light-path]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._clearLightPath(event.currentTarget.dataset.clearLightPath);
      });
    });

    rootElement.querySelectorAll("[data-move-light-path-point]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._startLightPathPointMove(event.currentTarget.dataset.moveLightPathPoint, Number(event.currentTarget.dataset.lightPathIndex));
      });
    });

    rootElement.querySelectorAll("[data-delete-light-path-point]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        this._deleteLightPathPoint(event.currentTarget.dataset.deleteLightPathPoint, Number(event.currentTarget.dataset.lightPathIndex));
      });
    });

    rootElement.querySelectorAll("[data-light-path-coordinate]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._updateLightPathCoordinate(event.currentTarget.dataset.lightPathCoordinateKey, Number(event.currentTarget.dataset.lightPathIndex), event.currentTarget.dataset.lightPathCoordinate, event.currentTarget.value);
      });
      element.addEventListener("input", (event) => {
        this._updateLightPathCoordinate(event.currentTarget.dataset.lightPathCoordinateKey, Number(event.currentTarget.dataset.lightPathIndex), event.currentTarget.dataset.lightPathCoordinate, event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
      });
    });
  }

  _iconSelect(row) {
    const selected = this._markers[row.key]?.icon || "auto";
    return `
      <label class="icon-picker">
        <span>Icon</span>
        <div class="icon-picker-control">
          <ha-icon-picker data-icon="${this._escape(row.key)}" value="${selected === "auto" ? "" : this._escape(selected)}"></ha-icon-picker>
          <button type="button" data-icon-auto="${this._escape(row.key)}" title="Use entity default icon">Auto</button>
        </div>
      </label>
    `;
  }

  _markerDisplayEditor(row) {
    const marker = this._markers[row.key] || {};
    const selected = this._normalizeMarkerDisplay(marker.markerDisplay) || "auto";
    const options = [
      ["auto", "Auto"],
      ["icon", "Icon"],
      ["value", "Value"],
    ]
      .map(([value, label]) => `<option value="${this._escape(value)}" ${selected === value ? "selected" : ""}>${this._escape(label)}</option>`)
      .join("");
    return `
      <label class="marker-display-picker">
        <span>Marker display</span>
        <select data-marker-display="${this._escape(row.key)}">${options}</select>
      </label>
    `;
  }

  _colorThresholdEditor(row) {
    const marker = this._markers[row.key] || {};
    const thresholds = this._normalizeColorThresholds(marker.colorThresholds || marker.color_thresholds) || [];
    const numericState = Number(row.primaryState);
    const shouldShow = thresholds.length || Number.isFinite(numericState) || row.primaryDomain === "sensor";
    if (!shouldShow) return "";
    const rows = thresholds.map((threshold, index) => `
      <div class="color-threshold-row">
        <input data-color-threshold-value="${this._escape(row.key)}" data-threshold-index="${index}" type="number" step="0.1" value="${this._escape(threshold.value)}" aria-label="Threshold value" />
        <input data-color-threshold-color="${this._escape(row.key)}" data-threshold-index="${index}" type="color" value="${this._escape(this._hexColorValue(threshold.color))}" aria-label="Threshold color" />
        <input data-color-threshold-text="${this._escape(row.key)}" data-threshold-index="${index}" type="text" value="${this._escape(threshold.color)}" aria-label="CSS color" />
        <button type="button" class="remove" data-remove-color-threshold="${this._escape(row.key)}" data-threshold-index="${index}" title="Remove threshold">Remove</button>
      </div>
    `).join("");
    return `
      <div class="color-threshold-editor">
        <div class="color-threshold-header">
          <span>Color thresholds</span>
          <button type="button" data-add-color-threshold="${this._escape(row.key)}">Add</button>
        </div>
        ${rows || `<div class="color-threshold-empty">No thresholds yet.</div>`}
      </div>
    `;
  }

  _hexColorValue(color) {
    const text = String(color || "").trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : "#66bb6a";
  }

  _markerTemplate(row, isEditing) {
    const marker = this._markers[row.key];
    const size = this._display.markerSize;
    const content = this._markerFace(row);
    const stateClass = this._stateClass(row);
    const title = this._config.show_entity_state ? `${row.name} - ${row.primaryState}` : row.name;
    const thresholds = marker?.colorThresholds;
    const numericState = Number(row.primaryState);
    const thresholdColor = (!row.offline && thresholds && Number.isFinite(numericState))
      ? this._markerColorFromThresholds(thresholds, numericState)
      : null;
    const thresholdClass = thresholdColor ? "state-threshold" : "";
    const thresholdStyle = thresholdColor ? ` --marker-threshold-color: ${thresholdColor};` : "";
    return `
      <button
        class="marker ${this._display.showLabels ? "with-label" : "icon-only"} ${content.type === "value" ? "value-marker" : ""} ${this._config.show_entity_state ? "state-mode" : ""} ${stateClass} ${thresholdClass} ${isEditing && this._selectedMarkers.has(row.key) ? "selected" : ""} ${row.offline ? "offline" : "online"}"
        style="left: ${this._escape(marker.x)}%; top: ${this._escape(marker.y)}%; --marker-size: ${this._escape(size)}px;${thresholdStyle}"
        draggable="${isEditing ? "true" : "false"}"
        data-marker="${this._escape(row.key)}"
        data-entity="${this._escape(row.entityId)}"
        title="${this._escape(title)}"
      >
        <span class="${content.type === "value" ? "value-face" : ""}">${content.type === "value" ? this._escape(content.value) : `<ha-icon icon="${this._escape(content.icon)}"></ha-icon>`}</span>
        ${this._display.showLabels ? `<strong>${this._escape(row.name)}</strong>` : ""}
      </button>
    `;
  }

  _modelCompassTemplate() {
    const hasDefaultView = Boolean(this._modelDefaultViews?.[this._activeFloorId || "default"]);
    return `
      <div class="model-compass" aria-label="3D view compass">
        <div class="compass-grid">
          <button type="button" data-model-view="north" class="compass-north" title="North angled view" aria-label="North angled view">N</button>
          <button type="button" data-model-view="west" class="compass-west" title="West angled view" aria-label="West angled view">W</button>
          <button type="button" data-model-view="top" class="compass-top" title="Top view" aria-label="Top view">Top</button>
          <button type="button" data-model-view="east" class="compass-east" title="East angled view" aria-label="East angled view">E</button>
          <button type="button" data-model-view="south" class="compass-south" title="South angled view" aria-label="South angled view">S</button>
        </div>
        <div class="default-view-actions">
          <button type="button" data-model-view="default" title="Go to saved startup view" aria-label="Go to saved startup view" ${hasDefaultView ? "" : "disabled"}>Home</button>
          <button type="button" data-model-default-view="save" title="Save current camera as home startup view">Save Home</button>
          <button type="button" data-model-default-view="clear" title="Clear saved startup view" ${hasDefaultView ? "" : "disabled"}>Clear</button>
        </div>
      </div>
    `;
  }

  _currentYamlExport() {
    return this._yamlExport(this._deviceRows());
  }

  _refreshYamlExport() {
    const textarea = this.shadowRoot?.querySelector("[data-yaml-export]");
    if (!textarea) return;
    textarea.value = this._currentYamlExport();
  }

  async _copyYamlExport() {
    const yaml = this._currentYamlExport();
    const status = this.shadowRoot?.querySelector("[data-copy-yaml-status]");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(yaml);
      } else {
        const textarea = this.shadowRoot?.querySelector("[data-yaml-export]");
        if (!textarea) throw new Error("Clipboard is unavailable.");
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
      }
      if (status) {
        status.textContent = "Copied";
        window.setTimeout(() => {
          if (status.textContent === "Copied") status.textContent = "";
        }, 1600);
      }
    } catch (error) {
      console.warn("home-assistant-3d-floorplan: YAML could not be copied", error);
      if (status) status.textContent = "Copy failed";
    }
  }

  _yamlExport(rows) {
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const performanceLines = this._yamlPerformanceSettings();
    const ambientLines = this._yamlAmbientDarkness();
    const defaultViewLines = this._yamlDefaultView(this._modelDefaultViews?.[this._activeFloorId || "default"], "");
    if (this._hasMultipleFloors()) {
      return [
        ...performanceLines,
        ...ambientLines,
        "floors:",
        ...this._floors.flatMap((floor) => {
          const markers = this._yamlMarkersForFloor(floor.id, rowByKey);
          const zones = this._yamlZonesForFloor(floor.id);
          const floorDefaultView = this._yamlDefaultView(this._modelDefaultViews?.[floor.id], "    ");
          return [
            `  - id: ${floor.id}`,
            `    name: ${floor.name}`,
            ...(floor.image ? [`    image: ${floor.image}`] : []),
            ...(floor.model ? [`    model: ${floor.model}`] : []),
            ...floorDefaultView,
            ...(markers.length
              ? [
                  "    markers:",
                  ...markers.flatMap((marker) => [
                    `      - key: ${marker.key}`,
                    `        entity: ${marker.entity}`,
                    `        name: ${marker.name}`,
                    `        coordinate_space: display`,
                    ...(marker.icon ? [`        icon: ${marker.icon}`] : []),
                    ...(marker.markerDisplay ? [`        marker_display: ${marker.markerDisplay}`] : []),
                    `        tap_action: ${marker.tapAction}`,
                    `        hold_action: ${marker.holdAction}`,
                    ...(marker.navigationPath ? [`        navigation_path: ${JSON.stringify(marker.navigationPath)}`] : []),
                    ...(marker.lightIntensity !== "" ? [`        light_intensity: ${marker.lightIntensity}`] : []),
                    ...(marker.lightType ? [`        light_type: ${this._threeLightTypeName(marker.lightType)}`, `        light_radius: ${marker.lightRadius || 1.5}`] : []),
                    ...(marker.lightPreset ? [`        light_preset: ${marker.lightPreset}`] : []),
                    ...this._yamlMarkerColorThresholdLines(marker.colorThresholds, "        "),
                    ...(marker.renderParams ? Object.entries(marker.renderParams).map(([k, v]) => `        render_params.${k}: ${v}`) : []),
                    ...(marker.subSpots?.length
                      ? [
                          `        sub_spots:`,
                          ...marker.subSpots.flatMap((spot) => [
                            `          - name: ${spot.name}`,
                            ...(spot.lightRadius ? [`            light_radius: ${spot.lightRadius}`] : []),
                            ...(spot.lightPreset ? [`            light_preset: ${spot.lightPreset}`] : []),
                            ...(spot.renderParams ? Object.entries(spot.renderParams).map(([k, v]) => `            render_params.${k}: ${v}`) : []),
                            `            x: ${spot.x}`,
                            `            y: ${spot.y}`,
                            ...(spot.z !== "" ? [`            z: ${spot.z}`] : []),
                          ]),
                        ]
                      : []),
                    ...this._yamlMarkerLightShapeLines(marker, "        "),
                    `        x: ${marker.x}`,
                    `        y: ${marker.y}`,
                    ...(marker.z !== "" ? [`        z: ${marker.z}`] : []),
                  ]),
                ]
              : ["    markers: []"]),
            ...(zones.length
              ? [
                  "    brightness_zones:",
                  ...zones.flatMap((zone) => [
                    `      - id: ${zone.id}`,
                    `        name: ${zone.name}`,
                    `        color: "${zone.color}"`,
                    `        height: ${zone.height}`,
                    `        day_opacity: ${zone.dayOpacity}`,
                    `        night_opacity: ${zone.nightOpacity}`,
                    ...(zone.lightingMode === "positional" ? [`        lighting_mode: positional`] : []),
                    ...(zone.illuminanceEnabled ? [`        illuminance_enabled: true`, ...(zone.illuminanceEntity ? [`        illuminance_entity: ${zone.illuminanceEntity}`] : [])] : []),
                    ...(zone.showLux ? [`        show_lux: true`] : []),
                    "        points:",
                    ...zone.points.flatMap((point) => this._yamlZonePointLines(point, "          ")),
                  ]),
                ]
              : []),
          ];
        }),
      ].join("\n");
    }

    const markers = this._yamlMarkersForFloor(this._activeFloorId, rowByKey);
    const zones = this._yamlZonesForFloor(this._activeFloorId);

    if (!markers.length && !zones.length && !defaultViewLines.length) return "markers: []";

    return [
      ...performanceLines,
      ...defaultViewLines,
      ...(markers.length
        ? [
            "markers:",
            ...markers.flatMap((marker) => [
              `  - key: ${marker.key}`,
              `    entity: ${marker.entity}`,
              `    name: ${marker.name}`,
              `    coordinate_space: display`,
              ...(marker.icon ? [`    icon: ${marker.icon}`] : []),
              ...(marker.markerDisplay ? [`    marker_display: ${marker.markerDisplay}`] : []),
              `    tap_action: ${marker.tapAction}`,
              `    hold_action: ${marker.holdAction}`,
              ...(marker.navigationPath ? [`    navigation_path: ${JSON.stringify(marker.navigationPath)}`] : []),
              ...(marker.lightIntensity !== "" ? [`    light_intensity: ${marker.lightIntensity}`] : []),
              ...(marker.lightType ? [`    light_type: ${this._threeLightTypeName(marker.lightType)}`, `    light_radius: ${marker.lightRadius || 1.5}`] : []),
              ...(marker.lightPreset ? [`    light_preset: ${marker.lightPreset}`] : []),
              ...this._yamlMarkerColorThresholdLines(marker.colorThresholds, "    "),
              ...(marker.renderParams ? Object.entries(marker.renderParams).map(([k, v]) => `    render_params.${k}: ${v}`) : []),
              ...(marker.subSpots?.length
                ? [
                    `    sub_spots:`,
                    ...marker.subSpots.flatMap((spot) => [
                      `      - name: ${spot.name}`,
                      ...(spot.lightRadius ? [`        light_radius: ${spot.lightRadius}`] : []),
                      ...(spot.lightPreset ? [`        light_preset: ${spot.lightPreset}`] : []),
                      ...(spot.renderParams ? Object.entries(spot.renderParams).map(([k, v]) => `        render_params.${k}: ${v}`) : []),
                      `        x: ${spot.x}`,
                      `        y: ${spot.y}`,
                      ...(spot.z !== "" ? [`        z: ${spot.z}`] : []),
                    ]),
                  ]
                : []),
              ...this._yamlMarkerLightShapeLines(marker, "    "),
              `    x: ${marker.x}`,
              `    y: ${marker.y}`,
              ...(marker.z !== "" ? [`    z: ${marker.z}`] : []),
            ]),
          ]
        : ["markers: []"]),
      ...ambientLines,
      ...this._yamlLightPresets(),
      ...(zones.length
        ? [
            "brightness_zones:",
            ...zones.flatMap((zone) => [
              `  - id: ${zone.id}`,
              `    name: ${zone.name}`,
              `    color: "${zone.color}"`,
              `    height: ${zone.height}`,
              `    day_opacity: ${zone.dayOpacity}`,
              `    night_opacity: ${zone.nightOpacity}`,
              ...(zone.lightingMode === "positional" ? [`    lighting_mode: positional`] : []),
              ...(zone.illuminanceEnabled ? [`    illuminance_enabled: true`, ...(zone.illuminanceEntity ? [`    illuminance_entity: ${zone.illuminanceEntity}`] : [])] : []),
              ...(zone.showLux ? [`    show_lux: true`] : []),
              "    points:",
              ...zone.points.flatMap((point) => this._yamlZonePointLines(point, "      ")),
            ]),
          ]
        : []),
    ].join("\n");
  }

  _yamlMarkerLightShapeLines(marker, indent) {
    if (marker.lightShape === "rect" && marker.lightRect) {
      return [
        `${indent}light_shape: rect`,
        `${indent}light_rect:`,
        `${indent}  width: ${marker.lightRect.width ?? 100}`,
        `${indent}  depth: ${marker.lightRect.depth ?? 80}`,
        `${indent}  angle: ${marker.lightRect.angle ?? 0}`,
      ];
    }

    if (!marker.lightPath?.length) return [];
    return [
      `${indent}light_path:`,
      ...marker.lightPath.flatMap((point) => [
        `${indent}  - x: ${point.x}`,
        `${indent}    y: ${point.y}`,
        ...(point.z !== "" ? [`${indent}    z: ${point.z}`] : []),
      ]),
    ];
  }

  _yamlMarkerColorThresholdLines(thresholds, indent) {
    const normalized = this._normalizeColorThresholds(thresholds);
    if (!normalized?.length) return [];
    return [
      `${indent}color_thresholds:`,
      ...normalized.flatMap((threshold) => [
        `${indent}  - value: ${threshold.value}`,
        `${indent}    color: ${this._yamlScalar(threshold.color)}`,
      ]),
    ];
  }

  _yamlZonePointLines(point, indent) {
    const entries = Object.entries(point);
    if (!entries.length) return [];
    return entries.map(([axis, value], index) => `${indent}${index === 0 ? "- " : "  "}${axis}: ${value}`);
  }

  _yamlDefaultView(view, indent = "") {
    const normalized = this._normalizeModelView(view);
    if (!normalized) return [];
    const formatArray = (values) => `[${values.map((value) => Number(value).toFixed(4)).join(", ")}]`;
    return [
      `${indent}default_view:`,
      `${indent}  position: ${formatArray(normalized.position)}`,
      `${indent}  target: ${formatArray(normalized.target)}`,
      ...(Number.isFinite(normalized.zoom) ? [`${indent}  zoom: ${Number(normalized.zoom).toFixed(4)}`] : []),
    ];
  }

  _yamlMarkersForFloor(floorId, rowByKey) {
    const floorMarkers = floorId === this._activeFloorId ? this._markers : this._floorMarkers[floorId] || {};
    return Object.entries(floorMarkers)
      .map(([key, marker]) => {
        const row = rowByKey.get(key);
        const displayPoint = Number.isFinite(Number(marker.z)) ? this._modelToDisplayPoint(marker) : marker;
        const hasCustomLightIntensity = Number.isFinite(Number(marker.lightIntensity)) && Number(marker.lightIntensity) !== 100;
        return {
          key,
          entity: row?.entityId || marker.entityId,
          name: row?.name || marker.name || key,
          icon: marker.icon || "",
          markerDisplay: this._normalizeMarkerDisplay(marker.markerDisplay || marker.marker_display),
          tapAction: this._exportMarkerAction(row, marker, "tap"),
          holdAction: this._exportMarkerAction(row, marker, "hold"),
          navigationPath: this._normalizeNavigationPath(marker.navigationPath || marker.navigation_path),
          lightIntensity: row?.primaryDomain === "light" || hasCustomLightIntensity ? this._normalizeLightIntensity(marker.lightIntensity) : "",
          lightType: this._normalizeLightType(marker.lightType),
          lightRadius: this._normalizeLightRadius(marker.lightRadius),
          lightPreset: marker.lightPreset || "",
          colorThresholds: this._normalizeColorThresholds(marker.colorThresholds || marker.color_thresholds),
          renderParams: marker.renderParams && Object.keys(marker.renderParams).length ? marker.renderParams : null,
          lightShape: marker.lightShape || marker.light_shape || "path",
          lightRect: marker.lightRect || marker.light_rect || null,
          subSpots: (marker.subSpots || []).map((spot, index) => {
            const spotPoint = this._modelToDisplayPoint(spot);
            return {
              name: spot.name || `Spot ${index + 1}`,
              lightRadius: this._normalizeLightRadius(spot.lightRadius),
              lightPreset: spot.lightPreset || "",
              renderParams: spot.renderParams && Object.keys(spot.renderParams).length ? spot.renderParams : null,
              x: this._formatCoordinateInteger(spotPoint.x),
              y: this._formatCoordinateInteger(spotPoint.y),
              z: this._formatCoordinateInteger(spotPoint.z),
            };
          }),
          lightPath: (marker.lightPath || []).map((point) => {
            const pathPoint = this._modelToDisplayPoint(point);
            return {
              x: this._formatCoordinateInteger(pathPoint.x),
              y: this._formatCoordinateInteger(pathPoint.y),
              z: this._formatCoordinateInteger(pathPoint.z),
            };
          }),
          x: this._formatCoordinateInteger(displayPoint.x),
          y: this._formatCoordinateInteger(displayPoint.y),
          z: this._formatCoordinateInteger(displayPoint.z),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _yamlLightPresets() {
    const presets = this._config.light_presets || {};
    const entries = Object.entries(presets);
    if (!entries.length) return [];
    return [
      "light_presets:",
      ...entries.flatMap(([name, params]) => [
        `  ${name}:`,
        ...Object.entries(params).map(([k, v]) => `    ${k}: ${v}`),
      ]),
    ];
  }

  _yamlPerformanceSettings() {
    const lines = [];
    const profile = this._modelPerformanceProfile();
    const pixelRatio = Number(this._config.model_pixel_ratio);
    if (profile !== "quality") lines.push(`model_performance_profile: ${profile}`);
    if (Number.isFinite(pixelRatio) && pixelRatio > 0) lines.push(`model_pixel_ratio: ${pixelRatio}`);
    if (this._config.model_antialias !== null && this._config.model_antialias !== undefined) {
      lines.push(`model_antialias: ${this._config.model_antialias !== false ? "true" : "false"}`);
    }
    const customBundleUrls = this._asList(this._config.three_bundle_urls).filter(
      (url) => ![
        "/hacsfiles/Home-Assistant-3D-Floorplan/dist/three.bundle.min.js",
        "/local/three.bundle.min.js",
      ].includes(url)
    );
    if (customBundleUrls.length) {
      lines.push("three_bundle_urls:");
      customBundleUrls.forEach((url) => lines.push(`  - ${url}`));
    }
    if (this._config.three_bundle_url) lines.push(`three_bundle_url: ${this._config.three_bundle_url}`);
    return lines;
  }

  _yamlAmbientDarkness() {
    if (this._config.ambient_darkness === false) return ["ambient_darkness: false"];
    const ambient = this._ambientDarknessConfig();
    return [
      "ambient_darkness:",
      ...(ambient.entity ? [`  entity: ${ambient.entity}`] : []),
      `  day_opacity: ${ambient.day_opacity}`,
      `  night_opacity: ${ambient.night_opacity}`,
    ];
  }

  _yamlZonesForFloor(floorId) {
    const floorZones = floorId === this._activeFloorId ? this._zones : this._floorZones[floorId] || {};
    const floorAxes = this._floorAxes();
    return Object.values(floorZones)
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color || "#f8d66d",
        height: this._formatCoordinate(this._zoneHeight(zone)),
        dayOpacity: this._formatCoordinate(this._zoneOpacity(zone, "day")),
        nightOpacity: this._formatCoordinate(this._zoneOpacity(zone, "night")),
        illuminanceEnabled: zone.illuminanceEnabled === true,
        illuminanceEntity: zone.illuminanceEntity || "",
        showLux: zone.showLux === true,
        lightingMode: zone.lightingMode || "area",
        points: (zone.points || []).map((point) => {
          const displayPoint = this._modelToDisplayPoint(point);
          return {
            [floorAxes[0]]: this._formatCoordinateInteger(displayPoint[floorAxes[0]]),
            [floorAxes[1]]: this._formatCoordinateInteger(displayPoint[floorAxes[1]]),
          };
        }),
      }))
      .filter((zone) => zone.points.length)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _asList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }

  async _importFirst(urls, label) {
    const errors = [];
    for (const url of urls) {
      try {
        return await import(url);
      } catch (error) {
        errors.push(`${url}: ${error?.message || error}`);
      }
    }
    throw new Error(`${label} could not be loaded. ${errors.join(" | ")}`);
  }

  async _loadThreeModules() {
    if (this._threeModules) return this._threeModules;
    if (this._threeModulesPromise) return this._threeModulesPromise;

    this._threeModulesPromise = (async () => {
      // Use esm.sh which rewrites bare specifiers internally (no import map needed).
      const [THREE, { GLTFLoader }, { OBJLoader }, { OrbitControls }] = await Promise.all([
        import("https://esm.sh/three@0.165.0"),
        import("https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js"),
        import("https://esm.sh/three@0.165.0/examples/jsm/loaders/OBJLoader.js"),
        import("https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js"),
      ]);
      this._threeModules = { THREE, GLTFLoader, OBJLoader, OrbitControls };
      return this._threeModules;
    })();

    return this._threeModulesPromise;
  }

  _modelPerformanceProfile() {
    const value = String(this._config.model_performance_profile || this._config.performance_profile || "quality").toLowerCase();
    return ["quality", "balanced", "performance", "mobile"].includes(value) ? value : "quality";
  }

  _modelAntialias(profile = this._modelPerformanceProfile()) {
    if (this._config.model_antialias !== null && this._config.model_antialias !== undefined) {
      return this._config.model_antialias !== false;
    }
    return profile === "quality";
  }

  _modelPixelRatio(profile = this._modelPerformanceProfile()) {
    const configuredPixelRatio = Number(this._config.model_pixel_ratio);
    if (Number.isFinite(configuredPixelRatio) && configuredPixelRatio > 0) {
      return Math.max(0.5, Math.min(configuredPixelRatio, 3));
    }
    const deviceRatio = window.devicePixelRatio || 1;
    if (profile === "quality") return Math.min(deviceRatio, 2);
    if (profile === "balanced") return Math.min(deviceRatio, 1.5);
    return 1;
  }

  _modelOverlayFrameInterval(profile = this._modelPerformanceProfile()) {
    if (profile === "quality") return 0;
    if (profile === "balanced") return 24;
    return 40;
  }

  async _renderModelViewer(modelUrl) {
    const container = this.shadowRoot?.querySelector("[data-model-viewer]");
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (!container || !modelUrl) return;
    if (this._modelLoadingUrl === modelUrl || this._modelLoadFailedUrl === modelUrl) return;
    const renderToken = ++this._modelRenderToken;
    this._modelLoadingUrl = modelUrl;
    this._modelLoadFailedUrl = "";
    let renderer = null;

    try {
      if (!window.WebGLRenderingContext) {
        throw new Error("WebGL is not available in this browser or WebView.");
      }
      const { THREE, GLTFLoader, OBJLoader, OrbitControls } = await this._loadThreeModules();
      if (renderToken !== this._modelRenderToken || !this.shadowRoot?.contains(container)) return;

      if (status) status.textContent = "Loading 3D model...";
      const scene = new THREE.Scene();
      const background = this._config.model_background || getComputedStyle(this).getPropertyValue("--card-background-color") || "#111827";
      scene.background = new THREE.Color(String(background).trim() || "#111827");

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
      const profile = this._modelPerformanceProfile();
      const antialias = this._modelAntialias(profile);
      const pixelRatio = this._modelPixelRatio(profile);
      renderer = new THREE.WebGLRenderer({ antialias, alpha: false });
      renderer.setPixelRatio(pixelRatio);
      if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.touchAction = "none";
      renderer.domElement.style.userSelect = "none";
      renderer.domElement.style.webkitUserSelect = "none";
      renderer.domElement.style.webkitTouchCallout = "none";
      renderer.domElement.tabIndex = 0;
      container.addEventListener("pointerenter", () => {
        this._modelKeyboardNavigationActive = true;
      });
      container.addEventListener("pointerleave", () => {
        this._modelKeyboardNavigationActive = false;
      });
      renderer.domElement.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        if (status) {
          status.hidden = false;
          status.textContent = "3D renderer paused. Restoring model...";
        }
      });
      renderer.domElement.addEventListener("webglcontextrestored", () => {
        if (renderToken !== this._modelRenderToken) return;
        this._disposeModelViewer({ preserveCamera: true });
        this._renderModelViewer(modelUrl);
      });
      container.appendChild(renderer.domElement);

      // ── Axes gizmo — pure 2D canvas, projects world axes onto camera plane ──
      // No second WebGL context needed; avoids any bleed into the main scene.
      const gizmoCanvas = container.querySelector("[data-axes-gizmo]");
      const gizmoCtx = gizmoCanvas ? gizmoCanvas.getContext("2d") : null;
      if (gizmoCanvas) {
        gizmoCanvas.width  = 130 * pixelRatio;
        gizmoCanvas.height = 130 * pixelRatio;
      }

      const ambient = new THREE.HemisphereLight(0xffffff, 0x334155, 1.25);
      scene.add(ambient);
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
      keyLight.position.set(4, 8, 6);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
      fillLight.position.set(-6, 4, -5);
      scene.add(fillLight);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      if (THREE.TOUCH) {
        controls.touches.ONE = THREE.TOUCH.ROTATE;
        controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
      }

      // Set camera up-vector to match the model's vertical axis so Top view and
      // orbit feel correct regardless of whether the model is Y-up or Z-up.
      const _vModelAxis = this._coordinateMap()[this._verticalAxis()];
      camera.up.set(_vModelAxis === "x" ? 1 : 0, _vModelAxis === "y" ? 1 : 0, _vModelAxis === "z" ? 1 : 0);
      controls.update();

      const model = await this._loadModelObject(modelUrl, { THREE, GLTFLoader, OBJLoader });
      if (renderToken !== this._modelRenderToken || !this.shadowRoot?.contains(container)) {
        renderer.dispose?.();
        renderer.domElement?.remove?.();
        return;
      }
      if (!model) throw new Error("Model file loaded but did not contain a scene.");
      this._modelLoadingUrl = "";

      scene.add(model);
      const zoneGroup = new THREE.Group();
      zoneGroup.renderOrder = 1;
      scene.add(zoneGroup);

      // --- Animated 3D Objects ---
      const activeFloorForAnim = this._activeFloor();
      const animationConfigs = activeFloorForAnim.animations || this._config.animations || [];
      const animatedObjects = animationConfigs.map((anim) => {
        const mesh = model.getObjectByName(anim.object_name);
        if (!mesh) {
          console.warn(`home-assistant-3d-floorplan: animation object "${anim.object_name}" not found in model`);
          return null;
        }
        // Center the geometry vertices around local origin so rotation spins in place.
        // SH3D exports bake world-space vertex positions with object position at (0,0,0),
        // so rotating the object orbits the world origin without this fix.
        mesh.traverse((child) => {
          if (child.isMesh && child.geometry) {
            child.geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            child.geometry.boundingBox.getCenter(center);
            child.geometry.translate(-center.x, -center.y, -center.z);
            child.position.add(center);
          }
        });
        return {
          mesh,
          entity: anim.entity,
          type: anim.type || "rotate",
          axis: (anim.axis || "y").toLowerCase(),
          speed: Number(anim.speed) || 1,
          stateOn: anim.state_on || "on",
          amplitude: Number(anim.amplitude) || 0.5,
          // For oscillate: track accumulated phase
          phase: 0,
          // For bob: store original position
          originalY: mesh.position.y,
          originalX: mesh.position.x,
          originalZ: mesh.position.z,
        };
      }).filter(Boolean);
      let animLastTime = performance.now();

      // --- Interactive 3D Objects ---
      const interactiveConfigs = activeFloorForAnim.interactive_objects || this._config.interactive_objects || [];
      const interactiveObjectMap = new Map(); // mesh → config
      const interactiveNameMap = new Map();   // object_name → { mesh, config, originalMaterials }
      for (const iObj of interactiveConfigs) {
        const mesh = model.getObjectByName(iObj.object_name);
        if (!mesh) {
          console.warn(`home-assistant-3d-floorplan: interactive object "${iObj.object_name}" not found in model`);
          continue;
        }
        // Collect all meshes in the subtree (the named object may be a group)
        const meshes = [];
        mesh.traverse((child) => { if (child.isMesh) meshes.push(child); });
        if (meshes.length === 0) meshes.push(mesh);
        // Store original materials so we can restore them
        const originalMaterials = meshes.map((m) => ({
          mesh: m,
          color: m.material?.color?.clone?.(),
          opacity: m.material?.opacity ?? 1,
          transparent: m.material?.transparent ?? false,
        }));
        const entry = {
          root: mesh,
          meshes,
          config: iObj,
          entity: iObj.entity,
          tapAction: iObj.tap_action || "toggle",
          holdAction: iObj.hold_action || "more-info",
          navigationPath: this._normalizeNavigationPath(iObj.navigation_path || iObj.navigationPath),
          stateStyles: iObj.state_styles || {},
          originalMaterials,
          lastAppliedState: null,
        };
        interactiveNameMap.set(iObj.object_name, entry);
        interactiveObjectMap.set(mesh, entry); // register root for parent-walk lookups
        for (const m of meshes) {
          interactiveObjectMap.set(m, entry);
        }
      }

      // Apply initial state styles
      // Apply/update state styles for interactive objects. Returns true if any material changed.
      const applyInteractiveStyles = () => {
        let changed = false;
        for (const [, entry] of interactiveNameMap) {
          const entityState = this._hass?.states?.[entry.entity]?.state || "";
          if (entityState === entry.lastAppliedState) continue;
          entry.lastAppliedState = entityState;
          changed = true;
          const style = entry.stateStyles[entityState];
          if (style) {
            for (const orig of entry.originalMaterials) {
              if (!orig.mesh.material) continue;
              // Clone material on first style change to avoid mutating shared materials
              if (!orig.mesh.material._interactiveCloned) {
                orig.mesh.material = orig.mesh.material.clone();
                orig.mesh.material._interactiveCloned = true;
              }
              if (style.color) {
                orig.mesh.material.color.set(style.color);
              } else if (orig.color) {
                orig.mesh.material.color.copy(orig.color);
              }
              if (style.opacity !== undefined) {
                orig.mesh.material.opacity = Number(style.opacity);
                orig.mesh.material.transparent = Number(style.opacity) < 1;
              } else {
                orig.mesh.material.opacity = orig.opacity;
                orig.mesh.material.transparent = orig.transparent;
              }
            }
          } else {
            // Restore originals when no style matches
            for (const orig of entry.originalMaterials) {
              if (!orig.mesh.material?._interactiveCloned) continue;
              if (orig.color) orig.mesh.material.color.copy(orig.color);
              orig.mesh.material.opacity = orig.opacity;
              orig.mesh.material.transparent = orig.transparent;
            }
          }
        }
        return changed;
      };

      this._fitCameraToObject(THREE, camera, controls, model);
      const configuredFocusDistance = Number(this._config.offline_focus_distance);
      const fittedCameraDistance = Math.max(1.2, camera.position.distanceTo(controls.target));
      const offlineFocusDistance =
        Number.isFinite(configuredFocusDistance) && configuredFocusDistance > 0
          ? configuredFocusDistance <= 10
            ? fittedCameraDistance * Math.max(0.1, configuredFocusDistance / 10)
            : configuredFocusDistance
          : fittedCameraDistance * 0.6;
      if (!this._modelCameraState) {
        this._applyModelCameraView(this._modelDefaultViews?.[this._activeFloorId || "default"], camera, controls);
      }
      this._restoreModelCameraState(camera, controls);
      status.hidden = this._mode !== "edit";
      if (this._mode === "edit") status.textContent = "Select an entity, then click the 3D model to place it.";

      const markerLayer = container.querySelector("[data-model-marker-layer]");
      const markerButtons = this._build3DMarkerButtons(markerLayer, THREE, camera);
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let pointerStart = null;
      const pickableObjects = [];
      model.traverse((object) => {
        if (object.isMesh) pickableObjects.push(object);
      });
      const modelBounds = new THREE.Box3().setFromObject(model);

      // Cursor feedback for interactive objects
      if (interactiveObjectMap.size > 0) {
        const hoverPointer = new THREE.Vector2();
        renderer.domElement.addEventListener("pointermove", (event) => {
          if (this._mode === "edit") { renderer.domElement.style.cursor = ""; return; }
          const rect = renderer.domElement.getBoundingClientRect();
          hoverPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          hoverPointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
          raycaster.setFromCamera(hoverPointer, camera);
          const hits = raycaster.intersectObjects(pickableObjects, true);
          let found = false;
          for (const hit of hits) {
            let obj = hit.object;
            while (obj) {
              if (interactiveObjectMap.has(obj)) { found = true; break; }
              obj = obj.parent;
            }
            if (found) break;
          }
          renderer.domElement.style.cursor = found ? "pointer" : "";
        });
      }

      renderer.domElement.addEventListener("pointerdown", (event) => {
        this._modelKeyboardNavigationActive = true;
        renderer.domElement.focus?.({ preventScroll: true });
        pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
      });

      renderer.domElement.addEventListener("pointerup", (event) => {
        // --- Interactive object tap/hold handling (user mode) ---
        if (this._mode !== "edit" && interactiveObjectMap.size > 0 && pointerStart) {
          const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5;
          if (!moved) {
            const rect = renderer.domElement.getBoundingClientRect();
            pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
            raycaster.setFromCamera(pointer, camera);
            const hits = raycaster.intersectObjects(pickableObjects, true);
            for (const hit of hits) {
              // Walk up to find if this mesh (or an ancestor mesh) is interactive
              let obj = hit.object;
              let entry = null;
              while (obj) {
                if (interactiveObjectMap.has(obj)) { entry = interactiveObjectMap.get(obj); break; }
                obj = obj.parent;
              }
              if (entry) {
                const elapsed = performance.now() - pointerStart.time;
                const holdMs = Math.max(250, Number(this._config.marker_hold_ms) || 650);
                const action = elapsed >= holdMs ? entry.holdAction : entry.tapAction;
                this._runInteractiveObjectAction(action, entry.entity, entry.navigationPath);
                pointerStart = null;
                return;
              }
            }
          }
        }

        // --- Edit mode placement handling ---
        if (this._mode !== "edit" || (!this._pendingLightPath && !this._pendingSubSpot && !this._pendingDeviceKey && !(this._zoneDrawing && this._activeZoneId))) return;
        if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pickableObjects, true)[0];
        if (!hit) return;
        if (this._pendingLightPath) {
          this._placeLightPathPoint(this._pendingLightPath.key, this._pendingLightPath.index, hit.point, camera);
          return;
        }
        if (this._pendingSubSpot) {
          this._placeSubSpot(this._pendingSubSpot.key, this._pendingSubSpot.index, hit.point, camera);
          return;
        }
        if (this._pendingDeviceKey) {
          this._place3DMarker(this._pendingDeviceKey, hit.point, camera);
          return;
        }
        this._addZonePoint(this._activeZoneId, hit.point);
      });

      let lastRenderWidth = 0;
      let lastRenderHeight = 0;
      const resize = () => {
        const rawWidth = container.clientWidth;
        const rawHeight = container.clientHeight;
        if (rawWidth < 2 || rawHeight < 2) return false;
        const width = Math.max(1, rawWidth);
        const height = Math.max(1, rawHeight);
        if (width === lastRenderWidth && height === lastRenderHeight) return true;
        lastRenderWidth = width;
        lastRenderHeight = height;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        return true;
      };
      let disposed = false;
      let needsRender = true;
      let lastOverlayUpdate = 0;
      const overlayFrameInterval = this._modelOverlayFrameInterval(profile);

      // Trigger a render whenever the camera moves (including damping deceleration).
      controls.addEventListener("change", () => { needsRender = true; });
      // Expose a setter so external callers (HA state updates) can request a frame.
      const requestRender = () => { needsRender = true; };

      const resizeObserver = new ResizeObserver(() => {
        if (resize()) needsRender = true;
      });
      resizeObserver.observe(container);
      resize();
      requestAnimationFrame(() => { if (resize()) needsRender = true; });
      window.setTimeout(() => { if (resize()) needsRender = true; }, 250);

      const animate = () => {
        if (disposed || renderToken !== this._modelRenderToken) return;
        // Schedule next frame first so early returns don't stall the loop.
        this._modelViewer.animationFrame = requestAnimationFrame(animate);
        // Skip all work while the browser tab is hidden — visibilitychange will
        // trigger a fresh render when the tab comes back into focus.
        if (document.hidden) return;
        // OrbitControls.update() must be called every frame when damping is on;
        // it fires a 'change' event (→ needsRender = true) while still decelerating.
        controls.update();

        // --- Update animated 3D objects ---
        if (animatedObjects.length > 0) {
          const animNow = performance.now();
          const dt = Math.min((animNow - animLastTime) / 1000, 0.1); // clamp to avoid jumps after tab restore
          animLastTime = animNow;
          let anyAnimActive = false;
          for (const anim of animatedObjects) {
            const entityState = this._hass?.states?.[anim.entity]?.state;
            const isActive = entityState === anim.stateOn;
            if (!isActive) continue;
            anyAnimActive = true;
            const speed = anim.speed;
            const axis = anim.axis;
            if (anim.type === "rotate") {
              const angle = speed * 2 * Math.PI * dt;
              if (axis === "x") anim.mesh.rotation.x += angle;
              else if (axis === "z") anim.mesh.rotation.z += angle;
              else anim.mesh.rotation.y += angle;
            } else if (anim.type === "oscillate") {
              anim.phase += dt * speed * 2 * Math.PI;
              const oscillation = Math.sin(anim.phase) * (anim.amplitude);
              if (axis === "x") anim.mesh.rotation.x = oscillation;
              else if (axis === "z") anim.mesh.rotation.z = oscillation;
              else anim.mesh.rotation.y = oscillation;
            } else if (anim.type === "bob") {
              anim.phase += dt * speed * 2 * Math.PI;
              const offset = Math.sin(anim.phase) * (anim.amplitude);
              if (axis === "x") anim.mesh.position.x = anim.originalX + offset;
              else if (axis === "z") anim.mesh.position.z = anim.originalZ + offset;
              else anim.mesh.position.y = anim.originalY + offset;
            }
          }
          if (anyAnimActive) needsRender = true;
        }

        // --- Update interactive object state styles ---
        if (interactiveNameMap.size > 0 && applyInteractiveStyles()) needsRender = true;

        if (!needsRender) return;
        needsRender = false;
        this._captureModelCameraState();
        const now = performance.now();
        const shouldUpdateOverlay = !lastOverlayUpdate || !overlayFrameInterval || now - lastOverlayUpdate >= overlayFrameInterval;
        if (shouldUpdateOverlay) {
          lastOverlayUpdate = now;
          this._update3DMarkerButtons(this._modelViewer?.markerButtons || markerButtons, THREE, camera, container);
          this._update3DZoneLabels(this._modelViewer?.zoneLabels || [], THREE, camera, container);
          this._update3DZonePointButtons(this._modelViewer?.zonePointButtons, THREE, camera, container);
        }
        renderer.render(scene, camera);
        // Draw axes gizmo on 2D canvas — project world-space axes onto camera plane
        if (gizmoCtx && gizmoCanvas) {
          const s = gizmoCanvas.width; // internal pixel size (68 * dpr)
          const cx = s / 2, cy = s / 2;
          const len = s * 0.36;
          const pr = pixelRatio;
          // Camera right and up vectors (world space) — project each axis onto them
          const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const camUp    = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const displayForward = this._modelToDisplayPoint(camera.getWorldDirection(new THREE.Vector3()));
          const isTopView = Math.abs(Number(displayForward[this._verticalAxis()])) > 0.92;
          const floorModelAxes = new Set(this._floorAxes().map((axis) => this._coordinateMap()[axis] || axis));
          const gizmoAxes = [
            { dir: new THREE.Vector3(1, 0, 0), color: "#ff4444", label: "X", model: "x" },
            { dir: new THREE.Vector3(0, 1, 0), color: "#44ee44", label: "Y", model: "y" },
            { dir: new THREE.Vector3(0, 0, 1), color: "#3388ff", label: "Z", model: "z" },
          ];
          gizmoCtx.clearRect(0, 0, s, s);
          // Draw back-facing axes first (dimmed), then front-facing on top
          const projected = gizmoAxes.map(({ dir, color, label, model }) => {
            const px = dir.dot(camRight) * len;
            const py = -dir.dot(camUp) * len; // flip Y for screen coords
            const depth = dir.dot(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2));
            const forceBright = isTopView && floorModelAxes.has(model);
            return { px, py, color, label, depth, forceBright };
          });
          const isBrightAxis = (axis) => axis.forceBright || axis.depth <= 0;
          // back-facing axes are dimmed, except floor axes in top view.
          for (const a of projected.filter(a => !isBrightAxis(a))) {
            gizmoCtx.globalAlpha = 0.25;
            gizmoCtx.strokeStyle = a.color;
            gizmoCtx.lineWidth = 1.5 * pr;
            gizmoCtx.beginPath(); gizmoCtx.moveTo(cx, cy); gizmoCtx.lineTo(cx + a.px, cy + a.py); gizmoCtx.stroke();
          }
          // front-facing axes, plus both floor axes while looking from top.
          for (const a of projected.filter(isBrightAxis)) {
            gizmoCtx.globalAlpha = 1;
            gizmoCtx.strokeStyle = a.color;
            gizmoCtx.lineWidth = 2 * pr;
            gizmoCtx.beginPath(); gizmoCtx.moveTo(cx, cy); gizmoCtx.lineTo(cx + a.px, cy + a.py); gizmoCtx.stroke();
            // dot at tip
            gizmoCtx.fillStyle = a.color;
            gizmoCtx.beginPath(); gizmoCtx.arc(cx + a.px, cy + a.py, 3 * pr, 0, Math.PI * 2); gizmoCtx.fill();
            // label
            gizmoCtx.font = `bold ${Math.round(10 * pr)}px sans-serif`;
            gizmoCtx.textAlign = "center";
            gizmoCtx.textBaseline = "middle";
            gizmoCtx.fillStyle = a.color;
            gizmoCtx.fillText(a.label, cx + a.px * 1.28, cy + a.py * 1.28);
          }
          gizmoCtx.globalAlpha = 1;
        }
      };

      this._modelViewer = {
        scene,
        THREE,
        camera,
        container,
        renderer,
        controls,
        resizeObserver,
        markerButtons,
        zoneGroup,
        modelBounds,
        pickableObjects,
        animatedObjects,
        interactiveObjectMap,
        interactiveNameMap,
        applyInteractiveStyles,
        surfaceRaycaster: new THREE.Raycaster(),
        offlineFocusDistance,
        animationFrame: 0,
        requestRender,
        dispose: () => {
          disposed = true;
        },
      };
      this._applyZoneDrawingState();
      this._refresh3DZoneOverlay();
      animate();
      if (this._pendingMarkerFocus) {
        const pendingFocus = this._pendingMarkerFocus;
        this._pendingMarkerFocus = null;
        requestAnimationFrame(() => this._focusMarker(pendingFocus.key || pendingFocus, pendingFocus.options || {}));
      }
    } catch (error) {
      if (renderToken === this._modelRenderToken) {
        this._modelLoadingUrl = "";
        this._modelLoadFailedUrl = modelUrl;
      }
      renderer?.dispose?.();
      renderer?.domElement?.remove?.();
      console.warn("home-assistant-3d-floorplan: 3D model could not be loaded", error);
      if (status) {
        status.hidden = false;
        status.textContent = `3D model could not be loaded: ${modelUrl}. ${error?.message || ""}`.trim();
      }
    }
  }

  _loadModelObject(modelUrl, modules) {
    const { GLTFLoader, OBJLoader } = modules;
    const cleanUrl = String(modelUrl).split("?")[0].toLowerCase();
    if (cleanUrl.endsWith(".obj")) {
      return new Promise((resolve, reject) => {
        new OBJLoader().load(modelUrl, resolve, undefined, reject);
      });
    }

    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        modelUrl,
        (gltf) => resolve(gltf.scene || gltf.scenes?.[0]),
        undefined,
        reject
      );
    });
  }

  /** Ask the animate loop to render one more frame (e.g. after a HA state update). */
  _requestRender() {
    this._modelViewer?.requestRender?.();
  }

  _captureModelCameraState() {
    if (!this._modelViewer?.camera || !this._modelViewer?.controls) return;
    const { camera, controls } = this._modelViewer;
    this._modelCameraState = {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      target: controls.target.toArray(),
      zoom: camera.zoom,
      near: camera.near,
      far: camera.far,
    };
  }

  _restoreModelCameraState(camera, controls) {
    const state = this._modelCameraState;
    if (!state?.position || !state?.target) return;
    camera.position.fromArray(state.position);
    if (state.quaternion) camera.quaternion.fromArray(state.quaternion);
    camera.zoom = Number.isFinite(state.zoom) ? state.zoom : camera.zoom;
    camera.near = Number.isFinite(state.near) ? state.near : camera.near;
    camera.far = Number.isFinite(state.far) ? state.far : camera.far;
    controls.target.fromArray(state.target);
    camera.updateProjectionMatrix();
    controls.update();
  }

  _modelMarkerRows() {
    const rowByKey = new Map(this._deviceRows().map((row) => [row.key, row]));
    return Object.entries(this._markers)
      .map(([key, marker]) => {
        const row = rowByKey.get(key);
        const x = Number(marker.x);
        const y = Number(marker.y);
        const z = Number(marker.z);
        if (!row || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return { row, marker: { ...marker, x, y, z } };
      })
      .filter(Boolean);
  }

  _build3DMarkerButtons(markerLayer, THREE, camera) {
    if (!markerLayer) return [];
    markerLayer.innerHTML = "";
    return this._modelMarkerRows().flatMap(({ row, marker }) => {
      const button = document.createElement("button");
      button.type = "button";
      const stateClass = this._stateClass(row);
      const content = this._markerFace(row);
      const thresholds = marker?.colorThresholds;
      const numericState = Number(row.primaryState);
      const thresholdColor = (!row.offline && thresholds && Number.isFinite(numericState))
        ? this._markerColorFromThresholds(thresholds, numericState)
        : null;
      button.className = `model-marker ${this._display.showLabels ? "with-label" : "icon-only"} ${content.type === "value" ? "value-marker" : ""} ${stateClass} ${thresholdColor ? "state-threshold" : ""} ${row.offline ? "offline" : "online"}`;
      button.dataset.marker = row.key;
      button.dataset.entity = row.entityId;
      button.title = `${row.name} - ${row.primaryState}`;
      button.style.setProperty("--marker-size", `${this._display.markerSize}px`);
      if (thresholdColor) button.style.setProperty("--marker-threshold-color", thresholdColor);
      button.innerHTML = `
        <span class="${content.type === "value" ? "value-face" : ""}">${content.type === "value" ? this._escape(content.value) : `<ha-icon icon="${this._escape(content.icon)}"></ha-icon>`}</span>
        ${this._display.showLabels ? `<strong>${this._escape(row.name)}</strong>` : ""}
      `;
      this._attachMarkerPressActions(button, row);
      markerLayer.appendChild(button);
      const buttons = [{
        button,
        position: new THREE.Vector3(marker.x, marker.y, marker.z),
      }];
      if (this._mode === "edit" && row.primaryDomain === "light" && (this._normalizeLightType(marker.lightType) || "spot") === "spot") {
        (marker.subSpots || []).forEach((subSpot, index) => {
          const x = Number(subSpot.x);
          const y = Number(subSpot.y);
          const z = Number(subSpot.z);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
          const subButton = document.createElement("button");
          subButton.type = "button";
          subButton.className = "model-marker model-sub-spot icon-only";
          subButton.dataset.marker = row.key;
          subButton.dataset.subSpotIndex = String(index);
          subButton.title = `${row.name} sub-spot ${index + 1}`;
          subButton.style.setProperty("--marker-size", `${Math.max(12, this._display.markerSize * 0.72)}px`);
          subButton.innerHTML = `<span><ha-icon icon="mdi:circle-small"></ha-icon></span>`;
          this._attachEditPointButton(subButton, row, "sub-spot", index);
          markerLayer.appendChild(subButton);
          buttons.push({
            button: subButton,
            position: new THREE.Vector3(x, y, z),
          });
        });
      }
      if (this._mode === "edit" && row.primaryDomain === "light" && this._supportsLightPath(marker.lightType)) {
        (marker.lightPath || []).forEach((pathPoint, index) => {
          const x = Number(pathPoint.x);
          const y = Number(pathPoint.y);
          const z = Number(pathPoint.z);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
          const pathButton = document.createElement("button");
          pathButton.type = "button";
          pathButton.className = "model-marker model-light-path-point icon-only";
          pathButton.title = `${row.name} path point ${index + 1}`;
          pathButton.style.setProperty("--marker-size", `${Math.max(10, this._display.markerSize * 0.62)}px`);
          pathButton.innerHTML = `<span>${index + 1}</span>`;
          this._attachEditPointButton(pathButton, row, "light-path", index);
          markerLayer.appendChild(pathButton);
          buttons.push({
            button: pathButton,
            position: new THREE.Vector3(x, y, z),
          });
        });
      }
      return buttons;
    });
  }

  _attachMarkerPressActions(button, row) {
    let pointerState = null;
    let suppressClickUntil = 0;
    const holdMs = Math.max(250, Number(this._config.marker_hold_ms) || 650);

    const resetPointer = () => {
      pointerState = null;
    };

    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      pointerState = {
        id: event.pointerId,
        startedAt: performance.now(),
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      button.setPointerCapture?.(event.pointerId);
    });

    button.addEventListener("pointermove", (event) => {
      if (!pointerState || pointerState.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y) > 10) {
        pointerState.moved = true;
      }
    });

    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!pointerState || pointerState.id !== event.pointerId) return;
      button.releasePointerCapture?.(event.pointerId);
      suppressClickUntil = performance.now() + 450;
      const elapsed = performance.now() - pointerState.startedAt;
      const moved = pointerState.moved || Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y) > 10;
      resetPointer();
      if (moved) return;
      this._runMarkerAction(this._effectiveMarkerAction(row, elapsed >= holdMs ? "hold" : "tap"), row);
    });

    ["pointercancel", "lostpointercapture"].forEach((type) => {
      button.addEventListener(type, resetPointer);
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < suppressClickUntil) return;
      this._runMarkerAction(this._effectiveMarkerAction(row, "tap"), row);
    });
  }

  _runMarkerAction(action, row) {
    const normalizedAction = action || "more-info";
    if (normalizedAction === "none") return;
    if (normalizedAction === "more-info") {
      this._openMoreInfo(row.entityId);
      return;
    }
    if (normalizedAction === "toggle") {
      this._toggleEntity(row.entityId);
      return;
    }
    if (normalizedAction === "navigate") {
      this._navigate(this._markers?.[row.key]?.navigationPath || row.navigationPath);
      return;
    }
    if (normalizedAction === "select") {
      this._selectedMarkers.clear();
      this._selectedMarkers.add(row.key);
      this._pendingDeviceKey = null;
      this._pendingSubSpot = null;
      this._pendingLightPath = null;
      this._highlightSelectedDeviceRow(row.key);
      this._refreshSelectedMarkerPanel();
      return;
    }
    if (normalizedAction === "move") {
      this._startMarkerMove(row.key);
    }
  }

  _normalizeNavigationPath(value) {
    return String(value ?? "").trim();
  }

  _navigate(path) {
    const target = this._normalizeNavigationPath(path);
    if (!target) return false;
    if (target.startsWith("#")) {
      // Hash targets drive pop-up cards (e.g. Bubble Card) without a route change.
      window.location.hash = target.slice(1);
    } else {
      window.history.pushState(null, "", target);
    }
    window.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
    return true;
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    const moreInfoEvent = new Event("hass-more-info", { bubbles: true, composed: true });
    moreInfoEvent.detail = { entityId };
    this.dispatchEvent(moreInfoEvent);
  }

  _toggleEntity(entityId) {
    if (!entityId || !this._hass?.callService) return;
    this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
  }

  _runInteractiveObjectAction(action, entityId, navigationPath) {
    const normalized = action || "more-info";
    if (normalized === "none") return;
    if (normalized === "more-info") {
      this._openMoreInfo(entityId);
      return;
    }
    if (normalized === "toggle") {
      this._toggleEntity(entityId);
      return;
    }
    if (normalized === "navigate") {
      this._navigate(navigationPath);
      return;
    }
    if (typeof normalized === "object" && normalized.action === "navigate") {
      this._navigate(normalized.navigation_path || normalized.navigationPath);
      return;
    }
    // Support call-service action: { action: "call-service", service: "...", data: {...} }
    if (typeof normalized === "object" && normalized.action === "call-service" && normalized.service) {
      const [domain, service] = normalized.service.split(".", 2);
      if (domain && service && this._hass?.callService) {
        this._hass.callService(domain, service, { entity_id: entityId, ...(normalized.data || {}) });
      }
      return;
    }
  }

  _refresh3DMarkerOverlay() {
    if (!this._modelViewer?.container || !this._modelViewer?.THREE || !this._modelViewer?.camera) return;
    const markerLayer = this._modelViewer.container.querySelector("[data-model-marker-layer]");
    this._modelViewer.markerButtons = this._build3DMarkerButtons(markerLayer, this._modelViewer.THREE, this._modelViewer.camera);
    this._refresh3DZoneOverlay(); // also calls _requestRender()
    this._updateDeviceRowsAfterMarkerChange();
    this._refreshOfflineAlert();
  }

  _zoneRenderSignature(rowByKey) {
    const zones = Object.values(this._zones || {}).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const participatingLightKeys = new Set();
    if (this._mode === "edit") {
      Object.entries(this._markers || {}).forEach(([key, marker]) => {
        const row = rowByKey.get(key);
        if (row?.primaryDomain === "light" && this._supportsLightPath(this._normalizeLightType(marker?.lightType))) {
          participatingLightKeys.add(key);
        }
      });
    }
    const zoneData = zones.map((zone) => {
      Object.entries(this._markers || {}).forEach(([key, marker]) => {
        const row = rowByKey.get(key);
        if (row?.primaryDomain === "light" && this._pointInZone(marker, zone)) participatingLightKeys.add(key);
      });
      const illuminanceEntity = zone.illuminanceEntity || "";
      const illuminanceState = illuminanceEntity ? this._hass?.states?.[illuminanceEntity]?.state : "";
      return {
        id: zone.id,
        color: zone.color,
        height: zone.height,
        dayOpacity: zone.dayOpacity,
        nightOpacity: zone.nightOpacity,
        lightingMode: zone.lightingMode,
        illuminanceEnabled: zone.illuminanceEnabled === true,
        illuminanceEntity,
        illuminanceState,
        showLux: zone.showLux === true,
        points: (zone.points || []).map((point) => [
          Number(point.x) || 0,
          Number(point.y) || 0,
          Number(point.z) || 0,
        ]),
      };
    });
    const lightData = [...participatingLightKeys].sort().map((key) => {
      const marker = this._markers?.[key] || {};
      const row = rowByKey.get(key);
      const stateObj = row?.entityId ? this._hass?.states?.[row.entityId] : null;
      return {
        key,
        state: stateObj?.state || "",
        brightness: stateObj?.attributes?.brightness ?? "",
        color: stateObj ? this._lightColor(stateObj) : "",
        x: marker.x,
        y: marker.y,
        z: marker.z,
        lightType: marker.lightType,
        lightRadius: marker.lightRadius,
        lightIntensity: marker.lightIntensity,
        lightPreset: marker.lightPreset,
        renderParams: marker.renderParams || {},
        subSpots: marker.subSpots || [],
        lightPath: marker.lightPath || [],
        lightShape: marker.lightShape,
        lightRect: marker.lightRect || {},
      };
    });
    const ambient = this._ambientDarknessConfig();
    const ambientState = ambient.entity ? this._hass?.states?.[ambient.entity]?.state : "";
    return JSON.stringify({
      mode: this._mode,
      activeFloorId: this._activeFloorId,
      ambient,
      ambientState,
      zones: zoneData,
      lights: lightData,
    });
  }

  _updateDeviceRowsAfterMarkerChange() {
    this.shadowRoot?.querySelectorAll("[data-device]").forEach((row) => {
      const key = row.dataset.device;
      const placed = Boolean(this._markers[key]);
      row.classList.toggle("is-placed", placed);
      row.classList.toggle("is-pending", this._pendingDeviceKey === key);
    });
  }

  _refresh3DZoneOverlay() {
    const viewer = this._modelViewer;
    if (!viewer?.zoneGroup || !viewer?.THREE) return;
    const { THREE, zoneGroup } = viewer;
    const rowByKey = new Map(this._deviceRows().map((row) => [row.key, row]));
    const signature = this._zoneRenderSignature(rowByKey);
    if (viewer.zoneRenderSignature === signature) {
      this._refresh3DZoneLabels();
      this._refresh3DZonePointOverlay();
      this._requestRender();
      return;
    }
    viewer.zoneRenderSignature = signature;
    while (zoneGroup.children.length) {
      const child = zoneGroup.children.pop();
      child.traverse?.((object) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.filter(Boolean).forEach((material) => {
          material.map?.dispose?.();
          material.dispose?.();
        });
      });
    }

    if (this._mode === "edit") {
      Object.entries(this._markers || {}).forEach(([key, marker]) => {
        const row = rowByKey.get(key);
        const lightType = this._normalizeLightType(marker?.lightType);
        if (row?.primaryDomain !== "light" || !this._supportsLightPath(lightType)) return;
        // For rect shape, generate the closed-loop points and draw those as the line
        const rectPts = marker.lightShape === "rect" ? this._lightRectPoints(marker) : null;
        const lineMarker = rectPts
          ? { ...marker, lightPath: [...rectPts, { ...rectPts[0] }] }  // close loop visually only
          : marker;
        const line = this._createLightPathLine(THREE, lineMarker, lightType);
        if (line) zoneGroup.add(line);
      });
    }
    for (const zone of Object.values(this._zones || {})) {
      if ((zone.points || []).length < 3) continue;
      const lighting = this._zoneLighting(zone, rowByKey);
      const brightness = lighting.brightness;
      const darkness = this._zoneDarkness(brightness, zone);

      if (zone.lightingMode === "positional") {
        // --- Individual Light Glow: walls always at full ambient darkness, only per-light glow lifts nearby walls ---
        const ambientDarkness = this._zoneAmbientDarknessOpacity(zone); // ignores light state — always max dark base
        // Keep the floor shade subtle so tile/material texture stays visible.
        // All walls stay fully dark regardless of which lights are on
        const wallShade = this._zoneWallShadeMeshes(THREE, zone, ambientDarkness);
        wallShade.forEach((wall) => zoneGroup.add(wall));
        const floorShade = this._zoneFloorShadeMesh(THREE, zone, ambientDarkness, "positional");
        if (floorShade) zoneGroup.add(floorShade);
        const lights = this._positionalLights(zone, rowByKey);
        const ceilingShade = this._zoneCeilingShadeMesh(THREE, zone, ambientDarkness);
        if (ceilingShade) zoneGroup.add(ceilingShade);
        // For cove/linear: floor fill is zone-wide — only render it once per unique entity key
        const lineTypeFloorDone = new Set();
        for (const light of lights) {
          const isLineType = light.lightType === "cove" || light.lightType === "linear";
          const entityKey = light.marker?.key || light.row?.key;
          const skipFloor = isLineType && lineTypeFloorDone.has(entityKey);
          if (!skipFloor) {
            const floorGlow = this._createFloorLightGlowMesh(THREE, zone, light.marker, light.lightType, light.lightRadius, light.color, light.brightness);
            if (floorGlow) zoneGroup.add(floorGlow);
            const giBounce = this._createGIBounceMesh(THREE, zone, light.marker, light.lightType, light.lightRadius, light.color, light.brightness);
            if (giBounce) zoneGroup.add(giBounce);
            if (isLineType && entityKey) lineTypeFloorDone.add(entityKey);
          }
          // Only the walls physically close to this light get illuminated
          const nearWalls = this._nearbyWallGlowMeshes(THREE, zone, light.marker, light.lightRadius, light.color, light.brightness, light.lightType, light.heightFraction);
          nearWalls.forEach((w) => zoneGroup.add(w));
          const ceilingGlow = this._createCeilingLightGlowMesh(THREE, zone, light.marker, light.lightType, light.lightRadius, light.color, light.brightness);
          if (ceilingGlow) zoneGroup.add(ceilingGlow);
        }
        const outline = this._zoneOutline(THREE, zone);
        if (outline) zoneGroup.add(outline);
      } else {
        // --- Area mode: single large soft pool centered on zone + wall wash ---
        const wallShade = this._zoneWallShadeMeshes(THREE, zone, darkness);
        wallShade.forEach((wall) => zoneGroup.add(wall));
        const floorShade = this._zoneFloorShadeMesh(THREE, zone, darkness, "area");
        if (floorShade) zoneGroup.add(floorShade);
        const ceilingDarkness = this._zoneCeilingDarkness(darkness, lighting.lights || []);
        const ceilingShade = this._zoneCeilingShadeMesh(THREE, zone, ceilingDarkness);
        if (ceilingShade) zoneGroup.add(ceilingShade);
        // Polygon-clipped flat floor glow — stays exactly within zone boundary, no bleed
        const areaGlow = this._zoneAreaGlowMesh(THREE, zone, brightness, lighting.color);
        if (areaGlow) zoneGroup.add(areaGlow);
        const wallWash = brightness > 0.01 ? this._zoneWallWashMeshes(THREE, zone, brightness * 0.75, lighting.color) : [];
        wallWash.forEach((wall) => zoneGroup.add(wall));
        const outline = this._zoneOutline(THREE, zone);
        if (outline) zoneGroup.add(outline);
      }
    }
    this._refresh3DZoneLabels();
    this._refresh3DZonePointOverlay();
    this._requestRender();
  }

  _zoneMesh(THREE, zone, opacity, color = zone.color || "#f8d66d", options = {}) {
    const points = this._floorSurfacePoints(THREE, zone, options.floorLift);
    const vertices = points.flatMap((point) => [point.x, point.y, point.z]);
    const displayPoints = (zone.points || []).map((point) => this._modelToDisplayPoint(point));
    const axes = this._floorAxes();
    const shapePoints = displayPoints.map((point) => new THREE.Vector2(Number(point[axes[0]]), Number(point[axes[1]])));
    const indices = THREE.ShapeUtils.triangulateShape(shapePoints, []).flat();
    if (!indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      ...(options.additive ? { blending: THREE.AdditiveBlending } : {}),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = options.renderOrder || 2;
    return mesh;
  }

  _zoneFloorShadeMesh(THREE, zone, darkness, mode = "area") {
    const strength = Math.max(0, Math.min(1, Number(darkness) || 0));
    const opacity = mode === "positional"
      ? Math.min(0.48, strength * 0.46)
      : Math.min(0.42, strength * 0.38);
    if (opacity <= 0.01) return null;
    return this._zoneMesh(THREE, zone, opacity, "#273244", {
      renderOrder: 1.9,
      floorLift: mode === "positional" ? 0.045 : 0.12,
      surfaceSnap: true,
    });
  }

  _attachEditPointButton(button, row, pointType, index) {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._selectedMarkers.clear();
      this._selectedMarkers.add(row.key);
      this._pendingDeviceKey = null;
      this._pendingSubSpot = null;
      this._pendingLightPath = null;
      this._highlightSelectedDeviceRow(row.key);
      this._refreshSelectedMarkerPanel();
    });
    button.dataset.marker = row.key;
    button.dataset.pointType = pointType;
    button.dataset.pointIndex = String(index);
  }

  _createLightPathLine(THREE, marker, lightType) {
    const points = (marker.lightPath || [])
      .map((point) => new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z)))
      .filter((point) => this._isSafeModelPoint(point));
    if (points.length < 2) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: lightType === "linear" ? 0xfacc15 : 0x93c5fd,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 20;
    return line;
  }

  _zoneOutline(THREE, zone) {
    if (this._mode !== "edit") return null;
    const points = this._offsetZonePoints(zone.points, 0.05);
    const vertices = [...points, points[0]].flatMap((point) => [point.x, point.y, point.z]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({ color: zone.color || "#f8d66d", transparent: true, opacity: 1, linewidth: 3 });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 3;
    return line;
  }

  _zoneWallWashMeshes(THREE, zone, brightness, color) {
    const basePoints = this._offsetZonePoints(zone.points);
    if (basePoints.length < 2) return [];
    const displayHeight = Math.max(0.01, Math.abs(this._zoneHeight(zone)));
    const modelHeight = this._displayToModelVector(this._displayHeightVector(displayHeight));
    const heightVector = new THREE.Vector3(modelHeight.x, modelHeight.y, modelHeight.z);
    if (!heightVector.length()) return [];
    const colorValue = color || zone.color || "#f8d66d";
    const opacity = Math.max(0.08, Math.min(0.55, brightness * 0.48));
    const vertices = [];
    basePoints.forEach((start, index) => {
      const end = basePoints[(index + 1) % basePoints.length];
      const bottomStart = new THREE.Vector3(start.x, start.y, start.z);
      const bottomEnd = new THREE.Vector3(end.x, end.y, end.z);
      const topStart = bottomStart.clone().add(heightVector);
      const topEnd = bottomEnd.clone().add(heightVector);
      vertices.push(
        bottomStart.x, bottomStart.y, bottomStart.z,
        bottomEnd.x, bottomEnd.y, bottomEnd.z,
        topEnd.x, topEnd.y, topEnd.z,
        bottomStart.x, bottomStart.y, bottomStart.z,
        topEnd.x, topEnd.y, topEnd.z,
        topStart.x, topStart.y, topStart.z,
      );
    });
    if (!vertices.length) return [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.MeshBasicMaterial({
      color: colorValue,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2.6;
    return [mesh];
  }

  /** Per-fragment lit wall glow — GPU computes 1/r² distance falloff at every pixel so long walls
   *  are bright near the light and naturally dark at the far end, no manual grid subdivision needed. */
  _nearbyWallGlowMeshes(THREE, zone, marker, lightRadius, color, brightness, lightType, heightFraction = 0.8) {
    if (brightness < 0.01) return [];
    const basePoints = this._offsetZonePoints(zone.points);
    if (basePoints.length < 2) return [];
    const displayHeight = Math.max(0.01, Math.abs(this._zoneHeight(zone)));
    const modelHeight = this._displayToModelVector(this._displayHeightVector(displayHeight));
    const heightVector = new THREE.Vector3(modelHeight.x, modelHeight.y, modelHeight.z);
    if (!heightVector.length()) return [];

    const floorAxes = this._floorAxes();
    const map = this._coordinateMap();
    const ax0 = map[floorAxes[0]];
    const ax1 = map[floorAxes[1]];
    const verticalModelAxis = map[this._verticalAxis()]; // "x" | "y" | "z"

    // Light world position — markers store model-space coords directly (set by raycaster hit).
    const lightPos = new THREE.Vector3(Number(marker.x), Number(marker.y), Number(marker.z));
    // Floor-projected light position — same XY but at floor level.
    // Used as the "bounce emitter" for spot wall glow so lower wall is brighter
    // (closer to the bright floor hotspot) and upper wall is dimmer.
    const floorLevel = this._zoneFloorLevel(zone);
    const floorLightPos = lightPos.clone();
    floorLightPos[verticalModelAxis] = floorLevel;

    // Resolve per-marker render params (built-in defaults → named preset → per-marker overrides)
    const rp = this._resolveRenderParams(marker);

    // Max reach of this light on the walls
    const baseReach = Math.max(1, Number(rp.distance) || lightRadius * rp.wall_reach);
    const spotReach = heightFraction > 0
      ? Math.max(baseReach, (lightPos[verticalModelAxis] - floorLevel) * 1.8)
      : baseReach;
    const maxReach = lightType === "spot" ? spotReach : baseReach;

    // Wall mesh covers full zone height
    const wallHeightFraction = Math.max(0.1, Math.min(1, Number(rp.wall_height_fraction) || 1));

    // Peak brightness using resolved param
    const peakBrightness = brightness * rp.wall_peak * (lightType === "spot" ? Math.max(0.5, heightFraction) : 1.0);

    const { r: cr, g: cg, b: cb } = this._cssColorToRgba(color || zone.color || "#f8d66d");
    const uColor = new THREE.Color(cr / 255, cg / 255, cb / 255);

    const falloffExp = rp.wall_falloff;

    // Spot cone direction: default points straight down, optional tilt steers it.
    const spotDir = this._spotDirectionVector(THREE, rp, verticalModelAxis, ax0, ax1);

    const baseSpotDir = new THREE.Vector3(
      verticalModelAxis === "x" ? -1 : 0,
      verticalModelAxis === "y" ? -1 : 0,
      verticalModelAxis === "z" ? -1 : 0,
    );

    const vertexShader = `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;
    const isSpot = lightType === "spot";
    const fragmentShader = `
      uniform vec3  uLightPos;
      uniform vec3  uColor;
      uniform float uPeak;
      uniform float uRadius;
      uniform float uFalloffExp;
      uniform float uIsSpot;
      uniform vec3  uSpotDir;    // normalised downward direction for cone
      uniform float uConeInner;  // cos of inner half-angle (bright core)
      uniform float uConeOuter;  // cos of outer half-angle (penumbra edge)
      varying vec3  vWorldPos;
      void main() {
        vec3 toPoint = vWorldPos - uLightPos;
        float dist = length(toPoint);
        if (dist >= uRadius) { gl_FragColor = vec4(0.0); return; }

        float intensity;
        if (uIsSpot > 0.5) {
          // True cone: check angle between ray and downward spot axis
          vec3 dir = normalize(toPoint);
          float cosA = dot(dir, uSpotDir);

          // Outside outer cone edge — no contribution
          if (cosA < uConeOuter) { gl_FragColor = vec4(0.0); return; }

          // Smooth penumbra from outer to inner cone edge
          float coneFactor = smoothstep(uConeOuter, uConeInner, cosA);

          // Distance falloff from the light source
          float distFalloff = pow(max(0.0, 1.0 - dist / uRadius), uFalloffExp);

          intensity = coneFactor * distFalloff * uPeak;
        } else {
          // Cove / linear / lamp: smooth continuous wash — no hard circular boundary.
          // Uses a squared distance-ratio so the falloff is very gradual, preventing
          // visible circle edges between adjacent path samples.
          float t = max(0.0, 1.0 - (dist * dist) / (uRadius * uRadius));
          float baseFalloff = pow(t, uFalloffExp * 0.5); // half exponent = much flatter

          // Vertical gradient: brighter near ceiling (light source), fades downward
          float verticalDrop = dot(toPoint, uSpotDir); // positive = below light
          float normDrop = clamp(verticalDrop / uRadius, 0.0, 1.0);
          float verticalFactor = pow(max(0.0, 1.0 - normDrop * 0.55), 0.4);

          intensity = baseFalloff * verticalFactor * uPeak;
        }
        ${this._supportsLightPath(lightType) ? `
        vec3 orientationDir = vec3(${Number(marker.orientationDir?.x || 0).toFixed(6)}, ${Number(marker.orientationDir?.y || 0).toFixed(6)}, ${Number(marker.orientationDir?.z || 0).toFixed(6)});
        float orientationLen = length(orientationDir);
        if (orientationLen > 0.001) {
          vec3 aimed = toPoint / max(length(toPoint), 0.0001);
          vec3 oriented = orientationDir / orientationLen;
          float sideFactor = smoothstep(${(1 - this._orientationSpread(marker.orientationSpread) * 1.35).toFixed(3)}, 1.0, dot(aimed, oriented));
          intensity *= sideFactor;
        }
        ` : ""}
        gl_FragColor = vec4(uColor * intensity, intensity);
      }
    `;

    const wallLowerBias = Math.max(0, Math.min(1, Number(rp.wall_lower_bias) || 0));
    const wallLightPos = lightPos.clone().lerp(floorLightPos, wallLowerBias);
    const glowHeight = displayHeight * wallHeightFraction;
    const glowModelHeight = this._displayToModelVector(this._displayHeightVector(glowHeight));
    const glowHeightVec = new THREE.Vector3(glowModelHeight.x, glowModelHeight.y, glowModelHeight.z);

    const vertices = [];
    for (let index = 0; index < basePoints.length; index++) {
      const start = basePoints[index];
      const end = basePoints[(index + 1) % basePoints.length];

      // Quick CPU cull: measure distance to the wall segment itself. Checking
      // endpoints only makes long walls miss line lights that run through the middle.
      const sx = Number(start[ax0]);
      const sy = Number(start[ax1]);
      const ex = Number(end[ax0]);
      const ey = Number(end[ax1]);
      const lx = Number(lightPos[ax0]);
      const ly = Number(lightPos[ax1]);
      const segX = ex - sx;
      const segY = ey - sy;
      const segLenSq = segX * segX + segY * segY;
      const t = segLenSq > 0 ? Math.max(0, Math.min(1, ((lx - sx) * segX + (ly - sy) * segY) / segLenSq)) : 0;
      const closestX = sx + segX * t;
      const closestY = sy + segY * t;
      const segmentDistance = Math.hypot(closestX - lx, closestY - ly);
      if (segmentDistance > maxReach) continue;

      const bottomStart = new THREE.Vector3(start.x, start.y, start.z);
      const bottomEnd   = new THREE.Vector3(end.x,   end.y,   end.z);
      const topStart    = bottomStart.clone().add(glowHeightVec);
      const topEnd      = bottomEnd.clone().add(glowHeightVec);

      vertices.push(
        bottomStart.x, bottomStart.y, bottomStart.z,
        bottomEnd.x,   bottomEnd.y,   bottomEnd.z,
        topEnd.x,      topEnd.y,      topEnd.z,
        bottomStart.x, bottomStart.y, bottomStart.z,
        topEnd.x,      topEnd.y,      topEnd.z,
        topStart.x,    topStart.y,    topStart.z,
      );
    }
    if (!vertices.length) return [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uLightPos:   { value: wallLightPos },
        uColor:      { value: uColor.clone() },
        uPeak:       { value: peakBrightness },
        uRadius:     { value: maxReach },
        uFalloffExp: { value: falloffExp },
        uIsSpot:     { value: isSpot ? 1.0 : 0.0 },
        uSpotDir:    { value: isSpot ? spotDir : baseSpotDir },
        uConeInner:  { value: Math.cos((rp.angle * (1 - rp.penumbra * 0.75)) || 0.5) },
        uConeOuter:  { value: Math.cos(rp.angle || 0.95) },
      },
      vertexShader, fragmentShader,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2.6;
    return [mesh];
  }

  _spotDirectionVector(THREE, params, verticalModelAxis, ax0, ax1) {
    const dir = new THREE.Vector3(
      verticalModelAxis === "x" ? -1 : 0,
      verticalModelAxis === "y" ? -1 : 0,
      verticalModelAxis === "z" ? -1 : 0,
    );
    const tilt0 = Math.tan(this._normalOrientationDeg(params.tilt_x) * Math.PI / 180);
    const tilt1 = Math.tan(this._normalOrientationDeg(params.tilt_y) * Math.PI / 180);
    dir[ax0] += tilt0;
    dir[ax1] += tilt1;
    return dir.normalize();
  }

  _directionalTargetFactor(marker, target) {
    const direction = marker?.orientationDir;
    if (!direction) return 1;
    const map = this._coordinateMap();
    const verticalAxis = map[this._verticalAxis()];
    const vertical = Number(direction[verticalAxis]) || 0;
    const spread = this._orientationSpread(marker.orientationSpread);
    const dot = target === "ceiling" ? vertical : target === "floor" ? -vertical : 0;
    const focus = Math.max(0, Math.min(1, dot));
    const softness = 1.45 - Math.min(1, spread) * 0.75;
    return 0.08 + 0.92 * Math.pow(focus, softness);
  }

  _zoneWallShadeMeshes(THREE, zone, darkness) {
    const opacity = Math.max(0, Math.min(0.62, darkness * 0.8));
    if (opacity <= 0.01) return [];
    const basePoints = this._offsetZonePoints(zone.points);
    if (basePoints.length < 2) return [];
    const displayHeight = Math.max(0.01, Math.abs(this._zoneHeight(zone)));
    const modelHeight = this._displayToModelVector(this._displayHeightVector(displayHeight));
    const heightVector = new THREE.Vector3(modelHeight.x, modelHeight.y, modelHeight.z);
    if (!heightVector.length()) return [];
    const vertices = [];
    basePoints.forEach((start, index) => {
      const end = basePoints[(index + 1) % basePoints.length];
      const bottomStart = new THREE.Vector3(start.x, start.y, start.z);
      const bottomEnd = new THREE.Vector3(end.x, end.y, end.z);
      const topStart = bottomStart.clone().add(heightVector);
      const topEnd = bottomEnd.clone().add(heightVector);
      vertices.push(
        bottomStart.x, bottomStart.y, bottomStart.z,
        topEnd.x, topEnd.y, topEnd.z,
        bottomEnd.x, bottomEnd.y, bottomEnd.z,
        bottomStart.x, bottomStart.y, bottomStart.z,
        topStart.x, topStart.y, topStart.z,
        topEnd.x, topEnd.y, topEnd.z,
      );
    });
    if (!vertices.length) return [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.MeshBasicMaterial({
      color: "#020617",
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2.2;
    return [mesh];
  }

  _zoneCeilingShadeMesh(THREE, zone, darkness) {
    const opacity = Math.max(0, Math.min(0.5, darkness * 0.55));
    if (opacity <= 0.01) return null;
    const displayHeight = Math.max(0.01, Math.abs(this._zoneHeight(zone)));
    const shadeHeight = Math.max(0, Math.min(displayHeight, this._zoneShadeHeight(zone)));
    const offset = this._displayToModelVector(this._displayHeightVector(shadeHeight));
    const points = this._offsetZonePoints(zone.points).map((point) => ({
      x: point.x + offset.x,
      y: point.y + offset.y,
      z: point.z + offset.z,
    }));
    const vertices = points.flatMap((point) => [point.x, point.y, point.z]);
    const displayPoints = (zone.points || []).map((point) => this._modelToDisplayPoint(point));
    const axes = this._floorAxes();
    const shapePoints = displayPoints.map((point) => new THREE.Vector2(Number(point[axes[0]]), Number(point[axes[1]])));
    const indices = THREE.ShapeUtils.triangulateShape(shapePoints, []).flat();
    if (!indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      color: "#020617",
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2.15;
    return mesh;
  }

  _createCeilingLightGlowMesh(THREE, zone, marker, lightType, lightRadius, color, brightness) {
    const rp = this._resolveRenderParams(marker);
    if (brightness <= 0.01) return null;
    const displayHeight = Math.max(0.01, Math.abs(this._zoneHeight(zone)));
    const shadeHeight = Math.max(0, Math.min(displayHeight, this._zoneShadeHeight(zone)));
    const verticalModelAxis = this._coordinateMap()[this._verticalAxis()] || "y";
    const ceilingLevel = this._zoneFloorLevel(zone) + this._displayToModelVector(this._displayHeightVector(shadeHeight))[verticalModelAxis] - 0.04;
    const radius = Math.max(0.1, Number(rp.distance) || Number(lightRadius) || 1);
    const glowBrightness = brightness * 0.35 * this._directionalTargetFactor(marker, "ceiling");
    const material = this._createLightPoolMaterial(THREE, lightType, color, glowBrightness, {
      softness: rp.decay <= 0 ? 1.8 : Math.max(0.8, Math.min(2.5, 2.4 / (rp.decay + 0.6))),
      saturation: Math.max(0.35, Math.min(1.1, Number(rp.floor_saturation) || 0.75)),
    });
    // Use zone polygon as geometry — clips ceiling glow to zone boundary
    const floorAxes = this._floorAxes();
    const map = this._coordinateMap();
    const ax0 = map[floorAxes[0]];
    const ax1 = map[floorAxes[1]];
    return this._buildPolygonFloorMesh(
      THREE, zone,
      Number(marker[ax0]), Number(marker[ax1]),
      radius, ceilingLevel, material, 2.18
    );
  }

  _refresh3DZonePointOverlay() {
    const viewer = this._modelViewer;
    if (!viewer?.THREE || !viewer?.camera || !viewer?.container) return;
    const layer = viewer.container.querySelector("[data-zone-point-layer]");
    if (!layer) return;
    viewer.zonePointButtons = this._build3DZonePointButtons(layer, viewer.THREE);
    this._update3DZonePointButtons(viewer.zonePointButtons, viewer.THREE, viewer.camera, viewer.container);
  }

  _refresh3DZoneLabels() {
    const viewer = this._modelViewer;
    if (!viewer?.THREE || !viewer?.camera || !viewer?.container) return;
    const layer = viewer.container.querySelector("[data-zone-label-layer]");
    if (!layer) return;
    layer.innerHTML = "";
    viewer.zoneLabels = Object.values(this._zones || [])
      .map((zone) => {
        if (zone.showLux !== true) return null;
        const illuminance = this._zoneIlluminanceInfo(zone);
        if (!illuminance) return null;
        const center = this._zoneCenter(zone);
        if (!center) return null;
        const label = document.createElement("div");
        label.className = "zone-lux-label";
        label.textContent = this._mode === "edit" ? `${this._formatLux(illuminance.lux)} lux / shade ${this._formatCoordinate(illuminance.opacity)}` : `${this._formatLux(illuminance.lux)} lux`;
        layer.appendChild(label);
        return {
          label,
          position: new viewer.THREE.Vector3(center.x, center.y, center.z),
        };
      })
      .filter(Boolean);
    this._update3DZoneLabels(viewer.zoneLabels, viewer.THREE, viewer.camera, viewer.container);
  }

  /** Returns the average radius (in model units) from zone center to its outermost point. */
  _zoneRadius(zone) {
    const center = this._zoneCenter(zone);
    if (!center) return 50;
    const floorAxes = this._floorAxes();
    const map = this._coordinateMap();
    const ax0 = map[floorAxes[0]];
    const ax1 = map[floorAxes[1]];
    return (zone.points || []).reduce((max, p) => {
      const dx = Number(p[ax0]) - Number(center[ax0]);
      const dy = Number(p[ax1]) - Number(center[ax1]);
      return Math.max(max, Math.sqrt(dx * dx + dy * dy));
    }, 10);
  }

  _zoneCenter(zone) {
    const points = this._offsetZonePoints(zone.points || [], 0.08);
    if (!points.length) return null;
    return points.reduce(
      (center, point) => {
        center.x += Number(point.x) / points.length;
        center.y += Number(point.y) / points.length;
        center.z += Number(point.z) / points.length;
        return center;
      },
      { x: 0, y: 0, z: 0 }
    );
  }

  /** Zone-wide gradient glow mesh — gradient clipped exactly to the zone polygon so it never bleeds outside walls. */
  _zoneAreaGlowMesh(THREE, zone, brightness, color) {
    const center = this._zoneCenter(zone);
    if (!center || brightness < 0.01) return null;

    const points = this._floorSurfacePoints(THREE, zone, 0.055);
    if (points.length < 3) return null;

    // Build triangulated geometry from zone polygon
    const floorAxes = this._floorAxes();
    const map = this._coordinateMap();
    const ax0 = map[floorAxes[0]]; // e.g. "x"
    const ax1 = map[floorAxes[1]]; // e.g. "y"

    const displayPoints = points.map((p) => this._modelToDisplayPoint(p));
    const centerDisplay = this._modelToDisplayPoint(center);
    const cx = Number(centerDisplay[floorAxes[0]]);
    const cy = Number(centerDisplay[floorAxes[1]]);

    // Compute max distance from center to any vertex (for UV normalisation)
    const maxDist = Math.max(1, ...displayPoints.map((p) => {
      const dx = Number(p[floorAxes[0]]) - cx;
      const dy = Number(p[floorAxes[1]]) - cy;
      return Math.sqrt(dx * dx + dy * dy);
    }));

    const shapePoints = displayPoints.map((p) => new THREE.Vector2(Number(p[floorAxes[0]]), Number(p[floorAxes[1]])));
    const indices = THREE.ShapeUtils.triangulateShape(shapePoints, []).flat();
    if (!indices.length) return null;

    const positions = points.flatMap((p) => [Number(p.x), Number(p.y), Number(p.z)]);
    // UV: map each vertex so zone center = (0.5, 0.5) and edges approach 0/1
    const uvs = displayPoints.flatMap((p) => {
      const u = 0.5 + (Number(p[floorAxes[0]]) - cx) / (maxDist * 2);
      const v = 0.5 + (Number(p[floorAxes[1]]) - cy) / (maxDist * 2);
      return [u, v];
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    // Shader material: flat diffuse wash clipped to zone polygon via UV
    const material = this._createLightPoolMaterial(THREE, "area", color, brightness * 0.26);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2.05;
    return mesh;
  }

  _build3DZonePointButtons(layer, THREE) {
    layer.innerHTML = "";
    if (this._mode !== "edit" || this._sidebarTab !== "areas") return [];
    const zone = this._zones[this._activeZoneId];
    if (!zone) return [];
    return (zone.points || []).map((point, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `zone-point-handle ${index === this._activeZonePointIndex ? "active" : ""}`;
      button.textContent = String(index + 1);
      button.title = `${zone.name} point ${index + 1}`;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._selectZonePoint(zone.id, index);
      });
      layer.appendChild(button);
      return {
        button,
        position: new THREE.Vector3(point.x, point.y, point.z),
      };
    });
  }

  _update3DZonePointButtons(pointButtons, THREE, camera, container) {
    if (!pointButtons?.length) return;
    const rect = container.getBoundingClientRect?.();
    const width = rect?.width || container.clientWidth || 1;
    const height = rect?.height || container.clientHeight || 1;
    for (const pointButton of pointButtons) {
      const point = pointButton.position.clone().project(camera);
      const visible = point.z > -1 && point.z < 1;
      pointButton.button.hidden = !visible;
      if (!visible) continue;
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      pointButton.button.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  _update3DZoneLabels(zoneLabels, THREE, camera, container) {
    if (!zoneLabels?.length) return;
    const rect = container.getBoundingClientRect?.();
    const width = rect?.width || container.clientWidth || 1;
    const height = rect?.height || container.clientHeight || 1;
    for (const zoneLabel of zoneLabels) {
      const point = zoneLabel.position.clone().project(camera);
      const visible = point.z > -1 && point.z < 1;
      zoneLabel.label.hidden = !visible;
      if (!visible) continue;
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      zoneLabel.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  _offsetZonePoints(points, lift = 0.025) {
    const modelVertical = this._coordinateMap()[this._verticalAxis()] || "z";
    const offset = Number.isFinite(Number(lift)) ? Number(lift) : 0.025;
    return points.map((point) => ({
      x: Number(point.x) + (modelVertical === "x" ? offset : 0),
      y: Number(point.y) + (modelVertical === "y" ? offset : 0),
      z: Number(point.z) + (modelVertical === "z" ? offset : 0),
    }));
  }

  _floorSurfacePoints(THREE, zone, lift = 0.025) {
    const targetLevel = this._zoneFloorLevel(zone);
    return this._offsetZonePoints(zone.points || [], lift).map((point) => this._surfacePoint(THREE, point, lift, targetLevel));
  }

  _surfacePoint(THREE, point, lift = 0.025, targetLevel = null) {
    const viewer = this._modelViewer;
    if (!viewer?.pickableObjects?.length || !viewer?.modelBounds || !viewer?.surfaceRaycaster) return point;
    const map = this._coordinateMap();
    const verticalAxis = map[this._verticalAxis()] || "y";
    const boundsMin = viewer.modelBounds.min[verticalAxis];
    const boundsMax = viewer.modelBounds.max[verticalAxis];
    if (!Number.isFinite(boundsMin) || !Number.isFinite(boundsMax)) return point;

    const span = Math.max(1, boundsMax - boundsMin);
    const origin = new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z));
    origin[verticalAxis] = boundsMax + span * 0.25;
    const direction = new THREE.Vector3(
      verticalAxis === "x" ? -1 : 0,
      verticalAxis === "y" ? -1 : 0,
      verticalAxis === "z" ? -1 : 0
    );
    const raycaster = viewer.surfaceRaycaster;
    raycaster.set(origin, direction);
    raycaster.near = 0;
    raycaster.far = span * 1.75;
    const hits = raycaster.intersectObjects(viewer.pickableObjects, true);
    if (!hits.length) return point;

    const desired = Number.isFinite(Number(targetLevel)) ? Number(targetLevel) : Number(point[verticalAxis]) - (Number(lift) || 0);
    const hit = hits
      .filter((entry) => entry?.point && Number.isFinite(entry.point[verticalAxis]))
      .sort((a, b) => Math.abs(a.point[verticalAxis] - desired) - Math.abs(b.point[verticalAxis] - desired))[0];
    if (!hit) return point;
    const result = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    const offset = Number.isFinite(Number(lift)) ? Number(lift) : 0.025;
    result[verticalAxis] += offset;
    return result;
  }

  _surfaceFloorLevel(THREE, zone, point, lift = 0.025) {
    const verticalAxis = this._coordinateMap()[this._verticalAxis()] || "y";
    const targetLevel = this._zoneFloorLevel(zone);
    const probe = {
      x: Number(point?.x) || 0,
      y: Number(point?.y) || 0,
      z: Number(point?.z) || 0,
    };
    probe[verticalAxis] = targetLevel + lift;
    return this._surfacePoint(THREE, probe, lift, targetLevel)[verticalAxis];
  }

  _displayToModelVector(vector) {
    const origin = this._displayToModelPoint({ x: 0, y: 0, z: 0 });
    const target = this._displayToModelPoint(vector);
    return {
      x: Number(target.x) - Number(origin.x),
      y: Number(target.y) - Number(origin.y),
      z: Number(target.z) - Number(origin.z),
    };
  }

  /** Returns a display-space vector with `magnitude` on the vertical axis and 0 on floor axes.
   *  Use this whenever you need to build a "height" vector — it respects vertical_axis config. */
  _displayHeightVector(magnitude) {
    const v = { x: 0, y: 0, z: 0 };
    v[this._verticalAxis()] = magnitude;
    return v;
  }

  _ambientDarknessConfig() {
    const value = this._config.ambient_darkness;
    if (value === false) {
      return { disabled: true, entity: "", day_opacity: 0, night_opacity: 0 };
    }
    return {
      entity: value?.entity || "sun.sun",
      day_opacity: this._numberOrDefault(value?.day_opacity, 0.5),
      night_opacity: this._numberOrDefault(value?.night_opacity, 1),
    };
  }

  _ambientDarknessOpacity() {
    const config = this._ambientDarknessConfig();
    const state = config.entity ? this._hass?.states?.[config.entity]?.state : "";
    const isNight = String(state || "").toLowerCase() === "below_horizon";
    return Math.max(0, Math.min(1, isNight ? config.night_opacity : config.day_opacity));
  }

  _zoneAmbientDarknessOpacity(zone) {
    const illuminance = this._zoneIlluminanceOpacity(zone);
    if (illuminance !== null) return illuminance;
    const config = this._ambientDarknessConfig();
    if (config.disabled) return 0;
    const state = config.entity ? this._hass?.states?.[config.entity]?.state : "";
    const isNight = String(state || "").toLowerCase() === "below_horizon";
    return this._zoneOpacity(zone, isNight ? "night" : "day");
  }

  _zoneIlluminanceOpacity(zone = {}) {
    return this._zoneIlluminanceInfo(zone)?.opacity ?? null;
  }

  _zoneIlluminanceInfo(zone = {}) {
    if (zone.illuminanceEnabled !== true || !zone.illuminanceEntity) return null;
    const stateObj = this._hass?.states?.[zone.illuminanceEntity];
    const lux = Number(stateObj?.state);
    if (!Number.isFinite(lux)) return null;
    const day = this._zoneOpacity(zone, "day");
    const night = this._zoneOpacity(zone, "night");
    const normalized = Math.max(0, lux / 300);
    const opacity = Math.max(0, Math.min(1, night - (night - day) * normalized));
    return { lux, opacity };
  }

  _formatLux(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (Math.abs(number) >= 100) return number.toFixed(0);
    if (Math.abs(number) >= 10) return number.toFixed(1);
    return number.toFixed(2);
  }

  _zoneDarkness(brightness, zone) {
    const ambient = this._zoneAmbientDarknessOpacity(zone);
    const lightReduction = Math.max(0, Math.min(1, brightness));
    return Math.max(0, Math.min(1, ambient * (1 - lightReduction)));
  }

  _zoneLighting(zone, rowByKey) {
    const lights = Object.entries(this._markers || {})
      .map(([key, marker]) => {
        const row = rowByKey.get(key);
        if (row?.primaryDomain !== "light" || !this._pointInZone(marker, zone)) return null;
        const stateObj = this._hass?.states?.[row.entityId];
        if (String(stateObj?.state || "").toLowerCase() !== "on") return 0;
        const brightness = Number(stateObj?.attributes?.brightness);
        const level = Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness / 255)) : 1;
        const intensity = this._normalizeLightIntensity(marker.lightIntensity) / 100;
        return {
          marker,
          row,
          brightness: level * intensity,
          color: this._lightColor(stateObj) || zone.color || "#f8d66d",
        };
      })
      .filter((value) => value !== null);
    if (!lights.length) return { brightness: 0, color: zone.color || "#f8d66d" };
    const brightness = Math.max(...lights.map((light) => light.brightness || 0));
    const dominant = lights
      .filter((light) => light.brightness > 0)
      .sort((a, b) => b.brightness - a.brightness)[0];
    return { brightness, color: dominant?.color || zone.color || "#f8d66d", lights };
  }

  _zoneCeilingDarkness(baseDarkness, lights = []) {
    const strongestReduction = Math.max(
      0,
      ...lights.map((light) => {
        const marker = light.marker || {};
        const params = this._resolveRenderParams(marker);
        const reduction = Math.max(0, Math.min(1, Number(params.intensity) * 0.35 || 0));
        const brightness = Math.max(0, Math.min(1, Number(light.brightness) || 0));
        return reduction * brightness;
      })
    );
    return Math.max(0, Math.min(1, baseDarkness * (1 - strongestReduction)));
  }

  /** Returns all active positional lights inside a zone with their rendering properties. */
  _positionalLights(zone, rowByKey) {
    const zoneRadius = this._zoneRadius(zone);
    const floorLevel = this._zoneFloorLevel(zone);
    const map = this._coordinateMap();
    const verticalModelAxis = map[this._verticalAxis()];
    const zoneHeight = Math.max(10, Math.abs(this._zoneHeight(zone)));

    return Object.entries(this._markers || {})
      .flatMap(([key, marker]) => {
        const row = rowByKey.get(key);
        if (row?.primaryDomain !== "light") return [];
        const lightType = this._normalizeLightType(marker.lightType) || "spot";
        const renderMarkers = [{ marker, lightType }];
        if (lightType === "spot") {
          (marker.subSpots || []).forEach((subSpot) => {
            renderMarkers.push({
              marker: this._effectiveSubSpotMarker(marker, subSpot),
              lightType: "spot",
            });
          });
        } else if (this._supportsLightPath(lightType) && marker.lightShape === "rect") {
          // Rectangle: generate closed loop from center + width/depth/angle
          const rectMarker = { ...marker, lightPath: this._lightRectPoints(marker), _closeLoop: true };
          renderMarkers.splice(0, renderMarkers.length, ...this._lightPathSampleMarkers(rectMarker, lightType, zoneRadius).map((pathMarker) => ({
            marker: pathMarker,
            lightType,
          })));
        } else if (this._supportsLightPath(lightType) && (marker.lightPath || []).length >= 2) {
          renderMarkers.splice(0, renderMarkers.length, ...this._lightPathSampleMarkers(marker, lightType, zoneRadius).map((pathMarker) => ({
            marker: pathMarker,
            lightType,
          })));
        }

        const stateObj = this._hass?.states?.[row.entityId];
        if (String(stateObj?.state || "").toLowerCase() !== "on") return [];
        const brightnessAttr = Number(stateObj?.attributes?.brightness);
        const level = Number.isFinite(brightnessAttr) ? Math.max(0, Math.min(1, brightnessAttr / 255)) : 1;
        const intensity = this._normalizeLightIntensity(marker.lightIntensity) / 100;
        const brightness = level * intensity;
        const color = this._lightColor(stateObj) || zone.color || "#fff5e0";
        return renderMarkers
          .filter((item) => this._pointInZone(item.marker, zone))
          .map((item) => {
            const renderMarker = item.marker;
            const renderType = item.lightType;
            const rp = this._resolveRenderParams(renderMarker);
            // Height of this light above the zone floor (in model units)
            const markerHeight = Number(renderMarker[verticalModelAxis]) || 0;
            const heightAboveFloor = Math.max(5, markerHeight - floorLevel);
            // Fraction of zone height where the light sits (0 = floor, 1 = ceiling)
            const heightFraction = Math.min(1, heightAboveFloor / zoneHeight);

            // Auto radius: spot uses cone physics (wider pool for higher mount),
            // lamp uses fixed fraction (floor/table lamp stays tight regardless of height),
            // indirect uses zone-relative spread
            const stored = Number(renderMarker.lightRadius);
            let lightRadius;
            if (stored > 0) {
              lightRadius = stored;
            } else if (Number(rp.distance) > 0) {
              lightRadius = Number(rp.distance);
            } else if (renderType === "spot") {
              // Cone: pool radius ≈ height × tan(~30°) — higher ceiling = wider pool
              lightRadius = Math.max(10, heightAboveFloor * 0.60);
            } else if (renderType === "cove") {
              // Cove: soft ambient downwash, covers most of the zone
              lightRadius = Math.max(10, zoneRadius * 0.55);
            } else if (renderType === "linear") {
              // Linear strip: medium-width elongated pool
              lightRadius = Math.max(10, zoneRadius * 0.32);
            } else {
              // Lamp: low mount, tight spread regardless of height
              lightRadius = Math.max(10, zoneRadius * 0.22);
            }

            return { marker: renderMarker, row, lightType: renderType, lightRadius, heightAboveFloor, heightFraction, color, brightness: brightness * (rp.intensity ?? 1) };
          });
      })
      .filter(Boolean);
  }

  /**
   * Generates 4 closed-loop model-space points for a rectangle light shape.
   * Center = marker position, width/depth in model units, angle = rotation degrees (floor plane).
   */
  _lightRectPoints(marker) {
    const map = this._coordinateMap();
    const floorAxes = this._floorAxes();
    const ax0 = map[floorAxes[0]]; // e.g. "x"
    const ax1 = map[floorAxes[1]]; // e.g. "z"
    const verticalAxis = map[this._verticalAxis()]; // e.g. "y"

    const rect = marker.lightRect || {};
    const hw = Math.max(1, Number(rect.width)  || 100) / 2;
    const hd = Math.max(1, Number(rect.depth)  || 80)  / 2;
    const angleDeg = Number(rect.angle) || 0;
    const rad = angleDeg * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = Number(marker[ax0]) || 0;
    const cy = Number(marker[verticalAxis]) || 0;
    const cz = Number(marker[ax1]) || 0;

    // 4 corners in local space (ax0, ax1 axes), then rotated
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const points = corners.map(([lx, lz]) => {
      const rx = lx * cos - lz * sin;
      const rz = lx * sin + lz * cos;
      const pt = { x: 0, y: 0, z: 0 };
      pt[ax0] = cx + rx;
      pt[ax1] = cz + rz;
      pt[verticalAxis] = cy;
      return pt;
    });

    // Don't duplicate the start point — _lightPathSampleMarkers handles closeLoop internally
    return points;
  }

  _lightPathSampleMarkers(marker, lightType, zoneRadius) {
    const path = (marker.lightPath || [])
      .map((point) => ({ x: Number(point.x), y: Number(point.y), z: Number(point.z) }))
      .filter((point) => this._isSafeModelPoint(point));
    if (path.length < 2) return [];
    const rp = this._resolveRenderParams(marker);
    const baseRadius = Number(marker.lightRadius) > 0
      ? Number(marker.lightRadius)
      : Math.max(10, zoneRadius * (lightType === "linear" ? 0.22 : 0.35));
    // Keep line lights continuous, but cap the whole path instead of each segment.
    // A square/loop used to multiply into many expensive glow meshes per side.
    // Step must be small enough that adjacent sample radii overlap — not smaller.
    // wall_reach ≈ rp.distance (130–160), so step ≤ distance * 0.4 ensures full overlap.
    const maxStep = Math.max(4, Math.min(60, baseRadius * (lightType === "linear" ? 0.38 : 0.45)));
    const maxSamples = lightType === "linear" ? 20 : 16;
    const segments = [];
    let totalDistance = 0;
    const closeLoop = marker._closeLoop === true;
    const segPath = closeLoop ? [...path, path[0]] : path; // add closing segment for closed loops
    for (let i = 0; i < segPath.length - 1; i += 1) {
      const start = segPath[i];
      const end = segPath[i + 1];
      const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
      if (distance < 0.001) continue;
      segments.push({ start, end, distance, offset: totalDistance });
      totalDistance += distance;
    }
    if (!segments.length) return [];

    // For closed loops: distribute samples evenly WITHOUT landing on start again at the end
    const targetCount = Math.min(maxSamples, Math.max(closeLoop ? 4 : 2, Math.ceil(totalDistance / maxStep) + (closeLoop ? 0 : 1)));
    const samples = [];
    const pushSample = (point, tangent) => {
      const previous = samples[samples.length - 1];
      if (previous && Math.hypot(previous.x - point.x, previous.y - point.y, previous.z - point.z) < 0.001) return;
      const oriented = this._orientedPathPoint(point, tangent, baseRadius, rp);
      samples.push({
        ...marker,
        x: Number(oriented.point.x.toFixed(4)),
        y: Number(oriented.point.y.toFixed(4)),
        z: Number(oriented.point.z.toFixed(4)),
        lightRadius: baseRadius,
        lightType,
        orientationDir: oriented.direction,
        orientationSpread: oriented.spread,
      });
    };

    let segmentIndex = 0;
    for (let index = 0; index < targetCount; index += 1) {
      // For closed loops: distribute from 0 to totalDistance*(1-1/N) so last sample
      // doesn't overlap with first (they're the same point on a rectangle)
      const distanceAlongPath = targetCount === 1 ? 0
        : closeLoop
          ? (totalDistance * index) / targetCount
          : (totalDistance * index) / (targetCount - 1);
      while (
        segmentIndex < segments.length - 1 &&
        distanceAlongPath > segments[segmentIndex].offset + segments[segmentIndex].distance
      ) {
        segmentIndex += 1;
      }
      const segment = segments[segmentIndex];
      const localDistance = Math.max(0, Math.min(segment.distance, distanceAlongPath - segment.offset));
      const t = segment.distance > 0 ? localDistance / segment.distance : 0;
      const tangent = {
        x: segment.end.x - segment.start.x,
        y: segment.end.y - segment.start.y,
        z: segment.end.z - segment.start.z,
      };
      pushSample({
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
        z: segment.start.z + (segment.end.z - segment.start.z) * t,
      }, tangent);
    }
    return samples;
  }

  _orientedPathPoint(point, tangent, radius, params = {}) {
    const map = this._coordinateMap();
    const floorAxes = this._floorAxes();
    const ax0 = map[floorAxes[0]];
    const ax1 = map[floorAxes[1]];
    const verticalAxis = map[this._verticalAxis()];
    const tx = Number(tangent?.[ax0]) || 0;
    const ty = Number(tangent?.[ax1]) || 0;
    const len = Math.hypot(tx, ty);
    const side = this._orientationBlend(params.path_side);
    const angle = this._normalOrientationDeg(params.path_angle) * Math.PI / 180;
    const spread = this._orientationSpread(params.path_spread);
    if (!len) {
      return { point, direction: null, spread };
    }
    const horizontalWeight = Math.cos(angle);
    const verticalWeight = Math.sin(angle);
    const normal0 = -ty / len * side * Math.abs(horizontalWeight);
    const normal1 = tx / len * side * Math.abs(horizontalWeight);
    const offset = Math.max(0, Number(radius) || 0) * 0.35;
    const orientedPoint = { ...point };
    orientedPoint[ax0] = Number(point[ax0]) + normal0 * offset;
    orientedPoint[ax1] = Number(point[ax1]) + normal1 * offset;
    orientedPoint[verticalAxis] = Number(point[verticalAxis]);
    const direction = { x: 0, y: 0, z: 0 };
    direction[ax0] = normal0;
    direction[ax1] = normal1;
    direction[verticalAxis] = verticalWeight;
    const directionLength = Math.hypot(direction.x, direction.y, direction.z);
    if (directionLength < 0.001) return { point: orientedPoint, direction: null, spread };
    direction.x /= directionLength;
    direction.y /= directionLength;
    direction.z /= directionLength;
    return { point: orientedPoint, direction, spread };
  }

  /** Returns the average vertical-axis position of zone floor points in model space. */
  _zoneFloorLevel(zone) {
    const map = this._coordinateMap();
    const va = map[this._verticalAxis()];
    const pts = zone.points || [];
    if (!pts.length) return 0;
    return pts.reduce((sum, p) => sum + (Number(p[va]) || 0), 0) / pts.length;
  }

  /** Parses a CSS color string (hex or rgb()) into {r, g, b} integers. */
  _cssColorToRgba(cssColor) {
    const rgbMatch = String(cssColor).match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
    let hex = String(cssColor).replace("#", "");
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return { r: 255, g: 245, b: 200 }; // warm white fallback
  }

  /** Generates a canvas-based radial gradient texture for a light pool. */
  /** Returns a ShaderMaterial implementing physical light attenuation per light type. */
  _createLightPoolMaterial(THREE, lightType, cssColor, brightness, options = {}) {
    const { r, g, b } = this._cssColorToRgba(cssColor);
    const colorValue = new THREE.Color(r / 255, g / 255, b / 255);
    const saturationValue = Number(options.saturation);
    const saturation = Number.isFinite(saturationValue) ? Math.max(0, Math.min(1.5, saturationValue)) : 1;
    const luminance = colorValue.r * 0.2126 + colorValue.g * 0.7152 + colorValue.b * 0.0722;
    const neutral = new THREE.Color(luminance, luminance, luminance);
    const uColor = neutral.lerp(colorValue, saturation);
    // Allow brightness above 1.0 for stronger floor pools — AdditiveBlending handles it gracefully
    const uBrightness = Math.max(0.05, brightness);
    const softnessValue = Number(options.softness);
    const uSoftness = Number.isFinite(softnessValue) ? Math.max(0.4, Math.min(2.5, softnessValue)) : 1;

    // Shared vertex shader — passes UV and world position to fragment
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    let fragmentShader;

    if (lightType === "spot") {
      // Physical spot with ACES filmic tonemapping — prevents blown-out white core,
      // keeps floor tile texture visible even at peak intensity
      fragmentShader = `
        uniform vec3  uColor;
        uniform float uBrightness;
        uniform float uInner;
        uniform float uOuter;
        varying vec2 vUv;

        // ACES filmic tonemapping curve (Narkowicz 2015 approximation)
        vec3 aces(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        void main() {
          float dist = length(vUv - vec2(0.5)) * 2.0;
          if (dist >= uOuter) { gl_FragColor = vec4(0.0); return; }

          // Smooth penumbra — linear falloff from inner core to outer edge
          float penumbra = 1.0 - smoothstep(uInner, uOuter, dist);

          // Physical 1/r² raw intensity — this will overexpose the core intentionally
          float r2 = max(0.001, dist / max(uInner, 0.001));
          float raw = 1.0 / (1.0 + r2 * r2 * 2.0);
          float core = max(0.0, 1.0 - dist / uInner);
          float rawIntensity = mix(raw, 1.5, core) * penumbra * uBrightness;

          // Apply ACES filmic curve — rolls off highlights smoothly,
          // underlying floor texture stays visible at the hotspot center
          vec3 hdrColor = uColor * rawIntensity;
          vec3 tonemapped = aces(hdrColor);

          // Use luminance of tonemapped result as alpha
          float alpha = dot(tonemapped, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(tonemapped, alpha);
        }
      `;
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor:      { value: uColor },
          uBrightness: { value: uBrightness },
          uInner:      { value: 0.18 },
          uOuter:      { value: Math.min(0.99, 0.96 * uSoftness) },
        },
        vertexShader, fragmentShader,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      });

    } else if (lightType === "cove") {
      // Cove: indirect ceiling bounce — no hotspot, very flat even wash, gentle edge fade
      fragmentShader = `
        uniform vec3  uColor;
        uniform float uBrightness;
        varying vec2 vUv;
        void main() {
          float dist = length(vUv - vec2(0.5)) * 2.0;
          if (dist >= 1.0) { gl_FragColor = vec4(0.0); return; }
          // Almost flat across the whole pool — simulates multi-bounce GI
          float falloff = pow(max(0.0, 1.0 - dist), 0.6);
          float intensity = falloff * uBrightness * 0.75;
          gl_FragColor = vec4(uColor * intensity, intensity);
        }
      `;
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor:      { value: uColor },
          uBrightness: { value: uBrightness * Math.min(1.4, uSoftness) },
        },
        vertexShader, fragmentShader,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      });

    } else if (lightType === "linear") {
      // Linear LED strip: defined bright band, moderate falloff — elongated by mesh scale
      fragmentShader = `
        uniform vec3  uColor;
        uniform float uBrightness;
        varying vec2 vUv;
        void main() {
          float dist = length(vUv - vec2(0.5)) * 2.0;
          if (dist >= 1.0) { gl_FragColor = vec4(0.0); return; }
          float falloff = pow(max(0.0, 1.0 - dist), 1.1);
          float intensity = falloff * uBrightness;
          gl_FragColor = vec4(uColor * intensity, intensity);
        }
      `;
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor:      { value: uColor },
          uBrightness: { value: uBrightness * Math.min(1.25, uSoftness) },
        },
        vertexShader, fragmentShader,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      });

    } else if (lightType === "lamp") {
      // Lamp downward cone: tight bright centre, smooth falloff
      fragmentShader = `
        uniform vec3  uColor;
        uniform float uBrightness;
        varying vec2 vUv;
        void main() {
          float dist = length(vUv - vec2(0.5)) * 2.0;
          if (dist >= 1.0) { gl_FragColor = vec4(0.0); return; }
          float r2 = max(0.001, dist);
          float attenuation = min(1.0, 0.018 / (r2 * r2));
          float cone = pow(max(0.0, 1.0 - dist), 1.4);
          float intensity = mix(attenuation, cone, 0.5) * uBrightness;
          gl_FragColor = vec4(uColor * intensity, intensity);
        }
      `;
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor:      { value: uColor },
          uBrightness: { value: uBrightness * Math.min(1.25, uSoftness) },
        },
        vertexShader, fragmentShader,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      });

    } else {
      // "area" type — uniform flat wash across the polygon, UV used only for soft edge fade
      // dist clamp is raised to 1.5 so polygon corners (UV dist ~1.0–1.4) are never clipped
      fragmentShader = `
        uniform vec3  uColor;
        uniform float uBrightness;
        varying vec2 vUv;
        void main() {
          float dist = length(vUv - vec2(0.5)) * 2.0;
          // Gentle edge fade only — no hard clip, polygon geometry provides the real boundary
          float edge = pow(max(0.0, 1.0 - dist * 0.55), 0.4);
          float intensity = edge * uBrightness;
          gl_FragColor = vec4(uColor * intensity, intensity);
        }
      `;
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor:      { value: uColor },
          uBrightness: { value: uBrightness * Math.min(1.4, uSoftness) },
        },
        vertexShader, fragmentShader,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      });
    }
  }

  /**
   * Builds a floor mesh whose geometry is the zone polygon (hard clip to zone boundary).
   * UV coordinates are computed so that (0.5, 0.5) = lightCenterAx0/Ax1 and
   * UV distance 1.0 = poolRadius from center — matching the pool shaders' dist check.
   */
  _buildPolygonFloorMesh(THREE, zone, lightCenterAx0, lightCenterAx1, poolRadius, floorLift, material, renderOrder) {
    const points = this._offsetZonePoints(zone.points || [], floorLift);
    if (points.length < 3) return null;

    const floorAxes = this._floorAxes();
    const map = this._coordinateMap();
    const ax0 = map[floorAxes[0]];
    const ax1 = map[floorAxes[1]];

    // Triangulate using display-space (X/Z floor axes)
    const displayPoints = points.map((p) => this._modelToDisplayPoint(p));
    const shapePoints = displayPoints.map((p) => new THREE.Vector2(Number(p[floorAxes[0]]), Number(p[floorAxes[1]])));
    const indices = THREE.ShapeUtils.triangulateShape(shapePoints, []).flat();
    if (!indices.length) return null;

    const positions = points.flatMap((p) => [p.x, p.y, p.z]);
    // UV: map each vertex relative to the light's floor hit position, scaled by poolRadius
    const diam = poolRadius * 2;
    const uvs = displayPoints.flatMap((p) => [
      0.5 + (Number(p[floorAxes[0]]) - lightCenterAx0) / diam,
      0.5 + (Number(p[floorAxes[1]]) - lightCenterAx1) / diam,
    ]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    // Force DoubleSide — polygon winding depends on how zone points were drawn,
    // so FrontSide could make the floor invisible if winding faces downward.
    if (material) material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  /** Creates a Three.js mesh for a single positional light pool on the floor. */
  /** Simulated GI bounce — wide, very soft secondary mesh that represents light reflected
   *  off the bright floor hotspot back up onto surrounding surfaces (3-bounce approximation). */
  _createGIBounceMesh(THREE, zone, marker, lightType, lightRadius, color, brightness) {
    const rp = this._resolveRenderParams(marker);
    // Only types with gi_brightness > 0 produce a GI bounce
    if ((rp.gi_brightness ?? 0) < 0.01) return null;
    if (brightness < 0.05) return null;

    const map = this._coordinateMap();
    const verticalModelAxis = map[this._verticalAxis()];
    const floorLevel = this._surfaceFloorLevel(THREE, zone, marker, 0.06); // just above floor pool

    // GI bounce: 3x pool radius, very low intensity warm wash
    const giRadius = lightRadius * Math.max(1, Math.min(6, Number(rp.gi_radius) || 3.2));
    const { r, g, b } = this._cssColorToRgba(color);
    // Warm up the bounce color slightly (simulate warm tile/floor color bleeding)
    const warmth = Math.max(0, Math.min(1, Number(rp.gi_warmth) || 0));
    const bounceColor = new THREE.Color(
      Math.min(1, (r / 255) * (1 + warmth * 0.22)),
      Math.min(1, (g / 255) * (1 - warmth * 0.12)),
      Math.min(1, (b / 255) * (1 - warmth * 0.38))
    );

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    // 3-bounce simulation: each bounce loses ~60% energy, combined as single soft wash
    // Stays flat across most of the radius then fades at the edge
    const fragmentShader = `
      uniform vec3  uColor;
      uniform float uBrightness;
      varying vec2 vUv;
      void main() {
        float dist = length(vUv - vec2(0.5)) * 2.0;
        if (dist >= 1.0) { gl_FragColor = vec4(0.0); return; }
        // Very shallow power — nearly flat across full radius (simulates diffuse GI fill)
        float bounce1 = pow(max(0.0, 1.0 - dist), 0.5) * 0.40; // 1st bounce
        float bounce2 = pow(max(0.0, 1.0 - dist), 0.8) * 0.16; // 2nd bounce (attenuated)
        float bounce3 = pow(max(0.0, 1.0 - dist), 1.2) * 0.06; // 3rd bounce (nearly gone)
        float intensity = (bounce1 + bounce2 + bounce3) * uBrightness;
        gl_FragColor = vec4(uColor * intensity, intensity);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor:      { value: bounceColor },
        uBrightness: { value: Math.max(0, brightness * (rp.gi_brightness ?? 0.28)) },
      },
      vertexShader, fragmentShader,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });

    // Compute tilt offset for GI center
    const floorAxesGI = this._floorAxes();
    const mapGI = this._coordinateMap();
    const ax0GI = mapGI[floorAxesGI[0]];
    const ax1GI = mapGI[floorAxesGI[1]];
    const tiltXGI = (this._normalOrientationDeg(rp.tilt_x) || 0) * Math.PI / 180;
    const tiltYGI = (this._normalOrientationDeg(rp.tilt_y) || 0) * Math.PI / 180;
    const hGI = Math.max(0, Number(marker[verticalModelAxis] || 0) - floorLevel);
    const offAx0 = hGI * Math.tan(tiltXGI);
    const offAx1 = hGI * Math.tan(tiltYGI);
    const centerAx0 = Number(marker[ax0GI]) + offAx0;
    const centerAx1 = Number(marker[ax1GI]) + offAx1;

    // Polygon mesh — clipped to zone boundary, no bleed through walls
    const mesh = this._buildPolygonFloorMesh(
      THREE, zone, centerAx0, centerAx1, giRadius, floorLevel + 0.06, material, 2.03
    );
    return mesh;
  }

  _createFloorLightGlowMesh(THREE, zone, marker, lightType, lightRadius, color, brightness) {
    const map = this._coordinateMap();
    const verticalModelAxis = map[this._verticalAxis()];
    const floorLevel = this._surfaceFloorLevel(THREE, zone, marker, 0.055);
    const radius = Math.max(0.1, Number(lightRadius) || 0.8);
    const rp = this._resolveRenderParams(marker);
    // For line types, directionalTargetFactor can return 0.08 (orientation points up to ceiling).
    // Use intensity directly so the floor brightness is controlled by render params.
    const isLineTypeCheck = lightType === "cove" || lightType === "linear";
    const floorBrightness = brightness * (isLineTypeCheck ? (rp.intensity ?? 1) : this._directionalTargetFactor(marker, "floor"));
    const floorAxes = this._floorAxes();
    const ax0 = map[floorAxes[0]];
    const ax1 = map[floorAxes[1]];
    const primaryModelAxis = ax0;
    const elongation = lightType === "linear" ? Math.max(1, Number(rp.width) / Math.max(1, radius)) : 1;
    const materialOptions = {
      softness: rp.decay <= 0 ? 1.8 : Math.max(0.4, Math.min(2.5, 2.4 / (rp.decay + 0.6))),
      saturation: rp.floor_saturation ?? 1,
    };
    const group = new THREE.Group();

    // For cove/linear: samples sit on the ceiling perimeter, so their individual radius
    // never reaches the floor center. Center on zone centroid and use a very large radius
    // so all UV distances stay near-zero → nearly uniform ambient fill (no hotspot).
    const isLineType = lightType === "cove" || lightType === "linear";
    const zoneCenter = isLineType ? this._zoneCenter(zone) : null;
    const zoneRadius  = isLineType ? this._zoneRadius(zone) : 0;
    // 8× zone radius → UV dist at zone edge ≈ 0.125 → cove shader falloff ≈ 0.92 (nearly flat)
    const floorRadius = isLineType ? zoneRadius * 8 : radius;
    const floorCenterAx0 = isLineType && zoneCenter ? Number(zoneCenter[ax0]) : Number(marker[ax0]);
    const floorCenterAx1 = isLineType && zoneCenter ? Number(zoneCenter[ax1]) : Number(marker[ax1]);

    // Compute tilt-based floor offset — only relevant for spot/lamp
    const tiltX = (this._normalOrientationDeg(rp.tilt_x) || 0) * Math.PI / 180;
    const tiltY = (this._normalOrientationDeg(rp.tilt_y) || 0) * Math.PI / 180;
    const heightAboveFloor = Math.max(0, Number(marker[verticalModelAxis] || 0) - floorLevel);
    const tiltOffsetAx0 = isLineType ? 0 : heightAboveFloor * Math.tan(tiltX);
    const tiltOffsetAx1 = isLineType ? 0 : heightAboveFloor * Math.tan(tiltY);
    const tiltMag = Math.hypot(tiltX, tiltY);
    const tiltRadiusScale = isLineType ? 1 : (1 + Math.min(0.8, tiltMag * 0.5));

    const hitAx0 = floorCenterAx0 + tiltOffsetAx0;
    const hitAx1 = floorCenterAx1 + tiltOffsetAx1;

    const addPoolLayer = (scale, brightnessScale, renderOrder, lift = 0) => {
      const layerRadius = floorRadius * scale * tiltRadiusScale;
      const material = this._createLightPoolMaterial(THREE, lightType, color, floorBrightness * brightnessScale, materialOptions);
      // Polygon mesh — uses zone boundary as geometry, UV-mapped to this light's hit position
      const mesh = this._buildPolygonFloorMesh(
        THREE, zone, hitAx0, hitAx1, layerRadius, floorLevel + lift, material, renderOrder
      );
      if (mesh) group.add(mesh);
    };

    if (isLineType) {
      // Cove/linear: single flat uniform fill — radius is already 8×zoneRadius, so UV is near-zero everywhere
      addPoolLayer(1.0, 0.85, 2.05, 0.003);
    } else {
      // Spot/lamp: layered pools with hotspot
      const outerSize       = rp.floor_outer_size       ?? 5.0;
      const outerBrightness = rp.floor_outer_brightness  ?? 0.12;
      addPoolLayer(outerSize,       outerBrightness, 2.03, 0.001); // ultra-wide ambient scatter
      addPoolLayer(outerSize * 0.5, outerBrightness * 3.2, 2.05, 0.002); // wide mid-glow
      addPoolLayer(1.0, 1.0, 2.06, 0.004); // main pool
      addPoolLayer(rp.floor_hotspot_size ?? (lightType === "lamp" ? 0.36 : 0.46), 1.3, 2.08, 0.008); // hotspot
    }

    group.renderOrder = 2.05;
    return group;
  }

  _lightColor(stateObj) {
    const attrs = stateObj?.attributes || {};
    if (Array.isArray(attrs.rgb_color) && attrs.rgb_color.length >= 3) {
      return `rgb(${attrs.rgb_color.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0))).join(",")})`;
    }
    if (Array.isArray(attrs.hs_color) && attrs.hs_color.length >= 2) {
      return this._hslToRgbCss(Number(attrs.hs_color[0]), Number(attrs.hs_color[1]), 58);
    }
    const kelvin = Number(attrs.color_temp_kelvin);
    if (Number.isFinite(kelvin)) return this._kelvinToRgbCss(kelvin);
    return "";
  }

  _hslToRgbCss(h, s, l) {
    const hue = (((h % 360) + 360) % 360) / 360;
    const sat = Math.max(0, Math.min(100, s)) / 100;
    const light = Math.max(0, Math.min(100, l)) / 100;
    const hueToRgb = (p, q, t) => {
      let value = t;
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      if (value < 1 / 6) return p + (q - p) * 6 * value;
      if (value < 1 / 2) return q;
      if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
      return p;
    };
    let r;
    let g;
    let b;
    if (!sat) {
      r = g = b = light;
    } else {
      const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
      const p = 2 * light - q;
      r = hueToRgb(p, q, hue + 1 / 3);
      g = hueToRgb(p, q, hue);
      b = hueToRgb(p, q, hue - 1 / 3);
    }
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  }

  _kelvinToRgbCss(kelvin) {
    const temp = Math.max(1000, Math.min(40000, kelvin)) / 100;
    const red = temp <= 66 ? 255 : Math.max(0, Math.min(255, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    const green = temp <= 66
      ? Math.max(0, Math.min(255, 99.4708025861 * Math.log(temp) - 161.1195681661))
      : Math.max(0, Math.min(255, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    const blue = temp >= 66 ? 255 : temp <= 19 ? 0 : Math.max(0, Math.min(255, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
    return `rgb(${Math.round(red)},${Math.round(green)},${Math.round(blue)})`;
  }

  _pointInZone(point, zone) {
    const displayPoint = this._modelToDisplayPoint(point);
    const axes = this._floorAxes();
    const polygon = (zone.points || []).map((zonePoint) => this._modelToDisplayPoint(zonePoint));
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const xi = Number(polygon[index][axes[0]]);
      const yi = Number(polygon[index][axes[1]]);
      const xj = Number(polygon[previous][axes[0]]);
      const yj = Number(polygon[previous][axes[1]]);
      const x = Number(displayPoint[axes[0]]);
      const y = Number(displayPoint[axes[1]]);
      const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.000001) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  _verticalAxis() {
    return ["x", "y", "z"].includes(this._config.vertical_axis) ? this._config.vertical_axis : "y";
  }

  /** Returns the HTML for the axes gizmo legend (X/Y/Z with colours + ↑ on the vertical axis). */
  _axesLegendHTML() {
    const map = this._coordinateMap(); // display→model axis
    const verticalDisplay = this._verticalAxis(); // which display axis is height
    const verticalModel = map[verticalDisplay];   // which Three.js model axis is up

    // Build inverse map: Three.js model axis → display axis label
    const inv = {};
    for (const [display, model] of Object.entries(map)) inv[model] = display.toUpperCase();

    return [
      { model: "x", color: "#ef4444" },
      { model: "y", color: "#22c55e" },
      { model: "z", color: "#3b82f6" },
    ].map(({ model, color }) => {
      const label = inv[model] || model.toUpperCase();
      const isUp = model === verticalModel;
      return `<span style="color:${color};font-weight:700">${label}${isUp ? "↑" : ""}</span>`;
    }).join("");
  }

  _axisLabelHTML(displayAxis) {
    const axis = ["x", "y", "z"].includes(displayAxis) ? displayAxis : "x";
    const modelAxis = this._coordinateMap()[axis] || axis;
    const colors = { x: "#ef4444", y: "#22c55e", z: "#3b82f6" };
    const isUp = axis === this._verticalAxis();
    return `<span class="axis-label" style="color:${colors[modelAxis] || "#94a3b8"}">${axis.toUpperCase()}${isUp ? "↑" : ""}</span>`;
  }

  _floorAxes() {
    const vertical = this._verticalAxis();
    return ["x", "y", "z"].filter((axis) => axis !== vertical);
  }

  _effectivePlacementMode(camera) {
    if (this._placementMode !== "auto") return this._placementMode;
    if (!camera) return "surface";
    const verticalAxis = this._verticalAxis();
    const direction = camera.getWorldDirection(new this._modelViewer.THREE.Vector3());
    const displayDirection = this._modelToDisplayPoint(direction);
    const verticalComponent = Math.abs(displayDirection[verticalAxis] || 0);
    return verticalComponent > 0.62 ? "floor" : "height";
  }

  _constrained3DPoint(key, point, camera) {
    const existing = this._markers[key];
    return this._constrained3DPointForExisting(existing, point, camera);
  }

  _constrained3DPointForExisting(existing, point, camera) {
    if (!existing) return point;
    const mode = this._effectivePlacementMode(camera);
    if (mode === "surface") return point;

    const result = this._modelToDisplayPoint(point);
    const existingDisplay = this._modelToDisplayPoint(existing);
    const verticalAxis = this._verticalAxis();
    const floorAxes = this._floorAxes();

    if (mode === "floor") {
      result[verticalAxis] = Number(existingDisplay[verticalAxis]);
    }

    if (mode === "height") {
      for (const axis of floorAxes) {
        result[axis] = Number(existingDisplay[axis]);
      }
    }

    return this._displayToModelPoint(result);
  }

  _placementModeText() {
    const vertical = this._verticalAxis().toUpperCase();
    const floor = this._floorAxes().map((axis) => axis.toUpperCase()).join("/");
    if (this._placementMode === "floor") return `Floor only: click updates ${floor} and keeps ${vertical} height.`;
    if (this._placementMode === "height") return `Height only: click updates ${vertical} and keeps ${floor}.`;
    if (this._placementMode === "auto") return `Auto by view: top views move ${floor}, side views move ${vertical}.`;
    return "Surface click: marker moves exactly to the clicked 3D surface point.";
  }

  _update3DMarkerCoordinate(key, axis, value, options = {}) {
    if (!this._markers[key] || !["x", "y", "z"].includes(axis)) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    if (!options.skipHistory) this._pushMarkerHistory();
    const modelAxis = this._coordinateMap()[axis] || axis;
    const rounded = Math.round(number);
    this._markers[key][modelAxis] = rounded;
    if (!options.skipSave) this._saveMarkers();
    this._refresh3DMarkerOverlay();
    if (!options.skipPanelRefresh) this._refreshSelectedMarkerPanel();
    const row = this.shadowRoot?.querySelector(`[data-device="${this._cssEscape(key)}"]`);
    const input = row?.querySelector(`[data-coordinate="${axis}"]`);
    if (input && document.activeElement !== input) input.value = this._formatCoordinateInteger(rounded);
  }

  _updateMarkerAction(key, type, value) {
    if (!this._markers[key] || !["tap", "hold"].includes(type)) return;
    const action = this._normalizeMarkerAction(value, type);
    if (!action) return;
    const property = type === "tap" ? "tapAction" : "holdAction";
    if ((this._markers[key][property] || "") === action) return;
    this._pushMarkerHistory();
    this._markers[key][property] = action;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _updateMarkerIcon(key, value) {
    if (!this._markers[key]) return;
    const icon = String(value || "").trim();
    if ((this._markers[key].icon || "") === icon) return;
    this._pushMarkerHistory();
    this._markers[key].icon = icon;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshDeviceRow(key);
    if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _updateMarkerDisplay(key, value) {
    if (!this._markers[key]) return;
    const display = this._normalizeMarkerDisplay(value);
    if ((this._markers[key].markerDisplay || "") === display) return;
    this._pushMarkerHistory();
    this._markers[key].markerDisplay = display;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshDeviceRow(key);
    if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _colorThresholdsForMarker(key) {
    const marker = this._markers[key];
    if (!marker) return [];
    return this._normalizeColorThresholds(marker.colorThresholds || marker.color_thresholds) || [];
  }

  _setColorThresholds(key, thresholds, options = {}) {
    const marker = this._markers[key];
    if (!marker) return;
    const normalized = this._normalizeColorThresholds(thresholds);
    if (!options.skipHistory) this._pushMarkerHistory();
    if (normalized?.length) marker.colorThresholds = normalized;
    else delete marker.colorThresholds;
    delete marker.color_thresholds;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshDeviceRow(key);
    if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _addColorThreshold(key) {
    const marker = this._markers[key];
    if (!marker) return;
    const row = this._deviceRows().find((item) => item.key === key);
    const numericState = Number(row?.primaryState);
    const thresholds = this._colorThresholdsForMarker(key);
    const fallbackValue = thresholds.length
      ? thresholds[thresholds.length - 1].value + 1
      : Number.isFinite(numericState)
        ? numericState
        : 0;
    this._setColorThresholds(key, [...thresholds, { value: fallbackValue, color: "#66bb6a" }]);
  }

  _removeColorThreshold(key, index) {
    const thresholds = this._colorThresholdsForMarker(key);
    if (!Number.isInteger(index) || index < 0 || index >= thresholds.length) return;
    thresholds.splice(index, 1);
    this._setColorThresholds(key, thresholds);
  }

  _updateColorThreshold(key, index, patch) {
    const thresholds = this._colorThresholdsForMarker(key);
    if (!Number.isInteger(index) || index < 0 || index >= thresholds.length) return;
    if (patch.value !== undefined && !Number.isFinite(Number(patch.value))) return;
    if (patch.color !== undefined && !String(patch.color || "").trim()) return;
    const next = thresholds.map((threshold, thresholdIndex) => {
      if (thresholdIndex !== index) return threshold;
      return {
        value: patch.value !== undefined ? Number(patch.value) : threshold.value,
        color: patch.color !== undefined ? String(patch.color || "").trim() : threshold.color,
      };
    });
    this._setColorThresholds(key, next);
  }

  _syncColorThresholdText(colorInput) {
    const key = colorInput?.dataset?.colorThresholdColor;
    const index = colorInput?.dataset?.thresholdIndex;
    const textInput = this.shadowRoot?.querySelector(`[data-color-threshold-text="${this._cssEscape(key)}"][data-threshold-index="${this._cssEscape(index)}"]`);
    if (textInput) textInput.value = colorInput.value;
  }

  _updateLightIntensity(key, value, options = {}) {
    if (!this._markers[key]) return;
    const intensity = this._normalizeLightIntensity(value);
    if ((this._markers[key].lightIntensity ?? 100) === intensity) {
      if (!options.skipSave) this._saveMarkers();
      return;
    }
    if (!options.skipHistory) this._pushMarkerHistory();
    this._markers[key].lightIntensity = intensity;
    if (!options.skipSave) this._saveMarkers();
    if (options.skipSave) this._refreshYamlExport();
    this._refresh3DZoneOverlay();
    if (!options.skipPanelRefresh && this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _subSpotAt(key, index) {
    const marker = this._markers[key];
    if (!marker || !Number.isInteger(index) || index < 0) return null;
    if (!Array.isArray(marker.subSpots)) marker.subSpots = [];
    return marker.subSpots[index] || null;
  }

  _addSubSpot(key) {
    const marker = this._markers[key];
    if (!marker || (this._normalizeLightType(marker.lightType) || "spot") !== "spot") return;
    this._pushMarkerHistory();
    if (!Array.isArray(marker.subSpots)) marker.subSpots = [];
    const floorAxes = this._floorAxes();
    const displayPoint = this._modelToDisplayPoint(marker);
    displayPoint[floorAxes[0]] = Number(displayPoint[floorAxes[0]] || 0) + Math.max(10, Number(marker.lightRadius) || 20);
    const modelPoint = this._displayToModelPoint(displayPoint);
    marker.subSpots.push({
      name: `Spot ${marker.subSpots.length + 1}`,
      lightRadius: "",
      lightPreset: "",
      renderParams: {},
      x: Math.round(modelPoint.x),
      y: Math.round(modelPoint.y),
      z: Math.round(modelPoint.z),
    });
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshSelectedMarkerPanel();
  }

  _deleteSubSpot(key, index) {
    const marker = this._markers[key];
    if (!marker?.subSpots?.[index]) return;
    this._pushMarkerHistory();
    marker.subSpots.splice(index, 1);
    marker.subSpots.forEach((spot, spotIndex) => {
      if (!spot.name || /^Spot \d+$/.test(spot.name)) spot.name = `Spot ${spotIndex + 1}`;
    });
    if (this._pendingSubSpot?.key === key && this._pendingSubSpot?.index === index) this._pendingSubSpot = null;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshSelectedMarkerPanel();
  }

  _startSubSpotMove(key, index) {
    if (!this._subSpotAt(key, index)) return;
    this._pendingSubSpot = { key, index };
    this._pendingDeviceKey = null;
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status) {
      status.hidden = false;
      status.textContent = `Click the 3D model to move sub-spot ${index + 1}. ${this._placementModeText()}`;
    }
  }

  _updateSubSpotCoordinate(key, index, axis, value, options = {}) {
    const subSpot = this._subSpotAt(key, index);
    if (!subSpot || !["x", "y", "z"].includes(axis)) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    if (!this._isSafeCoordinateValue(number)) {
      this._showModelStatus(`Ignored unsafe path coordinate (${number}).`);
      this._refreshSelectedMarkerPanel();
      return;
    }
    if (!options.skipHistory) this._pushMarkerHistory();
    const modelAxis = this._coordinateMap()[axis] || axis;
    subSpot[modelAxis] = Math.round(number);
    if (!options.skipSave) this._saveMarkers();
    if (options.skipSave) this._refreshYamlExport();
    this._refresh3DMarkerOverlay();
    if (!options.skipPanelRefresh) this._refreshSelectedMarkerPanel();
  }

  _updateSubSpotLightRadius(key, index, value, options = {}) {
    const subSpot = this._subSpotAt(key, index);
    if (!subSpot) return;
    if (!options.skipHistory) this._pushMarkerHistory();
    subSpot.lightRadius = this._normalizeLightRadius(value);
    if (!options.skipSave) this._saveMarkers();
    if (options.skipSave) this._refreshYamlExport();
    this._refresh3DZoneOverlay();
    if (!options.skipPanelRefresh && this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _updateSubSpotPreset(key, index, value) {
    const subSpot = this._subSpotAt(key, index);
    if (!subSpot) return;
    this._pushMarkerHistory();
    subSpot.lightPreset = value || "";
    this._saveMarkers();
    this._refresh3DZoneOverlay();
    if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _updateSubSpotRenderParam(key, index, param, value, options = {}) {
    const subSpot = this._subSpotAt(key, index);
    if (!subSpot || !param) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    if (!options.skipHistory) this._pushMarkerHistory();
    if (!subSpot.renderParams) subSpot.renderParams = {};
    subSpot.renderParams[param] = parseFloat(number);
    if (!options.skipSave) this._saveMarkers();
    if (options.skipSave) this._refreshYamlExport();
    this._refresh3DZoneOverlay();
    if (!options.skipPanelRefresh && this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _resetSubSpotRenderParams(key, index) {
    const subSpot = this._subSpotAt(key, index);
    if (!subSpot) return;
    this._pushMarkerHistory();
    subSpot.renderParams = {};
    subSpot.lightPreset = "";
    this._saveMarkers();
    this._refresh3DZoneOverlay();
    if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _saveSubSpotRenderPreset(key, index) {
    const marker = this._markers[key];
    const subSpot = this._subSpotAt(key, index);
    if (!marker || !subSpot) return;
    const name = window.prompt("Preset name:");
    if (!name?.trim()) return;
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (!this._config.light_presets) this._config.light_presets = {};
    this._config.light_presets[safeName] = this._cleanRenderPresetParams(this._resolveRenderParams(this._effectiveSubSpotMarker(marker, subSpot)));
    subSpot.lightPreset = safeName;
    this._savePresets();
    this._saveMarkers();
    this._refresh3DZoneOverlay();
    if (this._selectedMarkers.has(key)) this._refreshSelectedMarkerPanel();
  }

  _lightPathPointAt(key, index) {
    const marker = this._markers[key];
    if (!marker || !Number.isInteger(index) || index < 0) return null;
    if (!Array.isArray(marker.lightPath)) marker.lightPath = [];
    return marker.lightPath[index] || null;
  }

  _toggleLightPathDrawing(key) {
    const marker = this._markers[key];
    if (!marker || !this._supportsLightPath(marker.lightType)) return;
    if (this._pendingLightPath?.key === key && this._pendingLightPath?.mode === "add") {
      this._pendingLightPath = null;
    } else {
      this._pendingLightPath = { key, mode: "add", index: null };
      this._pendingDeviceKey = null;
      this._pendingSubSpot = null;
    }
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status) {
      status.hidden = false;
      status.textContent = this._pendingLightPath ? "Click the 3D model to add LED path points." : "Light path drawing stopped.";
    }
    this._refreshSelectedMarkerPanel();
  }

  _clearLightPath(key) {
    const marker = this._markers[key];
    if (!marker?.lightPath?.length) return;
    this._pushMarkerHistory();
    marker.lightPath = [];
    if (this._pendingLightPath?.key === key) this._pendingLightPath = null;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshSelectedMarkerPanel();
  }

  _startLightPathPointMove(key, index) {
    if (!this._lightPathPointAt(key, index)) return;
    this._pendingLightPath = { key, index, mode: "move" };
    this._pendingDeviceKey = null;
    this._pendingSubSpot = null;
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status) {
      status.hidden = false;
      status.textContent = `Click the 3D model to move LED path point ${index + 1}. ${this._placementModeText()}`;
    }
  }

  _deleteLightPathPoint(key, index) {
    const marker = this._markers[key];
    if (!marker?.lightPath?.[index]) return;
    this._pushMarkerHistory();
    marker.lightPath.splice(index, 1);
    if (this._pendingLightPath?.key === key && this._pendingLightPath?.index === index) this._pendingLightPath = null;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshSelectedMarkerPanel();
  }

  _updateLightPathCoordinate(key, index, axis, value, options = {}) {
    const point = this._lightPathPointAt(key, index);
    if (!point || !["x", "y", "z"].includes(axis)) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    if (!options.skipHistory) this._pushMarkerHistory();
    const modelAxis = this._coordinateMap()[axis] || axis;
    point[modelAxis] = Math.round(number);
    if (!options.skipSave) this._saveMarkers();
    if (options.skipSave) this._refreshYamlExport();
    this._refresh3DMarkerOverlay();
    if (!options.skipPanelRefresh) this._refreshSelectedMarkerPanel();
  }

  _update3DMarkerButtons(markerButtons, THREE, camera, container) {
    if (!markerButtons?.length) return;
    const rect = container.getBoundingClientRect?.();
    const width = rect?.width || container.clientWidth || 1;
    const height = rect?.height || container.clientHeight || 1;
    for (const marker of markerButtons) {
      const point = marker.position.clone().project(camera);
      const visible = point.z > -1 && point.z < 1;
      marker.button.hidden = !visible;
      if (!visible) continue;
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      marker.button.style.transform = `translate(${x}px, ${y}px) translate(calc(var(--marker-size, 22px) / -2 - 5px), -50%)`;
    }
  }

  _addZonePoint(zoneId, point) {
    const zone = this._zones[zoneId];
    if (!zone) return;
    const displayPoint = this._modelToDisplayPoint(point);
    const modelPoint = this._zoneDisplayPointToModel(displayPoint);
    zone.points = [...(zone.points || []), {
      x: Math.round(modelPoint.x),
      y: Math.round(modelPoint.y),
      z: Math.round(modelPoint.z),
    }];
    this._activeZoneId = zoneId;
    this._activeZonePointIndex = zone.points.length - 1;
    this._saveZones();
    this._refreshZoneTools();
    this._refresh3DZoneOverlay();
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status && this._mode === "edit") {
      status.hidden = false;
      status.textContent = `${zone.name} point added (${zone.points.length}).`;
    }
  }

  _place3DMarker(key, point, camera) {
    const row = this._deviceRows().find((item) => item.key === key);
    if (!row) return;
    const existingMarker = this._markers[key];
    const finalPoint = this._constrained3DPoint(key, point, camera);
    this._pushMarkerHistory();
    this._markers[key] = {
      key,
      entityId: row.entityId,
      name: row.name,
      icon: existingMarker?.icon || "",
      markerDisplay: existingMarker?.markerDisplay || "",
      tapAction: existingMarker?.tapAction || "",
      holdAction: existingMarker?.holdAction || "",
      colorThresholds: this._normalizeColorThresholds(existingMarker?.colorThresholds || existingMarker?.color_thresholds),
      lightIntensity: this._normalizeLightIntensity(existingMarker?.lightIntensity),
      lightType: this._normalizeLightType(existingMarker?.lightType),
      lightRadius: this._normalizeLightRadius(existingMarker?.lightRadius),
      lightPreset: existingMarker?.lightPreset || "",
      renderParams: existingMarker?.renderParams || {},
      subSpots: existingMarker?.subSpots || [],
      lightPath: existingMarker?.lightPath || [],
      lightShape: existingMarker?.lightShape || "path",
      lightRect: existingMarker?.lightRect || { width: 100, depth: 80, angle: 0 },
      x: Math.round(finalPoint.x),
      y: Math.round(finalPoint.y),
      z: Math.round(finalPoint.z),
    };
    this._pendingDeviceKey = null;
    this._pendingSubSpot = null;
    this._pendingLightPath = null;
    this._selectedMarkers.clear();
    this._selectedMarkers.add(key);
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshDeviceRow(key);
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status) {
      status.hidden = false;
      status.textContent = `${row.name} marker saved.`;
      window.setTimeout(() => {
        if (this._mode === "edit" && status.textContent === `${row.name} marker saved.`) {
          status.textContent = "Select an entity, then click the 3D model to place it.";
        }
      }, 1400);
    }
  }

  _placeSubSpot(key, index, point, camera) {
    const subSpot = this._subSpotAt(key, index);
    if (!subSpot) return;
    const finalPoint = this._constrained3DPointForExisting(subSpot, point, camera);
    this._pushMarkerHistory();
    subSpot.x = Math.round(finalPoint.x);
    subSpot.y = Math.round(finalPoint.y);
    subSpot.z = Math.round(finalPoint.z);
    this._pendingSubSpot = null;
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshSelectedMarkerPanel();
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status) {
      status.hidden = false;
      status.textContent = `Sub-spot ${index + 1} saved.`;
      window.setTimeout(() => {
        if (this._mode === "edit" && status.textContent === `Sub-spot ${index + 1} saved.`) {
          status.textContent = "Select an entity, then click the 3D model to place it.";
        }
      }, 1400);
    }
  }

  _placeLightPathPoint(key, index, point, camera) {
    const marker = this._markers[key];
    if (!marker || !this._supportsLightPath(marker.lightType)) return;
    if (!Array.isArray(marker.lightPath)) marker.lightPath = [];
    const existing = Number.isInteger(index) ? marker.lightPath[index] : null;
    const finalPoint = existing ? this._constrained3DPointForExisting(existing, point, camera) : point;
    this._pushMarkerHistory();
    const nextPoint = {
      x: Math.round(finalPoint.x),
      y: Math.round(finalPoint.y),
      z: Math.round(finalPoint.z),
    };
    if (!this._isSafeModelPoint(nextPoint)) {
      this._pendingLightPath = null;
      this._showModelStatus("Ignored unsafe LED path point.");
      return;
    }
    if (existing) {
      marker.lightPath[index] = nextPoint;
      this._pendingLightPath = null;
    } else {
      marker.lightPath.push(nextPoint);
      this._pendingLightPath = { key, mode: "add", index: null };
    }
    this._saveMarkers();
    this._refresh3DMarkerOverlay();
    this._refreshSelectedMarkerPanel();
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (status) {
      status.hidden = false;
      status.textContent = existing ? `LED path point ${index + 1} saved.` : `LED path point ${marker.lightPath.length} added.`;
    }
  }

  _fitCameraToObject(THREE, camera, controls, object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const distance = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));

    // Position camera at an angled view that respects the model's vertical axis.
    const vAxis = this._coordinateMap()[this._verticalAxis()]; // "x"|"y"|"z"
    const offset = new THREE.Vector3(
      vAxis === "x" ? distance * 1.25 : distance * 0.85,
      vAxis === "y" ? distance * 1.25 : distance * 0.85,
      vAxis === "z" ? distance * 1.25 : distance * 0.85,
    );
    // Also tilt toward one floor axis so it's a natural isometric view
    if (vAxis === "z") { offset.x += distance * 0.6; offset.y -= distance * 0.6; }
    else if (vAxis === "y") { offset.x += distance * 0.6; offset.z += distance * 0.6; }
    else { offset.y += distance * 0.6; offset.z += distance * 0.6; }

    controls.target.copy(center);
    camera.position.copy(center).add(offset);
    camera.near = Math.max(0.01, distance / 100);
    camera.far = Math.max(1000, distance * 100);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.update();
  }

  _disposeModelViewer({ preserveCamera = false } = {}) {
    this._modelRenderToken += 1;
    this._modelKeyboardNavigationActive = false;
    this._modelLoadingUrl = "";
    this._modelLoadFailedUrl = "";
    if (!this._modelViewer) return;
    const { scene, renderer, controls, resizeObserver, animationFrame, dispose } = this._modelViewer;
    if (!preserveCamera) this._captureModelCameraState();
    dispose?.();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    resizeObserver?.disconnect();
    controls?.dispose?.();
    scene?.traverse?.((object) => {
      if (object.geometry) object.geometry.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => {
        Object.values(material).forEach((value) => {
          if (value?.isTexture) value.dispose?.();
        });
        material.dispose?.();
      });
    });
    renderer?.dispose?.();
    renderer?.domElement?.remove?.();
    this._modelViewer = null;
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _cssEscape(value) {
    return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/"/g, '\\"');
  }

  _styles() {
    return `
      <style>
        :host {
          display: block;
          --dmp-good: #1d8f5f;
          --dmp-bad: #d43636;
          --dmp-border: var(--divider-color, rgba(127, 127, 127, 0.24));
          --dmp-muted: var(--secondary-text-color, #667085);
        }

        .panel {
          display: grid;
          grid-template-columns: minmax(260px, 330px) 1fr;
        }

        .panel.viewing {
          display: block;
        }

        .panel.sidebar-collapsed {
          grid-template-columns: 1fr;
        }

        aside {
          position: sticky;
          top: 12px;
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr) auto;
          gap: 8px;
          min-width: 0;
          height: calc(100vh - 24px);
          max-height: calc(100vh - 24px);
          border-right: 1px solid var(--dmp-border);
          box-sizing: border-box;
          padding: 14px;
        }

        header h2, header p {
          margin: 0;
        }

        header h2 {
          color: var(--primary-text-color);
          font-size: 20px;
          font-weight: 700;
          line-height: 1.2;
        }

        header p {
          color: var(--dmp-muted);
          font-size: 13px;
          margin-top: 4px;
        }

        .sidebar-status {
          color: var(--dmp-muted);
          font-size: 13px;
          font-weight: 700;
          line-height: 1.25;
        }

        .sidebar-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 4px;
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
          padding: 4px;
        }

        .sidebar-tabs button {
          min-height: 32px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--dmp-muted);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 800;
        }

        .sidebar-tabs button.active {
          background: var(--card-background-color, #fff);
          color: var(--primary-color, #03a9f4);
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12);
        }

        .filters, .bulk-actions, .zone-tools {
          display: grid;
          gap: 8px;
        }

        .filters-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-height: 36px;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 800;
          padding: 0 10px;
        }

        .filters-toggle::after {
          content: "";
          width: 8px;
          height: 8px;
          border-right: 2px solid currentColor;
          border-bottom: 2px solid currentColor;
          transform: rotate(45deg);
          transition: transform 0.16s ease;
        }

        .filters-toggle[aria-expanded="true"]::after {
          transform: rotate(225deg);
        }

        .filters-toggle span:last-child {
          color: var(--dmp-muted);
          font-size: 11px;
          margin-left: auto;
        }

        .filters-options {
          display: grid;
          gap: 8px;
        }

        .sidebar-tab-panel {
          min-height: 0;
          overflow: hidden;
        }

        .markers-panel {
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr);
          gap: 8px;
        }

        .areas-panel {
          display: grid;
          grid-template-rows: minmax(0, 1fr);
        }

        .bulk-actions, .zone-tools {
          grid-template-columns: 1fr;
          border-top: 1px solid var(--dmp-border);
          padding: 8px 0 0;
        }

        .zone-tools {
          min-height: 0;
          overflow: auto;
          padding-right: 2px;
        }

        .bulk-actions button, .zone-tools button {
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          min-height: 36px;
        }

        .bulk-actions button:hover, .zone-tools button:hover {
          border-color: var(--primary-color, #03a9f4);
        }

        .zone-tools-title,
        .zone-actions,
        .zone-point-title {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: space-between;
        }

        .zone-tools-title strong {
          color: var(--primary-text-color);
          font-size: 13px;
        }

        .zone-point-title strong {
          color: var(--primary-text-color);
          font-size: 12px;
        }

        .zone-tools-title button,
        .zone-actions button,
        .zone-point-title button {
          min-height: 30px;
          padding: 0 9px;
          white-space: nowrap;
        }

        .zone-point-editor {
          display: grid;
          gap: 8px;
          border-top: 1px solid var(--dmp-border);
          padding-top: 8px;
        }

        .zone-coordinate-editor,
        .zone-shade-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }

        .zone-illuminance-entity {
          grid-column: 1 / -1;
        }
        .zone-illuminance-entity input {
          width: 100%;
          min-height: 30px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font-size: 11px;
          padding: 0 8px;
          box-sizing: border-box;
        }
        .zone-illuminance-entity input:disabled {
          opacity: 0.45;
        }

        .zone-illuminance-toggle {
          grid-column: 1 / -1;
          display: flex;
          align-content: end;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .zone-illuminance-toggle input {
          flex: 0 0 auto;
        }

        .zone-illuminance-status {
          grid-column: 1 / -1;
          color: var(--dmp-muted);
          font-size: 11px;
          font-weight: 700;
        }

        .zone-point-list {
          display: grid;
          gap: 5px;
          max-height: 170px;
          overflow: auto;
          padding-right: 2px;
        }

        .zone-point-list button {
          min-height: 30px;
          overflow: hidden;
          text-align: left;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .zone-point-list button.active {
          border-color: var(--primary-color, #03a9f4);
          color: var(--primary-color, #03a9f4);
        }

        .zone-tools small,
        .zone-empty {
          color: var(--dmp-muted);
          font-size: 12px;
          line-height: 1.35;
        }

        label {
          display: grid;
          gap: 5px;
          min-width: 0;
        }

        label span {
          color: var(--dmp-muted);
          font-size: 12px;
          font-weight: 700;
        }

        select, input {
          box-sizing: border-box;
          width: 100%;
          min-height: 38px;
          min-width: 0;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: inherit;
          padding: 0 10px;
        }

        input[type="range"] {
          padding: 0;
        }

        input[type="checkbox"] {
          width: 16px;
          min-height: 16px;
          padding: 0;
        }

        .toggle-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .toggle-row span {
          color: var(--primary-text-color);
          font-size: 13px;
        }

        .devices {
          display: grid;
          align-content: start;
          grid-auto-rows: max-content;
          gap: 7px;
          min-height: 0;
          overflow: auto;
          padding-right: 2px;
        }

        .device-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: start;
          gap: 9px;
          min-height: 48px;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--card-background-color, #fff);
          cursor: grab;
          padding: 8px;
        }

        .device-row.is-placed {
          min-height: 48px;
        }

        .placement-mode {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 8px;
        }

        .placement-mode span {
          color: var(--dmp-muted);
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        .placement-mode select {
          min-width: 0;
          min-height: 32px;
        }

        .device-row.is-pending {
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.18);
        }

        .device-row.is-selected {
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.28);
        }

        .device-row:active {
          cursor: grabbing;
        }

        .dot, .marker span {
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: var(--dmp-good);
          color: #fff;
        }

        .offline .dot, .marker.offline span {
          background: var(--dmp-bad);
        }

        .dot {
          width: 28px;
          height: 28px;
          margin-top: 2px;
        }

        .dot ha-icon {
          --mdc-icon-size: 18px;
        }

        .device-text {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        .device-text strong, .device-text small {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .device-text strong {
          color: var(--primary-text-color);
          font-size: 13px;
        }

        .device-text small, .placed, .empty-list {
          color: var(--dmp-muted);
          font-size: 12px;
        }

        .icon-picker {
          grid-column: 2 / 4;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 6px;
          margin-top: 0;
        }

        .icon-picker span {
          color: var(--dmp-muted);
          font-size: 11px;
          font-weight: 700;
        }

        .icon-picker-control {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 48px;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .icon-picker ha-icon-picker {
          min-width: 0;
          min-height: 28px;
          --mdc-theme-primary: var(--primary-color);
          --mdc-shape-small: 6px;
          --ha-icon-picker-input-height: 28px;
          --ha-icon-picker-input-border-radius: 6px;
          --ha-icon-picker-input-background: var(--secondary-background-color, #f7f8fa);
          --ha-icon-picker-input-border: 1px solid var(--dmp-border);
          --ha-icon-picker-input-color: var(--primary-text-color);
        }

        .icon-picker ha-icon-picker::part(input) {
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font-size: 12px;
          padding: 0 7px;
        }

        .icon-picker button {
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 800;
          padding: 0 7px;
        }

        .row-actions {
          display: flex;
          gap: 5px;
        }

        .action-editor {
          grid-column: 1 / 4;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }

        .action-editor label {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .action-editor span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 800;
        }

        .action-editor select {
          min-width: 0;
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: inherit;
          font-size: 12px;
          padding: 0 6px;
        }

        .marker-display-picker {
          grid-column: 1 / 4;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 120px;
          align-items: center;
          gap: 6px;
        }

        .marker-display-picker span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 800;
        }

        .marker-display-picker select {
          min-width: 0;
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: inherit;
          font-size: 12px;
          padding: 0 6px;
        }

        .color-threshold-editor {
          grid-column: 1 / 4;
          display: grid;
          gap: 6px;
          margin-bottom: 8px;
        }

        .color-threshold-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .color-threshold-header span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 800;
        }

        .color-threshold-header button,
        .color-threshold-row button {
          min-height: 26px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 700;
          padding: 0 8px;
        }

        .color-threshold-row {
          display: grid;
          grid-template-columns: minmax(0, 72px) 34px minmax(0, 1fr) auto;
          align-items: center;
          gap: 6px;
        }

        .color-threshold-row input {
          min-width: 0;
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: inherit;
          font-size: 12px;
          padding: 0 6px;
        }

        .color-threshold-row input[type="color"] {
          padding: 2px;
        }

        .color-threshold-empty {
          color: var(--dmp-muted);
          font-size: 11px;
          font-weight: 700;
        }

        .light-intensity-editor {
          grid-column: 1 / 4;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 72px auto;
          align-items: center;
          gap: 6px;
        }

        .light-intensity-editor span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 800;
        }

        .light-intensity-editor input {
          min-width: 0;
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: 11px/1.2 monospace;
          padding: 0 6px;
        }

        .light-intensity-editor small {
          color: var(--dmp-muted);
          font-size: 11px;
          font-weight: 800;
        }

        /* ── Render params section ── */
        .render-params-section {
          grid-column: 1 / 4;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px;
          background: var(--secondary-background-color, #f7f8fa);
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
        }
        .render-params-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          flex-wrap: wrap;
        }
        .render-params-header > span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .render-preset-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: var(--dmp-muted);
          font-weight: 600;
        }
        .render-preset-label select {
          font-size: 10px;
          padding: 2px 4px;
          border: 1px solid var(--dmp-border);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
        }
        .render-params-grid {
          display: grid;
          gap: 8px;
        }
        .render-params-grid.advanced {
          padding-top: 6px;
          border-top: 1px solid var(--dmp-border);
        }
        .render-param-group {
          display: grid;
          gap: 5px;
        }
        .render-param-group-title {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .render-param-group-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px 12px;
        }
        .render-advanced-toggle {
          align-self: flex-start;
          font-size: 10px;
          font-weight: 700;
          padding: 3px 8px;
          border: 1px solid var(--dmp-border);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          color: var(--dmp-muted);
          cursor: pointer;
        }
        .render-advanced-toggle:hover,
        .render-advanced-toggle[aria-expanded="true"] {
          color: var(--primary-color, #03a9f4);
          border-color: var(--primary-color, #03a9f4);
        }
        .rp-slider {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          align-items: stretch;
          gap: 4px;
          min-width: 0;
          font-size: 11px;
        }
        .rp-slider span {
          color: var(--dmp-muted);
          font-weight: 700;
          line-height: 1.25;
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
        }
        .rp-stepper {
          display: grid;
          grid-template-columns: 28px minmax(64px, 1fr) 28px;
          align-items: center;
          gap: 4px;
          width: 100%;
        }
        .rp-stepper button {
          width: 28px;
          height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          cursor: pointer;
          font-size: 13px;
          font-weight: 900;
          line-height: 1;
          padding: 0;
        }
        .rp-stepper button:hover {
          border-color: var(--dmp-border);
          color: var(--primary-text-color);
          background: var(--secondary-background-color, #f7f8fa);
        }
        .rp-slider:hover .rp-stepper input[type=number] {
          border-color: var(--primary-color, #f8d66d);
          box-shadow: 0 0 0 1px var(--primary-color, #f8d66d);
        }

        /* Parameter tooltip */
        .rp-slider[data-rp-tooltip] {
          position: relative;
        }
        .rp-slider[data-rp-tooltip]:hover::after {
          content: attr(data-rp-tooltip);
          position: absolute;
          bottom: calc(100% + 6px);
          left: 0;
          right: 0;
          background: #1a1a2e;
          color: #e8e8f0;
          font-size: 10px;
          line-height: 1.4;
          padding: 6px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.12);
          white-space: pre-wrap;
          word-break: break-word;
          z-index: 99;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }
        .rp-stepper input[type=number] {
          width: 100%;
          min-width: 0;
          height: 28px;
          box-sizing: border-box;
          border: 1px solid var(--dmp-border);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          font-family: monospace;
          font-size: 11px;
          padding: 0 4px;
          text-align: center;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .rp-slider.rp-overridden span {
          color: var(--primary-color, #f8d66d);
        }
        .render-params-actions {
          display: flex;
          gap: 6px;
          justify-content: flex-end;
        }
        .render-params-actions button {
          font-size: 10px;
          padding: 3px 8px;
          border: 1px solid var(--dmp-border);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          cursor: pointer;
        }
        .render-params-actions button:hover {
          background: var(--primary-color, #f8d66d);
        }

        .sub-spots-section {
          grid-column: 1 / 4;
          display: grid;
          gap: 8px;
          padding: 8px;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
        }
        .sub-spots-header,
        .light-path-header {
          display: grid;
          align-items: center;
          gap: 8px;
          grid-template-columns: minmax(0, 1fr) auto;
        }
        .sub-spots-header span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .sub-spots-header button,
        .sub-spot-title button {
          border: 1px solid var(--dmp-border);
          border-radius: 999px;
          background: transparent;
          color: var(--primary-text-color);
          cursor: pointer;
          font-size: 11px;
          font-weight: 800;
          padding: 3px 8px;
          flex: 0 0 auto;
          max-width: 100%;
        }
        .sub-spots-header button {
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.65);
          background: rgba(34, 197, 94, 0.10);
        }
        .sub-spot-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          background: rgba(0,0,0,0.08);
          overflow: hidden;
        }
        .sub-spot-title {
          display: grid;
          align-items: center;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 6px;
        }
        .sub-spot-title strong {
          min-width: 0;
          font-size: 12px;
        }
        .sub-spot-title > div {
          display: flex;
          gap: 6px;
          justify-content: flex-end;
          flex-wrap: nowrap;
          min-width: 0;
          max-width: 100%;
        }
        .sub-spot-title button.move,
        .light-path-actions button.move {
          color: #facc15;
          border-color: rgba(250, 204, 21, 0.72);
          background: rgba(250, 204, 21, 0.12);
        }
        .sub-spot-title button.move:hover,
        .light-path-actions button.move:hover {
          color: #fde68a;
          border-color: #facc15;
          background: rgba(250, 204, 21, 0.22);
        }
        .sub-spot-title button.remove,
        .light-path-actions button.remove {
          color: #fca5a5;
          border-color: rgba(239, 68, 68, 0.68);
          background: rgba(239, 68, 68, 0.12);
        }
        .sub-spot-title button.remove:hover,
        .light-path-actions button.remove:hover {
          color: #fecaca;
          border-color: #ef4444;
          background: rgba(239, 68, 68, 0.24);
        }
        .sub-spot-preset {
          justify-content: flex-start;
        }
        .sub-spots-empty {
          color: var(--dmp-muted);
          font-size: 11px;
        }

        .light-path-section {
          grid-column: 1 / 4;
          display: grid;
          gap: 8px;
          padding: 8px;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
        }
        .light-path-header span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .light-path-header > div,
        .light-path-actions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
          min-width: 0;
          max-width: 100%;
        }
        .light-path-header button,
        .light-path-actions button {
          border: 1px solid var(--dmp-border);
          border-radius: 999px;
          background: transparent;
          color: var(--primary-text-color);
          cursor: pointer;
          font-size: 11px;
          font-weight: 800;
          padding: 3px 8px;
          flex: 0 0 auto;
          max-width: 100%;
        }
        .light-path-header button:first-child {
          color: #facc15;
          border-color: rgba(250, 204, 21, 0.7);
          background: rgba(250, 204, 21, 0.12);
        }
        .light-path-point-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          background: rgba(0,0,0,0.08);
          overflow: hidden;
        }
        .light-path-coordinates {
          grid-column: 1 / -1;
        }
        .light-path-empty {
          color: var(--dmp-muted);
          font-size: 11px;
        }

        .light-shape-toggle {
          display: flex;
          gap: 3px;
        }
        .light-shape-toggle button {
          font-size: 11px;
          padding: 3px 9px;
          border: 1px solid var(--dmp-border);
          border-radius: 999px;
          background: transparent;
          color: var(--dmp-muted);
          cursor: pointer;
        }
        .light-shape-toggle button.active {
          background: var(--primary-color, #f8d66d);
          color: #000;
          border-color: var(--primary-color, #f8d66d);
        }

        .light-path-actions-bar {
          display: flex;
          gap: 6px;
          margin-bottom: 6px;
        }

        .light-rect-editor {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 6px;
          margin-top: 6px;
        }
        .light-rect-field {
          display: grid;
          gap: 3px;
        }
        .light-rect-field span {
          font-size: 10px;
          font-weight: 700;
          color: var(--dmp-muted);
        }
        .light-rect-field input {
          min-width: 0;
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: 11px/1.2 monospace;
          padding: 0 6px;
        }
        .light-rect-hint {
          grid-column: 1 / -1;
          color: var(--dmp-muted);
          font-size: 10px;
        }

        .coordinate-editor {
          grid-column: 1 / 4;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }

        .sub-spot-coordinates,
        .light-path-coordinates {
          grid-column: 1 / -1;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .coordinate-editor label {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .coordinate-editor span {
          color: var(--dmp-muted);
          font-size: 10px;
          font-weight: 800;
        }
        .coordinate-editor .axis-label,
        .zone-coordinate-editor .axis-label {
          font-weight: 900;
        }

        .coordinate-editor input {
          min-width: 0;
          min-height: 28px;
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: 11px/1.2 monospace;
          padding: 0 6px;
        }

        .sub-spot-coordinates input,
        .light-path-coordinates input {
          width: 100%;
          min-width: 0;
          font-size: 12px;
        }

        .placed, .remove, .edit-marker, .select-marker {
          border: 1px solid var(--dmp-border);
          border-radius: 999px;
          padding: 3px 7px;
        }

        .remove, .edit-marker, .select-marker {
          background: transparent;
          color: var(--dmp-muted);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
        }

        .select-marker {
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.65);
          background: rgba(34, 197, 94, 0.10);
        }

        .select-marker:hover {
          color: #86efac;
          border-color: #22c55e;
          background: rgba(34, 197, 94, 0.18);
        }

        .is-pending .select-marker {
          color: var(--primary-color, #f8d66d);
          border-color: var(--primary-color, #f8d66d);
        }

        .remove {
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.65);
          background: rgba(239, 68, 68, 0.10);
        }

        .remove:hover {
          color: #fca5a5;
          border-color: #ef4444;
          background: rgba(239, 68, 68, 0.18);
        }

        .edit-marker:hover {
          color: var(--primary-color, #03a9f4);
          border-color: var(--primary-color, #03a9f4);
        }

        main {
          position: relative;
          min-width: 0;
          padding: 14px;
        }

        .viewing main {
          padding: 0 0 14px;
        }

        .map-toolbar {
          position: sticky;
          z-index: 4;
          top: 12px;
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          gap: 10px;
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: thin;
          width: calc(100% - 24px);
          max-width: calc(100% - 24px);
          margin: 12px;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.18);
          padding: 4px;
        }

        .toolbar-title {
          flex: 0 1 260px;
          min-width: 0;
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--primary-text-color);
          font-size: 14px;
          font-weight: 800;
          padding: 0 10px;
        }

        .floor-switch {
          display: flex;
          align-items: center;
          flex: 0 1 260px;
          gap: 6px;
          min-width: 180px;
          max-width: 280px;
        }

        .floor-switch select {
          min-height: 30px;
          max-width: none;
          padding: 0 8px;
        }

        .floor-switch span {
          white-space: nowrap;
        }

        .mode-switch {
          flex: 0 0 auto;
          display: flex;
          gap: 4px;
          margin-left: auto;
        }

        .mode-switch button, .sidebar-toggle {
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--dmp-muted);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          min-height: 30px;
          padding: 0 10px;
        }

        .sidebar-toggle {
          flex: 0 0 auto;
          border-left: 1px solid var(--dmp-border);
          color: var(--primary-text-color);
          white-space: nowrap;
        }

        .sidebar-toggle:hover {
          background: var(--secondary-background-color, #f7f8fa);
        }

        .map-alert {
          display: flex;
          align-items: center;
          gap: 10px;
          width: calc(100% - 24px);
          max-width: calc(100% - 24px);
          margin: -4px 12px 10px;
          border: 1px solid rgba(212, 54, 54, 0.45);
          border-radius: 8px;
          background: linear-gradient(90deg, rgba(212, 54, 54, 0.18), rgba(212, 54, 54, 0.07));
          box-sizing: border-box;
          padding: 8px 10px;
        }

        .map-alert-title {
          display: flex;
          align-items: center;
          flex: 0 0 auto;
          gap: 7px;
          color: var(--primary-text-color);
          font-size: 13px;
          white-space: nowrap;
        }

        .map-alert-title span {
          display: grid;
          place-items: center;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          background: var(--dmp-bad);
          color: #fff;
          font-weight: 900;
          box-shadow: 0 0 0 0 rgba(212, 54, 54, 0.45);
          animation: dmp-alert-pulse 1.8s ease-out infinite;
        }

        .map-alert-list {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          overflow-x: auto;
          scrollbar-width: thin;
        }

        .map-alert-list button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex: 0 0 auto;
          max-width: 280px;
          min-height: 28px;
          border: 1px solid rgba(212, 54, 54, 0.45);
          border-radius: 999px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          padding: 0 9px;
        }

        .map-alert-list button:hover {
          border-color: var(--dmp-bad);
          color: var(--dmp-bad);
        }

        .map-alert-list button span {
          overflow: hidden;
          max-width: 120px;
          color: var(--dmp-bad);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @keyframes dmp-alert-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(212, 54, 54, 0.45);
          }
          70% {
            box-shadow: 0 0 0 9px rgba(212, 54, 54, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(212, 54, 54, 0);
          }
        }

        .mode-switch button.active {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #fff);
        }

        .zoom-controls {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .zoom-controls button,
        .marker-size-stepper button {
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          min-height: 30px;
          min-width: 30px;
          padding: 0 8px;
        }

        .zoom-controls button:hover,
        .marker-size-stepper button:hover {
          background: var(--secondary-background-color, #f7f8fa);
        }

        .zoom-controls span,
        .display-controls span {
          color: var(--dmp-muted);
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        .zoom-controls input[type="range"] {
          width: 120px;
          min-width: 80px;
        }

        .zoom-controls output,
        .marker-size-stepper output {
          color: var(--dmp-muted);
          font-size: 12px;
          font-weight: 700;
          min-width: 42px;
          text-align: center;
        }

        .display-controls {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 8px;
          width: auto;
          min-width: 150px;
          border-left: 1px solid var(--dmp-border);
          border-right: 1px solid var(--dmp-border);
          margin-left: 4px;
          padding: 0 10px;
        }

        .display-controls label {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .marker-size-stepper {
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }

        .marker-size-stepper output {
          min-width: 24px;
        }

        .display-controls .toolbar-toggle {
          grid-template-columns: auto auto;
          justify-content: start;
          white-space: nowrap;
        }

        .map {
          position: relative;
          width: 100%;
          max-height: clamp(520px, 82vh, 1100px);
          overflow: auto;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
          cursor: grab;
          touch-action: none;
        }

        .map.panning {
          cursor: grabbing;
          user-select: none;
        }

        .map.selecting {
          cursor: crosshair;
          user-select: none;
        }

        .model-viewer {
          position: relative;
          width: 100%;
          height: clamp(520px, 82vh, 1100px);
          overflow: hidden;
          border-radius: var(--ha-card-border-radius, 12px);
          background: #111827;
          touch-action: none;
          user-select: none;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
        }

        .model-viewer canvas:not(.axes-gizmo) {
          display: block;
          width: 100%;
          height: 100%;
          outline: none;
          touch-action: none;
          user-select: none;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
        }

        .model-marker-layer,
        .model-zone-label-layer,
        .model-zone-point-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .model-marker-layer {
          z-index: 3;
        }

        .model-zone-point-layer {
          z-index: 5;
        }

        .model-zone-label-layer {
          z-index: 4;
        }

        .model-viewer.zone-drawing .model-marker-layer {
          display: none;
        }

        .model-compass {
          position: absolute;
          right: 12px;
          top: 12px;
          z-index: 7;
          display: grid;
          gap: 8px;
          width: 174px;
          pointer-events: none;
        }

        .compass-grid {
          display: grid;
          grid-template-columns: repeat(3, 38px);
          grid-template-rows: repeat(3, 38px);
          justify-content: center;
          gap: 4px;
        }

        .model-compass button {
          display: grid;
          place-items: center;
          min-width: 0;
          min-height: 0;
          border: 1px solid rgba(255, 255, 255, 0.34);
          border-radius: 6px;
          background: rgba(15, 23, 42, 0.78);
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          padding: 0;
          pointer-events: auto;
          backdrop-filter: blur(5px);
        }

        .model-compass button:hover {
          background: rgba(37, 99, 235, 0.9);
        }

        .model-compass button:disabled {
          cursor: not-allowed;
          opacity: 0.42;
        }

        .compass-north {
          grid-column: 2;
          grid-row: 1;
        }

        .compass-top {
          grid-column: 2;
          grid-row: 2;
        }

        .compass-west {
          grid-column: 1;
          grid-row: 2;
        }

        .compass-east {
          grid-column: 3;
          grid-row: 2;
        }

        .compass-south {
          grid-column: 2;
          grid-row: 3;
        }

        .default-view-actions {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 4px;
          width: 100%;
        }

        .default-view-actions button {
          min-height: 28px;
          padding: 0 6px;
        }

        .default-view-actions button:only-child {
          grid-column: 1 / -1;
        }

        .zone-lux-label {
          position: absolute;
          left: 0;
          top: 0;
          border: 1px solid rgba(255, 255, 255, 0.36);
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.78);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.26);
          color: #fff;
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
          padding: 6px 10px;
          white-space: nowrap;
          backdrop-filter: blur(4px);
        }

        .zone-point-handle {
          position: absolute;
          left: 0;
          top: 0;
          display: grid;
          place-items: center;
          width: 24px;
          height: 24px;
          border: 2px solid #fff;
          border-radius: 999px;
          background: #f5c542;
          box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.55), 0 0 18px rgba(245, 197, 66, 0.95);
          color: #111827;
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          padding: 0;
          pointer-events: auto;
          will-change: transform;
        }

        .zone-point-handle.active {
          background: #d43636;
          color: #fff;
          box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.85), 0 0 24px rgba(212, 54, 54, 1);
        }

        .model-marker {
          position: absolute;
          left: 0;
          top: 0;
          display: inline-flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          gap: 6px;
          max-width: min(240px, 42vw);
          border: 0;
          border-radius: 999px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 5px 18px rgba(0, 0, 0, 0.32);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          padding: 3px 7px 3px 3px;
          pointer-events: auto;
          text-align: left;
          writing-mode: horizontal-tb;
          will-change: transform;
        }

        .model-marker.icon-only {
          display: grid;
          place-items: center;
          width: calc(var(--marker-size, 22px) + 6px);
          height: calc(var(--marker-size, 22px) + 6px);
          max-width: none;
          padding: 3px;
        }

        .model-marker.icon-only.value-marker {
          width: auto;
          min-width: calc(var(--marker-size, 22px) + 6px);
        }

        .model-marker span {
          position: relative;
          z-index: 1;
          display: grid;
          flex: 0 0 var(--marker-size, 22px);
          place-items: center;
          width: var(--marker-size, 22px);
          height: var(--marker-size, 22px);
          min-width: var(--marker-size, 22px);
          min-height: var(--marker-size, 22px);
          border-radius: 50%;
          background: var(--dmp-good);
          color: #fff;
        }

        .model-marker strong {
          position: relative;
          z-index: 1;
        }

        .model-marker span.value-face {
          width: auto;
          min-width: var(--marker-size, 22px);
          padding: 0 6px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          line-height: 1;
          letter-spacing: 0;
          white-space: nowrap;
        }

        .model-marker.state-active span {
          background: #f5c542;
          color: #111;
        }

        .model-marker.state-inactive span {
          background: #111827;
          color: #fff;
        }

        .model-marker.state-neutral span,
        .model-marker.state-online span {
          background: var(--dmp-good);
          color: #fff;
        }

        .model-marker.state-offline span,
        .model-marker.offline span {
          background: var(--dmp-bad);
          color: #fff;
          box-shadow: 0 0 0 3px rgba(212, 54, 54, 0.98), 0 0 18px rgba(212, 54, 54, 0.95);
        }

        /* color_thresholds: overrides state-based background with the computed threshold color */
        .model-marker.state-threshold span {
          background: var(--marker-threshold-color);
          color: #fff;
        }

        .model-sub-spot {
          background: rgba(248, 214, 109, 0.95);
          color: #111827;
          box-shadow: 0 0 0 2px rgba(248, 214, 109, 0.24), 0 6px 18px rgba(0, 0, 0, 0.28);
        }

        .model-sub-spot span {
          background: #f8d66d;
          color: #111827;
          box-shadow: none;
        }

        .model-light-path-point {
          background: rgba(14, 165, 233, 0.92);
          color: #fff;
          box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.24), 0 6px 18px rgba(0, 0, 0, 0.28);
        }

        .model-light-path-point span {
          background: #0ea5e9;
          color: #fff;
          box-shadow: none;
          font-size: 10px;
          font-weight: 900;
        }

        .model-marker.jump-focus {
          overflow: visible;
        }

        .model-marker.jump-focus::after {
          content: "";
          position: absolute;
          left: calc((var(--marker-size, 22px) + 6px) / 2);
          top: 50%;
          z-index: 0;
          width: calc(var(--marker-size, 22px) + 22px);
          height: calc(var(--marker-size, 22px) + 22px);
          border: 3px solid rgba(255, 30, 30, 0.96);
          border-radius: 999px;
          box-shadow: 0 0 18px rgba(255, 30, 30, 0.85);
          pointer-events: none;
          transform: translate(-50%, -50%) scale(0.65);
          animation: offline-marker-ring 0.95s ease-out 3;
        }

        .model-marker.jump-focus span {
          background: var(--dmp-bad);
          color: #fff;
          box-shadow: 0 0 0 3px rgba(212, 54, 54, 0.95), 0 0 22px rgba(212, 54, 54, 1);
        }

        @keyframes offline-marker-ring {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.55);
          }
          16% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.9);
          }
        }

        .model-marker ha-icon {
          --mdc-icon-size: calc(var(--marker-size, 22px) * 0.68);
          display: block;
        }

        .model-marker strong {
          display: block;
          min-width: 0;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          writing-mode: horizontal-tb;
          font-size: 12px;
        }

        .model-status {
          position: absolute;
          inset: 0;
          z-index: 2;
          display: grid;
          place-items: center;
          color: rgba(255, 255, 255, 0.82);
          font-size: 14px;
          font-weight: 700;
          padding: 20px;
          text-align: center;
          pointer-events: none;
        }

        .model-status[hidden] {
          display: none;
        }

        .version-badge {
          position: absolute;
          bottom: 6px;
          right: 8px;
          z-index: 10;
          font-size: 10px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.35);
          pointer-events: none;
          letter-spacing: 0.03em;
        }

        /* ── Axes gizmo (edit mode only) ── */
        .axes-gizmo {
          position: absolute;
          top: 10px;
          left: 10px;
          width: 130px;
          height: 130px;
          pointer-events: none;
          z-index: 6;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.28);
        }
        .axes-legend {
          position: absolute;
          top: 146px;
          left: 10px;
          width: 130px;
          display: flex;
          justify-content: space-around;
          align-items: center;
          pointer-events: none;
          z-index: 6;
          font-size: 12px;
          font-family: monospace;
          letter-spacing: 0.02em;
          background: rgba(0, 0, 0, 0.28);
          border-radius: 6px;
          padding: 3px 4px;
          box-sizing: border-box;
          text-shadow: 0 1px 4px rgba(0,0,0,0.9);
        }

        .selected-marker-panel {
          position: absolute;
          z-index: 4;
          right: 14px;
          top: 196px;
          width: min(360px, calc(100% - 28px));
          max-height: calc(100% - 210px);
          overflow: auto;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.78);
          color: #fff;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          padding: 10px;
          backdrop-filter: blur(6px);
        }

        .selected-empty {
          color: rgba(255, 255, 255, 0.74);
          font-size: 12px;
          font-weight: 700;
        }

        .selected-title {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .selected-title strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }

        .selected-title-actions {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .selected-title button {
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          padding: 4px 9px;
        }

        .selected-title button[data-edit-marker] {
          border-color: rgba(248, 214, 109, 0.65);
          background: rgba(248, 214, 109, 0.14);
          color: #fde68a;
        }

        .selected-title button[data-edit-marker]:hover {
          background: rgba(248, 214, 109, 0.28);
        }

        .selected-title button.remove {
          border-color: rgba(239, 68, 68, 0.5);
          background: rgba(239, 68, 68, 0.12);
          color: #fca5a5;
        }
        .selected-title button.remove:hover {
          background: rgba(239, 68, 68, 0.30);
        }

        .selected-marker-panel .coordinate-editor {
          grid-column: auto;
        }

        .selected-marker-panel .action-editor {
          grid-column: auto;
          margin-bottom: 8px;
        }

        .selected-marker-panel .light-intensity-editor {
          grid-column: auto;
          margin-bottom: 8px;
        }

        .selected-marker-panel .marker-display-picker {
          grid-column: auto;
          margin-bottom: 8px;
        }

        .selected-marker-panel .color-threshold-editor {
          grid-column: auto;
        }

        .selected-marker-panel .color-threshold-header span,
        .selected-marker-panel .color-threshold-empty {
          color: rgba(255, 255, 255, 0.72);
        }

        .selected-marker-panel .color-threshold-header button,
        .selected-marker-panel .color-threshold-row button,
        .selected-marker-panel .color-threshold-row input {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(15, 23, 42, 0.9);
          color: #fff;
        }

        .selected-marker-panel .action-editor span {
          color: rgba(255, 255, 255, 0.72);
        }

        .selected-marker-panel .action-editor select {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(15, 23, 42, 0.9);
          color: #fff;
        }

        .selected-marker-panel .marker-display-picker span {
          color: rgba(255, 255, 255, 0.72);
        }

        .selected-marker-panel .marker-display-picker select {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(15, 23, 42, 0.9);
          color: #fff;
        }

        .selected-marker-panel .light-intensity-editor span,
        .selected-marker-panel .light-intensity-editor small {
          color: rgba(255, 255, 255, 0.72);
        }

        .selected-marker-panel .light-intensity-editor input {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(15, 23, 42, 0.9);
          color: #fff;
        }

        .selected-marker-panel .coordinate-editor span {
          color: rgba(255, 255, 255, 0.72);
        }

        .selected-marker-panel .coordinate-editor input {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(15, 23, 42, 0.9);
          color: #fff;
        }

        .model-viewer.editable .model-status {
          inset: auto 14px 14px 14px;
          display: block;
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.72);
          padding: 10px 12px;
          text-align: left;
        }

        .nudge-pad {
          position: absolute;
          z-index: 5;
          left: 0;
          top: 0;
          display: grid;
          justify-content: center;
          grid-template-areas:
            ". up ."
            "left . right"
            ". down ."
            "step step step";
          grid-template-columns: 28px 28px 28px;
          grid-template-rows: 28px 28px 28px auto;
          gap: 3px;
          width: 112px;
          margin: 0;
          border: 1px solid rgba(127, 127, 127, 0.3);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.42);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
          opacity: 0.58;
          padding: 7px;
          pointer-events: auto;
          backdrop-filter: blur(3px);
        }

        .nudge-pad:hover {
          opacity: 0.95;
        }

        .nudge-pad button {
          display: grid;
          place-items: center;
          border: 1px solid rgba(29, 143, 95, 0.55);
          border-radius: 999px;
          background: rgba(160, 220, 120, 0.72);
          color: #1f5f2f;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          line-height: 1;
          padding: 0;
        }

        .nudge-pad button:disabled {
          cursor: not-allowed;
          filter: grayscale(1);
          opacity: 0.45;
        }

        .nudge-pad button:not(:disabled):hover {
          background: rgba(150, 225, 95, 0.95);
        }

        .nudge-up {
          grid-area: up;
        }

        .nudge-left {
          grid-area: left;
        }

        .nudge-right {
          grid-area: right;
        }

        .nudge-down {
          grid-area: down;
        }

        .nudge-step {
          grid-area: step;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 5px;
          margin-top: 3px;
          min-width: 0;
        }

        .nudge-step span {
          color: #1f5f2f;
          font-size: 10px;
          font-weight: 800;
        }

        .nudge-step input {
          min-width: 0;
          min-height: 22px;
          width: 100%;
          border: 1px solid rgba(29, 143, 95, 0.45);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.8);
          color: #1f5f2f;
          font: inherit;
          font-size: 11px;
          font-weight: 800;
          padding: 0 5px;
        }

        .map-content {
          position: relative;
          margin: 0;
        }

        .projection-3d {
          perspective: 1200px;
          perspective-origin: 50% 35%;
        }

        .projection-3d .map-content {
          margin: 8% auto 14%;
          transform: rotateX(var(--floorplan-tilt)) rotateZ(var(--floorplan-rotate));
          transform-origin: 50% 58%;
          transform-style: preserve-3d;
          filter: drop-shadow(0 var(--floorplan-depth) calc(var(--floorplan-depth) * 1.25) rgba(0, 0, 0, 0.34));
        }

        .zoomed-out .map-content {
          margin: 0 auto;
        }

        .projection-3d.zoomed-out .map-content {
          margin: 8% auto 14%;
        }

        .viewing .map {
          border: 0;
          border-radius: var(--ha-card-border-radius, 12px);
        }

        .map img {
          display: block;
          width: 100%;
          height: auto;
          object-fit: contain;
          pointer-events: none;
          user-select: none;
        }

        .image-error {
          display: none;
          position: absolute;
          inset: 16px;
          place-items: center;
          border: 1px dashed var(--dmp-border);
          border-radius: 8px;
          background: var(--card-background-color, #fff);
          color: var(--dmp-muted);
          padding: 18px;
          text-align: center;
        }

        .image-failed .image-error {
          display: grid;
        }

        .marker {
          position: absolute;
          z-index: 3;
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          gap: 6px;
          max-width: min(240px, 42vw);
          min-width: 0;
          border: 0;
          border-radius: 999px;
          background: var(--card-background-color, #fff);
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.28);
          color: var(--primary-text-color);
          cursor: grab;
          font: inherit;
          padding: 3px 6px 3px 3px;
          text-align: left;
          writing-mode: horizontal-tb;
          transform: translate(calc(var(--marker-size) / -2 - 5px), -50%);
        }

        .selection-box {
          position: absolute;
          z-index: 2;
          border: 1px solid var(--primary-color, #03a9f4);
          background: rgba(3, 169, 244, 0.16);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
          pointer-events: none;
        }

        .marker.icon-only {
          display: grid;
          place-items: center;
          width: calc(var(--marker-size) + 6px);
          height: calc(var(--marker-size) + 6px);
          max-width: none;
          padding: 3px;
        }

        .marker.icon-only.value-marker {
          width: auto;
          min-width: calc(var(--marker-size) + 6px);
        }

        .marker:active {
          cursor: grabbing;
        }

        .marker.selected {
          outline: 3px solid var(--primary-color, #03a9f4);
          outline-offset: 4px;
        }

        .marker.jump-focus {
          overflow: visible;
        }

        .marker.jump-focus::after {
          content: "";
          position: absolute;
          left: calc((var(--marker-size) + 6px) / 2);
          top: 50%;
          z-index: 0;
          width: calc(var(--marker-size) + 22px);
          height: calc(var(--marker-size) + 22px);
          border: 3px solid rgba(255, 30, 30, 0.96);
          border-radius: 999px;
          box-shadow: 0 0 18px rgba(255, 30, 30, 0.85);
          pointer-events: none;
          transform: translate(-50%, -50%) scale(0.65);
          animation: offline-marker-ring 0.95s ease-out 3;
        }

        .marker span {
          position: relative;
          z-index: 1;
          display: grid;
          flex: 0 0 var(--marker-size);
          place-items: center;
          width: var(--marker-size);
          height: var(--marker-size);
          min-width: var(--marker-size);
          min-height: var(--marker-size);
          border-radius: 50%;
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.85), 0 0 13px rgba(29, 143, 95, 0.78);
          line-height: 0;
        }

        .marker strong {
          position: relative;
          z-index: 1;
        }

        .marker span.value-face {
          flex-basis: auto;
          width: auto;
          min-width: var(--marker-size);
          padding: 0 6px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          line-height: 1;
          letter-spacing: 0;
          white-space: nowrap;
        }

        .marker.online span {
          background: var(--dmp-good);
        }

        .marker.offline span {
          background: var(--dmp-bad);
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.85), 0 0 15px rgba(212, 54, 54, 0.9);
        }

        .marker.state-mode.online span {
          box-shadow: 0 0 0 3px rgba(29, 143, 95, 0.96), 0 0 16px rgba(29, 143, 95, 0.8);
        }

        .marker.state-mode.state-active span {
          background: #f5c542;
          color: #111;
        }

        .marker.state-mode.state-inactive span {
          background: #111827;
          color: #fff;
        }

        .marker.state-mode.state-neutral span {
          background: #64748b;
          color: #fff;
        }

        .marker.state-mode.offline span {
          background: var(--dmp-bad);
          color: #fff;
          box-shadow: 0 0 0 3px rgba(212, 54, 54, 0.98), 0 0 18px rgba(212, 54, 54, 0.95);
        }

        /* color_thresholds: overrides state-based background with the computed threshold color */
        .marker.state-threshold span,
        .marker.state-mode.state-threshold span {
          background: var(--marker-threshold-color);
          color: #fff;
        }

        .marker ha-icon {
          --mdc-icon-size: calc(var(--marker-size) * 0.68);
          display: block;
          width: calc(var(--marker-size) * 0.68);
          height: calc(var(--marker-size) * 0.68);
          line-height: 1;
        }

        .marker strong {
          display: block;
          min-width: 0;
          max-width: calc(240px - var(--marker-size) - 24px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          writing-mode: horizontal-tb;
          font-size: 12px;
        }

        .missing-image {
          display: grid;
          min-height: 520px;
          place-items: center;
          border: 1px dashed var(--dmp-border);
          border-radius: 8px;
          color: var(--dmp-muted);
          text-align: center;
        }

        .export {
          border-top: 1px solid var(--dmp-border);
          padding-top: 10px;
        }

        .export summary {
          color: var(--primary-color, #03a9f4);
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
        }

        .export-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
        }

        .export-actions button {
          border: 1px solid var(--dmp-border);
          border-radius: 6px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          padding: 5px 9px;
        }

        .rp-import-label {
          border: 1px solid var(--dmp-border);
          border-radius: 5px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          cursor: pointer;
          font: inherit;
          font-size: 10px;
          padding: 3px 8px;
        }
        .rp-import-label:hover {
          background: var(--primary-color, #f8d66d);
        }


        .export-actions button:hover {
          border-color: var(--primary-color, #03a9f4);
          color: var(--primary-color, #03a9f4);
        }

        .export-actions span {
          color: var(--dmp-muted);
          font-size: 12px;
          font-weight: 700;
        }

        textarea {
          box-sizing: border-box;
          width: 100%;
          min-height: 150px;
          margin-top: 8px;
          border: 1px solid var(--dmp-border);
          border-radius: 8px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: 12px/1.4 monospace;
          padding: 8px;
          resize: vertical;
        }

        @media (max-width: 900px) {
          .panel {
            grid-template-columns: 1fr;
          }

          aside {
            position: relative;
            top: auto;
            height: auto;
            border-right: 0;
            border-bottom: 1px solid var(--dmp-border);
            max-height: 520px;
          }

          .map-toolbar {
            flex-wrap: nowrap;
            width: auto;
          }

          .floor-switch {
            width: auto;
          }

          .floor-switch select {
            max-width: none;
          }

          .display-controls {
            width: auto;
            min-width: 150px;
            border-left: 0;
            border-right: 0;
            border-top: 0;
            border-bottom: 0;
            margin-left: 0;
            padding: 0;
          }
        }
      </style>
    `;
  }
}

customElements.define("home-assistant-3d-floorplan", HomeAssistant3DFloorplan);

class HomeAssistant3DFloorplanEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._markerYamlError = "";
    this._objectConfigScope = "root";
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
    const scopeMatch = /^floor:(\d+)$/.exec(this._objectConfigScope || "");
    if (scopeMatch && !this._config.floors?.[Number(scopeMatch[1])]) this._objectConfigScope = "root";
    this._render();
  }

  _render() {
    this.innerHTML = `
      <style>
        .floorplan-editor {
          display: grid;
          gap: 14px;
          padding: 12px 0;
          color: var(--primary-text-color);
        }

        .floorplan-editor section {
          display: grid;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.25));
          border-radius: 8px;
          background: var(--card-background-color, #fff);
        }

        .floorplan-editor h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
        }

        .editor-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 10px;
        }

        .floorplan-editor label {
          display: grid;
          gap: 4px;
          min-width: 0;
          font-size: 12px;
          font-weight: 700;
        }

        .floorplan-editor input,
        .floorplan-editor select,
        .floorplan-editor textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
          border-radius: 6px;
          background: var(--secondary-background-color, #f7f8fa);
          color: var(--primary-text-color);
          font: inherit;
          padding: 8px;
        }

        .floorplan-editor textarea {
          min-height: 220px;
          resize: vertical;
          font-family: monospace;
          font-size: 12px;
          line-height: 1.45;
        }

        .checkbox-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .checkbox-row input {
          width: auto;
        }

        .editor-help {
          color: var(--secondary-text-color);
          font-size: 12px;
          line-height: 1.4;
        }

        .editor-error {
          color: var(--error-color, #db4437);
          font-size: 12px;
          font-weight: 700;
        }

        .object-config-toolbar {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .object-config-toolbar label {
          min-width: min(100%, 240px);
        }

        .object-config-list {
          display: grid;
          gap: 10px;
        }

        .object-config-card {
          display: grid;
          gap: 10px;
          padding: 10px;
          border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.25));
          border-radius: 7px;
          background: var(--secondary-background-color, #f7f8fa);
        }

        .object-config-card header,
        .state-style-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .object-config-card header strong {
          font-size: 12px;
        }

        .object-config-card button,
        .object-config-toolbar button,
        .state-style-editor button {
          width: auto;
          border: 1px solid var(--primary-color, #03a9f4);
          border-radius: 6px;
          background: transparent;
          color: var(--primary-color, #03a9f4);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 10px;
        }

        .object-config-card button[data-remove-object-item],
        .state-style-row button {
          border-color: var(--error-color, #db4437);
          color: var(--error-color, #db4437);
        }

        .state-style-editor {
          display: grid;
          gap: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.25));
        }

        .state-style-editor h4 {
          margin: 0;
          font-size: 12px;
        }

        .state-style-row {
          display: grid;
          grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) minmax(85px, 0.7fr) auto;
        }

        .object-config-empty {
          padding: 10px;
          border: 1px dashed var(--divider-color, rgba(127, 127, 127, 0.35));
          border-radius: 7px;
          color: var(--secondary-text-color);
          font-size: 12px;
          text-align: center;
        }

        @media (max-width: 600px) {
          .state-style-row {
            grid-template-columns: 1fr 1fr;
          }
        }
      </style>
      <div class="floorplan-editor">
        <section>
          <h3>Basic</h3>
          <div class="editor-grid">
            ${this._textInput("title", "Title", "3D Floorplan")}
            ${this._textInput("model", "3D Model URL", "/local/floorplans/home.glb")}
            ${this._textInput("model_background", "Model Background", "#111827")}
          </div>
        </section>

        <section>
          <h3>Performance</h3>
          <div class="editor-grid">
            ${this._selectInput("model_performance_profile", "Render Profile", [["quality", "Quality"], ["balanced", "Balanced"], ["performance", "Performance"], ["mobile", "Mobile"]], "quality")}
            ${this._numberInput("model_pixel_ratio", "Pixel Ratio Override", 0, 0, 3, 0.25)}
          </div>
          <div class="editor-help">Quality keeps the sharp original render path. Use Balanced, Performance, or Mobile only for heavier models.</div>
        </section>

        <section>
          <h3>Editing & Display</h3>
          <div class="editor-grid">
            ${this._checkboxInput("allow_edit", "Allow Admin Edit Mode", true)}
            ${this._checkboxInput("show_labels", "Show Marker Names", true)}
            ${this._checkboxInput("show_entity_state", "Use Entity State Colors", true)}
            ${this._numberInput("marker_size", "Marker Size", 18, 8, 64, 1)}
            ${this._numberInput("nudge_step", "Nudge Step", 1, 0.01, 100, 0.01)}
          </div>
        </section>

        <section>
          <h3>Marker Actions</h3>
          <div class="editor-grid">
            ${this._selectInput("marker_tap_action", "User Tap", this._actionOptions("tap"))}
            ${this._selectInput("marker_hold_action", "User Hold", this._actionOptions("hold"))}
            ${this._selectInput("edit_marker_tap_action", "Edit Tap", this._actionOptions("hold"))}
            ${this._selectInput("edit_marker_hold_action", "Edit Hold", this._actionOptions("hold"))}
            ${this._numberInput("marker_hold_ms", "Hold Delay (ms)", 650, 250, 3000, 50)}
          </div>
        </section>

        <section>
          <h3>Offline Devices</h3>
          <div class="editor-grid">
            ${this._listInput("offline_states", "Offline States", ["unavailable", "unknown"])}
            ${this._numberInput("offline_focus_distance", "Offline Focus Distance", 2, 1, 10, 0.1)}
          </div>
          <div class="editor-help">Focus distance uses model-relative levels from 1-10. Lower values zoom closer to the offline marker.</div>
        </section>

        <section>
          <h3>Entity Filters</h3>
          <div class="editor-grid">
            ${this._listInput("domains", "Domains", [])}
            ${this._listInput("integrations", "Integrations", [])}
            ${this._listInput("areas", "Areas", [])}
          </div>
          <div class="editor-help">Comma-separated values. Leave empty to include all.</div>
        </section>

        <section>
          <h3>Ambient Darkness</h3>
          <div class="editor-grid">
            ${this._checkboxInput("ambient_darkness_enabled", "Enable Ambient Darkness", this._config.ambient_darkness !== false)}
            ${this._textInput("ambient_darkness.entity", "Sun Entity", "sun.sun")}
          </div>
        </section>

        <section>
          <h3>Animated 3D Objects</h3>
          ${this._renderObjectConfigToolbar("animation")}
          <div class="editor-help">Animate named GLB objects while a Home Assistant entity matches the configured active state.</div>
          <div class="object-config-list">
            ${this._renderAnimationEditors()}
          </div>
        </section>

        <section>
          <h3>Interactive 3D Objects</h3>
          ${this._renderObjectConfigToolbar("interactive")}
          <div class="editor-help">Make named GLB objects clickable and optionally change their color or opacity with entity state.</div>
          <div class="object-config-list">
            ${this._renderInteractiveObjectEditors()}
          </div>
        </section>

        <section>
          <h3>Import Config YAML</h3>
          <div class="editor-help">Paste the full output of <strong>Copy YAML</strong> here. Applies markers, zones, animations, interactive objects, presets, and ambient darkness all at once.</div>
          <textarea data-full-config-yaml spellcheck="false" placeholder="Paste exported YAML here…"></textarea>
          <button type="button" data-apply-full-config style="margin-top:6px;padding:5px 12px;border:1px solid var(--primary-color,#03a9f4);border-radius:6px;background:transparent;color:var(--primary-color,#03a9f4);cursor:pointer;font-size:12px;font-weight:700;">Apply</button>
          ${this._fullConfigError ? `<div class="editor-error">${this._escape(this._fullConfigError)}</div>` : ""}
          ${this._fullConfigSuccess ? `<div class="editor-success">${this._escape(this._fullConfigSuccess)}</div>` : ""}
        </section>
      </div>
    `;
    this._attachEditorEvents();
  }

  _renderObjectConfigToolbar(kind) {
    const floors = Array.isArray(this._config.floors) ? this._config.floors : [];
    const scopeOptions = [
      `<option value="root" ${this._objectConfigScope === "root" ? "selected" : ""}>Card / single floor</option>`,
      ...floors.map((floor, index) => {
        const value = `floor:${index}`;
        const label = floor.name || floor.id || `Floor ${index + 1}`;
        return `<option value="${value}" ${this._objectConfigScope === value ? "selected" : ""}>${this._escape(label)}</option>`;
      }),
    ].join("");
    const label = kind === "animation" ? "Animation" : "Interactive object";
    return `
      <div class="object-config-toolbar">
        <label>
          <span>Configuration scope</span>
          <select data-object-config-scope>${scopeOptions}</select>
        </label>
        <button type="button" data-add-object-item="${kind}">Add ${label}</button>
      </div>
    `;
  }

  _objectConfigTarget(config = this._config) {
    const match = /^floor:(\d+)$/.exec(this._objectConfigScope || "");
    if (!match) return config;
    const index = Number(match[1]);
    return Array.isArray(config.floors) && config.floors[index] ? config.floors[index] : config;
  }

  _renderAnimationEditors() {
    const animations = this._objectConfigTarget()?.animations;
    if (!Array.isArray(animations) || !animations.length) {
      return `<div class="object-config-empty">No animations configured for this scope.</div>`;
    }
    return animations.map((animation, index) => `
      <article class="object-config-card">
        <header>
          <strong>Animation ${index + 1}${animation.object_name ? ` · ${this._escape(animation.object_name)}` : ""}</strong>
          <button type="button" data-remove-object-item="animation" data-item-index="${index}">Remove</button>
        </header>
        <div class="editor-grid">
          ${this._objectField("animation", index, "object_name", "GLB Object Name", animation.object_name, "CeilingFan")}
          ${this._objectField("animation", index, "entity", "Entity", animation.entity, "fan.living_room")}
          ${this._objectSelect("animation", index, "type", "Animation Type", animation.type || "rotate", [["rotate", "Rotate"], ["oscillate", "Oscillate"], ["bob", "Bob"]])}
          ${this._objectSelect("animation", index, "axis", "Axis", animation.axis || "y", [["x", "X"], ["y", "Y"], ["z", "Z"]])}
          ${this._objectField("animation", index, "speed", "Speed", animation.speed ?? 1, "1", "number", 'min="0" step="0.1"')}
          ${this._objectField("animation", index, "state_on", "Active State", animation.state_on || "on", "on")}
          ${this._objectField("animation", index, "amplitude", "Amplitude", animation.amplitude ?? 0.5, "0.5", "number", 'min="0" step="0.1"')}
        </div>
      </article>
    `).join("");
  }

  _renderInteractiveObjectEditors() {
    const objects = this._objectConfigTarget()?.interactive_objects;
    if (!Array.isArray(objects) || !objects.length) {
      return `<div class="object-config-empty">No interactive objects configured for this scope.</div>`;
    }
    return objects.map((object, index) => {
      const tapAction = this._interactiveActionType(object.tap_action, "toggle");
      const holdAction = this._interactiveActionType(object.hold_action, "more-info");
      return `
        <article class="object-config-card">
          <header>
            <strong>Interactive object ${index + 1}${object.object_name ? ` · ${this._escape(object.object_name)}` : ""}</strong>
            <button type="button" data-remove-object-item="interactive" data-item-index="${index}">Remove</button>
          </header>
          <div class="editor-grid">
            ${this._objectField("interactive", index, "object_name", "GLB Object Name", object.object_name, "CeilingFan")}
            ${this._objectField("interactive", index, "entity", "Entity", object.entity, "fan.living_room")}
            ${this._objectSelect("interactive", index, "tap_action", "Tap Action", tapAction, this._interactiveActionOptions())}
            ${this._objectSelect("interactive", index, "hold_action", "Hold Action", holdAction, this._interactiveActionOptions())}
            ${(tapAction === "navigate" || holdAction === "navigate")
              ? this._objectField("interactive", index, "navigation_path", "Navigation Path", object.navigation_path || object.navigationPath, "#living-room or /lovelace/room")
              : ""}
          </div>
          ${this._renderServiceActionFields(index, "tap_action", object.tap_action)}
          ${this._renderServiceActionFields(index, "hold_action", object.hold_action)}
          ${this._renderStateStyleEditor(index, object.state_styles)}
        </article>
      `;
    }).join("");
  }

  _interactiveActionOptions() {
    return [["toggle", "Toggle"], ["more-info", "More info"], ["navigate", "Navigate"], ["none", "None"], ["call-service", "Call service"]];
  }

  _interactiveActionType(action, fallback) {
    return action && typeof action === "object" ? (action.action || fallback) : (action || fallback);
  }

  _renderServiceActionFields(index, actionKey, action) {
    if (this._interactiveActionType(action, "") !== "call-service") return "";
    const data = action && typeof action === "object" && action.data ? JSON.stringify(action.data, null, 2) : "";
    const label = actionKey === "tap_action" ? "Tap" : "Hold";
    return `
      <div class="editor-grid">
        ${this._objectField("interactive", index, `${actionKey}.service`, `${label} Service`, action?.service, "light.turn_on")}
        ${this._objectField("interactive", index, `${actionKey}.data`, `${label} Service Data (JSON)`, data, '{"brightness_pct": 50}', "text", "", "json")}
      </div>
    `;
  }

  _renderStateStyleEditor(index, stateStyles) {
    const entries = stateStyles && typeof stateStyles === "object" ? Object.entries(stateStyles) : [];
    return `
      <div class="state-style-editor">
        <h4>State styles</h4>
        ${entries.map(([state, style], styleIndex) => `
          <div class="state-style-row">
            ${this._objectField("interactive", index, `state_styles.${styleIndex}.state`, "State", state, "on")}
            ${this._objectField("interactive", index, `state_styles.${styleIndex}.color`, "Color", style?.color, "#81c784")}
            ${this._objectField("interactive", index, `state_styles.${styleIndex}.opacity`, "Opacity", style?.opacity ?? "", "1", "number", 'min="0" max="1" step="0.05"')}
            <button type="button" data-remove-state-style data-item-index="${index}" data-style-state="${this._escape(state)}">Remove</button>
          </div>
        `).join("")}
        ${entries.length ? "" : `<div class="object-config-empty">No state styles configured.</div>`}
        <button type="button" data-add-state-style data-item-index="${index}">Add state style</button>
      </div>
    `;
  }

  _objectField(kind, index, key, label, value = "", placeholder = "", type = "text", attributes = "", valueType = "") {
    return this._field(
      label,
      `<input type="${this._escape(type)}" data-object-kind="${kind}" data-item-index="${index}" data-object-key="${this._escape(key)}" ${valueType ? `data-value-type="${valueType}"` : ""} value="${this._escape(value ?? "")}" placeholder="${this._escape(placeholder)}" ${attributes} />`
    );
  }

  _objectSelect(kind, index, key, label, value, options) {
    return this._field(
      label,
      `<select data-object-kind="${kind}" data-item-index="${index}" data-object-key="${this._escape(key)}">${options.map(([optionValue, optionLabel]) => `<option value="${this._escape(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${this._escape(optionLabel)}</option>`).join("")}</select>`
    );
  }

  _attachEditorEvents() {
    this.querySelectorAll("[data-config-key]").forEach((element) => {
      const eventName = element.type === "checkbox" ? "change" : "change";
      element.addEventListener(eventName, (event) => this._handleConfigInput(event.currentTarget));
    });
    this.querySelector("[data-apply-full-config]")?.addEventListener("click", () => {
      const textarea = this.querySelector("[data-full-config-yaml]");
      if (textarea) this._handleFullConfigYaml(textarea.value);
    });
    this.querySelectorAll("[data-object-config-scope]").forEach((select) => {
      select.addEventListener("change", (event) => {
        this._objectConfigScope = event.currentTarget.value;
        this._render();
      });
    });
    this.querySelectorAll("[data-add-object-item]").forEach((button) => {
      button.addEventListener("click", () => this._addObjectConfigItem(button.dataset.addObjectItem));
    });
    this.querySelectorAll("[data-remove-object-item]").forEach((button) => {
      button.addEventListener("click", () => this._removeObjectConfigItem(button.dataset.removeObjectItem, Number(button.dataset.itemIndex)));
    });
    this.querySelectorAll("[data-object-kind][data-object-key]").forEach((input) => {
      input.addEventListener("change", () => this._handleObjectConfigInput(input));
    });
    this.querySelectorAll("[data-add-state-style]").forEach((button) => {
      button.addEventListener("click", () => this._addStateStyle(Number(button.dataset.itemIndex)));
    });
    this.querySelectorAll("[data-remove-state-style]").forEach((button) => {
      button.addEventListener("click", () => this._removeStateStyle(Number(button.dataset.itemIndex), button.dataset.styleState));
    });
  }

  _handleConfigInput(input) {
    const key = input.dataset.configKey;
    const type = input.dataset.configType || "text";
    let value = input.value;
    if (type === "checkbox") value = input.checked;
    if (type === "number") {
      if (value === "") value = null;
      else {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        value = number;
      }
    }
    if (type === "list") value = value.split(",").map((item) => item.trim()).filter(Boolean);

    const nextConfig = JSON.parse(JSON.stringify(this._config || {}));
    if (key === "ambient_darkness_enabled") {
      if (value) {
        nextConfig.ambient_darkness = nextConfig.ambient_darkness && typeof nextConfig.ambient_darkness === "object" ? nextConfig.ambient_darkness : { entity: "sun.sun" };
      } else {
        nextConfig.ambient_darkness = false;
      }
    } else {
      this._setConfigPath(nextConfig, key, value);
      this._cleanupEmptyObjects(nextConfig);
    }
    this._commitConfig(nextConfig);
  }

  _objectConfigArrayKey(kind) {
    return kind === "animation" ? "animations" : "interactive_objects";
  }

  _addObjectConfigItem(kind) {
    const nextConfig = JSON.parse(JSON.stringify(this._config || {}));
    const target = this._objectConfigTarget(nextConfig);
    const key = this._objectConfigArrayKey(kind);
    if (!Array.isArray(target[key])) target[key] = [];
    target[key].push(kind === "animation"
      ? { object_name: "", entity: "", type: "rotate", axis: "y", speed: 1, state_on: "on", amplitude: 0.5 }
      : { object_name: "", entity: "", tap_action: "toggle", hold_action: "more-info", state_styles: {} });
    this._commitConfig(nextConfig);
    this._render();
  }

  _removeObjectConfigItem(kind, index) {
    const nextConfig = JSON.parse(JSON.stringify(this._config || {}));
    const target = this._objectConfigTarget(nextConfig);
    const key = this._objectConfigArrayKey(kind);
    if (!Array.isArray(target[key]) || !target[key][index]) return;
    target[key].splice(index, 1);
    if (!target[key].length) delete target[key];
    this._commitConfig(nextConfig);
    this._render();
  }

  _handleObjectConfigInput(input) {
    const kind = input.dataset.objectKind;
    const index = Number(input.dataset.itemIndex);
    const key = input.dataset.objectKey;
    const nextConfig = JSON.parse(JSON.stringify(this._config || {}));
    const target = this._objectConfigTarget(nextConfig);
    const list = target[this._objectConfigArrayKey(kind)];
    const item = Array.isArray(list) ? list[index] : null;
    if (!item) return;

    let value = input.value;
    if (input.type === "number") {
      value = value === "" ? null : Number(value);
      if (value !== null && !Number.isFinite(value)) return;
    }
    if (input.dataset.valueType === "json") {
      try {
        value = value.trim() ? JSON.parse(value) : null;
        input.setCustomValidity("");
      } catch (_) {
        input.setCustomValidity("Enter valid JSON.");
        input.reportValidity();
        return;
      }
    }

    let rerender = false;
    if (kind === "interactive" && (key === "tap_action" || key === "hold_action")) {
      item[key] = value === "call-service" ? { action: "call-service", service: "" } : value;
      rerender = true;
    } else if (kind === "interactive" && /^(tap_action|hold_action)\.(service|data)$/.test(key)) {
      const [, actionKey, property] = key.match(/^(tap_action|hold_action)\.(service|data)$/);
      if (!item[actionKey] || typeof item[actionKey] !== "object") item[actionKey] = { action: "call-service", service: "" };
      if (value === null || value === "") delete item[actionKey][property];
      else item[actionKey][property] = value;
    } else if (kind === "interactive" && key.startsWith("state_styles.")) {
      const [, styleIndexText, property] = key.split(".");
      const entries = Object.entries(item.state_styles || {});
      const styleIndex = Number(styleIndexText);
      const [oldState, oldStyle = {}] = entries[styleIndex] || [];
      if (oldState === undefined) return;
      if (property === "state") {
        const nextState = String(value || "").trim();
        if (!nextState) {
          input.setCustomValidity("State is required.");
          input.reportValidity();
          return;
        }
        const rebuilt = {};
        entries.forEach(([state, style], entryIndex) => {
          rebuilt[entryIndex === styleIndex ? nextState : state] = style;
        });
        item.state_styles = rebuilt;
        rerender = true;
      } else {
        const nextStyle = { ...oldStyle };
        if (value === null || value === "") delete nextStyle[property];
        else nextStyle[property] = value;
        item.state_styles[oldState] = nextStyle;
      }
    } else if (value === null || value === "") {
      delete item[key];
    } else {
      item[key] = value;
    }

    this._commitConfig(nextConfig);
    if (rerender) this._render();
  }

  _addStateStyle(index) {
    const nextConfig = JSON.parse(JSON.stringify(this._config || {}));
    const target = this._objectConfigTarget(nextConfig);
    const item = target.interactive_objects?.[index];
    if (!item) return;
    if (!item.state_styles || typeof item.state_styles !== "object") item.state_styles = {};
    let state = "on";
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(item.state_styles, state)) {
      state = `state_${suffix}`;
      suffix += 1;
    }
    item.state_styles[state] = { color: "#81c784" };
    this._commitConfig(nextConfig);
    this._render();
  }

  _removeStateStyle(index, state) {
    const nextConfig = JSON.parse(JSON.stringify(this._config || {}));
    const target = this._objectConfigTarget(nextConfig);
    const item = target.interactive_objects?.[index];
    if (!item?.state_styles || !Object.prototype.hasOwnProperty.call(item.state_styles, state)) return;
    delete item.state_styles[state];
    if (!Object.keys(item.state_styles).length) delete item.state_styles;
    this._commitConfig(nextConfig);
    this._render();
  }

  _handleMarkersYaml(value) {
    try {
      const parsed = this._parseFullYaml(String(value || "").trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const applied = this._applyImportedConfig(parsed);
        if (applied.length) {
          this._markerYamlError = "";
          return;
        }
      }
      const markers = this._parseMarkersYaml(value);
      this._markerYamlError = "";
      this._commitConfig({ ...(this._config || {}), markers });
    } catch (error) {
      this._markerYamlError = error?.message || "Invalid markers YAML.";
      this._render();
    }
  }

  _handleFullConfigYaml(value) {
    this._fullConfigError = "";
    this._fullConfigSuccess = "";
    try {
      const parsed = this._parseFullYaml(String(value || "").trim());
      if (!parsed || typeof parsed !== "object") throw new Error("Could not parse YAML.");

      const applied = this._applyImportedConfig(parsed, {
        beforeCommit: (sections) => {
          this._fullConfigSuccess = `Applied: ${sections.join(", ")}`;
        },
      });
      if (!applied.length) throw new Error("No recognised sections found. Expected markers:, animations:, interactive_objects:, brightness_zones:, etc.");
      this._render();
    } catch (err) {
      this._fullConfigError = err?.message || "Invalid YAML.";
      this._render();
    }
  }

  _applyImportedConfig(parsed, options = {}) {
    const expanded = this._expandDottedYamlKeys(parsed);
    const next = { ...(this._config || {}) };
    const applied = [];
    const directKeys = [
      "title",
      "model",
      "model_background",
      "view_mode",
      "allow_edit",
      "show_labels",
      "show_entity_state",
      "marker_size",
      "nudge_step",
      "marker_tap_action",
      "marker_hold_action",
      "edit_marker_tap_action",
      "edit_marker_hold_action",
      "marker_hold_ms",
      "offline_states",
      "offline_focus_distance",
      "domains",
      "integrations",
      "areas",
      "coordinate_map",
      "model_performance_profile",
      "performance_profile",
      "model_antialias",
      "model_pixel_ratio",
      "three_bundle_urls",
      "three_bundle_url",
      "three_url",
      "gltf_loader_url",
      "gltf_loader_urls",
      "obj_loader_url",
      "obj_loader_urls",
      "orbit_controls_url",
      "orbit_controls_urls",
      "animations",
      "interactive_objects",
    ];

    directKeys.forEach((key) => {
      if (expanded[key] !== undefined) {
        next[key] = expanded[key];
        applied.push(key);
      }
    });

    if (expanded.markers !== undefined) {
      next.markers = Array.isArray(expanded.markers) ? expanded.markers : [];
      applied.push("markers");
    }
    if (expanded.brightness_zones !== undefined) {
      next.brightness_zones = Array.isArray(expanded.brightness_zones) ? expanded.brightness_zones : [];
      applied.push("brightness_zones");
    }
    if (expanded.light_presets !== undefined) {
      next.light_presets = { ...(next.light_presets || {}), ...expanded.light_presets };
      applied.push("light_presets");
    }
    if (expanded.ambient_darkness !== undefined) {
      next.ambient_darkness = expanded.ambient_darkness;
      applied.push("ambient_darkness");
    }
    if (expanded.default_view !== undefined) {
      next.default_view = expanded.default_view;
      applied.push("default_view");
    }
    if (expanded.floors !== undefined) {
      next.floors = Array.isArray(expanded.floors) ? expanded.floors : [];
      applied.push("floors");
    }

    if (applied.length) {
      next.type = next.type || "custom:home-assistant-3d-floorplan";
      this._cleanupEmptyObjects(next);
      this._clearImportedLayoutStorage(this._config || {}, next, applied);
      options.beforeCommit?.(applied, next);
      this._commitConfig(next);
    }

    return applied;
  }

  _clearImportedLayoutStorage(previousConfig, nextConfig, applied) {
    if (typeof localStorage === "undefined") return;
    const sections = new Set(applied);
    const configs = [previousConfig, nextConfig].filter(Boolean);
    const removeKeys = new Set();
    configs.forEach((config) => {
      const hasFloors = Array.isArray(config.floors) && config.floors.length > 0;
      const path = window.location?.pathname || "dashboard";
      const cardKey = config.storage_key || config.title || "home-assistant-3d-floorplan";
      const coordinateSuffixes = ["", this._coordinateStorageSuffixForConfig(config)];
      if (sections.has("markers") || sections.has("floors")) {
        coordinateSuffixes.forEach((suffix) => removeKeys.add(`home-assistant-3d-floorplan:${hasFloors ? "floors" : "markers"}${suffix}:${path}:${cardKey}`));
      }
      if (sections.has("brightness_zones") || sections.has("floors")) {
        coordinateSuffixes.forEach((suffix) => removeKeys.add(`home-assistant-3d-floorplan:brightness-zones${suffix}:${path}:${cardKey}`));
      }
      if (sections.has("default_view") || sections.has("floors")) {
        coordinateSuffixes.forEach((suffix) => removeKeys.add(`home-assistant-3d-floorplan:model-default-view${suffix}:${path}:${cardKey}`));
      }
      if (sections.has("light_presets")) {
        removeKeys.add(`home-assistant-3d-floorplan:light-presets:${path}:${cardKey}`);
      }
    });
    removeKeys.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (_) {
        // Best effort only; config import should still succeed if storage is blocked.
      }
    });
  }

  _coordinateStorageSuffixForConfig(config = {}) {
    const raw = config.coordinate_map || {};
    const defaultMap = { x: "x", y: "y", z: "z" };
    const used = new Set();
    const fallback = { x: "x", y: "y", z: "z" };
    const map = ["x", "y", "z"].reduce((result, axis) => {
      const requestedAxis = raw[axis] || defaultMap[axis];
      const modelAxis = ["x", "y", "z"].includes(requestedAxis) && !used.has(requestedAxis) ? requestedAxis : fallback[axis];
      result[axis] = modelAxis;
      used.add(modelAxis);
      return result;
    }, {});
    const vertical = ["x", "y", "z"].includes(config.vertical_axis) ? config.vertical_axis : "y";
    const signature = `map-${map.x}${map.y}${map.z}-up-${vertical}`;
    return signature === "map-xyz-up-y" ? "" : `:${signature}`;
  }

  /**
   * Simple but complete YAML parser supporting:
   * - Objects (key: value)
   * - Lists (- item)
   * - Nested structures via indentation
   * - Scalars: strings, numbers, booleans, null, quoted strings, inline arrays
   */
  _parseFullYaml(text) {
    const raw = text.split(/\r?\n/);
    // Strip comments and trailing whitespace, keep blank lines for structure
    const lines = raw.map((l) => {
      const noComment = l.replace(/#(?=(?:[^"']*["'][^"']*["'])*[^"']*$).*/, "");
      return noComment.trimEnd();
    });
    const result = this._parseYamlBlock(lines, 0, 0);
    return result.value;
  }

  _expandDottedYamlKeys(value) {
    if (Array.isArray(value)) return value.map((item) => this._expandDottedYamlKeys(item));
    if (!value || typeof value !== "object") return value;
    const result = {};
    Object.entries(value).forEach(([rawKey, rawValue]) => {
      const value = this._expandDottedYamlKeys(rawValue);
      const parts = String(rawKey).split(".");
      let target = result;
      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          if (target[part] && typeof target[part] === "object" && value && typeof value === "object" && !Array.isArray(target[part]) && !Array.isArray(value)) {
            target[part] = { ...target[part], ...value };
          } else {
            target[part] = value;
          }
          return;
        }
        if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) target[part] = {};
        target = target[part];
      });
    });
    return result;
  }

  _parseYamlBlock(lines, startIndex, baseIndent) {
    let index = startIndex;
    // Skip blank lines
    while (index < lines.length && !lines[index].trim()) index++;
    if (index >= lines.length) return { value: null, nextIndex: index };

    const firstLine = lines[index];
    const firstIndent = firstLine.search(/\S/);
    const firstTrimmed = firstLine.trim();

    // Determine if this is a list or object by looking at first non-blank line
    if (firstTrimmed.startsWith("- ") || firstTrimmed === "-") {
      // Parse as list
      const list = [];
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) { index++; continue; }
        const indent = line.search(/\S/);
        if (indent < firstIndent) break; // dedented - parent's turn
        if (indent === firstIndent && line.trim().startsWith("- ")) {
          const rest = line.trim().slice(2).trim();
          if (!rest) {
            // Value is on next lines
            index++;
            const child = this._parseYamlBlock(lines, index, firstIndent + 2);
            list.push(child.value);
            index = child.nextIndex;
          } else if (rest.includes(":") && !rest.startsWith("'") && !rest.startsWith('"')) {
            // Inline key: value - parse as object starting with this key
            const obj = {};
            const colonIdx = rest.indexOf(":");
            const key = rest.slice(0, colonIdx).trim();
            const val = rest.slice(colonIdx + 1).trim();
            if (val) {
              obj[key] = this._parseYamlScalar(val);
              index++;
            } else {
              // Value on next lines
              index++;
              const child = this._parseYamlBlock(lines, index, firstIndent + 2);
              obj[key] = child.value;
              index = child.nextIndex;
            }
            // Continue reading sibling keys at same indent+2
            while (index < lines.length) {
              const nextLine = lines[index];
              if (!nextLine.trim()) { index++; continue; }
              const nextIndent = nextLine.search(/\S/);
              if (nextIndent <= firstIndent) break;
              const nextTrimmed = nextLine.trim();
              if (nextTrimmed.startsWith("- ")) break;
              const ci = nextTrimmed.indexOf(":");
              if (ci < 0) { index++; continue; }
              const k = nextTrimmed.slice(0, ci).trim();
              const v = nextTrimmed.slice(ci + 1).trim();
              if (v) { obj[k] = this._parseYamlScalar(v); index++; }
              else {
                index++;
                const child2 = this._parseYamlBlock(lines, index, nextIndent + 2);
                obj[k] = child2.value;
                index = child2.nextIndex;
              }
            }
            list.push(obj);
          } else {
            list.push(this._parseYamlScalar(rest));
            index++;
          }
        } else {
          break;
        }
      }
      return { value: list, nextIndex: index };
    } else {
      // Parse as object
      const obj = {};
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) { index++; continue; }
        const indent = line.search(/\S/);
        if (indent < firstIndent) break;
        if (indent > firstIndent) { index++; continue; } // shouldn't happen at this level
        const trimmed = line.trim();
        const ci = trimmed.indexOf(":");
        if (ci < 0) { index++; continue; }
        const key = trimmed.slice(0, ci).trim();
        const val = trimmed.slice(ci + 1).trim();
        if (val) { obj[key] = this._parseYamlScalar(val); index++; }
        else {
          index++;
          // Skip blank lines to find child indent
          let peekIdx = index;
          while (peekIdx < lines.length && !lines[peekIdx].trim()) peekIdx++;
          if (peekIdx >= lines.length) { obj[key] = null; continue; }
          const childIndent = lines[peekIdx].search(/\S/);
          if (childIndent <= firstIndent) { obj[key] = null; continue; }
          const child = this._parseYamlBlock(lines, index, childIndent);
          obj[key] = child.value;
          index = child.nextIndex;
        }
      }
      return { value: obj, nextIndex: index };
    }
  }

  _commitConfig(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  _setConfigPath(config, path, value) {
    const parts = path.split(".");
    let target = config;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      const nextPart = parts[index + 1];
      if (target[part] === undefined || target[part] === null || typeof target[part] !== "object") {
        target[part] = /^\d+$/.test(nextPart) ? [] : {};
      }
      target = target[part];
    }
    const finalKey = parts[parts.length - 1];
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) {
      if (Array.isArray(target)) target[Number(finalKey)] = value;
      else delete target[finalKey];
      return;
    }
    target[finalKey] = value;
  }

  _cleanupEmptyObjects(config) {
    if (config.default_view) {
      const position = (config.default_view.position || []).map(Number);
      const target = (config.default_view.target || []).map(Number);
      const zoom = Number(config.default_view.zoom);
      if (position.filter(Number.isFinite).length !== 3 || target.filter(Number.isFinite).length !== 3) {
        delete config.default_view;
      } else {
        config.default_view = {
          position,
          target,
          ...(Number.isFinite(zoom) ? { zoom } : {}),
        };
      }
    }
    if (config.ambient_darkness && typeof config.ambient_darkness === "object" && !config.ambient_darkness.entity) {
      config.ambient_darkness.entity = "sun.sun";
    }
  }

  _actionOptions(type) {
    const options = [
      ["auto", "Auto"],
      ["toggle", "Toggle"],
      ["more-info", "More info"],
      ["navigate", "Navigate"],
      ["none", "None"],
    ];
    return type === "hold" ? [...options, ["move", "Move"], ["select", "Select"]] : options;
  }

  _axisSelect(key, label, fallback) {
    return this._selectInput(key, label, [["x", "X"], ["y", "Y"], ["z", "Z"]], fallback);
  }

  _textInput(key, label, placeholder = "") {
    return this._field(label, `<input data-config-key="${this._escape(key)}" value="${this._escape(this._getConfigPath(key) ?? "")}" placeholder="${this._escape(placeholder)}" />`);
  }

  _numberInput(key, label, fallback = "", min = null, max = null, step = 1) {
    const value = this._getConfigPath(key);
    return this._field(
      label,
      `<input data-config-key="${this._escape(key)}" data-config-type="number" type="number" ${min === null ? "" : `min="${this._escape(min)}"`} ${max === null ? "" : `max="${this._escape(max)}"`} step="${this._escape(step)}" value="${this._escape(value ?? fallback)}" />`
    );
  }

  _listInput(key, label, fallback = []) {
    const value = this._getConfigPath(key);
    return this._field(label, `<input data-config-key="${this._escape(key)}" data-config-type="list" value="${this._escape((Array.isArray(value) ? value : fallback).join(", "))}" />`);
  }

  _checkboxInput(key, label, fallback = false) {
    const value = this._getConfigPath(key);
    return `<label class="checkbox-row"><span>${this._escape(label)}</span><input data-config-key="${this._escape(key)}" data-config-type="checkbox" type="checkbox" ${(value ?? fallback) ? "checked" : ""} /></label>`;
  }

  _selectInput(key, label, options, fallback = "") {
    const value = this._getConfigPath(key) ?? fallback;
    return this._field(
      label,
      `<select data-config-key="${this._escape(key)}">${options.map(([optionValue, optionLabel]) => `<option value="${this._escape(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${this._escape(optionLabel)}</option>`).join("")}</select>`
    );
  }

  _field(label, inputHtml) {
    return `<label><span>${this._escape(label)}</span>${inputHtml}</label>`;
  }

  _getConfigPath(path) {
    if (path === "ambient_darkness_enabled") return this._config.ambient_darkness !== false;
    return path.split(".").reduce((value, part) => (value === undefined || value === null ? undefined : value[part]), this._config);
  }

  _markersToYaml(markers = []) {
    if (!markers.length) return "markers: []";
    const lines = ["markers:"];
    markers.forEach((marker) => {
      lines.push(`  - entity: ${marker.entity || marker.entityId || marker.key || ""}`);
      Object.entries(marker).forEach(([key, value]) => {
        const yamlKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        if (["entity", "entity_id", "entityId"].includes(key) || value === undefined || value === null || value === "") return;
        lines.push(`    ${yamlKey}: ${this._yamlScalar(value)}`);
      });
    });
    return lines.join("\n");
  }

  _parseMarkersYaml(value) {
    const text = String(value || "").trim();
    if (!text || text === "markers: []") return [];
    if (text.startsWith("[")) return JSON.parse(text);
    const parsed = this._parseFullYaml(text);
    if (Array.isArray(parsed)) return this._expandDottedYamlKeys(parsed);
    if (parsed && typeof parsed === "object") {
      const expanded = this._expandDottedYamlKeys(parsed);
      if (Array.isArray(expanded.markers)) return expanded.markers;
      if (expanded.markers === null) return [];
    }
    const lines = text.split(/\r?\n/).map((line) => line.replace(/\t/g, "  ")).filter((line) => line.trim() && !line.trim().startsWith("#"));
    const first = lines[0]?.trim();
    const listLines = first === "markers:" ? lines.slice(1) : lines;
    const markers = [];
    let current = null;
    listLines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) {
        current = {};
        markers.push(current);
        const rest = trimmed.slice(2).trim();
        if (rest) this._assignYamlPair(current, rest);
        return;
      }
      if (!current) throw new Error("Markers YAML must be a list under markers:.");
      this._assignYamlPair(current, trimmed);
    });
    return markers.filter((marker) => marker.entity || marker.key);
  }

  _assignYamlPair(target, line) {
    const index = line.indexOf(":");
    if (index < 0) return;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    target[key] = this._parseYamlScalar(value);
  }

  _parseYamlScalar(value) {
    const text = String(value || "").trim();
    if (text === "true") return true;
    if (text === "false") return false;
    if (text === "null") return null;
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    if (text.startsWith("[") && text.endsWith("]")) return text.slice(1, -1).split(",").map((item) => this._parseYamlScalar(item));
    return text;
  }

  _yamlScalar(value) {
    if (Array.isArray(value)) return `[${value.map((item) => this._yamlScalar(item)).join(", ")}]`;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const text = String(value ?? "");
    return /[:#\[\]{}]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

customElements.define("home-assistant-3d-floorplan-editor", HomeAssistant3DFloorplanEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "home-assistant-3d-floorplan",
  name: "Home Assistant 3D Floorplan",
  description: "Place Home Assistant entities directly on a 3D model.",
});

