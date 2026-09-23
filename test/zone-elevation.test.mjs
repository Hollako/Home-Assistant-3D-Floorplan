import test from "node:test";
import assert from "node:assert/strict";

const defined = new Map();

globalThis.HTMLElement = class {
  attachShadow() { return {}; }
  addEventListener() {}
};
globalThis.customElements = { define: (name, cls) => defined.set(name, cls) };
globalThis.document = { createElement: (tag) => ({ tag }) };
globalThis.window = {
  location: { pathname: "/lovelace/home" },
  addEventListener() {},
  customCards: [],
};

await import("../Home-Assistant-3D-Floorplan.js");
const Card = defined.get("home-assistant-3d-floorplan");

function makeCard(config = {}) {
  const card = Object.create(Card.prototype);
  card._config = config;
  card._activeFloorId = "first";
  card._floorZones = {};
  card._zones = {};
  card._saveZones = () => {};
  card._refreshZoneTools = () => {};
  card._refresh3DZoneOverlay = () => {};
  card.shadowRoot = { querySelector: () => null };
  return card;
}

test("zone points use the configured floor elevation", () => {
  const card = makeCard();
  assert.deepEqual(
    card._zoneDisplayPointToModel({ x: 10, y: 99, z: 20 }, 6.5),
    { x: 10, y: 6.5, z: 20 },
  );
});

test("zone elevation respects a custom coordinate map", () => {
  const card = makeCard({ coordinate_map: { x: "z", y: "x", z: "y" } });
  const point = card._zoneDisplayPointToModel({ x: 10, y: 99, z: 20 }, 6.5);
  assert.deepEqual(point, { z: 10, x: 6.5, y: 20 });
  assert.equal(card._zoneFloorLevel({ elevation: 6.5, points: [point] }), 6.5);
});

test("YAML zones load all polygon points at their elevation", () => {
  const card = makeCard();
  const zones = card._zonesFromList([{
    id: "upstairs",
    elevation: 6,
    height: 3,
    points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 5 }],
  }]);
  assert.equal(zones.upstairs.elevation, 6);
  assert.ok(zones.upstairs.points.every((point) => point.y === 6));
  assert.equal(zones.upstairs.height, 3);
});

test("the first click automatically establishes a new zone elevation", () => {
  const card = makeCard();
  card._zones.upstairs = { id: "upstairs", name: "Upstairs", elevation: null, points: [] };
  card._addZonePoint("upstairs", { x: 2, y: 7.25, z: 3 });
  assert.equal(card._zones.upstairs.elevation, 7.25);
  assert.equal(card._zones.upstairs.points[0].y, 7.25);
});

test("YAML export includes zone elevation separately from height", () => {
  const card = makeCard();
  card._zones = {
    upstairs: {
      id: "upstairs",
      name: "Upstairs",
      color: "#ffffff",
      elevation: 6,
      height: 3,
      points: [{ x: 0, y: 6, z: 0 }, { x: 4, y: 6, z: 0 }, { x: 4, y: 6, z: 5 }],
    },
  };
  const [zone] = card._yamlZonesForFloor("first");
  assert.equal(zone.elevation, "6.0000");
  assert.equal(zone.height, "3.0000");
});

test("zone editor exposes floor elevation", () => {
  const card = makeCard();
  card._zones = {
    upstairs: { id: "upstairs", name: "Upstairs", elevation: 6, height: 3, points: [] },
  };
  card._activeZoneId = "upstairs";
  assert.match(card._zoneToolsTemplate(), /data-zone-elevation="upstairs"/);
});

test("spot and lamp glow offsets are relative to the zone floor", () => {
  const card = makeCard();
  const zone = { elevation: 6, points: [] };
  assert.equal(card._floorGlowTargetLevel(zone, "spot", { floor_glow_offset: 0.8 }), 6.8);
  assert.equal(card._floorGlowTargetLevel(zone, "lamp", { floor_glow_offset: 1.2 }), 7.2);
});

test("glow offsets do not affect cove or linear lights", () => {
  const card = makeCard();
  const zone = { elevation: 6, points: [] };
  assert.equal(card._floorGlowTargetLevel(zone, "cove", { floor_glow_offset: 10 }), 6);
  assert.equal(card._floorGlowTargetLevel(zone, "linear", { floor_glow_offset: 10 }), 6);
});

test("glow surface height is available only for spot and lamp editors", () => {
  const card = makeCard();
  const spot = card._renderParamSliders("light.spot", "spot", card._resolveRenderParams({ lightType: "spot" }), {});
  const lamp = card._renderParamSliders("light.lamp", "lamp", card._resolveRenderParams({ lightType: "lamp" }), {});
  const cove = card._renderParamSliders("light.cove", "cove", card._resolveRenderParams({ lightType: "cove" }), {});
  assert.match(spot, /data-render-param="floor_glow_offset"/);
  assert.match(lamp, /data-render-param="floor_glow_offset"/);
  assert.doesNotMatch(cove, /data-render-param="floor_glow_offset"/);
});

test("glow surface height is preserved in cleaned presets", () => {
  const card = makeCard();
  assert.deepEqual(card._cleanRenderPresetParams({ floor_glow_offset: 0.8, ignored: 1 }), { floor_glow_offset: 0.8 });
});

test("Three.js loading prefers the same-origin bundle", async () => {
  const card = makeCard({
    three_bundle_urls: ["/hacsfiles/card/dist/three.bundle.min.js"],
    three_urls: ["https://cdn.example/three.js"],
  });
  const calls = [];
  const bundle = {
    GLTFLoader: class GLTFLoader {},
    OBJLoader: class OBJLoader {},
    OrbitControls: class OrbitControls {},
  };
  card._threeModules = null;
  card._threeModulesPromise = null;
  card._importModule = async (url) => {
    calls.push(url);
    if (url.startsWith("/hacsfiles/")) return bundle;
    throw new Error("remote import should not run");
  };
  const loaded = await card._loadThreeModules();
  assert.equal(loaded.THREE, bundle);
  assert.deepEqual(calls, ["/hacsfiles/card/dist/three.bundle.min.js"]);
});

test("Three.js loading falls back to configured module URLs", async () => {
  const card = makeCard({
    three_bundle_urls: ["/local/missing-bundle.js"],
    three_urls: ["https://cdn.example/three.js"],
    gltf_loader_urls: ["https://cdn.example/gltf.js"],
    obj_loader_urls: ["https://cdn.example/obj.js"],
    orbit_controls_urls: ["https://cdn.example/orbit.js"],
  });
  const calls = [];
  const modules = {
    "https://cdn.example/three.js": { Scene: class Scene {} },
    "https://cdn.example/gltf.js": { GLTFLoader: class GLTFLoader {} },
    "https://cdn.example/obj.js": { OBJLoader: class OBJLoader {} },
    "https://cdn.example/orbit.js": { OrbitControls: class OrbitControls {} },
  };
  card._threeModules = null;
  card._threeModulesPromise = null;
  card._importModule = async (url) => {
    calls.push(url);
    if (modules[url]) return modules[url];
    throw new Error("not found");
  };
  const loaded = await card._loadThreeModules();
  assert.equal(loaded.THREE, modules["https://cdn.example/three.js"]);
  assert.equal(loaded.GLTFLoader, modules["https://cdn.example/gltf.js"].GLTFLoader);
  assert.ok(calls.includes("/local/missing-bundle.js"));
  assert.ok(calls.includes("https://cdn.example/orbit.js"));
});
