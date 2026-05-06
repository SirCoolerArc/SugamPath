// Run the faithfulness judge against synthetic and real simplifier outputs.
//
// Usage:
//   # Pure judge tests (synthetic simplifications, deterministic):
//   npx tsx scripts/test_faithfulness.ts --synthetic
//
//   # End-to-end against a cached extraction (uses the real simplifier output):
//   npx tsx scripts/test_faithfulness.ts --cached scripts/cache/extraction.json
//
// The synthetic mode is the headline test — it builds three simplifications
// from one extraction (verified, omitting one, fabricating one) and confirms
// the judge classifies each correctly.

import fs from "node:fs/promises";
import path from "node:path";

import { judgeFaithfulness } from "../lib/faithfulness";
import { simplify, applyCriticalFieldSubstitution } from "../lib/renderers";
import type {
  CriticalField,
  Extraction,
  FaithfulnessResult,
  Simplification,
} from "../lib/types";
import type { PIIVault } from "../lib/pii_vault";

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
    // .env.local optional
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

/** Build a Simplification that references every critical field. */
function buildVerifiedSimplification(criticalFields: readonly CriticalField[]): Simplification {
  const refs = criticalFields.map((c) => `{{${c.id}}}`).join(", ");
  return {
    language: "en",
    sections: [
      {
        heading: "What this is",
        body: `This document mentions: ${refs}. Read each one alongside the original.`,
      },
    ],
    simplified_actions: [],
    warnings_plain: [],
  };
}

/** Build a Simplification that drops the LAST critical field reference. */
function buildOmittedSimplification(
  criticalFields: readonly CriticalField[],
): { simplification: Simplification; droppedId: string } {
  if (criticalFields.length === 0) {
    throw new Error("Need at least one critical field to test omission.");
  }
  const dropped = criticalFields[criticalFields.length - 1];
  const kept = criticalFields.slice(0, -1);
  const refs = kept.map((c) => `{{${c.id}}}`).join(", ");
  return {
    simplification: {
      language: "en",
      sections: [
        {
          heading: "What this is",
          body: `This document mentions: ${refs}. Read each one alongside the original.`,
        },
      ],
      simplified_actions: [],
      warnings_plain: [],
    },
    droppedId: dropped.id,
  };
}

/** Build a Simplification that references every critical field AND adds a
 *  free-text duration the document never said. */
function buildFabricatedSimplification(
  criticalFields: readonly CriticalField[],
): { simplification: Simplification; fabricatedFragment: string } {
  const refs = criticalFields.map((c) => `{{${c.id}}}`).join(", ");
  const fabricatedFragment = "for 9999 days";
  return {
    simplification: {
      language: "en",
      sections: [
        {
          heading: "What this is",
          body: `This document mentions: ${refs}. Continue these ${fabricatedFragment}.`,
        },
      ],
      simplified_actions: [],
      warnings_plain: [],
    },
    fabricatedFragment,
  };
}

function summariseVerdict(label: string, result: FaithfulnessResult): void {
  console.log(`\n──── ${label} ────`);
  console.log(`verdict: ${result.verdict}`);
  console.log(`fields in original:   [${result.critical_fields_in_original.join(", ")}]`);
  console.log(`fields in simplified: [${result.critical_fields_in_simplified.join(", ")}]`);
  if (result.differences.length === 0) {
    console.log("differences: (none)");
  } else {
    console.log("differences:");
    for (const d of result.differences) {
      if (d.kind === "OMITTED") {
        console.log(`  - OMITTED: ${d.field_id ?? "?"} → ${(d.verbatim ?? "").slice(0, 80)}`);
      } else {
        console.log(`  - FABRICATED: "${(d.fragment ?? "").slice(0, 80)}"`);
      }
    }
  }
}

async function runSynthetic(redactedExtraction: Extraction): Promise<void> {
  const cf = redactedExtraction.critical_fields;
  if (cf.length < 2) {
    console.error("Cached extraction needs at least 2 critical fields for the synthetic test.");
    process.exit(1);
  }

  console.log(`Synthetic faithfulness test against ${cf.length} critical fields.`);

  // ─── Test 1: VERIFIED ───────────────────────────────────────────────────
  const verifiedSim = buildVerifiedSimplification(cf);
  const t1 = Date.now();
  const verifiedResult = await judgeFaithfulness({
    redactedCriticalFields: cf,
    rawSimplification: verifiedSim,
  });
  console.log(`\n[verified case] judge in ${Date.now() - t1} ms`);
  summariseVerdict("Test 1 — every critical field referenced", verifiedResult);
  assertVerdict(verifiedResult, "VERIFIED");

  // ─── Test 2: VERIFIED_WITH_OMISSIONS ────────────────────────────────────
  const { simplification: omittedSim, droppedId } = buildOmittedSimplification(cf);
  const t2 = Date.now();
  const omittedResult = await judgeFaithfulness({
    redactedCriticalFields: cf,
    rawSimplification: omittedSim,
  });
  console.log(`\n[omitted case] judge in ${Date.now() - t2} ms (expected to flag ${droppedId})`);
  summariseVerdict("Test 2 — one critical field omitted", omittedResult);
  assertVerdict(omittedResult, "VERIFIED_WITH_OMISSIONS");
  const omittedIds = omittedResult.differences
    .filter((d) => d.kind === "OMITTED")
    .map((d) => d.field_id);
  if (!omittedIds.includes(droppedId)) {
    console.error(`✗ judge did not flag the actually-dropped id ${droppedId}; flagged: ${omittedIds.join(", ")}`);
    process.exit(1);
  }
  console.log(`✓ judge correctly flagged ${droppedId} as omitted`);

  // ─── Test 3: UNVERIFIED ─────────────────────────────────────────────────
  const { simplification: fabSim, fabricatedFragment } = buildFabricatedSimplification(cf);
  const t3 = Date.now();
  const fabResult = await judgeFaithfulness({
    redactedCriticalFields: cf,
    rawSimplification: fabSim,
  });
  console.log(`\n[fabricated case] judge in ${Date.now() - t3} ms (expected to flag "${fabricatedFragment}")`);
  summariseVerdict("Test 3 — one fabricated phrase", fabResult);
  assertVerdict(fabResult, "UNVERIFIED");

  console.log("\n✓ All synthetic faithfulness tests passed.");
}

async function runCached(redactedExtraction: Extraction): Promise<void> {
  console.log("End-to-end faithfulness test (real simplifier → judge).");
  console.log(`Simplifying ${redactedExtraction.critical_fields.length} critical fields...`);
  const t0 = Date.now();
  const simResult = await simplify({ redactedExtraction });
  console.log(`✓ Simplification in ${Date.now() - t0} ms (attempts: ${simResult.attempts})`);

  // Show what the judge will see (with redacted spans).
  const redactedSubstituted = applyCriticalFieldSubstitution(
    simResult.simplification,
    redactedExtraction.critical_fields,
  );
  const previewSection = redactedSubstituted.sections[0];
  if (previewSection) {
    console.log(`\nFirst section heading: ${previewSection.heading}`);
    console.log(`First section body (excerpt): ${previewSection.body.slice(0, 200)}${previewSection.body.length > 200 ? "..." : ""}`);
  }

  const t1 = Date.now();
  const judgeResult = await judgeFaithfulness({
    redactedCriticalFields: redactedExtraction.critical_fields,
    rawSimplification: simResult.simplification,
  });
  console.log(`\n✓ Faithfulness judge in ${Date.now() - t1} ms`);
  summariseVerdict("End-to-end verdict", judgeResult);
}

function assertVerdict(
  result: FaithfulnessResult,
  expected: FaithfulnessResult["verdict"],
): void {
  if (result.verdict !== expected) {
    console.error(`✗ Expected verdict ${expected}, got ${result.verdict}`);
    process.exit(1);
  }
  console.log(`✓ verdict matches expected (${expected})`);
}

async function main(): Promise<void> {
  await loadEnv();

  const args = process.argv.slice(2);
  const mode = args[0] ?? "--synthetic";
  const cachePath = args[1] ?? EXTRACTION_CACHE;

  console.log(`Loading cached extraction from ${cachePath}...`);
  const { redactedExtraction } = await loadCachedExtraction(cachePath);
  console.log(`Loaded: ${redactedExtraction.critical_fields.length} critical fields, ${redactedExtraction.action_items.length} action items.`);

  if (mode === "--synthetic") {
    await runSynthetic(redactedExtraction);
  } else if (mode === "--cached") {
    await runCached(redactedExtraction);
  } else {
    console.error(`Unknown mode ${mode}. Use --synthetic or --cached.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
