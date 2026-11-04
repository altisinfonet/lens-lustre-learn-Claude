#!/usr/bin/env node
/**
 * APP STORE CONNECT, ONE TOOL — run only by .github/workflows/ios-app-review.yml.
 *
 *   read    prints the state of the iOS version, its build, the review
 *           submissions and the age rating. Changes nothing.
 *   submit  sends the version for review: attaches the newest valid build,
 *           adds the review notes and pictures, then submits.
 *
 * The repository and its Actions logs are public, so this prints states and
 * version numbers only. It never prints the key, the review contact, the demo
 * login or the existing review notes. Documented API only.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ID = "6809751061";
const API = "https://api.appstoreconnect.apple.com";
const HERE = dirname(fileURLToPath(import.meta.url));
const ATTACHMENT = "age-check-both.png";
const NOTES_MARK = "--- Resubmission notes, 4 Nov 2026 ---";

const key = createPrivateKey(Buffer.from(process.env.APP_STORE_KEY_BASE64 ?? "", "base64"));
const b64u = (v) => Buffer.from(v).toString("base64url");

function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "ES256", kid: process.env.APP_STORE_KEY_ID, typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: process.env.APP_STORE_ISSUER_ID, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64u(sig)}`;
}

async function asc(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const why = (json?.errors ?? []).map((e) => `${e.code}: ${e.title} ${path.includes("Attachment") ? (e.detail ?? "") : ""}`).join("; ");
    throw new Error(`${method} ${path.split("?")[0]} ${res.status} ${why}`);
  }
  return json;
}

const EDITABLE = new Set(["REJECTED", "METADATA_REJECTED", "INVALID_BINARY", "DEVELOPER_REJECTED", "PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "UNRESOLVED_ISSUES"]);

/** The version being worked on: the editable one, never an older live version. */
async function latestVersion() {
  const all = (await asc("GET", `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20`)).data;
  for (const v of all) console.log(`version ${v.attributes.versionString} ${v.attributes.appStoreState} / ${v.attributes.appVersionState}`);
  const found = all.find((v) => EDITABLE.has(v.attributes.appStoreState) || EDITABLE.has(v.attributes.appVersionState));
  if (!found && process.env.ASC_ACTION === "submit") throw new Error("no editable version");
  return found ?? all[0];
}

const validBuilds = async () =>
  (await asc("GET", `/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate,expired`)).data;

async function ageRating() {
  const infos = (await asc("GET", `/v1/apps/${APP_ID}/appInfos`)).data;
  return (await asc("GET", `/v1/appInfos/${infos[0].id}/ageRatingDeclaration`)).data;
}

async function read() {
  const v = await latestVersion();
  const attached = (await asc("GET", `/v1/appStoreVersions/${v.id}/build`)).data;
  console.log(`attached build ${attached?.attributes?.version ?? "none"}`);
  for (const b of await validBuilds()) {
    console.log(`build ${b.attributes.version} ${b.attributes.processingState} ${b.attributes.uploadedDate?.slice(0, 16)} expired=${b.attributes.expired}`);
  }
  const subs = (await asc("GET", `/v1/reviewSubmissions?filter[app]=${APP_ID}&limit=5`)).data;
  for (const s of subs) {
    console.log(`submission ${s.id} ${s.attributes.state} ${s.attributes.submittedDate?.slice(0, 16) ?? ""}`);
    for (const i of (await asc("GET", `/v1/reviewSubmissions/${s.id}/items`)).data) {
      console.log(`  item ${i.attributes.state}`);
    }
  }
  const a = (await ageRating()).attributes;
  for (const k of ["parentalControls", "ageAssurance", "ageRatingOverride", "ageRatingOverrideV2", "kidsAgeBand"]) {
    if (k in a) console.log(`age ${k} = ${a[k]}`);
  }
}

/** Apple's three-step upload: reserve, send the parts, commit with the checksum. */
async function attach(detailId, file) {
  const bytes = readFileSync(file);
  const made = await asc("POST", "/v1/appStoreReviewAttachments", {
    data: {
      type: "appStoreReviewAttachments",
      attributes: { fileName: basename(file), fileSize: statSync(file).size },
      relationships: { appStoreReviewDetail: { data: { type: "appStoreReviewDetails", id: detailId } } },
    },
  });
  for (const op of made.data.attributes.uploadOperations) {
    const part = bytes.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
    const put = await fetch(op.url, { method: op.method, headers, body: part });
    if (!put.ok) throw new Error(`attachment upload ${put.status}`);
  }
  await asc("PATCH", `/v1/appStoreReviewAttachments/${made.data.id}`, {
    data: {
      type: "appStoreReviewAttachments",
      id: made.data.id,
      attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(bytes).digest("hex") },
    },
  });
  console.log(`attached ${basename(file)}`);
}

async function submit() {
  const v = await latestVersion();
  const newest = (await validBuilds()).find((b) => b.attributes.processingState === "VALID" && !b.attributes.expired);
  if (!newest) throw new Error("no valid build yet");
  if (newest.attributes.version !== process.env.EXPECT_BUILD) {
    throw new Error(`newest valid build is ${newest.attributes.version}, expected ${process.env.EXPECT_BUILD}`);
  }
  await asc("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: newest.id } });
  console.log(`build ${newest.attributes.version} attached to version ${v.attributes.versionString}`);

  const detail = (await asc("GET", `/v1/appStoreVersions/${v.id}/appStoreReviewDetail`)).data;
  const kept = (detail.attributes.notes ?? "").split(NOTES_MARK)[0].trimEnd();
  const added = readFileSync(join(HERE, "review-notes.txt"), "utf8").trim();
  const notes = `${kept}\n\n${NOTES_MARK}\n${added}`.trim();
  await asc("PATCH", `/v1/appStoreReviewDetails/${detail.id}`, {
    data: { type: "appStoreReviewDetails", id: detail.id, attributes: { notes } },
  });
  console.log("review notes updated");

  const existing = (await asc("GET", `/v1/appStoreReviewDetails/${detail.id}/appStoreReviewAttachments`)).data;
  const names = new Set();
  for (const a of existing) console.log(`attachment ${a.attributes.fileName} ${a.attributes.assetDeliveryState?.state ?? ""} uploaded=${a.attributes.uploaded ?? ""}`);
  for (const a of existing) {
    // A half-finished upload never becomes visible to Apple: remove it and send it again.
    if (a.attributes.fileName !== ATTACHMENT || a.attributes.assetDeliveryState?.state === "FAILED" || a.attributes.uploaded === false) {
      await asc("DELETE", `/v1/appStoreReviewAttachments/${a.id}`);
    } else {
      names.add(a.attributes.fileName);
    }
  }
  // Apple allows one attachment, so the two pictures travel as one file.
  for (const name of [ATTACHMENT]) {
    if (!names.has(name)) await attach(detail.id, join(HERE, "review-attachments", name));
  }

  const open = (await asc("GET", `/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[state]=UNRESOLVED_ISSUES,READY_FOR_REVIEW&limit=5`)).data;
  let id = open[0]?.id;
  if (!id) {
    id = (await asc("POST", "/v1/reviewSubmissions", {
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { type: "apps", id: APP_ID } } },
      },
    })).data.id;
  }
  const items = (await asc("GET", `/v1/reviewSubmissions/${id}/items`)).data;
  if (items.length === 0) {
    await asc("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id } },
          appStoreVersion: { data: { type: "appStoreVersions", id: v.id } },
        },
      },
    });
  }
  // A rejected item must be marked resolved before the submission can go again.
  for (const item of items.filter((i) => i.attributes.state === "REJECTED" || i.attributes.state === "UNRESOLVED_ISSUES")) {
    await asc("PATCH", `/v1/reviewSubmissionItems/${item.id}`, {
      data: { type: "reviewSubmissionItems", id: item.id, attributes: { resolved: true } },
    });
  }
  await asc("PATCH", `/v1/reviewSubmissions/${id}`, { data: { type: "reviewSubmissions", id, attributes: { submitted: true } } });
  console.log(`submitted ${id}`);
}

const action = process.env.ASC_ACTION;
if (action === "read") await read();
else if (action === "submit") await submit();
else throw new Error(`unknown action ${action}`);
