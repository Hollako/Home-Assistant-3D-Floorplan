// Build the complete HACS dashboard package.
// Run with: node build.js
// Output:   dist/Home-Assistant-3D-Floorplan.js and dist/three.bundle.min.js

import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

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

copyFileSync("src/Home-Assistant-3D-Floorplan.js", "dist/Home-Assistant-3D-Floorplan.js");

console.log("Done -> dist/Home-Assistant-3D-Floorplan.js");
console.log("Done -> dist/three.bundle.min.js");
