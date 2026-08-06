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
import { join } from "path";
import { renderCatalogMarkdown, ERROR_CATALOG } from "../src/lib/errorCodes";

const target = join(__dirname, "..", "docs", "error-codes.md");
writeFileSync(target, renderCatalogMarkdown(), "utf8");
// eslint-disable-next-line no-console -- a build script's output IS its interface
console.log(`docs/error-codes.md written — ${ERROR_CATALOG.length} codes.`);
