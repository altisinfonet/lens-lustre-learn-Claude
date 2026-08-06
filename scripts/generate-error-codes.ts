/**
 * Regenerate docs/error-codes.md from the catalog in src/lib/errorCodes.ts.
 *
 *   npx tsx scripts/generate-error-codes.ts
 *
 * The markdown is a GENERATED artefact. Editing it by hand is pointless —
 * src/lib/__tests__/errorCatalog.test.ts compares the file to the catalog and
 * fails CI on any difference, which is what stops the document and the code
 * from quietly disagreeing.
 */
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { renderCatalogMarkdown, ERROR_CATALOG } from "../src/lib/errorCodes";

// package.json declares "type": "module", so this file is an ES module and
// __dirname does not exist in it. Until 2026-08-06 line 15 used __dirname and
// the documented command above ALWAYS threw
// "ReferenceError: __dirname is not defined in ES module scope" — reproduced on
// main at d82f0ca before this change. docs/error-codes.md could only ever have
// been written by hand, which is exactly what the header forbids.
const here = dirname(fileURLToPath(import.meta.url));

const target = join(here, "..", "docs", "error-codes.md");
writeFileSync(target, renderCatalogMarkdown(), "utf8");
// eslint-disable-next-line no-console -- a build script's output IS its interface
console.log(`docs/error-codes.md written — ${ERROR_CATALOG.length} codes.`);
