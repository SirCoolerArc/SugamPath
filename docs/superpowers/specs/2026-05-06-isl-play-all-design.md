# ISL "Play All" — sequenced playback over the simplified text

**Checkpoint:** Stage 2 follow-up (not numbered in CLAUDE.md §8 — added during the post-6.1 review)
**Date:** 2026-05-06
**Status:** approved, ready for implementation plan

---

## Overview

A "Play all signs" button next to the existing audio player walks every ISL chip in the simplified text in document order. While playing, a floating player shows the current sign clip; the corresponding chip in the text is highlighted as a "you are here" cursor. The user controls playback (pause, skip-next, stop) and on completion sees a clear "Replay / Close" pair. Inline video playback works because a new server-side proxy at `/api/isl-video/<id>` streams the bytes from Google Drive — keeping the API key on the server and side-stepping CORS. The existing per-chip popover behaviour stays unchanged.

The headline shift: chips stop being a *lookup tool* and become an optional *primary consumption mode*. A profoundly deaf user can press one button and watch the document signed end-to-end without reading. This addresses the strongest gap in the product as it stood after 6.1: the existing chip system assumed a literate user who occasionally needed a sign, not a sign-fluent user who needed the document.

---

## Decisions

The four questions answered during brainstorming:

1. **Video transport: server-side proxy.** A new `/api/isl-video/<fileId>` endpoint streams Drive bytes to the browser. The Drive API key stays on the server. CORS is sidestepped (browser → our origin only). The alternative — embedding a public-prefixed key in the browser bundle — was rejected because (a) Drive API keys can't be safely public on a public site, and (b) Drive's `?alt=media` 302-redirects to a `googleusercontent.com` URL whose CORS headers don't allow browser playback in many cases.
2. **"All" means every chip occurrence in document order, including repeats.** Sign-language users see the same sign twice without confusion the same way hearing users hear the same word twice. The skip-next control covers users who want to jump past a clip they already know. The alternatives — unique-only ("II", glossary-shaped) and per-section ("III", chunked) — both lose the "watch the document end-to-end in ISL" promise that motivated the feature.
3. **Floating player + synchronised text highlight.** The video plays in a fixed-position floating player (bottom-right, ~320×260px). The corresponding chip in the simplified text is highlighted with a "currently signing" treatment. Auto-scroll-into-view nudges the highlighted chip on screen if it's not already visible. The alternatives — inline-popover-only (auto-scroll fights the user; popover too small for comfortable video) and floating-only (loses text-context coupling) — both gave up real value.
4. **On completion: stay open with Replay / Close.** The last chip's highlight stays briefly. The player shows two clear actions. Quiet auto-close was rejected because a deaf user who just watched a 90-second sequence is exactly the user most likely to want a second pass.

---

## Components

### New endpoint: `app/api/isl-video/[fileId]/route.ts`

- `GET /api/isl-video/<fileId>` → streams the video bytes from Drive's `files.get?alt=media` endpoint to the browser.
- The Drive API key reads from `process.env.GOOGLE_DRIVE_API_KEY` (already present, used by `sync_isl_dictionary.ts`).
- **Streams, doesn't buffer.** Pipes Drive's response body straight to the Next.js response so a 5 MB clip doesn't sit in our server's memory. Use the response body's `ReadableStream` and return it with `new Response(body, { headers })`.
- **Caching:** sets `Cache-Control: public, max-age=86400, immutable`. Forwards `Content-Type` from Drive's response. Browsers cache aggressively per file ID; signing the same chip twice in one session = one network call.
- **Validation:** `fileId` matched against `/^[A-Za-z0-9_-]{20,}$/` (Drive file IDs). Garbage → 404.
- **Errors:** Drive 4xx/5xx → 502 with a small JSON body. Network failure → 502.
- The chip's existing "Watch on Google Drive" tab fallback covers any case where the proxy is down.

### Modified: `app/api/isl-dictionary/route.ts`

- Currently rewrites Drive `?alt=media` URLs to `drive.google.com/file/d/<id>/view` (a tab-opening viewer URL).
- Will rewrite to `/api/isl-video/<fileId>` (our proxy) instead. This is the single point where the URL transformation happens, so the rest of the app sees inline-playable URLs everywhere.
- The Drive viewer URL is preserved as a new `videoFallbackUrl` field on the dictionary entry. The `ISLTermChip`'s "Watch on Google Drive" link uses this; no functionality lost.

### Modified: `lib/types.ts`

`ISLDictionaryEntry` gains an optional field:

```ts
export interface ISLDictionaryEntry {
  term: string;
  aliases?: string[];
  videoUrl: string;             // now points at /api/isl-video/<fileId>
  videoFallbackUrl?: string;    // NEW — the Drive viewer URL
  caption?: string;
}
```

Plus a new exported type for sequence items (defined inline near the new sequencer module, below; declaration lives in `types.ts` for cross-module use):

```ts
export interface ISLSequenceItem {
  entry: ISLDictionaryEntry;
  sectionIndex: number; // index into Simplification.sections
  tokenIndex: number;   // ordinal of the chipped token within that section's body
  surface: string;      // the surface form ("Doctor" or "डॉक्टर") that resolved to this entry
}
```

### Modified: `components/ISLTermChip.tsx`

- The popover currently shows a Drive link only. Will show an inline `<video src={entry.videoUrl} controls muted playsInline autoPlay />`.
- The Drive viewer link stays as a small footer "Open on Drive ↗", using `entry.videoFallbackUrl` (falls back to `entry.videoUrl` if missing).
- `autoPlay muted` is required for the browser to allow autoplay without user gesture (which we have — the click — but `muted` keeps autoplay reliable across browsers; the videos are silent anyway).

### New module: `lib/chip_resolver.ts`

Targeted refactor in service of the new feature. Currently `SimplifiedText.tsx` owns:

- The Devanagari + Latin tokeniser
- The `getIndex()` memoised dictionary index builder
- The `resolveEntry()` Devanagari-alias-aware lookup

These move to `lib/chip_resolver.ts` as exported pure functions. Both `SimplifiedText.tsx` (rendering chips) and `lib/isl_sequencer.ts` (building the playback sequence) consume from this module. Single source of truth: the chip the user sees and the chip the sequencer plays must be the same chip.

API surface:

```ts
export function tokeniseLine(line: string): Array<{ text: string; isWord: boolean }>;
export function getIndex(dictionary: ISLDictionaryEntry[]): Map<string, ISLDictionaryEntry>;
export function resolveEntry(
  surface: string,
  index: Map<string, ISLDictionaryEntry>,
): ISLDictionaryEntry | undefined;
```

Module-level memo on `getIndex()` preserved (current behaviour: rebuild only when dictionary identity changes).

### New module: `lib/isl_sequencer.ts`

Pure logic, no React. One exported function:

```ts
export function buildSequence(
  simplification: Simplification,
  dictionary: ISLDictionaryEntry[],
): ISLSequenceItem[];
```

Walks `simplification.sections` in order. For each section's `body`:

- splits on lines (preserving the same `\n` boundaries `SimplifiedText` uses)
- tokenises each line via `tokeniseLine`
- runs `resolveEntry` on each word token via `getIndex(dictionary)`
- collects matched tokens with their `sectionIndex` and a per-section `tokenIndex` (incrementing 0, 1, 2 across all word-tokens in that section, matching the React key SimplifiedText uses)

Decision (2): every occurrence is included, including repeats. A "doctor" mentioned 8 times produces 8 sequence items.

The Hindi alias map is consumed inside `resolveEntry` already (no change). The sequencer itself does not import the alias map directly.

### New component: `components/ISLPlayAllButton.tsx`

- Sits next to `<AudioPlayer>` in `SideBySideViewer`. Same toolbar-button visual idiom: a small button with a `Hand` icon and the label `play all signs`.
- Disabled when the sequence is empty. Disabled state shows a tooltip *"no ISL signs in this text"*.
- One prop: `onClick: () => void`. Pressing it opens the floating player.

### New component: `components/ISLPlayAllPlayer.tsx`

- Fixed-position floating player. Bottom-right of viewport, `~320×260px`. `position: fixed; bottom: 24px; right: 24px;`. `z-index` above the side-by-side content but below the modal layer (no modal exists; safe to use a moderate z-index like 40).
- Layout, top-to-bottom:
  1. Header strip: current term label (`entry.term`) plus the section heading it came from (`Your medicines · 8 / 23`).
  2. Video: `<video src={entry.videoUrl} autoPlay controls={false} muted playsInline ref={videoRef}>` — fills the body area. Listens to `onEnded`, `onError`. (`entry.videoUrl` already points at our proxy `/api/isl-video/<fileId>` after the dictionary route's URL transformation; no client-side parsing needed.)
  3. Controls strip: pause/resume button, skip-next button, stop (close) button.
- Props: `sequence: ISLSequenceItem[]`, `currentIndex: number`, `status: "playing" | "paused" | "complete"`, `onAdvance(): void`, `onPauseToggle(): void`, `onStop(): void`, `onReplay(): void`.
- On `complete`: replaces the controls strip with `Replay` and `Close` buttons. Video element stays mounted, paused on its last frame.
- ESC closes the player (calls `onStop`). Click outside does **not** close.
- Skip-next behaves identically to `onEnded` — calls `onAdvance` (parent moves to next index, or transitions to `complete`).
- `onError` (proxy failed): renders a small inline message *"couldn't load this sign"* with a `videoFallbackUrl` link, and starts a 3-second auto-advance timer. User can click skip-next or the link before the timer fires.

### Modified: `components/SimplifiedText.tsx`

1. **Mechanical move:** import `tokeniseLine`, `getIndex`, `resolveEntry`, `DEVANAGARI_RE` from the new `lib/chip_resolver.ts`. Drop the local definitions. Visual rendering unchanged.
2. **New optional prop** `activeChip: { sectionIndex: number; tokenIndex: number } | null`. When non-null, the chip at that location renders with the "currently signing" highlight: filled `var(--navy)` background, white (`var(--paper)`) text, soft pulse-once on entry (200ms scale 1.0 → 1.04 → 1.0). The non-active rendering is unchanged.
3. **Auto-scroll-into-view:** when `activeChip` changes, scroll the active chip into view if it's not already visible. Use `scrollIntoView({ behavior: "smooth", block: "nearest" })`. The chip needs a stable ref keyed by `(sectionIndex, tokenIndex)` — easiest implementation is a ref callback that registers each rendered chip's DOM node into a parent-component-managed map. Effect runs on `activeChip` change.

### Modified: `components/SideBySideViewer.tsx`

- Builds the sequence via `useMemo(() => buildSequence(simplification, dictionary), [simplification, dictionary])`. Dictionary fetched the same way `SimplifiedText` already does (or hoisted into `SideBySideViewer` and passed down — see implementation plan for the cleanest decomposition).
- New state: `playback: { currentIndex: number; status: "playing" | "paused" | "complete" } | null`.
- Renders `<ISLPlayAllButton onClick={...} />` next to `<AudioPlayer>`.
- When `playback !== null`: renders `<ISLPlayAllPlayer />` with the sequence, current index, status, and the four callbacks.
- Computes `activeChip` from `sequence[playback.currentIndex]` when `playback !== null`, else `null`. Passes to `<SimplifiedText activeChip={...} />`.
- When the parent `simplification` prop changes (form / language regenerate), `playback` resets to `null`. Cleanest resolution per error-handling decision.

### Untouched (deliberately):

- `lib/renderers.ts`, `lib/faithfulness.ts`, `lib/intent.ts` — out of scope.
- `prompts/*` — out of scope. The simplifier emits the same text it does today; the sequencer is a pure consumer of that text.
- `data/isl_dictionary.json` — untouched. The video URL transformation happens at API serve time, not in the source data.
- `data/hindi_isl_aliases.ts` — untouched. The chip resolver continues to use it as-is.

---

## Data flow

```
mount of result view
   │
   ▼
useMemo: buildSequence(simplification, dictionary)
   ├─ walks each section body in order
   ├─ tokeniseLine() over each line in the body
   ├─ resolveEntry() on each word token (Latin + Devanagari)
   └─ collects { entry, sectionIndex, tokenIndex, surface } in document order
   │
   ▼
sequence stored in component state. ISLPlayAllButton enabled if sequence.length > 0.

────────────────────────────────────────

user clicks "Play all signs"
   │
   ▼
playback = { currentIndex: 0, status: "playing" }
   │
   ▼
ISLPlayAllPlayer renders, sets <video src="/api/isl-video/<sequence[0].entry.videoUrl-derived-id>" autoPlay/>
SimplifiedText receives activeChip = { sectionIndex: S0, tokenIndex: T0 } → that chip renders highlighted, scrolled into view.

────────────────────────────────────────

video <onEnded>
   │
   ├─ if currentIndex < sequence.length - 1:
   │     currentIndex += 1
   │     <video> src updates → autoplays the next clip
   │     activeChip updates → previous chip highlight clears, next chip highlights
   │
   └─ else:
         status = "complete"
         video stays paused on last frame
         player shows "Replay / Close" buttons

────────────────────────────────────────

user controls
   ├─ pause: video.pause(); status = "paused"
   ├─ skip-next: behave as if onEnded fired — advance one
   ├─ stop: playback = null (player closes, all highlights clear)
   ├─ Replay (only in complete state): currentIndex = 0; status = "playing"
   └─ Close (only in complete state): playback = null
```

The proxy (`/api/isl-video/<id>`) is on the data path of every video request. The browser caches each clip after the first fetch, so a Replay run is local-only (no Drive calls).

---

## Error handling

- **Proxy fails (Drive 5xx, network):** `<video onError>` fires. Player shows the current term's label, an inline message *"couldn't load this sign — try opening on Drive"*, and a `Visit ↗` link to `videoFallbackUrl`. A 3-second auto-advance timer starts; user can click skip-next or the link before it fires.
- **Proxy returns wrong content type:** same as above (`onError` covers it).
- **Sequence empty:** `<ISLPlayAllButton>` disabled with tooltip *"no ISL signs in this text"*.
- **User clicks "Play all" while a per-chip popover is open:** the popover closes (existing outside-click logic), the floating player takes over.
- **User changes reading-form or language while playing:** simplification regenerates → `useMemo` rebuilds the sequence with new `simplification` identity → `useEffect` resets `playback` to `null`. Player closes.
- **User uploads a new document mid-playback:** stage transitions from `result` to `processing`, side-by-side unmounts, player unmounts. No special handling needed.
- **`<video>` autoplay blocked:** every browser permits muted autoplay after user gesture; the user's "Play all" click is the gesture. Should not occur in practice. If it does, the player surfaces a "click to play" overlay on the first video.

---

## Testing

- **`scripts/test_isl_sequencer.ts`** (new): unit-style tests for `buildSequence()`. Hand-construct small `Simplification` fixtures (or load the cached extraction's simplification) and assert:
  - sequence length matches the count of chip-matching word tokens in the body (verified by an independent walk of the same body)
  - sequence is in document order (ascending `sectionIndex`, then ascending `tokenIndex` within each section)
  - duplicates allowed — a hand-crafted body containing "doctor" 3 times produces 3 sequence items with the same entry
  - Hindi-only body produces the right entries via the alias map (e.g. "डॉक्टर" → the Doctor entry)
  - empty body produces empty sequence
  - body containing only non-chip words produces empty sequence
- **`chip_resolver.ts` regression**: visual eyeball of the demo doc in the dev server before and after the resolver extraction. Same chips, same positions, same Hindi behaviour.
- **End-to-end manual** with the demo discharge summary in the dev server:
  1. English mode: click "Play all" → floating player appears bottom-right → first sign plays → highlighted chip in text → advances → completes → "Replay / Close" appears.
  2. Hindi mode: same, but Devanagari chips highlight and play correctly.
  3. Pause / resume / skip-next / stop each behave as designed.
  4. Replay restarts from index 0.
  5. Switching reading-form mid-playback closes the player cleanly.
- **Proxy verification**: hit `/api/isl-video/<known-good-fileId>` directly in a browser tab → video plays. Hit with garbage ID → 404. Hit with malformed ID → 404. Confirm response headers include `Cache-Control` and the right `Content-Type`.

---

## Out of scope

- Variable playback speed.
- Timeline scrubber inside the floating player.
- Per-chip "loop this sign" mode.
- Captions overlaid on the video (the chip popover already shows the term label; the player shows it too).
- Continuous-playback memory across reading-form / language changes.
- Pre-buffering the next clip while the current one plays. Browsers can do this naturally with a hidden `<video>` if latency feels bad; YAGNI for v1.
- Server-side concatenation of multiple clips into a single playable stream. Smoother but adds a real video toolchain (ffmpeg, transcoding) — far out of scope.
- Hosting the videos ourselves. The proxy stays a proxy; we never persist clips locally.
- Per-paragraph or per-section play-all (decision (2) committed to whole-document).

---

## Pitch positioning (for Q&A)

This feature is the strongest demo answer to "how is this actually for a deaf primary user, not just a literate person?" Before this, the chip system answered "look up a sign when you don't know a word." After this, the chip system answers "watch the entire document signed end-to-end without reading." The press of one button changes the modality balance from text-primary-with-chip-lookups to ISL-primary-with-text-as-context.

For Peter Kulcsár Szabó's scaling question: the proxy is stateless and trivially horizontally scalable. Each request streams Drive bytes; nothing persists. The cost line item is Vercel egress and Drive API quota, both predictable per active user. The dictionary is a static JSON read once per server process; it would handle 10M users at the cost of one `fs.readFile` per cold start.

For ethical alignment: every video the user sees is fetched fresh from Drive at request time. We don't cache, mirror, or persist any video. The ISLRTC archive remains the source of truth; we are a delivery surface that respects their hosting.
