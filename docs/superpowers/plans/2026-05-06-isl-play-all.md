# ISL "Play All" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "play all signs" button next to the existing audio player that walks every ISL chip in the simplified text in document order, showing each video in a floating player while the corresponding word in the text is highlighted.

**Architecture:** A new server-side proxy at `/api/isl-video/<fileId>` streams Drive bytes through our origin, unblocking inline `<video>` playback. Chip-resolution logic moves out of `SimplifiedText.tsx` into a shared `lib/chip_resolver.ts` so the rendered chip and the sequenced chip are the same chip by construction. A pure `lib/isl_sequencer.ts` walks the simplification's sections and produces an ordered list of chip occurrences. The new `ISLPlayAllPlayer` component holds all playback state internally; `SideBySideViewer` only mounts/unmounts it and reports the active chip back to `SimplifiedText` for highlighting.

**Tech Stack:** Next.js 14 App Router · TypeScript strict · React functional components with `useState`/`useEffect`/`useRef` · `<video>` element native API · `lucide-react` icons · existing `data/isl_dictionary.json` (kept untouched) · existing `data/hindi_isl_aliases.ts` (kept untouched).

**Spec:** [`docs/superpowers/specs/2026-05-06-isl-play-all-design.md`](../specs/2026-05-06-isl-play-all-design.md)

**Test runner note:** Hand-run scripts in `scripts/test_*.ts` via `npx tsx`. Tests assert by throwing on mismatch and calling `process.exit(1)`. Follow `scripts/test_faithfulness.ts` for shape.

---

## File structure

**Create:**
- `app/api/isl-video/[fileId]/route.ts` — Drive-byte streaming proxy
- `lib/chip_resolver.ts` — shared tokeniser + dictionary-index lookup (extracted from SimplifiedText)
- `lib/isl_sequencer.ts` — pure `buildSequence()` walking a simplification
- `components/ISLPlayAllButton.tsx` — toolbar button next to AudioPlayer
- `components/ISLPlayAllPlayer.tsx` — floating player UI with controls
- `scripts/test_chip_resolver.ts` — regression test for the extracted resolver
- `scripts/test_isl_sequencer.ts` — unit tests for `buildSequence()`

**Modify:**
- `lib/types.ts` — add `videoFallbackUrl?: string` to `ISLDictionaryEntry`, add `ISLSequenceItem`
- `app/api/isl-dictionary/route.ts` — rewrite Drive URLs to the new proxy, populate `videoFallbackUrl`
- `components/ISLTermChip.tsx` — replace external Drive link with inline `<video>`, keep Drive link as footer
- `components/SimplifiedText.tsx` — import resolver from new module; accept `activeChip` prop; auto-scroll active chip
- `components/SideBySideViewer.tsx` — fetch dictionary, build sequence via `useMemo`, render the new button + player, thread `activeChip`

**Untouched (deliberately):**
- `data/isl_dictionary.json` — URL transformation happens at API serve time, not in source data.
- `data/hindi_isl_aliases.ts` — alias logic stays inside `chip_resolver.ts`.
- `lib/renderers.ts`, `lib/faithfulness.ts`, `lib/intent.ts`, `prompts/*` — out of scope.

---

## Task 1 — Type additions in `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `videoFallbackUrl` to `ISLDictionaryEntry`**

In `lib/types.ts`, locate the `ISLDictionaryEntry` interface:

```ts
export interface ISLDictionaryEntry {
  /** Canonical English term as it should appear in the simplified text. */
  term: string;
  /** Optional inflections / synonyms that should also resolve to this entry. */
  aliases?: string[];
  /** Direct URL to the sign video, OR a link to the ISLRTC page for the term
   *  if the video itself isn't legally hostable. The ISL chip will use a
   *  <video> if the URL ends in a recognised extension; otherwise it will
   *  open the URL in a new tab. */
  videoUrl: string;
  /** Optional short caption shown beside the video. */
  caption?: string;
}
```

Replace with:

```ts
export interface ISLDictionaryEntry {
  /** Canonical English term as it should appear in the simplified text. */
  term: string;
  /** Optional inflections / synonyms that should also resolve to this entry. */
  aliases?: string[];
  /** URL the ISL chip's <video> element points at. After the dictionary route
   *  rewrites it, this will be `/api/isl-video/<fileId>` — our streaming
   *  proxy that serves Drive bytes through our origin so inline playback
   *  works without exposing the Drive API key. */
  videoUrl: string;
  /** Drive's public viewer URL (`drive.google.com/file/d/<id>/view`). Used as
   *  the chip popover's "Open on Drive ↗" footer link, and as the fallback
   *  when the proxy fails. Optional for back-compat with older entries. */
  videoFallbackUrl?: string;
  /** Optional short caption shown beside the video. */
  caption?: string;
}
```

- [ ] **Step 2: Add the `ISLSequenceItem` type**

Append to the bottom of `lib/types.ts`, after the existing ISL dictionary entry interface:

```ts
// ─── ISL play-all sequence (post-Stage-2 follow-up) ──────────────────────────
// One playable item in a sequenced walk over the simplified text. The
// sequencer (lib/isl_sequencer.ts) produces these in document order; the
// floating player consumes them one at a time via <video src=entry.videoUrl>.
// `sectionIndex` and `tokenIndex` jointly identify the rendered chip so
// SimplifiedText can highlight it as "currently signing".
export interface ISLSequenceItem {
  entry: ISLDictionaryEntry;
  sectionIndex: number; // index into Simplification.sections
  tokenIndex: number;   // ordinal of the chipped word within that section's body
  surface: string;      // the surface form ("Doctor" or "डॉक्टर") that resolved to this entry
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(isl): add videoFallbackUrl + ISLSequenceItem types"
```

---

## Task 2 — Extract chip-resolver into `lib/chip_resolver.ts`

**Files:**
- Create: `lib/chip_resolver.ts`
- Create: `scripts/test_chip_resolver.ts`
- Modify: `components/SimplifiedText.tsx`

This is a refactor. The behaviour must not change. We follow strict TDD: characterise the existing behaviour with tests against the *to-be-extracted* surface first, then move the code, then re-run the tests.

- [ ] **Step 1: Write the failing test for the extracted resolver**

Create `scripts/test_chip_resolver.ts`:

```ts
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

  // Latin alphanumerics
  if (JSON.stringify(tokenTexts("Take aspirin daily")) !== JSON.stringify(["Take", "aspirin", "daily"])) {
    fail("Latin words split incorrectly");
  }
  ok("Latin words split into 3 tokens");

  // Apostrophe-inside-word stays one token
  if (JSON.stringify(tokenTexts("doctor's note")) !== JSON.stringify(["doctor's", "note"])) {
    fail("apostrophe should stay inside word");
  }
  ok("apostrophe-internal stays in token");

  // Devanagari run is one token
  if (JSON.stringify(tokenTexts("डॉक्टर ने कहा")) !== JSON.stringify(["डॉक्टर", "ने", "कहा"])) {
    fail("Devanagari should split on whitespace into 3 tokens");
  }
  ok("Devanagari runs split on whitespace");

  // Mixed Latin + Devanagari — separate tokens
  if (JSON.stringify(tokenTexts("खून blood test")) !== JSON.stringify(["खून", "blood", "test"])) {
    fail("Latin and Devanagari should not merge");
  }
  ok("Latin + Devanagari produce separate tokens");

  // Non-words preserved as-is (whitespace and punctuation)
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

  // Latin: case-insensitive direct match
  const e1 = resolveEntry("Doctor", index);
  if (e1?.term !== "Doctor") fail(`expected Doctor, got ${e1?.term}`);
  ok("Latin direct match (Doctor)");

  // Latin: alias resolves
  const e2 = resolveEntry("doctors", index);
  if (e2?.term !== "Doctor") fail(`alias should resolve to Doctor, got ${e2?.term}`);
  ok("Latin alias (doctors → Doctor)");

  // Latin: lowercase match
  const e3 = resolveEntry("hospital", index);
  if (e3?.term !== "Hospital") fail(`lowercase should resolve, got ${e3?.term}`);
  ok("Latin lowercase (hospital → Hospital)");

  // Latin: unknown word
  const e4 = resolveEntry("unknownword", index);
  if (e4 !== undefined) fail("unknown word should return undefined");
  ok("unknown word returns undefined");

  // Devanagari: alias-mapped via HINDI_ISL_ALIASES
  const e5 = resolveEntry("डॉक्टर", index);
  if (e5?.term !== "Doctor") fail(`Devanagari should resolve via alias map, got ${e5?.term}`);
  ok("Devanagari alias (डॉक्टर → Doctor)");

  // Devanagari: unknown
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test_chip_resolver.ts`
Expected: FAIL with `Cannot find module '../lib/chip_resolver'` or similar.

- [ ] **Step 3: Create `lib/chip_resolver.ts` by extracting from SimplifiedText**

Create `lib/chip_resolver.ts`:

```ts
import { HINDI_ISL_ALIASES } from "@/data/hindi_isl_aliases";
import type { ISLDictionaryEntry } from "@/lib/types";

const DEVANAGARI_RE = /[ऀ-ॿ]/;

/**
 * Tokenise a line into [text, isWord] runs. A "word" is a contiguous run of
 * either Latin alphanumerics (with an internal apostrophe) OR Devanagari
 * characters. A "non-word" is everything else (whitespace, punctuation,
 * em-dashes), preserved verbatim so spacing and punctuation survive the
 * re-emit unchanged. Latin and Devanagari runs are tokenised separately:
 * "खून blood test" produces three word tokens, not one.
 */
export function tokeniseLine(line: string): Array<{ text: string; isWord: boolean }> {
  const out: Array<{ text: string; isWord: boolean }> = [];
  const re = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|[ऀ-ॿ]+/g;
  let last = 0;
  for (const match of line.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push({ text: line.slice(last, idx), isWord: false });
    out.push({ text: match[0], isWord: true });
    last = idx + match[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), isWord: false });
  return out;
}

// Module-level memo — built once per dictionary identity. 10k+ terms × per-line
// regex would be catastrophic; an O(words-in-line) hash lookup is fast.
let cachedIndex: { dict: ISLDictionaryEntry[]; index: Map<string, ISLDictionaryEntry> } | null =
  null;

/**
 * Build a lowercase-keyed lookup map from the ISL dictionary. Memoised on
 * dictionary identity (the dictionary is fetched once per page session and
 * the array reference is stable across renders).
 */
export function getIndex(dictionary: ISLDictionaryEntry[]): Map<string, ISLDictionaryEntry> {
  if (cachedIndex && cachedIndex.dict === dictionary) return cachedIndex.index;
  const index = new Map<string, ISLDictionaryEntry>();
  for (const entry of dictionary) {
    const keys = [entry.term, ...(entry.aliases ?? [])];
    for (const k of keys) {
      const norm = k.toLowerCase().trim();
      if (!norm) continue;
      // First entry wins on collision so the dictionary's natural ordering
      // (alphabetised by sync script) gives stable behaviour.
      if (!index.has(norm)) index.set(norm, entry);
    }
  }
  cachedIndex = { dict: dictionary, index };
  return index;
}

/**
 * Look up a token in the ISL index. For Latin tokens, lowercase the surface
 * form and probe directly. For Devanagari tokens, first translate via the
 * hand-curated Hindi → English alias map, then probe. Keeps the dictionary
 * (auto-generated by sync_isl_dictionary.ts) script-pure while letting Hindi
 * simplifications still chip the same medical / civic vocabulary.
 */
export function resolveEntry(
  surface: string,
  index: Map<string, ISLDictionaryEntry>,
): ISLDictionaryEntry | undefined {
  if (DEVANAGARI_RE.test(surface)) {
    const englishKey = HINDI_ISL_ALIASES[surface];
    if (!englishKey) return undefined;
    return index.get(englishKey);
  }
  return index.get(surface.toLowerCase());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test_chip_resolver.ts`
Expected: every assertion logs ✓; final `✓ chip_resolver tests passed`.

- [ ] **Step 5: Update `components/SimplifiedText.tsx` to import from the new module**

Open `components/SimplifiedText.tsx`. Locate the imports block at the top:

```tsx
import { ISLTermChip } from "@/components/ISLTermChip";
import { HINDI_ISL_ALIASES } from "@/data/hindi_isl_aliases";
import type { ISLDictionaryEntry, Simplification } from "@/lib/types";
```

Replace with:

```tsx
import { ISLTermChip } from "@/components/ISLTermChip";
import { tokeniseLine, getIndex, resolveEntry } from "@/lib/chip_resolver";
import type { ISLDictionaryEntry, Simplification } from "@/lib/types";
```

(Note: `HINDI_ISL_ALIASES` is now imported by `chip_resolver.ts` instead.)

- [ ] **Step 6: Remove the now-duplicated logic from SimplifiedText**

In `components/SimplifiedText.tsx`, locate and DELETE the following blocks (they all live in `chip_resolver.ts` now):

Delete the `cachedIndex` module-level variable:

```tsx
// Module-level memo — built once per dictionary identity (which itself is
// fetched once per page session). 10k+ terms × per-line regex would be
// catastrophic; an O(words-in-line) hash lookup is fast.
let cachedIndex: { dict: ISLDictionaryEntry[]; index: Map<string, ISLDictionaryEntry> } | null = null;
```

Delete the `getIndex` function definition (the local copy).

Delete the `tokeniseLine` function definition (the local copy).

Delete the `DEVANAGARI_RE` constant (the local copy).

Delete the `resolveEntry` function definition (the local copy).

After deletion, `chipifyLine` should still call `getIndex`, `tokeniseLine`, and `resolveEntry` — but those calls now resolve to the imported functions.

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Re-run the resolver test**

Run: `npx tsx scripts/test_chip_resolver.ts`
Expected: still passes.

- [ ] **Step 9: Commit**

```bash
git add lib/chip_resolver.ts scripts/test_chip_resolver.ts components/SimplifiedText.tsx
git commit -m "refactor(chip): extract chip resolver into lib/chip_resolver

Single source of truth for which surface forms become ISL chips.
SimplifiedText (renderer) and the upcoming isl_sequencer (player)
both consume from this module so the rendered chip and the
sequenced chip cannot drift. Behaviour-preserving extraction;
tokeniser, dictionary index memo, and Devanagari alias lookup
move verbatim. New regression test pins the contract."
```

---

## Task 3 — Build the sequencer (`lib/isl_sequencer.ts`)

**Files:**
- Create: `scripts/test_isl_sequencer.ts`
- Create: `lib/isl_sequencer.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test_isl_sequencer.ts`:

```ts
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
  { term: "Medicine", videoUrl: "/api/isl-video/medicine" },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test_isl_sequencer.ts`
Expected: FAIL with `Cannot find module '../lib/isl_sequencer'`.

- [ ] **Step 3: Implement `lib/isl_sequencer.ts`**

Create `lib/isl_sequencer.ts`:

```ts
import { tokeniseLine, getIndex, resolveEntry } from "@/lib/chip_resolver";
import type { ISLDictionaryEntry, ISLSequenceItem, Simplification } from "@/lib/types";

/**
 * Walk a simplification's sections in document order and emit one
 * ISLSequenceItem per word token that resolves to a dictionary entry. The
 * floating "play all" player consumes this sequence; SimplifiedText
 * highlights the chip at the current `(sectionIndex, tokenIndex)`.
 *
 * Repeats are included — every occurrence of "doctor" produces its own item.
 * This matches decision (2) in the spec: a deaf user watching the document
 * end-to-end sees the same sign multiple times the same way a hearing user
 * hears the same word multiple times.
 *
 * The walk uses the same tokeniser and resolver SimplifiedText uses for
 * rendering (lib/chip_resolver.ts), so the rendered chip and the sequenced
 * chip are guaranteed to be the same chip.
 */
export function buildSequence(
  simplification: Simplification,
  dictionary: ISLDictionaryEntry[],
): ISLSequenceItem[] {
  if (dictionary.length === 0) return [];
  const index = getIndex(dictionary);
  const out: ISLSequenceItem[] = [];

  simplification.sections.forEach((section, sectionIndex) => {
    // Per-section token ordinal. Increments for every word token (including
    // ones that don't resolve), mirroring SimplifiedText's React keying so
    // the highlight target is identifiable by (sectionIndex, tokenIndex).
    let tokenIndex = 0;
    const lines = section.body.split("\n");
    for (const line of lines) {
      const tokens = tokeniseLine(line);
      for (const tok of tokens) {
        if (!tok.isWord) continue;
        const entry = resolveEntry(tok.text, index);
        if (entry) {
          out.push({
            entry,
            sectionIndex,
            tokenIndex,
            surface: tok.text,
          });
        }
        tokenIndex++;
      }
    }
  });

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test_isl_sequencer.ts`
Expected: every test logs ✓; final `✓ isl_sequencer tests passed`.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/isl_sequencer.ts scripts/test_isl_sequencer.ts
git commit -m "feat(isl): buildSequence() walks simplification sections in order

Pure function. Returns one ISLSequenceItem per word-token that
resolves to a dictionary entry, in document order, including
repeats. Tested against synthetic fixtures covering Latin,
Devanagari, multiline bodies, repeats, and edge cases."
```

---

## Task 4 — Drive-streaming proxy at `/api/isl-video/[fileId]`

**Files:**
- Create: `app/api/isl-video/[fileId]/route.ts`

- [ ] **Step 1: Create the proxy endpoint**

Create `app/api/isl-video/[fileId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// Videos are typically 0.5–5 MB. Allow up to 60s for slow Drive streams.
export const maxDuration = 60;

const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

interface RouteContext {
  params: { fileId: string };
}

/**
 * Stream a Google Drive video file's bytes through our origin to the browser.
 *
 * Why a proxy rather than direct Drive URLs in <video> elements:
 *  - The Drive API key would have to ship in the browser bundle (NEXT_PUBLIC),
 *    which makes it extractable by anyone visiting the site.
 *  - Drive's `?alt=media` 302-redirects to a googleusercontent.com URL whose
 *    CORS headers do not allow <video> playback in many browser/version
 *    combinations, so the browser fetches but cannot render.
 *
 * This proxy reads the API key from server-only env, fetches the bytes,
 * and pipes them straight to the browser response. Memory footprint is one
 * stream-chunk at a time — never the whole video.
 */
export async function GET(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { fileId } = ctx.params;

  if (!fileId || !DRIVE_FILE_ID_RE.test(fileId)) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 404 });
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is not configured to proxy ISL videos." },
      { status: 500 },
    );
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media&key=${encodeURIComponent(apiKey)}`;

  let driveRes: Response;
  try {
    driveRes = await fetch(driveUrl);
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach Drive.", detail: errMessage(err) },
      { status: 502 },
    );
  }

  if (!driveRes.ok) {
    // Surface Drive's status, but don't leak its body (which sometimes
    // contains the API key context in error messages).
    return NextResponse.json(
      { error: "Drive returned an error.", driveStatus: driveRes.status },
      { status: 502 },
    );
  }

  const body = driveRes.body;
  if (!body) {
    return NextResponse.json({ error: "Drive returned no body." }, { status: 502 });
  }

  // Forward Content-Type from Drive (typically video/mp4). Set our own
  // aggressive cache header — file IDs are immutable in the dictionary.
  const contentType = driveRes.headers.get("content-type") ?? "video/mp4";
  const contentLength = driveRes.headers.get("content-length");

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400, immutable",
  };
  if (contentLength) headers["Content-Length"] = contentLength;

  return new Response(body, { status: 200, headers });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-test the proxy**

This step requires the dev server. Start it: `npm run dev`. Wait for `Ready in <Nms>`.

In a separate terminal, find a known good Drive file ID from the dictionary:

Run:
```bash
node -e "const d=require('./data/isl_dictionary.json'); const e=d.find(x=>x.term==='Doctor'); console.log(e.videoUrl);"
```

Expected output: a URL like `https://www.googleapis.com/drive/v3/files/<FILE_ID>?alt=media`. Copy the file ID portion.

Open in a browser: `http://localhost:3000/api/isl-video/<FILE_ID>` (or 3001 if port collision).
Expected: a small video plays, or downloads and plays as a `.mp4`.

Open: `http://localhost:3000/api/isl-video/garbage`
Expected: JSON `{ "error": "Invalid file id." }` with status 404.

Stop the dev server (Ctrl+C or TaskStop).

- [ ] **Step 4: Commit**

```bash
git add app/api/isl-video
git commit -m "feat(isl): /api/isl-video/<fileId> Drive-streaming proxy

Streams Drive bytes through our origin so <video> elements can
play inline without exposing the Drive API key or hitting CORS
restrictions on Drive's redirect target. Aggressive 24h cache;
file IDs are immutable. Validates fileId shape; refuses garbage."
```

---

## Task 5 — Rewrite dictionary URLs to point at the proxy

**Files:**
- Modify: `app/api/isl-dictionary/route.ts`

- [ ] **Step 1: Update `toDriveViewerUrl` to populate both `videoUrl` and `videoFallbackUrl`**

Open `app/api/isl-dictionary/route.ts`. Replace the entire file with:

```ts
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import type { ISLDictionaryEntry } from "@/lib/types";

export const runtime = "nodejs";

// Cache the parsed dictionary across requests within a single server process.
// 10k+ entries; cheap to keep, expensive to re-read.
let baseCache: ISLDictionaryEntry[] | null = null;

export async function GET(): Promise<NextResponse> {
  if (baseCache === null) {
    try {
      const raw = await fs.readFile(
        path.join(process.cwd(), "data", "isl_dictionary.json"),
        "utf-8",
      );
      const parsed = JSON.parse(raw) as unknown;
      baseCache = Array.isArray(parsed) ? (parsed as ISLDictionaryEntry[]) : [];
    } catch {
      baseCache = [];
    }
  }

  // Each entry's `videoUrl` is rewritten to point at our streaming proxy
  // (/api/isl-video/<fileId>) so <video> elements can play it inline. The
  // original Drive viewer URL is preserved as `videoFallbackUrl` for the
  // chip popover's "Open on Drive ↗" footer link and as the fallback when
  // the proxy fails.
  const enriched = baseCache.map((entry) => {
    const fileId = extractDriveFileId(entry.videoUrl);
    if (!fileId) return entry; // unrecognised URL shape; pass through
    return {
      ...entry,
      videoUrl: `/api/isl-video/${fileId}`,
      videoFallbackUrl: `https://drive.google.com/file/d/${fileId}/view`,
    };
  });

  return NextResponse.json(enriched, {
    headers: {
      // Browser may aggressively cache; let it. Bust by restarting server
      // (the dictionary changes only when sync_isl_dictionary.ts re-runs).
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const DRIVE_API_FILE_ID = /googleapis\.com\/drive\/v3\/files\/([^/?#]+)/i;

function extractDriveFileId(url: string): string | null {
  const m = url.match(DRIVE_API_FILE_ID);
  return m ? m[1] : null;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-test the dictionary endpoint**

Start dev server: `npm run dev`. Wait for ready.

Open in a browser: `http://localhost:3000/api/isl-dictionary`
Expected: a large JSON array. Find any entry — its `videoUrl` should look like `/api/isl-video/<fileId>` (not a Drive URL anymore), and `videoFallbackUrl` should look like `https://drive.google.com/file/d/<fileId>/view`.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/isl-dictionary/route.ts
git commit -m "feat(isl): point dictionary videoUrls at the proxy + add videoFallbackUrl

Each ISL dictionary entry's videoUrl now points at /api/isl-video/<fileId>
so <video> elements can play it inline. Drive viewer URL is preserved as
videoFallbackUrl for the popover's external-tab fallback."
```

---

## Task 6 — Inline `<video>` in `ISLTermChip`

**Files:**
- Modify: `components/ISLTermChip.tsx`

- [ ] **Step 1: Replace the popover's Drive-only link with an inline `<video>`**

Open `components/ISLTermChip.tsx`. Locate the popover content, which currently reads:

```tsx
          <p
            className="display mb-3"
            style={{ fontSize: "var(--t-md)" }}
          >
            {entry.term}
          </p>

          <a
            href={entry.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-1 mono"
            style={{
              color: "var(--navy)",
              fontSize: "var(--t-xs)",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            watch the sign on Google Drive <ExternalLink size={11} />
          </a>

          {entry.caption && (
            <p
              className="mt-2"
              style={{ fontSize: "var(--t-xs)", color: "var(--ink-muted)" }}
            >
              {entry.caption}
            </p>
          )}
```

Replace the entire block above with:

```tsx
          <p
            className="display mb-2"
            style={{ fontSize: "var(--t-md)" }}
          >
            {entry.term}
          </p>

          <video
            src={entry.videoUrl}
            controls
            autoPlay
            muted
            playsInline
            preload="auto"
            className="block w-full"
            style={{
              maxWidth: "240px",
              background: "var(--ink-faint)",
            }}
          />

          {entry.caption && (
            <p
              className="mt-2"
              style={{ fontSize: "var(--t-xs)", color: "var(--ink-muted)" }}
            >
              {entry.caption}
            </p>
          )}

          <a
            href={entry.videoFallbackUrl ?? entry.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 mono"
            style={{
              color: "var(--navy)",
              fontSize: "var(--t-xs)",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            open on Drive <ExternalLink size={11} />
          </a>
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual visual smoke test**

Start dev server: `npm run dev`. Open the page, upload `demo_assets/discharge_summary.pdf`, wait for processing.

In the simplified text, find an underlined chip word (like "Doctor" or "Hospital") and click it. Expected: the popover opens, a small video element appears and the sign clip plays inline. Below the video, there is an "open on Drive ↗" link.

Click the "open on Drive" link — opens the Drive viewer in a new tab.

Close the popover. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add components/ISLTermChip.tsx
git commit -m "feat(isl): inline <video> playback in chip popover

The chip's popover now shows a small video element that plays the
ISL sign inline (autoplay, muted, controls). The Drive viewer link
stays as a footer fallback. Unblocked by the new /api/isl-video
proxy that streams Drive bytes through our origin."
```

---

## Task 7 — Wire dictionary fetch + sequence build into `SideBySideViewer`

This task hoists the dictionary fetch from inside `SimplifiedText` into `SideBySideViewer` so both the renderer and the upcoming play-all flow use the same dictionary identity. It also computes the sequence via `useMemo`. After this task, the play-all button isn't visible yet — that comes in Task 9.

**Files:**
- Modify: `components/SimplifiedText.tsx`
- Modify: `components/SideBySideViewer.tsx`

- [ ] **Step 1: Make `SimplifiedText` accept the dictionary as a prop**

Open `components/SimplifiedText.tsx`. Locate:

```tsx
interface Props {
  simplification: Simplification;
}

export function SimplifiedText({ simplification }: Props) {
  const dictionary = useDictionary();
```

Replace with:

```tsx
interface Props {
  simplification: Simplification;
  dictionary: ISLDictionaryEntry[];
}

export function SimplifiedText({ simplification, dictionary }: Props) {
```

DELETE the entire `useDictionary()` hook function from this file (it moves to SideBySideViewer in Step 2):

```tsx
function useDictionary(): ISLDictionaryEntry[] {
  const [entries, setEntries] = useState<ISLDictionaryEntry[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/isl-dictionary");
        if (!res.ok) return;
        const json = (await res.json()) as ISLDictionaryEntry[];
        if (alive && Array.isArray(json)) setEntries(json);
      } catch {
        // Empty dictionary is a valid state — chips just won't appear.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return entries;
}
```

If the imports `useEffect` and `useState` become unused after deletion, remove them from the React import.

Top of file, after deletions, the imports may now look like:

```tsx
import { Fragment } from "react";

import { ISLTermChip } from "@/components/ISLTermChip";
import { tokeniseLine, getIndex, resolveEntry } from "@/lib/chip_resolver";
import type { ISLDictionaryEntry, Simplification } from "@/lib/types";
```

(Adjust based on what your file actually imports — only remove unused symbols.)

- [ ] **Step 2: Add the dictionary fetch + sequence build to `SideBySideViewer`**

Open `components/SideBySideViewer.tsx`. Locate the imports block:

```tsx
"use client";

import { OriginalDocument } from "@/components/OriginalDocument";
import { SimplifiedText } from "@/components/SimplifiedText";
import { ActionItemsPanel } from "@/components/ActionItemsPanel";
import { SafetyBadges } from "@/components/SafetyBadges";
import { AudioPlayer } from "@/components/AudioPlayer";
import { InjectionNotice } from "@/components/InjectionNotice";
import { ReadingFormSlider } from "@/components/ReadingFormSlider";
import { LanguageToggle } from "@/components/LanguageToggle";
import type {
  Extraction,
  FaithfulnessResult,
  InjectionCheckResult,
  ReadingLevel,
  Simplification,
  TargetLanguage,
} from "@/lib/types";
```

Replace with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";

import { OriginalDocument } from "@/components/OriginalDocument";
import { SimplifiedText } from "@/components/SimplifiedText";
import { ActionItemsPanel } from "@/components/ActionItemsPanel";
import { SafetyBadges } from "@/components/SafetyBadges";
import { AudioPlayer } from "@/components/AudioPlayer";
import { InjectionNotice } from "@/components/InjectionNotice";
import { ReadingFormSlider } from "@/components/ReadingFormSlider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { buildSequence } from "@/lib/isl_sequencer";
import type {
  Extraction,
  FaithfulnessResult,
  InjectionCheckResult,
  ISLDictionaryEntry,
  ReadingLevel,
  Simplification,
  TargetLanguage,
} from "@/lib/types";
```

- [ ] **Step 3: Add the dictionary fetch hook inside the component**

Inside the `SideBySideViewer` function body, add **at the very top of the function body** (before any existing logic):

```tsx
  const dictionary = useDictionary();
  const sequence = useMemo(
    () => buildSequence(simplification, dictionary),
    [simplification, dictionary],
  );
```

At the **bottom** of `components/SideBySideViewer.tsx` (after the closing brace of the `SideBySideViewer` function), append:

```tsx
function useDictionary(): ISLDictionaryEntry[] {
  const [entries, setEntries] = useState<ISLDictionaryEntry[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/isl-dictionary");
        if (!res.ok) return;
        const json = (await res.json()) as ISLDictionaryEntry[];
        if (alive && Array.isArray(json)) setEntries(json);
      } catch {
        // Empty dictionary is a valid state — chips just won't appear.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return entries;
}
```

- [ ] **Step 4: Pass `dictionary` down to `SimplifiedText`**

Locate the `<SimplifiedText simplification={simplification} />` line in the JSX. Replace with:

```tsx
            <SimplifiedText simplification={simplification} dictionary={dictionary} />
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual visual smoke test**

Start dev server. Upload the demo doc, wait for processing. Confirm the simplified text still renders chips correctly (Latin and Devanagari, depending on language toggle). The behaviour must be identical to before this task.

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add components/SimplifiedText.tsx components/SideBySideViewer.tsx
git commit -m "refactor(isl): hoist dictionary fetch into SideBySideViewer

The dictionary identity is now owned by SideBySideViewer and passed
down to SimplifiedText as a prop. This unlocks the play-all sequencer
(buildSequence) being computed once via useMemo at the parent level
and shared with the floating player. SimplifiedText behaviour
unchanged."
```

---

## Task 8 — Add `activeChip` highlighting + auto-scroll to `SimplifiedText`

**Files:**
- Modify: `components/SimplifiedText.tsx`

- [ ] **Step 1: Extend Props with `activeChip`**

Open `components/SimplifiedText.tsx`. Locate:

```tsx
interface Props {
  simplification: Simplification;
  dictionary: ISLDictionaryEntry[];
}

export function SimplifiedText({ simplification, dictionary }: Props) {
```

Replace with:

```tsx
interface Props {
  simplification: Simplification;
  dictionary: ISLDictionaryEntry[];
  /** When non-null, the chip at this (sectionIndex, tokenIndex) renders with
   *  a "currently signing" highlight and is scrolled into view. Used by the
   *  play-all flow; null in normal rendering. */
  activeChip?: { sectionIndex: number; tokenIndex: number } | null;
}

export function SimplifiedText({ simplification, dictionary, activeChip = null }: Props) {
```

Top of file, add to the React import:

```tsx
import { Fragment, useEffect, useRef } from "react";
```

(If React is imported as a default + named import, only add `useEffect` and `useRef` to the named portion.)

- [ ] **Step 2: Thread `activeChip` and a ref-registry through the rendering chain**

The rendering chain is `renderBody` → `renderTextWithChips` → `chipifyLine`. Each function needs `sectionIndex` (so the chip can know whether it is the active one) and a per-section tokenIndex counter that increments across all word tokens.

Locate the `renderBody` function:

```tsx
function renderBody(body: string, dictionary: ISLDictionaryEntry[]): React.ReactNode {
  const segments = splitOnCriticalSpans(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "critical" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <Fragment key={i}>{renderTextWithChips(seg.text, dictionary)}</Fragment>
        ),
      )}
    </>
  );
}
```

Replace with:

```tsx
interface RenderContext {
  dictionary: ISLDictionaryEntry[];
  sectionIndex: number;
  /** Mutable ref-cell holding the running token ordinal across the section.
   *  We use a ref-cell rather than a number so all the helpers share the
   *  same counter regardless of how the segments are sliced. */
  tokenCounter: { current: number };
  activeChip: { sectionIndex: number; tokenIndex: number } | null;
  /** Map from "sectionIndex:tokenIndex" → DOM node, populated by chip refs. */
  chipNodeRegistry: Map<string, HTMLElement>;
}

function renderBody(body: string, ctx: RenderContext): React.ReactNode {
  const segments = splitOnCriticalSpans(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "critical" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <Fragment key={i}>{renderTextWithChips(seg.text, ctx)}</Fragment>
        ),
      )}
    </>
  );
}
```

Locate `renderTextWithChips`:

```tsx
function renderTextWithChips(text: string, dictionary: ISLDictionaryEntry[]): React.ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => (
    <Fragment key={lineIdx}>
      {lineIdx > 0 && <br />}
      {chipifyLine(line, dictionary)}
    </Fragment>
  ));
}
```

Replace with:

```tsx
function renderTextWithChips(text: string, ctx: RenderContext): React.ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => (
    <Fragment key={lineIdx}>
      {lineIdx > 0 && <br />}
      {chipifyLine(line, ctx)}
    </Fragment>
  ));
}
```

Locate `chipifyLine`:

```tsx
function chipifyLine(line: string, dictionary: ISLDictionaryEntry[]): React.ReactNode {
  if (dictionary.length === 0 || !line) return line;
  const index = getIndex(dictionary);
  const tokens = tokeniseLine(line);

  return tokens.map((tok, i) => {
    if (!tok.isWord) return <Fragment key={i}>{tok.text}</Fragment>;
    const entry = resolveEntry(tok.text, index);
    if (!entry) return <Fragment key={i}>{tok.text}</Fragment>;
    return <ISLTermChip key={i} label={tok.text} entry={entry} />;
  });
}
```

Replace with:

```tsx
function chipifyLine(line: string, ctx: RenderContext): React.ReactNode {
  if (ctx.dictionary.length === 0 || !line) return line;
  const index = getIndex(ctx.dictionary);
  const tokens = tokeniseLine(line);

  return tokens.map((tok, i) => {
    if (!tok.isWord) return <Fragment key={i}>{tok.text}</Fragment>;
    // Capture this token's ordinal *before* incrementing — every word token
    // (resolved or not) advances the counter so the ordinal matches the
    // sequencer's view (lib/isl_sequencer.ts uses the same rule).
    const tokenIndex = ctx.tokenCounter.current;
    ctx.tokenCounter.current += 1;

    const entry = resolveEntry(tok.text, index);
    if (!entry) return <Fragment key={i}>{tok.text}</Fragment>;

    const isActive =
      ctx.activeChip !== null &&
      ctx.activeChip.sectionIndex === ctx.sectionIndex &&
      ctx.activeChip.tokenIndex === tokenIndex;

    const refKey = `${ctx.sectionIndex}:${tokenIndex}`;

    return (
      <ChipWithRef
        key={i}
        label={tok.text}
        entry={entry}
        isActive={isActive}
        refKey={refKey}
        registry={ctx.chipNodeRegistry}
      />
    );
  });
}
```

- [ ] **Step 3: Add the `ChipWithRef` wrapper at the bottom of the file**

Append to the bottom of `components/SimplifiedText.tsx`:

```tsx
interface ChipWithRefProps {
  label: string;
  entry: ISLDictionaryEntry;
  isActive: boolean;
  refKey: string;
  registry: Map<string, HTMLElement>;
}

/**
 * Wraps ISLTermChip with a ref callback that registers its DOM node in a
 * shared registry, plus a "currently signing" highlight overlay when active.
 * The registry lets the parent (SimplifiedText) scroll the active chip into
 * view via a useEffect on activeChip.
 */
function ChipWithRef({ label, entry, isActive, refKey, registry }: ChipWithRefProps) {
  return (
    <span
      ref={(node) => {
        if (node) registry.set(refKey, node);
        else registry.delete(refKey);
      }}
      data-chip-key={refKey}
      style={{
        display: "inline-block",
        background: isActive ? "var(--navy)" : "transparent",
        color: isActive ? "var(--paper)" : "inherit",
        padding: isActive ? "0 4px" : 0,
        borderRadius: isActive ? "2px" : 0,
        transition: "background 150ms ease, color 150ms ease",
      }}
    >
      <ISLTermChip label={label} entry={entry} />
    </span>
  );
}
```

- [ ] **Step 4: Build the registry and run the auto-scroll effect inside `SimplifiedText`**

Locate the `SimplifiedText` function body. It currently looks roughly like:

```tsx
export function SimplifiedText({ simplification, dictionary, activeChip = null }: Props) {
  return (
    <div className="space-y-10">
      {simplification.sections.map((section, idx) => (
        <section key={idx}>
          <h3 ...>
            {section.heading}
          </h3>
          <div ...>
            {renderBody(section.body, dictionary)}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Replace the function body with:

```tsx
export function SimplifiedText({ simplification, dictionary, activeChip = null }: Props) {
  // Map from "sectionIdx:tokenIdx" → chip DOM node, populated by ref callbacks
  // during render. Persists across re-renders so the auto-scroll effect can
  // find the active chip without rebuilding the map.
  const chipNodeRegistry = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!activeChip) return;
    const node = chipNodeRegistry.current.get(`${activeChip.sectionIndex}:${activeChip.tokenIndex}`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeChip]);

  return (
    <div className="space-y-10">
      {simplification.sections.map((section, idx) => {
        const ctx: RenderContext = {
          dictionary,
          sectionIndex: idx,
          tokenCounter: { current: 0 },
          activeChip,
          chipNodeRegistry: chipNodeRegistry.current,
        };
        return (
          <section key={idx}>
            <h3
              className="display mb-3"
              style={{
                fontSize: "var(--t-lg)",
                color: "var(--ink)",
                fontVariationSettings: '"opsz" 32',
              }}
            >
              {section.heading}
            </h3>
            <div
              style={{
                fontSize: "var(--t-md)",
                lineHeight: 1.65,
                color: "var(--ink)",
              }}
            >
              {renderBody(section.body, ctx)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run the chip-resolver regression test (sanity)**

Run: `npx tsx scripts/test_chip_resolver.ts`
Expected: still passes (the resolver wasn't touched, but cheap to confirm).

- [ ] **Step 7: Manual visual smoke test**

Start dev server, upload demo doc, confirm the simplified text still renders chips identically. Click a chip — popover opens, video plays. No "active" highlight is visible because nothing has set `activeChip` yet (that comes in Task 9).

Stop dev server.

- [ ] **Step 8: Commit**

```bash
git add components/SimplifiedText.tsx
git commit -m "feat(isl): activeChip highlight + auto-scroll in SimplifiedText

SimplifiedText now accepts an optional activeChip prop. The chip at
that (sectionIndex, tokenIndex) renders with a navy 'currently signing'
highlight and is scrolled into view. Token ordinals are computed during
render via a counter ref-cell, matching the rule used by buildSequence
so highlight target and player video stay synced."
```

---

## Task 9 — `ISLPlayAllButton` and `ISLPlayAllPlayer` components

**Files:**
- Create: `components/ISLPlayAllButton.tsx`
- Create: `components/ISLPlayAllPlayer.tsx`

- [ ] **Step 1: Create the button**

Create `components/ISLPlayAllButton.tsx`:

```tsx
"use client";

import { Hand } from "lucide-react";

interface Props {
  onClick: () => void;
  disabled: boolean;
  /** Number of signs in the sequence; used in the button label and tooltip. */
  count: number;
}

/**
 * Toolbar button that opens the play-all floating player. Sits next to the
 * AudioPlayer in SideBySideViewer; matches its visual idiom (small button,
 * mono-label legend on the right). Disabled when the sequence is empty —
 * which can happen if the simplified text has no chip-matching tokens (e.g.
 * a Hindi-only document where the alias map missed every term).
 */
export function ISLPlayAllButton({ onClick, disabled, count }: Props) {
  return (
    <div
      className="inline-flex items-center gap-1 border"
      style={{ borderColor: "var(--ink-faint)" }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={
          disabled
            ? "No ISL signs in this text"
            : `Play all ${count} signs in this document`
        }
        title={disabled ? "no ISL signs in this text" : `play all ${count} signs`}
        className="px-2.5 py-2 hover:bg-[color:var(--paper-sunk)] transition-colors"
        style={{
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <Hand size={13} strokeWidth={2} />
      </button>
      <span
        className="mono-label px-3"
        style={{
          color: disabled ? "var(--ink-quiet)" : "var(--navy)",
          borderLeft: "var(--hairline)",
        }}
      >
        {disabled ? "no signs" : `play all signs (${count})`}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create the player**

Create `components/ISLPlayAllPlayer.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward, X, RotateCcw, ExternalLink } from "lucide-react";

import type { ISLSequenceItem } from "@/lib/types";

interface Props {
  sequence: ISLSequenceItem[];
  currentIndex: number;
  status: "playing" | "paused" | "complete";
  /** Heading of the section the current chip belongs to, for context. */
  currentSectionHeading: string;
  onAdvance: () => void;
  onPauseToggle: () => void;
  onStop: () => void;
  onReplay: () => void;
}

/**
 * Floating player for the ISL play-all sequence. Bottom-right of the
 * viewport. Owns the <video> element and the failure-handling timer; the
 * parent owns sequence/index/status state. ESC closes; click-outside does
 * NOT close (the user might be reading mid-playback).
 */
export function ISLPlayAllPlayer({
  sequence,
  currentIndex,
  status,
  currentSectionHeading,
  onAdvance,
  onPauseToggle,
  onStop,
  onReplay,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [errored, setErrored] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const item = sequence[currentIndex];

  // Reset error state and clear pending auto-advance timer whenever the
  // current item changes (advance, replay, etc.).
  useEffect(() => {
    setErrored(false);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, [currentIndex, status]);

  // Reflect status into the <video> element's playback. status="playing" =>
  // video should be playing; status="paused" => video should be paused;
  // status="complete" => video stays paused on its last frame (don't poke it).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (status === "playing") void v.play().catch(() => {/* autoplay blocked */});
    else if (status === "paused") v.pause();
  }, [status, currentIndex]);

  // ESC closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onStop();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStop]);

  // Cleanup any pending timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  if (!item) return null;

  const handleEnded = () => {
    if (status === "complete") return;
    onAdvance();
  };

  const handleError = () => {
    setErrored(true);
    // Auto-advance after 3s if the user does nothing; lets the playback flow
    // recover from a single broken sign without manual intervention.
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => onAdvance(), 3000);
  };

  return (
    <div
      role="dialog"
      aria-label="Indian Sign Language playback"
      style={{
        position: "fixed",
        right: "24px",
        bottom: "24px",
        zIndex: 40,
        width: "320px",
        background: "var(--paper)",
        border: "1px solid var(--ink)",
        boxShadow: "0 8px 24px -8px rgba(0,0,0,0.18)",
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: "var(--hairline)" }}
      >
        <div className="min-w-0">
          <p
            className="mono-label"
            style={{ fontSize: "10px", color: "var(--navy)" }}
          >
            — Indian Sign Language
          </p>
          <p
            className="truncate"
            style={{ fontSize: "var(--t-sm)", fontWeight: 500 }}
          >
            {item.entry.term}
          </p>
          <p
            className="truncate"
            style={{ fontSize: "var(--t-xs)", color: "var(--ink-muted)" }}
          >
            {currentSectionHeading} · {currentIndex + 1} / {sequence.length}
          </p>
        </div>
        <button
          type="button"
          onClick={onStop}
          aria-label="Close ISL playback"
          className="flex items-center justify-center transition-colors"
          style={{
            width: "24px",
            height: "24px",
            color: "var(--ink-quiet)",
            background: "transparent",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div style={{ background: "var(--ink-faint)" }}>
        {errored ? (
          <div className="px-3 py-6 text-center" style={{ minHeight: "180px" }}>
            <p
              style={{
                fontSize: "var(--t-sm)",
                color: "var(--ink-muted)",
                lineHeight: 1.5,
              }}
            >
              couldn&rsquo;t load this sign
            </p>
            {item.entry.videoFallbackUrl && (
              <a
                href={item.entry.videoFallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 mono"
                style={{
                  color: "var(--navy)",
                  fontSize: "var(--t-xs)",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                open on Drive <ExternalLink size={11} />
              </a>
            )}
            <p
              className="mt-2"
              style={{ fontSize: "10px", color: "var(--ink-quiet)", fontStyle: "italic" }}
            >
              skipping in 3s…
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            key={`${currentIndex}-${item.entry.videoUrl}`}
            src={item.entry.videoUrl}
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={handleEnded}
            onError={handleError}
            className="block w-full"
            style={{ maxHeight: "240px", background: "var(--ink-faint)" }}
          />
        )}
      </div>

      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderTop: "var(--hairline)" }}
      >
        {status === "complete" ? (
          <>
            <button
              type="button"
              onClick={onReplay}
              className="inline-flex items-center gap-1.5 mono"
              style={{
                color: "var(--navy)",
                fontSize: "var(--t-xs)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
                cursor: "pointer",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
              aria-label="Replay all signs"
            >
              <RotateCcw size={12} strokeWidth={2} />
              replay
            </button>
            <button
              type="button"
              onClick={onStop}
              className="mono"
              style={{
                color: "var(--ink-quiet)",
                fontSize: "var(--t-xs)",
                cursor: "pointer",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
              aria-label="Close"
            >
              close
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPauseToggle}
                aria-label={status === "paused" ? "Resume playback" : "Pause playback"}
                className="px-2 py-1 hover:bg-[color:var(--paper-sunk)] transition-colors"
                style={{ background: "transparent", border: "1px solid var(--ink-faint)", cursor: "pointer" }}
              >
                {status === "paused" ? (
                  <Play size={12} strokeWidth={2} />
                ) : (
                  <Pause size={12} strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                onClick={onAdvance}
                aria-label="Skip to next sign"
                className="px-2 py-1 hover:bg-[color:var(--paper-sunk)] transition-colors"
                style={{ background: "transparent", border: "1px solid var(--ink-faint)", cursor: "pointer" }}
              >
                <SkipForward size={12} strokeWidth={2} />
              </button>
            </div>
            <span
              className="mono-label"
              style={{ fontSize: "10px", color: "var(--ink-quiet)" }}
            >
              {status === "paused" ? "paused" : "playing"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/ISLPlayAllButton.tsx components/ISLPlayAllPlayer.tsx
git commit -m "feat(isl): ISLPlayAllButton + ISLPlayAllPlayer components

Button mirrors the AudioPlayer toolbar idiom; player is a fixed
bottom-right floating dialog with header (term + section + n/total),
video body, and a controls strip that swaps to Replay/Close on
completion. Player owns video element + error timer; parent owns
sequence/index/status. ESC closes; click-outside does not."
```

---

## Task 10 — Wire the playback flow into `SideBySideViewer`

**Files:**
- Modify: `components/SideBySideViewer.tsx`

- [ ] **Step 1: Add imports**

In `components/SideBySideViewer.tsx`, locate:

```tsx
import { LanguageToggle } from "@/components/LanguageToggle";
import { buildSequence } from "@/lib/isl_sequencer";
```

Add immediately after:

```tsx
import { ISLPlayAllButton } from "@/components/ISLPlayAllButton";
import { ISLPlayAllPlayer } from "@/components/ISLPlayAllPlayer";
```

- [ ] **Step 2: Add playback state and handlers**

Inside the `SideBySideViewer` function body, locate the existing block:

```tsx
  const dictionary = useDictionary();
  const sequence = useMemo(
    () => buildSequence(simplification, dictionary),
    [simplification, dictionary],
  );
```

Append immediately after that block:

```tsx
  const [playback, setPlayback] = useState<{
    currentIndex: number;
    status: "playing" | "paused" | "complete";
  } | null>(null);

  // Reset playback whenever the underlying simplification changes (form /
  // language regenerate, or new document upload). Cleanest resolution.
  useEffect(() => {
    setPlayback(null);
  }, [simplification]);

  const handlePlayAll = () => {
    if (sequence.length === 0) return;
    setPlayback({ currentIndex: 0, status: "playing" });
  };

  const handleAdvance = () => {
    setPlayback((p) => {
      if (!p) return p;
      if (p.currentIndex >= sequence.length - 1) {
        return { ...p, status: "complete" };
      }
      return { currentIndex: p.currentIndex + 1, status: "playing" };
    });
  };

  const handlePauseToggle = () => {
    setPlayback((p) => {
      if (!p || p.status === "complete") return p;
      return { ...p, status: p.status === "playing" ? "paused" : "playing" };
    });
  };

  const handleStop = () => setPlayback(null);
  const handleReplay = () => setPlayback({ currentIndex: 0, status: "playing" });

  const activeChip = playback
    ? {
        sectionIndex: sequence[playback.currentIndex].sectionIndex,
        tokenIndex: sequence[playback.currentIndex].tokenIndex,
      }
    : null;

  const currentSectionHeading = playback
    ? simplification.sections[sequence[playback.currentIndex].sectionIndex]?.heading ?? ""
    : "";
```

- [ ] **Step 3: Render the button next to AudioPlayer and the player at the end**

Locate the existing slider/audio row in JSX:

```tsx
            <AudioPlayer simplification={simplification} language={language} />
          </div>
```

Replace the `<AudioPlayer ... />` line with:

```tsx
            <div className="flex items-center gap-3 flex-wrap">
              <AudioPlayer simplification={simplification} language={language} />
              <ISLPlayAllButton
                onClick={handlePlayAll}
                disabled={sequence.length === 0 || playback !== null}
                count={sequence.length}
              />
            </div>
          </div>
```

Locate the existing `<SimplifiedText simplification={simplification} dictionary={dictionary} />` line. Replace with:

```tsx
            <SimplifiedText
              simplification={simplification}
              dictionary={dictionary}
              activeChip={activeChip}
            />
```

At the very end of the `<section>...</section>` JSX returned by `SideBySideViewer` (just before the closing `</section>`), add:

```tsx
      {playback !== null && sequence[playback.currentIndex] && (
        <ISLPlayAllPlayer
          sequence={sequence}
          currentIndex={playback.currentIndex}
          status={playback.status}
          currentSectionHeading={currentSectionHeading}
          onAdvance={handleAdvance}
          onPauseToggle={handlePauseToggle}
          onStop={handleStop}
          onReplay={handleReplay}
        />
      )}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Run all unit tests**

Run: `npx tsx scripts/test_chip_resolver.ts`
Expected: passes.

Run: `npx tsx scripts/test_isl_sequencer.ts`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add components/SideBySideViewer.tsx
git commit -m "feat(isl): wire play-all flow — button, player, active highlight

SideBySideViewer holds playback state (currentIndex + status), renders
ISLPlayAllButton next to AudioPlayer, mounts ISLPlayAllPlayer when
playback is active, and threads activeChip to SimplifiedText so the
current sign's word in the text is highlighted and scrolled into
view. Switching reading-form / language resets playback to null."
```

---

## Task 11 — End-to-end manual verification

**Files:**
- None (read-only verification)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: `Ready in <Nms>`. Note the port.

- [ ] **Step 2: Walk through the play-all flow**

Open the URL the dev server printed. Upload `demo_assets/discharge_summary.pdf`. After processing, the side-by-side view appears.

  1. **Button appears, enabled, with count.** Next to the AudioPlayer, see "play all signs (N)" where N is a positive number (around 15–40 for the demo doc).
  2. **Click the button.** A floating player appears bottom-right showing the first chip's term and section. The video plays automatically. The corresponding word in the simplified text is highlighted (navy background, white text).
  3. **Auto-advance.** When the video ends, the next sign loads automatically; the highlight moves to the next chip; the page scrolls if the new chip is offscreen.
  4. **Pause / resume.** Click the pause icon — video pauses, status legend changes to "paused". Click play — resumes.
  5. **Skip-next.** Click the skip-forward icon — advances immediately to the next sign.
  6. **Stop.** Click the × in the player header — player closes, all highlights clear.
  7. **Run to completion.** Click "play all signs" again. Use skip-next to walk to the last sign quickly. When the last video ends (or you skip past it), the controls strip swaps to "replay" and "close". The video stays on its last frame.
  8. **Replay.** Click "replay" — playback restarts from index 0.
  9. **Close.** Click "close" — player disappears.
  10. **Hindi mode.** Toggle the language slider to हिन्दी. Wait for regeneration. The player auto-closes (correct). After regeneration finishes, click "play all signs" again — the sequence rebuilds from the Hindi text; Devanagari chips highlight correctly.
  11. **Mid-playback toggle.** Start playback, then while it's playing toggle the form slider to "list". The simplification regenerates; the player closes cleanly. After regeneration, the button shows the new count.
  12. **ESC key.** During playback, press Escape. Player closes.

- [ ] **Step 3: Verify the proxy is being used (DevTools)**

While the player is mid-playback, open DevTools → Network tab. The video requests should go to `/api/isl-video/<fileId>` (your origin), not `googleapis.com` directly. Status codes: 200 with `Content-Type: video/mp4` and `Cache-Control: public, max-age=86400, immutable`.

Replay the sequence — the same video URLs should now return from cache (status 200 (from disk cache) or similar) without re-fetching from the proxy.

- [ ] **Step 4: Stop the dev server**

Use TaskStop or Ctrl+C.

- [ ] **Step 5: Final typecheck and unit tests**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx tsx scripts/test_chip_resolver.ts && npx tsx scripts/test_isl_sequencer.ts`
Expected: both pass.

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Self-review

**Spec coverage:**

- Decision 1 (server-side proxy) → Task 4 (`/api/isl-video/[fileId]/route.ts`).
- Decision 2 (every occurrence in document order) → Task 3 (`buildSequence`) + the `repeatsAllowedTest` and `documentOrderTest` cases.
- Decision 3 (floating player + text highlight + auto-scroll) → Task 8 (highlight + scrollIntoView), Task 9 (player), Task 10 (wiring + activeChip).
- Decision 4 (Replay / Close on completion) → Task 9 (player's `complete` branch), Task 10 (`handleReplay`).
- Component: `app/api/isl-video/[fileId]/route.ts` → Task 4.
- Component: `app/api/isl-dictionary/route.ts` modification → Task 5.
- Component: `lib/types.ts` (`videoFallbackUrl`, `ISLSequenceItem`) → Task 1.
- Component: `components/ISLTermChip.tsx` (inline video) → Task 6.
- Component: `lib/chip_resolver.ts` → Task 2.
- Component: `lib/isl_sequencer.ts` → Task 3.
- Component: `components/ISLPlayAllButton.tsx` → Task 9.
- Component: `components/ISLPlayAllPlayer.tsx` → Task 9.
- Component: `components/SimplifiedText.tsx` (resolver import + `activeChip`) → Task 2 (Step 5–6 import) + Task 7 (dictionary prop) + Task 8 (`activeChip` + auto-scroll).
- Component: `components/SideBySideViewer.tsx` (sequence + playback) → Task 7 (dictionary fetch + sequence) + Task 10 (playback + button + player).
- Error handling — proxy failure → Task 9 (`handleError` + 3s auto-advance + Drive fallback link); empty sequence → Task 9 (button disabled state); sim regenerate during playback → Task 10 (`useEffect([simplification])` resets playback); ESC → Task 9 (keydown listener).
- Testing — sequencer unit → Task 3; resolver regression → Task 2; manual end-to-end → Task 11; proxy verification → Task 11 Step 3.
- Out-of-scope items (variable speed, scrubber, captions, pre-buffering, server-side concat, hosting clips) → not addressed, correctly.

**Placeholder scan:** every step has executable content. No "TODO" / "TBD" / "implement later" / "similar to Task N". Code blocks are complete. Commands have expected output.

**Type consistency:**
- `ISLSequenceItem` (Task 1) used in Task 3 (`buildSequence` return), Task 9 (`Props.sequence`) — match.
- `videoFallbackUrl` (Task 1) used in Task 5 (route populates), Task 6 (chip footer), Task 9 (player error fallback) — match.
- `tokeniseLine`, `getIndex`, `resolveEntry` (Task 2) used in Task 3 (sequencer) and Task 8 (SimplifiedText render) — match.
- `RenderContext` (Task 8) used internally in `chipifyLine` / `renderTextWithChips` / `renderBody` — match within Task 8.
- `chipNodeRegistry` map keys: format `"${sectionIndex}:${tokenIndex}"`. Set in `ChipWithRef`, read in `useEffect` — match.
- `playback` shape `{ currentIndex, status }` (Task 10) — passed to `ISLPlayAllPlayer` (Task 9) which destructures the same fields — match.
- `activeChip` shape `{ sectionIndex, tokenIndex }` — Task 10 derives it; Task 8 consumes it; both agree — match.

No gaps, no contradictions.
