// Run the extractor against one or more page images and print the resulting JSON.
//
// Usage:
//   npx tsx scripts/test_extractor.ts <path1> [path2] [path3] ...
//   npx tsx scripts/test_extractor.ts demo_assets/discharge_real_page2.png
//   npx tsx scripts/test_extractor.ts demo_assets/discharge_real_page1.png demo_assets/discharge_real_page2.png demo_assets/discharge_real_page3.png
//
// If no paths are given, looks for demo_assets/discharge_real_page*.png in
// numeric order.
//
// What it prints:
//   1. Token-budget meta (image sizes, total latency)
//   2. The PII-reconstructed extraction (what the user sees)
//   3. The redacted extraction (what flows downstream to the simplifier)
//   4. The vault map
//   5. Structure counts (compare to benchmark §3 expectations)

import fs from "node:fs/promises";
import path from "node:path";

import { extract, ExtractionFailedError } from "../lib/extractor";
import type { GeminiImage } from "../lib/gemini_client";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
};

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

async function discoverDefaultPages(): Promise<string[]> {
  const dir = "demo_assets";
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const pages = files
    .filter((f) => /^discharge_real_page\d+\.(png|jpe?g)$/i.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const numB = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return numA - numB;
    })
    .map((f) => path.join(dir, f));
  return pages;
}

async function loadImage(filePath: string): Promise<GeminiImage> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) throw new Error(`Unknown image extension ${ext} for ${filePath}`);
  const buffer = await fs.readFile(filePath);
  return { base64: buffer.toString("base64"), mimeType };
}

async function main(): Promise<void> {
  await loadEnv();

  let paths = process.argv.slice(2);
  if (paths.length === 0) {
    paths = await discoverDefaultPages();
    if (paths.length === 0) {
      throw new Error(
        "No image paths given and demo_assets/discharge_real_page*.png not found.\n" +
          "Pass one or more image paths as arguments.",
      );
    }
    console.log(`(auto-discovered ${paths.length} page${paths.length === 1 ? "" : "s"})`);
  }

  const images: GeminiImage[] = [];
  let totalBytes = 0;
  for (const p of paths) {
    const img = await loadImage(p);
    images.push(img);
    const bytes = Buffer.from(img.base64, "base64").length;
    totalBytes += bytes;
    console.log(`Image:    ${p}  (${(bytes / 1024).toFixed(1)} KB, ${img.mimeType})`);
  }
  console.log(`Total:    ${images.length} image(s), ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log("");

  const startedAt = Date.now();
  let result;
  try {
    result = await extract({ images });
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
  console.log(" 4. STRUCTURE COUNTS");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  document_type:    ${result.extraction.document_type}`);
  console.log(`  language:         ${result.extraction.language_detected}`);
  console.log(`  issuing_authority:${result.extraction.issuing_authority}`);
  console.log(`  paragraphs:       ${result.extraction.paragraphs.length}`);
  console.log(`  critical_fields:  ${result.extraction.critical_fields.length}`);
  console.log(`  action_items:     ${result.extraction.action_items.length}`);
  console.log(`  warning_signs:    ${result.extraction.warning_signs.length}`);
  console.log(`  red_flags:        ${result.extraction.red_flags.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
