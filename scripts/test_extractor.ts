// Run the extractor against an image and print the resulting JSON.
//
// Usage:
//   npx tsx scripts/test_extractor.ts <path-to-image>
//   npx tsx scripts/test_extractor.ts demo_assets/discharge_summary_mock.jpg
//
// If no path is given, looks for demo_assets/discharge_summary_mock.{jpg,png,jpeg}.
//
// What it prints:
//   1. Token-budget meta (size of image, latency)
//   2. The PII-reconstructed extraction (what the user sees)
//   3. The redacted extraction (what flows downstream to the simplifier)
//   4. The vault map
//   5. A diff against benchmark §3 (counts only, not exact-string match — the
//      mock is meant to be a guide, not a golden literal)

import fs from "node:fs/promises";
import path from "node:path";

import { extract, ExtractionFailedError } from "../lib/extractor";

const DEFAULT_PATHS = [
  "demo_assets/discharge_summary_mock.jpg",
  "demo_assets/discharge_summary_mock.jpeg",
  "demo_assets/discharge_summary_mock.png",
  "demo_assets/discharge_summary.pdf",
];

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
};

async function loadEnv(): Promise<void> {
  // Minimal .env.local loader — Next handles this in the app, but tsx doesn't.
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

async function resolveImagePath(arg: string | undefined): Promise<string> {
  if (arg) {
    await fs.access(arg);
    return arg;
  }
  for (const candidate of DEFAULT_PATHS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    `No image path given and none of these exist: ${DEFAULT_PATHS.join(", ")}\n` +
      `Either pass a path as the first arg, or drop a photo of the benchmark mock at demo_assets/discharge_summary_mock.jpg.`,
  );
}

async function main(): Promise<void> {
  await loadEnv();

  const arg = process.argv[2];
  const imagePath = await resolveImagePath(arg);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) throw new Error(`Unknown image extension ${ext}`);

  const buffer = await fs.readFile(imagePath);
  const base64 = buffer.toString("base64");

  console.log(`Image:    ${imagePath}`);
  console.log(`Size:     ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`MimeType: ${mimeType}`);
  console.log("");

  const startedAt = Date.now();
  let result;
  try {
    result = await extract({ imageBase64: base64, imageMimeType: mimeType });
  } catch (err) {
    if (err instanceof ExtractionFailedError) {
      console.error("EXTRACTION FAILED");
      console.error(`Attempts: ${err.attempts}`);
      console.error(`Errors:`);
      for (const e of err.lastErrors) console.error(`  - ${e}`);
      console.error(`\nLast raw response excerpt:\n${err.lastRawExcerpt}`);
      process.exit(1);
    }
    throw err;
  }
  const latencyMs = Date.now() - startedAt;

  console.log(`✓ Extraction succeeded in ${latencyMs} ms (attempts: ${result.attempts})`);
  if (result.warnings.length) {
    console.log("\nWarnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(" 1. EXTRACTION (PII RECONSTRUCTED — what the user sees)");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(JSON.stringify(result.extraction, null, 2));

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(" 2. REDACTED EXTRACTION (what flows downstream to the simplifier)");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(JSON.stringify(result.redactedExtraction, null, 2));

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(" 3. VAULT MAP");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const [token, value] of result.vault.entries()) {
    console.log(`  ${token.padEnd(18)} -> ${value}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(" 4. STRUCTURE COUNTS (compare to benchmark §3 expectations)");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  document_type:    ${result.extraction.document_type}`);
  console.log(`  language:         ${result.extraction.language_detected}`);
  console.log(`  paragraphs:       ${result.extraction.paragraphs.length}`);
  console.log(`  critical_fields:  ${result.extraction.critical_fields.length}  (benchmark expects ~17)`);
  console.log(`  action_items:     ${result.extraction.action_items.length}     (benchmark expects ~6)`);
  console.log(`  warning_signs:    ${result.extraction.warning_signs.length}     (benchmark expects 5)`);
  console.log(`  red_flags:        ${result.extraction.red_flags.length}     (benchmark expects 0 for clean doc)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
