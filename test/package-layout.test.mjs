import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const source = new URL("../src/Home-Assistant-3D-Floorplan.js", import.meta.url);
const card = new URL("../dist/Home-Assistant-3D-Floorplan.js", import.meta.url);
const bundle = new URL("../dist/three.bundle.min.js", import.meta.url);

test("HACS package uses dist for both required JavaScript files", () => {
  const manifest = JSON.parse(readFileSync(new URL("../hacs.json", import.meta.url), "utf8"));
  assert.equal(manifest.filename, "Home-Assistant-3D-Floorplan.js");
  assert.equal(existsSync(new URL(manifest.filename, root)), false);
  assert.equal(existsSync(card), true);
  assert.equal(existsSync(bundle), true);
  assert.equal(readFileSync(card, "utf8"), readFileSync(source, "utf8"));
});
