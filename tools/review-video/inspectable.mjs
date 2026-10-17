#!/usr/bin/env node
/**
 * ios-review-video.yml ONLY — never run by ios-build.yml.
 *
 * Capacitor 8 ships its iOS runtime as a prebuilt (release) framework, so the
 * "web view is inspectable in Debug builds" default is compiled out and Appium
 * finds no web view ("Empty page dictionary"). For the simulator recording job
 * we turn inspection on explicitly in capacitor.config.ts before `cap sync`.
 * The App Store build never runs this, so the shipped app is unchanged.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = "capacitor.config.ts";
const src = readFileSync(path, "utf8");
if (src.includes("webContentsDebuggingEnabled")) {
  console.log("already inspectable");
} else {
  const anchor = "android: {";
  if (!src.includes(anchor)) {
    console.error(`::error::${path} has no "${anchor}" to anchor the ios block`);
    process.exit(1);
  }
  writeFileSync(path, src.replace(anchor, `ios: { webContentsDebuggingEnabled: true },\n  ${anchor}`));
  console.log("ios.webContentsDebuggingEnabled = true (this job only)");
}
