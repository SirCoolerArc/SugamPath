// Tests for buildSequence(). The sequencer walks a simplification's section
// bodies in order and produces an ordered list of ISL chip occurrences (one
// per match, including repeats).
//
// Usage:
//   npx tsx scripts/test_isl_sequencer.ts

import { buildSequence } from "../lib/isl_sequencer";
import type { ISLDictionaryEntry, Simplification } from "../lib/types";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`✓ ${msg}`);
}

const FAKE_DICT: ISLDictionaryEntry[] = [
  { term: "Doctor", aliases: ["doctors"], videoUrl: "/api/isl-video/doctor" },
  { term: "Hospital", videoUrl: "/api/isl-video/hospital" },
  { term: "Medicine", aliases: ["medicines"], videoUrl: "/api/isl-video/medicine" },
];

function s(sections: Array<{ heading: string; body: string }>): Simplification {
  return {
    language: "en",
    sections,
    simplified_actions: [],
    warnings_plain: [],
  };
}

function emptyBodyTest(): void {
  const seq = buildSequence(s([{ heading: "h", body: "" }]), FAKE_DICT);
  if (seq.length !== 0) fail(`empty body should produce empty sequence, got ${seq.length}`);
  ok("empty body → empty sequence");
}

function noChipMatchesTest(): void {
  const seq = buildSequence(s([{ heading: "h", body: "the cat sat on the mat" }]), FAKE_DICT);
  if (seq.length !== 0) fail(`no-match body should produce empty sequence, got ${seq.length}`);
  ok("no chip matches → empty sequence");
}

function singleChipTest(): void {
  const seq = buildSequence(s([{ heading: "h", body: "see the doctor" }]), FAKE_DICT);
  if (seq.length !== 1) fail(`expected 1 item, got ${seq.length}`);
  if (seq[0].entry.term !== "Doctor") fail(`expected Doctor, got ${seq[0].entry.term}`);
  if (seq[0].sectionIndex !== 0) fail(`expected sectionIndex 0, got ${seq[0].sectionIndex}`);
  ok("single chip resolves to one item");
}

function repeatsAllowedTest(): void {
  const seq = buildSequence(
    s([{ heading: "h", body: "doctor and doctor and doctor" }]),
    FAKE_DICT,
  );
  if (seq.length !== 3) fail(`expected 3 items (repeats allowed), got ${seq.length}`);
  for (const item of seq) {
    if (item.entry.term !== "Doctor") fail(`each item should be Doctor, got ${item.entry.term}`);
  }
  // tokenIndex should be strictly increasing within the section
  if (!(seq[0].tokenIndex < seq[1].tokenIndex && seq[1].tokenIndex < seq[2].tokenIndex)) {
    fail("tokenIndex should be strictly increasing within section");
  }
  ok("repeats produce repeated entries with increasing tokenIndex");
}

function documentOrderTest(): void {
  const seq = buildSequence(
    s([
      { heading: "Section A", body: "go to the hospital" },
      { heading: "Section B", body: "see the doctor about your medicine" },
    ]),
    FAKE_DICT,
  );
  if (seq.length !== 3) fail(`expected 3 items, got ${seq.length}`);
  if (seq[0].entry.term !== "Hospital") fail("first should be Hospital");
  if (seq[1].entry.term !== "Doctor") fail("second should be Doctor");
  if (seq[2].entry.term !== "Medicine") fail("third should be Medicine");
  if (seq[0].sectionIndex !== 0) fail("first should be in section 0");
  if (seq[1].sectionIndex !== 1) fail("second should be in section 1");
  if (seq[2].sectionIndex !== 1) fail("third should be in section 1");
  ok("document order: section asc, then token asc within section");
}

function devanagariTest(): void {
  const seq = buildSequence(
    s([{ heading: "h", body: "डॉक्टर के पास जाएँ" }]),
    FAKE_DICT,
  );
  if (seq.length !== 1) fail(`Devanagari single chip: expected 1, got ${seq.length}`);
  if (seq[0].entry.term !== "Doctor") {
    fail(`Devanagari should resolve via alias to Doctor, got ${seq[0].entry.term}`);
  }
  if (seq[0].surface !== "डॉक्टर") fail(`surface should be the Devanagari form`);
  ok("Devanagari surface resolves via alias map");
}

function multilineBodyTest(): void {
  // Sections frequently contain bullet lists separated by \n. The sequencer
  // must walk lines within a body, not just the body as one blob.
  const seq = buildSequence(
    s([
      {
        heading: "Your medicines",
        body: "take all your medicines\n• doctor approval needed for changes\n• hospital pharmacy for refills",
      },
    ]),
    FAKE_DICT,
  );
  if (seq.length !== 3) fail(`multiline body: expected 3 items, got ${seq.length}`);
  if (seq[0].entry.term !== "Medicine") fail("first multiline match should be Medicine");
  if (seq[1].entry.term !== "Doctor") fail("second multiline match should be Doctor");
  if (seq[2].entry.term !== "Hospital") fail("third multiline match should be Hospital");
  ok("multiline body walks lines in order");
}

function emptyDictionaryTest(): void {
  const seq = buildSequence(s([{ heading: "h", body: "see the doctor" }]), []);
  if (seq.length !== 0) fail("empty dictionary should produce empty sequence");
  ok("empty dictionary → empty sequence");
}

function main(): void {
  emptyBodyTest();
  noChipMatchesTest();
  singleChipTest();
  repeatsAllowedTest();
  documentOrderTest();
  devanagariTest();
  multilineBodyTest();
  emptyDictionaryTest();
  console.log("\n✓ isl_sequencer tests passed");
}

main();
