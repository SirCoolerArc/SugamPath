// Run the simplifier against an extraction and print the resulting JSON +
// post-substituted HTML.
//
// Usage:
//   # End-to-end (vision + simplifier):
//   npx tsx scripts/test_simplifier.ts demo_assets/discharge_real_page1.png demo_assets/discharge_real_page2.png demo_assets/discharge_real_page3.png
//
//   # Cached extraction (skip vision, faster iteration on simplifier prompt):
//   npx tsx scripts/test_simplifier.ts --cached scripts/cache/extraction.json
//
//   # End-to-end and save the extraction for later reuse:
//   npx tsx scripts/test_simplifier.ts --save-extraction demo_assets/page1.png demo_assets/page2.png

import fs from "node:fs/promises";
import path from "node:path";

import { extract, ExtractionFailedError } from "../lib/extractor";
import {
  simplify,
  applyCriticalFieldSubstitution,
  reconstructSimplification,
  findUnresolvedPlaceholders,
  SimplificationFailedError,
} from "../lib/renderers";
import type { GeminiImage } from "../lib/gemini_client";
import type { Extraction, Simplification } from "../lib/types";
import type { PIIVault } from "../lib/pii_vault";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
};

const CACHE_DIR = path.join("scripts", "cache");
const EXTRACTION_CACHE = path.join(CACHE_DIR, "extraction.json");

interface CachedExtraction {
  extraction: Extraction;
  redactedExtraction: Extraction;
  vault: Array<[string, string]>;
}

async function loadEnv(): Promise<void> {
  try {
    const text = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // missing .env.local is fine; rely on real env
  }
}

async function loadImage(filePath: string): Promise<GeminiImage> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) throw new Error(`Unknown image extension ${ext} for ${filePath}`);
  const buffer = await fs.readFile(filePath);
  return { base64: buffer.toString("base64"), mimeType };
}

async function runExtract(paths: string[]): Promise<{
  extraction: Extraction;
  redactedExtraction: Extraction;
  vault: PIIVault;
  ms: number;
}> {
  const images: GeminiImage[] = [];
  for (const p of paths) images.push(await loadImage(p));

  console.log(`Extracting from ${paths.length} image(s)...`);
  const t0 = Date.now();
  try {
    const result = await extract({ images });
    const ms = Date.now() - t0;
    console.log(`✓ Extraction in ${ms} ms (attempts: ${result.attempts})`);
    return {
      extraction: result.extraction,
      redactedExtraction: result.redactedExtraction,
      vault: result.vault,
      ms,
    };
  } catch (err) {
    if (err instanceof ExtractionFailedError) {
      console.error(`Extraction failed after ${err.attempts} attempts:`);
      for (const e of err.lastErrors) console.error(`  - ${e}`);
      console.error(`\nLast raw excerpt:\n${err.lastRawExcerpt}`);
      process.exit(1);
    }
    throw err;
  }
}

async function loadCachedExtraction(filePath: string): Promise<{
  extraction: Extraction;
  redactedExtraction: Extraction;
  vault: PIIVault;
}> {
  const text = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(text) as CachedExtraction;
  return {
    extraction: data.extraction,
    redactedExtraction: data.redactedExtraction,
    vault: new Map(data.vault),
  };
}

async function saveExtractionCache(
  extraction: Extraction,
  redactedExtraction: Extraction,
  vault: PIIVault,
): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const payload: CachedExtraction = {
    extraction,
    redactedExtraction,
    vault: [...vault.entries()],
  };
  await fs.writeFile(EXTRACTION_CACHE, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`(cached extraction at ${EXTRACTION_CACHE})`);
}

function printSimplification(label: string, s: Simplification): void {
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(` ${label}`);
  console.log(`═══════════════════════════════════════════════════════════════════`);
  for (const sec of s.sections) {
    console.log(`\n## ${sec.heading}\n`);
    console.log(sec.body);
  }
  if (s.simplified_actions.length) {
    console.log(`\n## Action items\n`);
    for (const a of s.simplified_actions) {
      console.log(`  [${a.id}] ${a.what}`);
      console.log(`         when:   ${a.deadline_plain}`);
      console.log(`         verify: ${a.verify_with_plain}`);
    }
  }
  if (s.warnings_plain.length) {
    console.log(`\n## Warnings\n`);
    for (const w of s.warnings_plain) console.log(`  • ${w}`);
  }
}

async function main(): Promise<void> {
  await loadEnv();

  const args = process.argv.slice(2);
  const useCached = args[0] === "--cached";
  const saveExtraction = args[0] === "--save-extraction";

  let extraction: Extraction;
  let redactedExtraction: Extraction;
  let vault: PIIVault;

  if (useCached) {
    const cachePath = args[1] ?? EXTRACTION_CACHE;
    console.log(`Loading cached extraction from ${cachePath}...`);
    ({ extraction, redactedExtraction, vault } = await loadCachedExtraction(cachePath));
  } else {
    const imagePaths = saveExtraction ? args.slice(1) : args;
    if (imagePaths.length === 0) {
      throw new Error("No image paths given. Pass image paths or use --cached <path>.");
    }
    const r = await runExtract(imagePaths);
    extraction = r.extraction;
    redactedExtraction = r.redactedExtraction;
    vault = r.vault;
    if (saveExtraction) {
      await saveExtractionCache(extraction, redactedExtraction, vault);
    }
  }

  console.log(`\nExtraction: ${extraction.paragraphs.length} paragraphs, ${extraction.critical_fields.length} critical fields, ${extraction.action_items.length} actions, ${vault.size} vault entries`);
  console.log("");

  console.log("Simplifying (Gemini call)...");
  const t0 = Date.now();
  let simplification: Simplification;
  try {
    const result = await simplify({ redactedExtraction });
    simplification = result.simplification;
    console.log(`✓ Simplification in ${Date.now() - t0} ms (attempts: ${result.attempts})`);
    if (result.warnings.length) {
      console.log("\nWarnings:");
      for (const w of result.warnings) console.log(`  - ${w}`);
    }
  } catch (err) {
    if (err instanceof SimplificationFailedError) {
      console.error(`Simplification failed after ${err.attempts} attempts:`);
      for (const e of err.lastErrors) console.error(`  - ${e}`);
      console.error(`\nLast raw excerpt:\n${err.lastRawExcerpt}`);
      process.exit(1);
    }
    throw err;
  }

  // 1. Raw simplification (PII tokens + {{cN}} placeholders intact).
  printSimplification("1. RAW SIMPLIFIER OUTPUT (PII tokens + {{cN}} placeholders)", simplification);

  // 2. Critical-field substitution applied (still PII-tokenised).
  const withCriticals = applyCriticalFieldSubstitution(simplification, extraction.critical_fields);
  printSimplification("2. AFTER CRITICAL-FIELD SUBSTITUTION (HTML spans, PII still tokenised)", withCriticals);

  // 3. PII reconstructed (what the client sees).
  const final = reconstructSimplification(withCriticals, vault);
  printSimplification("3. AFTER PII RECONSTRUCTION (final client-bound payload)", final);

  // Diagnostics.
  const unresolved = findUnresolvedPlaceholders(simplification);
  if (unresolved.length) {
    console.log(`\n⚠ Unresolved {{cN}} placeholders: ${unresolved.join(", ")}`);
    console.log(`  These ids appeared in the simplifier output but are not in the extraction's critical_fields.`);
  } else {
    console.log(`\n✓ All {{cN}} placeholders resolved cleanly.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
