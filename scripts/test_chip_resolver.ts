// Regression test for the chip resolver extracted out of SimplifiedText.
// The resolver decides which surface forms in the simplified body become ISL
// chips. The rendered chip and the sequenced chip must be the same chip;
// this test pins the contract.
//
// Usage:
//   npx tsx scripts/test_chip_resolver.ts

import {
  tokeniseLine,
  getIndex,
  resolveEntry,
} from "../lib/chip_resolver";
import type { ISLDictionaryEntry } from "../lib/types";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}

function tokenTexts(line: string): string[] {
  return tokeniseLine(line)
    .filter((t) => t.isWord)
    .map((t) => t.text);
}

function tokeniseLineTests(): void {
  console.log("\n──── tokeniseLine ────");

  if (JSON.stringify(tokenTexts("Take aspirin daily")) !== JSON.stringify(["Take", "aspirin", "daily"])) {
    fail("Latin words split incorrectly");
  }
  ok("Latin words split into 3 tokens");

  if (JSON.stringify(tokenTexts("doctor's note")) !== JSON.stringify(["doctor's", "note"])) {
    fail("apostrophe should stay inside word");
  }
  ok("apostrophe-internal stays in token");

  if (JSON.stringify(tokenTexts("डॉक्टर ने कहा")) !== JSON.stringify(["डॉक्टर", "ने", "कहा"])) {
    fail("Devanagari should split on whitespace into 3 tokens");
  }
  ok("Devanagari runs split on whitespace");

  if (JSON.stringify(tokenTexts("खून blood test")) !== JSON.stringify(["खून", "blood", "test"])) {
    fail("Latin and Devanagari should not merge");
  }
  ok("Latin + Devanagari produce separate tokens");

  const segs = tokeniseLine("a, b");
  const reconstructed = segs.map((s) => s.text).join("");
  if (reconstructed !== "a, b") fail(`reconstruction lost characters: "${reconstructed}"`);
  ok("non-word segments preserved (lossless reconstruction)");
}

function resolverTests(): void {
  console.log("\n──── resolveEntry ────");

  const fakeDict: ISLDictionaryEntry[] = [
    { term: "Doctor", aliases: ["doctors"], videoUrl: "x" },
    { term: "Hospital", videoUrl: "y" },
  ];
  const index = getIndex(fakeDict);

  const e1 = resolveEntry("Doctor", index);
  if (e1?.term !== "Doctor") fail(`expected Doctor, got ${e1?.term}`);
  ok("Latin direct match (Doctor)");

  const e2 = resolveEntry("doctors", index);
  if (e2?.term !== "Doctor") fail(`alias should resolve to Doctor, got ${e2?.term}`);
  ok("Latin alias (doctors → Doctor)");

  const e3 = resolveEntry("hospital", index);
  if (e3?.term !== "Hospital") fail(`lowercase should resolve, got ${e3?.term}`);
  ok("Latin lowercase (hospital → Hospital)");

  const e4 = resolveEntry("unknownword", index);
  if (e4 !== undefined) fail("unknown word should return undefined");
  ok("unknown word returns undefined");

  const e5 = resolveEntry("डॉक्टर", index);
  if (e5?.term !== "Doctor") fail(`Devanagari should resolve via alias map, got ${e5?.term}`);
  ok("Devanagari alias (डॉक्टर → Doctor)");

  const e6 = resolveEntry("बिल्कुलअजीब", index);
  if (e6 !== undefined) fail("unknown Devanagari word should return undefined");
  ok("unknown Devanagari returns undefined");
}

function main(): void {
  tokeniseLineTests();
  resolverTests();
  console.log("\n✓ chip_resolver tests passed");
}

main();
