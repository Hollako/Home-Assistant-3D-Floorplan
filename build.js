// Build script: bundles Three.js + loaders + controls into a single browser-ready ES module.
// Run with: node build.js
// Output:   dist/three.bundle.min.js  (copy to HA /local/ alongside the card)

import { build } from "esbuild";
import { mkdirSync } from "fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/three-bundle.js"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "dist/three.bundle.min.js",
  platform: "browser",
  target: ["es2020"],
  logLevel: "info",
});

console.log("Done → dist/three.bundle.min.js");
