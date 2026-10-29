#!/usr/bin/env node
/**
 * Copies this repository's own Capacitor plugins into the GENERATED Android
 * project (android/ is not committed; `npx cap add android` makes it in CI)
 * and registers them in MainActivity.
 *
 *   node scripts/android-native-plugins.mjs android
 *
 * Today: ExitInfoPlugin (S2 native crash / OOM / ANR reasons).
 *
 * Guarded, not a blind sed: MainActivity must be EXACTLY Capacitor's template
 * (`public class MainActivity extends BridgeActivity {}`) or already carry our
 * registration. Anything else stops the build with a message, because a
 * plugin that is copied but not registered is undefined at runtime with every
 * test green (known trap #11).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_DIR = "app/src/main/java/com/fiftymmretina/app";
export const PLUGINS = ["ExitInfoPlugin"];
const SOURCE_DIR = path.join(HERE, "..", "resources", "android", "java", "com", "fiftymmretina", "app");

const TEMPLATE_BODY = /public class MainActivity extends BridgeActivity \{\s*\}/;

export function registeredMainActivity(pkg, plugins) {
  const regs = plugins.map((p) => `        registerPlugin(${p}.class);`).join("\n");
  return `package ${pkg};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered BEFORE super.onCreate builds the bridge.
${regs}
        super.onCreate(savedInstanceState);
    }
}
`;
}

/** Returns a list of what it did; throws with a reason when the project is not what it expects. */
export function installNativePlugins(androidDir, { sourceDir = SOURCE_DIR, plugins = PLUGINS } = {}) {
  const done = [];
  const pkgDir = path.join(androidDir, PACKAGE_DIR);
  const mainPath = path.join(pkgDir, "MainActivity.java");
  if (!fs.existsSync(mainPath)) {
    throw new Error(`${mainPath} not found — did \`npx cap add android\` run, and is the appId still com.fiftymmretina.app?`);
  }
  for (const p of plugins) {
    const src = path.join(sourceDir, `${p}.java`);
    if (!fs.existsSync(src)) throw new Error(`plugin source ${src} not found`);
    fs.copyFileSync(src, path.join(pkgDir, `${p}.java`));
    done.push(`copied ${p}.java`);
  }
  const main = fs.readFileSync(mainPath, "utf8");
  const pkg = (main.match(/^package\s+([\w.]+);/m) || [])[1];
  if (pkg !== "com.fiftymmretina.app") throw new Error(`MainActivity package is ${pkg ?? "(none)"}, expected com.fiftymmretina.app`);
  const already = plugins.every((p) => main.includes(`registerPlugin(${p}.class);`));
  if (already) {
    done.push("MainActivity already registers every plugin");
  } else if (TEMPLATE_BODY.test(main)) {
    fs.writeFileSync(mainPath, registeredMainActivity(pkg, plugins));
    done.push(`MainActivity registers ${plugins.join(", ")}`);
  } else {
    throw new Error(
      "MainActivity is not Capacitor's template and does not register our plugins — refusing to guess. " +
        "Update scripts/android-native-plugins.mjs for the new template.",
    );
  }
  const after = fs.readFileSync(mainPath, "utf8");
  for (const p of plugins) {
    if (!after.includes(`registerPlugin(${p}.class);`)) throw new Error(`MainActivity does not register ${p}`);
    if (after.indexOf(`registerPlugin(${p}.class);`) > after.indexOf("super.onCreate(")) {
      throw new Error(`${p} is registered after super.onCreate — the bridge would not see it`);
    }
  }
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || "android";
  try {
    for (const line of installNativePlugins(dir)) console.log(`OK: ${line}`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
