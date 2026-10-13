// Bundle the converter worker into ONE Node 22 ESM file: converter/dist/worker.mjs
// (+ worker.mjs.sha256). esbuild comes with vite (a devDependency); nothing is added.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, "dist", "worker.mjs");

await build({
  entryPoints: [path.join(here, "src", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: false,
  legalComments: "inline",
  // Some bundled CommonJS may call require(); give ESM one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});

const sum = createHash("sha256").update(readFileSync(outfile)).digest("hex");
writeFileSync(`${outfile}.sha256`, `${sum}  worker.mjs\n`);
console.log(`converter: ${path.relative(process.cwd(), outfile)} sha256 ${sum}`);
