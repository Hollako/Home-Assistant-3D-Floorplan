// Tests for the `navigate` marker/interactive-object action added on top of
// Hollako/Home-Assistant-3D-Floorplan v2.10.0.
//
// The card ships as a browser ES module with no exports: it defines two custom
// elements as a side effect of import. So we stub just enough DOM to import it,
// capture the class off customElements.define, and exercise methods on bare
// prototypes — no full card construction, no three.js, no renderer.
import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------- DOM stubs
const fired = [];      // events dispatched on window
const pushed = [];     // history.pushState calls
const defined = new Map();

globalThis.HTMLElement = class {
  attachShadow() { return {}; }
  addEventListener() {}
  dispatchEvent() { return true; }
};
globalThis.customElements = { define: (name, cls) => defined.set(name, cls) };
globalThis.document = { createElement: (tag) => ({ tag }) };
// Browsers normalise `location.hash = "x"` to "#x" and fire hashchange only on a
// real change — emulate that so the assertions below mean what they say.
const hashChanges = [];
const location = {
  _hash: "",
  get hash() { return this._hash; },
  set hash(value) {
    const next = value === "" ? "" : value.startsWith("#") ? value : `#${value}`;
    if (next === this._hash) return;
    this._hash = next;
    hashChanges.push(next);
  },
};

globalThis.window = {
  location,
  history: { pushState: (state, title, url) => pushed.push(url) },
  dispatchEvent: (event) => { fired.push(event); return true; },
  addEventListener() {},
  customCards: [],
};

await import("../Home-Assistant-3D-Floorplan.js");
const Card = defined.get("home-assistant-3d-floorplan");
const Editor = defined.get("home-assistant-3d-floorplan-editor");

// ------------------------------------------------------------------ helpers
function makeCard(overrides = {}) {
  const card = Object.create(Card.prototype);
  card._config = {};
  card._markers = {};
  card._serviceCalls = [];
  card._moreInfo = [];
  card._hass = {
    callService: (domain, service, data) => card._serviceCalls.push([domain, service, data]),
  };
  card.dispatchEvent = (event) => { card._moreInfo.push(event); return true; };
  return Object.assign(card, overrides);
}

function reset() {
  fired.length = 0;
  pushed.length = 0;
  hashChanges.length = 0;
  location._hash = "";
}

const locationChanged = () => fired.filter((e) => e.type === "location-changed");

// -------------------------------------------------------------- vocabulary
test("navigate is offered as a tap action", () => {
  const card = makeCard();
  const tap = card._markerActionOptions("tap").map(([value]) => value);
  assert.ok(tap.includes("navigate"), `tap options were ${tap.join(", ")}`);
});

test("navigate is offered as a hold action too", () => {
  const card = makeCard();
  assert.ok(card._markerActionOptions("hold").map(([v]) => v).includes("navigate"));
});

test("navigate survives config normalisation", () => {
  const card = makeCard();
  assert.equal(card._normalizeMarkerAction("navigate", "tap"), "navigate");
  assert.equal(card._normalizeMarkerAction("navigate", "hold"), "navigate");
});

test("unknown actions are still rejected", () => {
  const card = makeCard();
  assert.equal(card._normalizeMarkerAction("launch-missiles", "tap"), "");
});

test("the visual editor dropdown offers navigate", () => {
  const editor = Object.create(Editor.prototype);
  assert.ok(editor._actionOptions("tap").map(([v]) => v).includes("navigate"));
});

// ------------------------------------------------------------- hash targets
test("a hash target sets location.hash and fires location-changed", () => {
  reset();
  const card = makeCard({ _markers: { "light.living": { navigationPath: "#living-room" } } });
  card._runMarkerAction("navigate", { key: "light.living", entityId: "light.living" });
  assert.equal(location.hash, "#living-room");
  assert.deepEqual(hashChanges, ["#living-room"], "exactly one hashchange");
  assert.equal(locationChanged().length, 1);
  assert.equal(pushed.length, 0, "hash targets must not push a history entry");
});

// ------------------------------------------------------------- path targets
test("a dashboard path pushes history and fires location-changed", () => {
  reset();
  const card = makeCard({ _markers: { "light.a": { navigationPath: "/lovelace/house" } } });
  card._runMarkerAction("navigate", { key: "light.a", entityId: "light.a" });
  assert.deepEqual(pushed, ["/lovelace/house"]);
  assert.equal(locationChanged().length, 1);
});

// ------------------------------------------------------------------- guards
test("navigate with no configured path is a no-op, not a crash", () => {
  reset();
  const card = makeCard({ _markers: { "light.a": {} } });
  card._runMarkerAction("navigate", { key: "light.a", entityId: "light.a" });
  assert.equal(locationChanged().length, 0);
  assert.equal(pushed.length, 0);
  assert.equal(location.hash, "");
});

test("_navigate reports whether it navigated", () => {
  reset();
  const card = makeCard();
  assert.equal(card._navigate("   "), false);
  assert.equal(card._navigate("#kitchen"), true);
});

// -------------------------------------------------- existing actions intact
test("toggle still calls homeassistant.toggle", () => {
  reset();
  const card = makeCard();
  card._runMarkerAction("toggle", { key: "light.a", entityId: "light.a" });
  assert.deepEqual(card._serviceCalls, [["homeassistant", "toggle", { entity_id: "light.a" }]]);
  assert.equal(locationChanged().length, 0);
});

test("more-info still fires hass-more-info", () => {
  reset();
  const card = makeCard();
  card._runMarkerAction("more-info", { key: "s.a", entityId: "sensor.a" });
  assert.equal(card._moreInfo.length, 1);
  assert.equal(card._moreInfo[0].type, "hass-more-info");
  assert.deepEqual(card._moreInfo[0].detail, { entityId: "sensor.a" });
});

test("none still does nothing", () => {
  reset();
  const card = makeCard();
  card._runMarkerAction("none", { key: "light.a", entityId: "light.a" });
  assert.equal(card._serviceCalls.length, 0);
  assert.equal(card._moreInfo.length, 0);
  assert.equal(locationChanged().length, 0);
});

// ------------------------------------------------- interactive mesh objects
test("clickable meshes navigate via the third argument", () => {
  reset();
  const card = makeCard();
  card._runInteractiveObjectAction("navigate", "light.a", "#media-room");
  assert.equal(location.hash, "#media-room");
});

test("clickable meshes navigate via the object form", () => {
  reset();
  const card = makeCard();
  card._runInteractiveObjectAction({ action: "navigate", navigation_path: "#basement" }, "light.a");
  assert.equal(location.hash, "#basement");
});

test("mesh call-service is untouched", () => {
  reset();
  const card = makeCard();
  card._runInteractiveObjectAction(
    { action: "call-service", service: "script.movie_night", data: { x: 1 } },
    "light.a",
  );
  assert.deepEqual(card._serviceCalls, [["script", "movie_night", { entity_id: "light.a", x: 1 }]]);
});

// ------------------------------------------------------- config round-trip
test("navigation_path is read from YAML config (snake_case)", () => {
  const card = makeCard();
  const parsed = card._normalizedMarkers({
    "light.kitchen": { entityId: "light.kitchen", x: 1, y: 2, z: 3, navigation_path: "#kitchen" },
  });
  assert.equal(parsed["light.kitchen"].navigationPath, "#kitchen");
});

test("navigation_path is written back out to YAML", () => {
  const card = makeCard({
    _activeFloorId: "ground",
    _floorMarkers: {},
    _markers: {
      "light.kitchen": { entityId: "light.kitchen", x: 1, y: 2, navigationPath: "#kitchen" },
    },
  });
  const rows = new Map([["light.kitchen", { key: "light.kitchen", entityId: "light.kitchen", name: "Kitchen", primaryDomain: "light" }]]);
  const [exported] = card._yamlMarkersForFloor("ground", rows);
  assert.equal(exported.navigationPath, "#kitchen");
});

test("re-tapping the same marker fires no second hashchange (known Bubble caveat)", () => {
  reset();
  const card = makeCard({ _markers: { "light.a": { navigationPath: "#kitchen" } } });
  const row = { key: "light.a", entityId: "light.a" };
  card._runMarkerAction("navigate", row);
  card._runMarkerAction("navigate", row);
  assert.deepEqual(hashChanges, ["#kitchen"], "browser suppresses the repeat hashchange");
  assert.equal(locationChanged().length, 2, "but location-changed still fires each tap");
});
