const VERSION = "2.0.0";
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
    this._pendingDeviceKey = null;
    this._dragMarkerKey = null;
    this._selectionBox = null;
    this._selectionBoxElement = null;
    this._pendingMarkerFocus = null;
    this._offlineFocusedMarkers = new Map();
    this._history = {};
    this._historyLimit = 30;
    this._modelViewer = null;
    this._modelRenderToken = 0;
    this._modelCameraState = null;
    this._modelDefaultViews = {};
    this._modelViewAnimation = 0;
    this._threeModules = null;
    this._threeModulesPromise = null;
    this._boundKeydown = (event) => this._handleKeydown(event);
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
      coordinate_map: { x: "z", y: "x", z: "y" },
      vertical_axis: "z",
      model_background: "",
      ambient_darkness: {
        entity: "sun.sun",
        day_opacity: 0.5,
        night_opacity: 1,
      },
      three_url: "https://esm.sh/three@0.165.0",
      gltf_loader_url: "https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js",
      obj_loader_url: "https://esm.sh/three@0.165.0/examples/jsm/loaders/OBJLoader.js",
      orbit_controls_url: "https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js",
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
    window.addEventListener("keydown", this._boundKeydown);
    this._queueModelViewerRecovery();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._boundKeydown);
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
    if (!(this._canEdit() && this._mode === "edit")) return;
    const active = this.shadowRoot?.activeElement || document.activeElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(active?.tagName)) return;
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
    }
    this._selectedMarkers.clear();
    this._saveMarkers();
    this._render();
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
        lightIntensity: this._normalizeLightIntensity(marker.light_intensity ?? marker.lightIntensity),
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
        lightIntensity: this._normalizeLightIntensity(marker.lightIntensity ?? marker.light_intensity),
        x: is3DMarker ? x : Math.max(0, Math.min(100, x)),
        y: is3DMarker ? y : Math.max(0, Math.min(100, y)),
        ...(is3DMarker ? { z } : {}),
      };
      return result;
    }, {});
  }

  _storageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:${this._hasMultipleFloors() ? "floors" : "markers"}:${path}:${cardKey}`;
  }

  _zonesStorageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:brightness-zones:${path}:${cardKey}`;
  }

  _displayStorageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:display:${path}:${cardKey}`;
  }

  _modelDefaultViewStorageKey() {
    const path = window.location?.pathname || "dashboard";
    const cardKey = this._config.storage_key || this._config.title || "home-assistant-3d-floorplan";
    return `home-assistant-3d-floorplan:model-default-view:${path}:${cardKey}`;
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
        points: (zone.points || []).map((point) => this._zoneDisplayPointToModel(point)),
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
        result[floor.id] = this._normalizedMarkers({
          ...result[floor.id],
          ...(savedByFloor[floor.id] || {}),
        });
      }
      return result;
    }

    const floorId = this._floors[0]?.id || "default";
    result[floorId] = this._normalizedMarkers({
      ...(result[floorId] || {}),
      ...(this._looksLikeFloorMarkers(savedMarkers) ? savedMarkers[floorId] || {} : savedMarkers || {}),
    });
    return result;
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
      const displayPoint = "z" in firstPoint ? firstPoint : this._modelToDisplayPoint(firstPoint);
      const height = Number(displayPoint.z);
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
    return this._displayToModelPoint({
      x: Number(point?.x),
      y: Number(point?.y),
      z: 0,
    });
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
              ${this._modelCompassTemplate(isEditing)}
              ${isEditing ? `<div class="selected-marker-panel" data-selected-marker-panel>${this._selectedMarkerPanel()}</div>` : ""}
              <div class="model-status" data-model-status>${isEditing ? "Select an entity, then click the 3D model to place it." : "Loading 3D model..."}</div>
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
          const badge = row.querySelector(".placed");
          if (badge && !row.classList.contains("is-placed")) badge.textContent = row.dataset.device === this._pendingDeviceKey ? "Click model" : "Select";
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
        this._saveMarkers();
        this._refresh3DMarkerOverlay();
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
      ${this._zoneShadeTemplate(activeZone)}
      <div class="zone-actions">
        <button type="button" data-zone-draw="${this._escape(activeZone.id)}">${this._zoneDrawing && this._activeZoneId === activeZone.id ? "Stop Drawing" : "Draw"}</button>
        <button type="button" data-zone-clear="${this._escape(activeZone.id)}">Clear Points</button>
        <button type="button" data-zone-remove="${this._escape(activeZone.id)}">Remove</button>
      </div>
      <small>${this._escape(activeZone.points.length)} point${activeZone.points.length === 1 ? "" : "s"}${this._zoneDrawing && this._activeZoneId === activeZone.id ? " - top view is locked; clicks save X/Y only." : ""}</small>
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
          <input data-zone-illuminance-entity="${this._escape(zone.id)}" value="${this._escape(zone.illuminanceEntity || "")}" placeholder="sensor.room_illuminance" ${illuminanceEnabled ? "" : "disabled"} />
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
          ${["x", "y"]
            .map((axis) => `
          <label>
            <span>${axis.toUpperCase()}</span>
            <input data-zone-point-coordinate="${axis}" data-zone-point-key="${this._escape(zone.id)}" data-zone-point-index="${selectedIndex}" type="number" step="0.01" value="${this._escape(this._formatCoordinate(selectedPoint[axis]))}" />
          </label>
          `)
            .join("")}
        </div>
        <div class="zone-point-list">
          ${(zone.points || [])
            .map((point, index) => {
              const displayPoint = this._modelToDisplayPoint(point);
              return `
          <button type="button" data-zone-point-select="${this._escape(zone.id)}" data-zone-point-index="${index}" class="${index === selectedIndex ? "active" : ""}">
            ${index + 1}. X ${this._escape(this._formatCoordinate(displayPoint.x))} / Y ${this._escape(this._formatCoordinate(displayPoint.y))}
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
    if (!zone || !zone.points[index] || !["x", "y"].includes(axis)) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const displayPoint = this._modelToDisplayPoint(zone.points[index]);
    displayPoint[axis] = Number(number.toFixed(4));
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
    template.innerHTML = this._modelCompassTemplate(this._canEdit() && this._mode === "edit").trim();
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
                <button type="button" class="edit-marker" data-edit-marker="${this._escape(row.key)}" title="Move marker">Move</button>
                <button type="button" class="remove" data-remove="${this._escape(row.key)}" title="Remove from map">Remove</button>
              </div>`
            : `<span class="placed">${this._pendingDeviceKey === row.key ? "Click model" : "Select"}</span>`
        }
        ${placed ? this._iconSelect(row) : ""}
        ${placed ? this._markerDisplayEditor(row) : ""}
        ${placed ? this._actionEditor(row) : ""}
        ${placed ? this._lightIntensityEditor(row) : ""}
        ${placed ? this._coordinateEditor(row) : ""}
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
    return `
      <label class="light-intensity-editor">
        <span>Light intensity</span>
        <input data-light-intensity="${this._escape(row.key)}" type="number" min="0" max="100" step="1" value="${this._escape(intensity)}" />
        <small>%</small>
      </label>
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
          <span>${axis.toUpperCase()}</span>
          <input data-coordinate="${axis}" data-coordinate-key="${this._escape(row.key)}" type="number" step="0.01" value="${this._escape(this._formatCoordinate(displayPoint[axis]))}" />
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

  _coordinateMap() {
    const raw = this._config.coordinate_map || {};
    const defaultMap = { x: "z", y: "x", z: "y" };
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
        <button type="button" data-edit-marker="${this._escape(key)}">Move</button>
      </div>
      ${row ? this._actionEditor(row) : ""}
      ${row ? this._markerDisplayEditor(row) : ""}
      ${row ? this._lightIntensityEditor(row) : ""}
      <div class="coordinate-editor selected-coordinates">
        ${["x", "y", "z"]
          .map(
            (axis) => `
        <label>
          <span>${axis.toUpperCase()}</span>
          <input data-coordinate="${axis}" data-coordinate-key="${this._escape(key)}" type="number" step="0.01" value="${this._escape(this._formatCoordinate(displayPoint[axis]))}" />
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

    rowElement.querySelectorAll("[data-coordinate]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => event.stopPropagation());
      element.addEventListener("change", (event) => {
        this._update3DMarkerCoordinate(event.currentTarget.dataset.coordinateKey, event.currentTarget.dataset.coordinate, event.currentTarget.value);
      });
      element.addEventListener("input", (event) => {
        this._update3DMarkerCoordinate(event.currentTarget.dataset.coordinateKey, event.currentTarget.dataset.coordinate, event.currentTarget.value, { skipHistory: true, skipSave: true, skipPanelRefresh: true });
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

  _markerTemplate(row, isEditing) {
    const marker = this._markers[row.key];
    const size = this._display.markerSize;
    const content = this._markerFace(row);
    const stateClass = this._stateClass(row);
    const title = this._config.show_entity_state ? `${row.name} - ${row.primaryState}` : row.name;
    return `
      <button
        class="marker ${this._display.showLabels ? "with-label" : "icon-only"} ${content.type === "value" ? "value-marker" : ""} ${this._config.show_entity_state ? "state-mode" : ""} ${stateClass} ${isEditing && this._selectedMarkers.has(row.key) ? "selected" : ""} ${row.offline ? "offline" : "online"}"
        style="left: ${this._escape(marker.x)}%; top: ${this._escape(marker.y)}%; --marker-size: ${this._escape(size)}px;"
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

  _modelCompassTemplate(isEditing) {
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
          ${isEditing ? `<button type="button" data-model-default-view="save" title="Save current camera as home startup view">Save Home</button>` : ""}
          ${isEditing ? `<button type="button" data-model-default-view="clear" title="Clear saved startup view" ${hasDefaultView ? "" : "disabled"}>Clear</button>` : ""}
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
    const ambientLines = this._yamlAmbientDarkness();
    const defaultViewLines = this._yamlDefaultView(this._modelDefaultViews?.[this._activeFloorId || "default"], "");
    if (this._hasMultipleFloors()) {
      return [
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
                    ...(marker.lightIntensity !== "" ? [`        light_intensity: ${marker.lightIntensity}`] : []),
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
                    ...(zone.illuminanceEnabled ? [`        illuminance_enabled: true`, ...(zone.illuminanceEntity ? [`        illuminance_entity: ${zone.illuminanceEntity}`] : [])] : []),
                    ...(zone.showLux ? [`        show_lux: true`] : []),
                    "        points:",
                    ...zone.points.flatMap((point) => [
                      `          - x: ${point.x}`,
                      `            y: ${point.y}`,
                    ]),
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
              ...(marker.lightIntensity !== "" ? [`    light_intensity: ${marker.lightIntensity}`] : []),
              `    x: ${marker.x}`,
              `    y: ${marker.y}`,
              ...(marker.z !== "" ? [`    z: ${marker.z}`] : []),
            ]),
          ]
        : ["markers: []"]),
      ...ambientLines,
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
              ...(zone.illuminanceEnabled ? [`    illuminance_enabled: true`, ...(zone.illuminanceEntity ? [`    illuminance_entity: ${zone.illuminanceEntity}`] : [])] : []),
              ...(zone.showLux ? [`    show_lux: true`] : []),
              "    points:",
              ...zone.points.flatMap((point) => [
                `      - x: ${point.x}`,
                `        y: ${point.y}`,
              ]),
            ]),
          ]
        : []),
    ].join("\n");
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
          lightIntensity: row?.primaryDomain === "light" || hasCustomLightIntensity ? this._normalizeLightIntensity(marker.lightIntensity) : "",
          x: Number(displayPoint.x).toFixed(4),
          y: Number(displayPoint.y).toFixed(4),
          z: Number.isFinite(Number(displayPoint.z)) ? Number(displayPoint.z).toFixed(4) : "",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _yamlAmbientDarkness() {
    if (this._config.ambient_darkness === false) return ["ambient_darkness: false"];
    const ambient = this._ambientDarknessConfig();
    return [
      "ambient_darkness:",
      ...(ambient.entity ? [`  entity: ${ambient.entity}`] : []),
    ];
  }

  _yamlZonesForFloor(floorId) {
    const floorZones = floorId === this._activeFloorId ? this._zones : this._floorZones[floorId] || {};
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
        points: (zone.points || []).map((point) => {
          const displayPoint = this._modelToDisplayPoint(point);
          return {
            x: Number(displayPoint.x).toFixed(4),
            y: Number(displayPoint.y).toFixed(4),
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

    this._threeModulesPromise = Promise.all([
      this._importFirst(this._asList(this._config.three_urls).concat(this._config.three_url), "Three.js"),
      this._importFirst(this._asList(this._config.gltf_loader_urls).concat(this._config.gltf_loader_url), "GLTFLoader"),
      this._importFirst(this._asList(this._config.obj_loader_urls).concat(this._config.obj_loader_url), "OBJLoader"),
      this._importFirst(this._asList(this._config.orbit_controls_urls).concat(this._config.orbit_controls_url), "OrbitControls"),
    ]).then(([THREE, gltfModule, objModule, controlsModule]) => {
      this._threeModules = {
        THREE,
        GLTFLoader: gltfModule.GLTFLoader,
        OBJLoader: objModule.OBJLoader,
        OrbitControls: controlsModule.OrbitControls,
      };
      return this._threeModules;
    });

    return this._threeModulesPromise;
  }

  async _renderModelViewer(modelUrl) {
    const container = this.shadowRoot?.querySelector("[data-model-viewer]");
    const status = this.shadowRoot?.querySelector("[data-model-status]");
    if (!container || !modelUrl) return;
    const renderToken = ++this._modelRenderToken;

    try {
      if (!window.WebGLRenderingContext) {
        throw new Error("WebGL is not available in this browser or WebView.");
      }
      const { THREE, GLTFLoader, OBJLoader, OrbitControls } = await this._loadThreeModules();
      if (renderToken !== this._modelRenderToken || !this.shadowRoot?.contains(container)) return;

      status.textContent = "Loading 3D model...";
      const scene = new THREE.Scene();
      const background = this._config.model_background || getComputedStyle(this).getPropertyValue("--card-background-color") || "#111827";
      scene.background = new THREE.Color(String(background).trim() || "#111827");

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.touchAction = "none";
      renderer.domElement.style.userSelect = "none";
      renderer.domElement.style.webkitUserSelect = "none";
      renderer.domElement.style.webkitTouchCallout = "none";
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

      const model = await this._loadModelObject(modelUrl, { THREE, GLTFLoader, OBJLoader });
      if (renderToken !== this._modelRenderToken || !this.shadowRoot?.contains(container)) {
        renderer.dispose?.();
        renderer.domElement?.remove?.();
        return;
      }
      if (!model) throw new Error("Model file loaded but did not contain a scene.");

      scene.add(model);
      const zoneGroup = new THREE.Group();
      zoneGroup.renderOrder = 1;
      scene.add(zoneGroup);
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

      const markerLayer = container.querySelector("[data-model-marker-layer]");
      const markerButtons = this._build3DMarkerButtons(markerLayer, THREE, camera);
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let pointerStart = null;
      const pickableObjects = [];
      model.traverse((object) => {
        if (object.isMesh) pickableObjects.push(object);
      });

      renderer.domElement.addEventListener("pointerdown", (event) => {
        pointerStart = { x: event.clientX, y: event.clientY };
      });

      renderer.domElement.addEventListener("pointerup", (event) => {
        if (this._mode !== "edit" || (!this._pendingDeviceKey && !(this._zoneDrawing && this._activeZoneId))) return;
        if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pickableObjects, true)[0];
        if (!hit) return;
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
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();
      requestAnimationFrame(resize);
      window.setTimeout(resize, 250);

      let disposed = false;
      const animate = () => {
        if (disposed || renderToken !== this._modelRenderToken) return;
        resize();
        controls.update();
        this._captureModelCameraState();
        this._update3DMarkerButtons(this._modelViewer?.markerButtons || markerButtons, THREE, camera, container);
        this._update3DZoneLabels(this._modelViewer?.zoneLabels || [], THREE, camera, container);
        this._update3DZonePointButtons(this._modelViewer?.zonePointButtons, THREE, camera, container);
        renderer.render(scene, camera);
        this._modelViewer.animationFrame = requestAnimationFrame(animate);
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
        offlineFocusDistance,
        animationFrame: 0,
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
    return this._modelMarkerRows().map(({ row, marker }) => {
      const button = document.createElement("button");
      button.type = "button";
      const stateClass = this._stateClass(row);
      const content = this._markerFace(row);
      button.className = `model-marker ${this._display.showLabels ? "with-label" : "icon-only"} ${content.type === "value" ? "value-marker" : ""} ${stateClass} ${row.offline ? "offline" : "online"}`;
      button.dataset.marker = row.key;
      button.dataset.entity = row.entityId;
      button.title = `${row.name} - ${row.primaryState}`;
      button.style.setProperty("--marker-size", `${this._display.markerSize}px`);
      button.innerHTML = `
        <span class="${content.type === "value" ? "value-face" : ""}">${content.type === "value" ? this._escape(content.value) : `<ha-icon icon="${this._escape(content.icon)}"></ha-icon>`}</span>
        ${this._display.showLabels ? `<strong>${this._escape(row.name)}</strong>` : ""}
      `;
      this._attachMarkerPressActions(button, row);
      markerLayer.appendChild(button);
      return {
        button,
        position: new THREE.Vector3(marker.x, marker.y, marker.z),
      };
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
    if (normalizedAction === "select") {
      this._selectedMarkers.clear();
      this._selectedMarkers.add(row.key);
      this._pendingDeviceKey = null;
      this._highlightSelectedDeviceRow(row.key);
      this._refreshSelectedMarkerPanel();
      return;
    }
    if (normalizedAction === "move") {
      this._startMarkerMove(row.key);
    }
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

  _refresh3DMarkerOverlay() {
    if (!this._modelViewer?.container || !this._modelViewer?.THREE || !this._modelViewer?.camera) return;
    const markerLayer = this._modelViewer.container.querySelector("[data-model-marker-layer]");
    this._modelViewer.markerButtons = this._build3DMarkerButtons(markerLayer, this._modelViewer.THREE, this._modelViewer.camera);
    this._refresh3DZoneOverlay();
    this._updateDeviceRowsAfterMarkerChange();
    this._refreshOfflineAlert();
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
    while (zoneGroup.children.length) {
      const child = zoneGroup.children.pop();
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach((material) => {
        material.map?.dispose?.();
        material.dispose?.();
      });
    }

    const rowByKey = new Map(this._deviceRows().map((row) => [row.key, row]));
    for (const zone of Object.values(this._zones || {})) {
      if ((zone.points || []).length < 3) continue;
      const lighting = this._zoneLighting(zone, rowByKey);
      const brightness = lighting.brightness;
      const darkness = this._zoneDarkness(brightness, zone);
      const floorOpacity = this._mode === "edit" ? Math.max(0.1, brightness * 0.45) : brightness * 0.38;
      const floorShadeOpacity = darkness * 0.32;
      const wallShade = this._zoneWallShadeMeshes(THREE, zone, darkness);
      wallShade.forEach((wall) => zoneGroup.add(wall));
      if (floorShadeOpacity > 0.01) {
        const floorShade = this._zoneMesh(THREE, zone, floorShadeOpacity, "#020617", { renderOrder: 1.9, floorLift: 0.045 });
        if (floorShade) zoneGroup.add(floorShade);
      }
      const midShade = this._zoneMidShadeMesh(THREE, zone, darkness);
      if (midShade) zoneGroup.add(midShade);
      if (floorOpacity > 0.01) {
        const mesh = this._zoneMesh(THREE, zone, floorOpacity, lighting.color, { floorLift: 0.045 });
        if (mesh) zoneGroup.add(mesh);
      }
      const wallWash = brightness > 0.01 ? this._zoneWallWashMeshes(THREE, zone, brightness, lighting.color) : [];
      wallWash.forEach((wall) => zoneGroup.add(wall));
      const outline = this._zoneOutline(THREE, zone);
      if (outline) zoneGroup.add(outline);
    }
    this._refresh3DZoneLabels();
    this._refresh3DZonePointOverlay();
  }

  _zoneMesh(THREE, zone, opacity, color = zone.color || "#f8d66d", options = {}) {
    const points = this._offsetZonePoints(zone.points, options.floorLift);
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
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = options.renderOrder || 2;
    return mesh;
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
    const modelHeight = this._displayToModelVector({ x: 0, y: 0, z: displayHeight });
    const heightVector = new THREE.Vector3(modelHeight.x, modelHeight.y, modelHeight.z);
    if (!heightVector.length()) return [];
    const colorValue = color || zone.color || "#f8d66d";
    const opacity = Math.max(0.08, Math.min(0.55, brightness * 0.48));
    return basePoints.map((start, index) => {
      const end = basePoints[(index + 1) % basePoints.length];
      const bottomStart = new THREE.Vector3(start.x, start.y, start.z);
      const bottomEnd = new THREE.Vector3(end.x, end.y, end.z);
      const topStart = bottomStart.clone().add(heightVector);
      const topEnd = bottomEnd.clone().add(heightVector);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          bottomStart.x, bottomStart.y, bottomStart.z,
          bottomEnd.x, bottomEnd.y, bottomEnd.z,
          topEnd.x, topEnd.y, topEnd.z,
          bottomStart.x, bottomStart.y, bottomStart.z,
          topEnd.x, topEnd.y, topEnd.z,
          topStart.x, topStart.y, topStart.z,
        ], 3)
      );
      geometry.computeVertexNormals();
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
      return mesh;
    });
  }

  _zoneWallShadeMeshes(THREE, zone, darkness) {
    const opacity = Math.max(0, Math.min(0.62, darkness * 0.8));
    if (opacity <= 0.01) return [];
    const basePoints = this._offsetZonePoints(zone.points);
    if (basePoints.length < 2) return [];
    const displayHeight = Math.max(0.01, Math.abs(this._zoneHeight(zone)));
    const modelHeight = this._displayToModelVector({ x: 0, y: 0, z: displayHeight });
    const heightVector = new THREE.Vector3(modelHeight.x, modelHeight.y, modelHeight.z);
    if (!heightVector.length()) return [];
    return basePoints.map((start, index) => {
      const end = basePoints[(index + 1) % basePoints.length];
      const bottomStart = new THREE.Vector3(start.x, start.y, start.z);
      const bottomEnd = new THREE.Vector3(end.x, end.y, end.z);
      const topStart = bottomStart.clone().add(heightVector);
      const topEnd = bottomEnd.clone().add(heightVector);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          bottomStart.x, bottomStart.y, bottomStart.z,
          topEnd.x, topEnd.y, topEnd.z,
          bottomEnd.x, bottomEnd.y, bottomEnd.z,
          bottomStart.x, bottomStart.y, bottomStart.z,
          topStart.x, topStart.y, topStart.z,
          topEnd.x, topEnd.y, topEnd.z,
        ], 3)
      );
      geometry.computeVertexNormals();
      const material = new THREE.MeshBasicMaterial({
        color: "#020617",
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 2.2;
      return mesh;
    });
  }

  _zoneMidShadeMesh(THREE, zone, darkness) {
    const opacity = Math.max(0, Math.min(0.5, darkness * 0.55));
    if (opacity <= 0.01) return null;
    const displayHeight = Math.max(0.01, Math.abs(this._zoneHeight(zone)));
    const shadeHeight = Math.max(0, Math.min(displayHeight, this._zoneShadeHeight(zone)));
    const offset = this._displayToModelVector({ x: 0, y: 0, z: shadeHeight });
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
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
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
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
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

  _displayToModelVector(vector) {
    const origin = this._displayToModelPoint({ x: 0, y: 0, z: 0 });
    const target = this._displayToModelPoint(vector);
    return {
      x: Number(target.x) - Number(origin.x),
      y: Number(target.y) - Number(origin.y),
      z: Number(target.z) - Number(origin.z),
    };
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
    return { brightness, color: dominant?.color || zone.color || "#f8d66d" };
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
    return ["x", "y", "z"].includes(this._config.vertical_axis) ? this._config.vertical_axis : "z";
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
    this._markers[key][modelAxis] = Number(number.toFixed(4));
    if (!options.skipSave) this._saveMarkers();
    this._refresh3DMarkerOverlay();
    if (!options.skipPanelRefresh) this._refreshSelectedMarkerPanel();
    const row = this.shadowRoot?.querySelector(`[data-device="${this._cssEscape(key)}"]`);
    const input = row?.querySelector(`[data-coordinate="${axis}"]`);
    if (input && document.activeElement !== input) input.value = this._formatCoordinate(number);
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

  _update3DMarkerButtons(markerButtons, THREE, camera, container) {
    if (!markerButtons?.length) return;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
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
      x: Number(modelPoint.x.toFixed(4)),
      y: Number(modelPoint.y.toFixed(4)),
      z: Number(modelPoint.z.toFixed(4)),
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
      lightIntensity: this._normalizeLightIntensity(existingMarker?.lightIntensity),
      x: Number(finalPoint.x.toFixed(4)),
      y: Number(finalPoint.y.toFixed(4)),
      z: Number(finalPoint.z.toFixed(4)),
    };
    this._pendingDeviceKey = null;
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

  _fitCameraToObject(THREE, camera, controls, object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const distance = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));

    controls.target.copy(center);
    camera.position.set(center.x + distance * 0.85, center.y + distance * 0.75, center.z + distance * 1.25);
    camera.near = Math.max(0.01, distance / 100);
    camera.far = Math.max(1000, distance * 100);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.update();
  }

  _disposeModelViewer() {
    this._modelRenderToken += 1;
    if (!this._modelViewer) return;
    const { scene, renderer, controls, resizeObserver, animationFrame, dispose } = this._modelViewer;
    this._captureModelCameraState();
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
          grid-template-rows: auto auto;
          row-gap: 8px;
          min-height: 84px;
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

        .coordinate-editor {
          grid-column: 1 / 4;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
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

        .placed, .remove, .edit-marker {
          border: 1px solid var(--dmp-border);
          border-radius: 999px;
          padding: 3px 7px;
        }

        .remove, .edit-marker {
          background: transparent;
          color: var(--dmp-muted);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
        }

        .remove:hover {
          color: var(--dmp-bad);
          border-color: var(--dmp-bad);
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

        .model-viewer canvas {
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
          align-items: center;
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
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
          align-items: center;
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
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
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
          <h3>Coordinates</h3>
          <div class="editor-grid">
            ${this._axisSelect("coordinate_map.x", "Display X Uses Model Axis", "z")}
            ${this._axisSelect("coordinate_map.y", "Display Y Uses Model Axis", "x")}
            ${this._axisSelect("coordinate_map.z", "Display Z Uses Model Axis", "y")}
            ${this._axisSelect("vertical_axis", "Vertical Axis", "z")}
          </div>
        </section>

        <section>
          <h3>Ambient Darkness</h3>
          <div class="editor-grid">
            ${this._checkboxInput("ambient_darkness_enabled", "Enable Ambient Darkness", this._config.ambient_darkness !== false)}
            ${this._textInput("ambient_darkness.entity", "Sun Entity", "sun.sun")}
          </div>
        </section>

        <section>
          <h3>Markers YAML</h3>
          <div class="editor-help">Paste only the exported markers block here. Example: <code>markers:</code> followed by the marker list.</div>
          <textarea data-markers-yaml spellcheck="false">${this._escape(this._markersToYaml(this._config.markers || []))}</textarea>
          ${this._markerYamlError ? `<div class="editor-error">${this._escape(this._markerYamlError)}</div>` : ""}
        </section>
      </div>
    `;
    this._attachEditorEvents();
  }

  _attachEditorEvents() {
    this.querySelectorAll("[data-config-key]").forEach((element) => {
      const eventName = element.type === "checkbox" ? "change" : "change";
      element.addEventListener(eventName, (event) => this._handleConfigInput(event.currentTarget));
    });
    this.querySelector("[data-markers-yaml]")?.addEventListener("change", (event) => this._handleMarkersYaml(event.currentTarget.value));
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

  _handleMarkersYaml(value) {
    try {
      const markers = this._parseMarkersYaml(value);
      this._markerYamlError = "";
      this._commitConfig({ ...(this._config || {}), markers });
    } catch (error) {
      this._markerYamlError = error?.message || "Invalid markers YAML.";
      this._render();
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

