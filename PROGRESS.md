# PROGRESS.md — SugamPath status at submission

> **Read this file together with `CLAUDE.md`** at the start of every new session. `CLAUDE.md` is the immutable contract; `PROGRESS.md` is the live snapshot. If they ever conflict, `CLAUDE.md` wins, and the conflict gets flagged.

---

## 1. Where we are

- **Stage 0 — complete and tagged.** All 13 items of `CLAUDE.md` §8 shipped. Tag: `stage-0-complete` (commit `64e6945`).
- **Stage 1 — complete.** 4 of 6 items shipped, 2 deliberately skipped with reasoning. (Tag pending; never blocked anything.)
- **Stage 2 — partially shipped, with one item deliberately deferred.**
  - **6.1 Hindi support — shipped.** Devanagari PII patterns, simplifier `target_language` parameter (en / hi / code-mixed), cross-language faithfulness judge, ISL chips for Devanagari surface forms via a hand-curated alias map, and a three-position language toggle UI.
  - **6.2 click-to-highlight — skipped by design** (PDF iframe targets cap the achievable visual fidelity; deferred to a future Stage 3).
  - **6.3 per-paragraph confidence dots — skipped** (low user-impact for the demo; the existing faithfulness badge already carries the trust story).
  - **6.4 intent classifier + advice refusal — deferred by design.** A free-text follow-up box centres a literate user; SugamPath's primary user is deaf or low-literacy and composing a written question is exactly what the rest of the product removes the burden of doing. Spec preserved at [`docs/superpowers/specs/2026-05-06-intent-classifier-design.md`](docs/superpowers/specs/2026-05-06-intent-classifier-design.md) as a record of the design decision.
- **ISL Play-All — shipped (post-Stage-2 follow-up).** A "play all signs" button next to the audio player walks every ISL chip in the simplified text in document order. While playing, a floating bottom-right player shows the current sign clip; the corresponding word in the simplified text is highlighted with a soft navy tint and a left bar (readable while signing). Backed by a server-side proxy at `/api/isl-video/<fileId>` that streams Drive bytes through our origin, unblocking inline `<video>` playback (which had never worked before — chips used to open Drive in a new tab). This is the headline feature for "actually for a deaf primary user, not just a literate person."

**Latest commit on submission day:** `6f51c5c` on `main`, pushed to `https://github.com/SirCoolerArc/SugamPath`.

---

## 2. What ships today (concretely)

A user can:

1. Open `http://localhost:3000`, see an editorial landing page with the one-line pitch and three "promise" cards.
2. Drag-drop or click to upload one or more page images / a PDF (cap: 10 MB total). PDFs preview natively in a browser iframe; images render via `next/image`.
3. Watch a typewritten *"we do this carefully, on purpose"* loading screen narrate the safety pipeline as it runs (~36 s of narration over a ~40 s pipeline, with a calm "still reading carefully" line if it crosses 50 s).
4. See a side-by-side view: original document on the left, simplified plain-English text on the right, with critical-field spans (turmeric underline) and inline ISL chips for any of 10,243 ISLRTC terms.
5. **Switch the reading form** — a three-position slider above the simplified column flips between *"Plain words, in short paragraphs"*, *"Shorter sentences. Easier to scan."*, and *"Each fact on its own line."* Each position now carries a static label so the affordance is self-documenting. Toggling re-simplifies via `/api/resimplify` (~22 s); previously-seen levels swap instantly from a client cache keyed by `${level}|${language}`.
6. **Switch the output language** — a peer three-position toggle (English / हिन्दी / दोनों) regenerates the simplified text in plain Hindi or Hindi-English code-mixed prose. PII tokens and critical-field placeholders flow through unchanged regardless of language. The faithfulness judge is language-aware so Hindi output isn't false-flagged for paraphrasing durations and quantities.
7. Click any ISL chip to see the sign play **inline** in a small popover. The Drive viewer remains a footer fallback link.
8. **Click "play all signs"** to walk the entire document in ISL: a floating bottom-right player auto-plays each chip's sign in document order; the corresponding word in the simplified text is highlighted with a soft navy tint as the cursor moves; pause / skip-next / stop controls; on completion, Replay / Close. ESC closes. Switching reading-form or language mid-playback closes the player cleanly.
9. Click "READ ALOUD" to hear the simplified text via browser SpeechSynthesis. The voice locale follows the language toggle (`en-IN` for English, `hi-IN` for Hindi or code-mixed) and the player listens for the browser's `voiceschanged` event so the voice list is warm on first click.
10. See action items in a numbered panel below the simplified text, each with `what` / `when` / `verify with` framing — never imperative.
11. See the safety-row badges:
    - **N personal details kept private** (vault size)
    - **M pages read end-to-end** (page count)
    - **Ts careful reading time** (latency)
    - **Faithfulness verdict** — quietly shows ✓ (VERIFIED), a count (VERIFIED_WITH_OMISSIONS, click expands to show the omitted critical fields), or — (UNVERIFIED, click expands to a soft note pointing back to the original). Never a red banner.
    - **Injection finding count** — appears only if the detector flags adversarial content; rust accent, click expands to the verbatim flagged excerpts.
12. **See a calm rust-accent notice** at the top of the result if the document contains text directed at an automated assistant. The notice can be dismissed; the safety badge keeps the signal visible.
13. **See an honest tip below the play-all button** when the language is not English: *"ISL signs are English-grounded — the play-all flow covers more of the document when the text is in English."* Surfaces a known coverage trade-off rather than hiding it.
14. **See status-aware error copy** if anything fails — distinct text for 400 / 413 / 422-extraction / 422-simplification / 502-busy / 502-RECITATION / network failure. "Try again with the same document" only appears for transient errors; 4xx errors offer "upload a different document". The original Files persist on the error stage so retry doesn't force re-upload.

PII is tokenised before any LLM call beyond the initial vision pass; reconstructed only on the response object returned to the client; never persisted. The serialised vault round-trips between `/api/process` and `/api/resimplify` — same PII surface as the rendered fields, no new exposure.

---

## 3. End-to-end pipeline

```
client (browser)
  │  multipart POST /api/process  (one or more File entries under "document")
  ▼
app/api/process/route.ts
  │
  ├─► extract({ images })                                  [lib/extractor.ts]
  │     │
  │     ├─► callGemini(prompt, { images })                 [lib/gemini_client.ts]
  │     │     vision pass on raw images, returns JSON text
  │     │
  │     ├─► parseExtraction(rawText)                       [lib/validator.ts]
  │     │     strips JSON fences, Zod-validates, retries up to 3× with appended error guidance
  │     │
  │     └─► tokeniseExtraction(extraction)                 [lib/extractor.ts → lib/pii_vault.ts]
  │           regex Pass 1 (incl. Devanagari cues) + LLM-supplied pii_spans Pass 2
  │           sentinel-split with defensive fallback to original field if a chunk is empty
  │           returns { extraction (PII reconstructed), redactedExtraction (tokenised), vault }
  │
  ├─► Promise.allSettled([
  │       simplify({ redactedExtraction, level, language }),    [lib/renderers.ts]
  │         └─ callGemini → parseSimplification → typed Simplification with {{cN}} placeholders
  │            level appended via levelGuidance(); language appended via languageGuidance()
  │       checkForInjection({ redactedExtraction }),            [lib/injection_check.ts]
  │         └─ callGemini → parseInjectionCheck → CLEAN | SUSPICIOUS + verbatim findings
  │   ])
  │     simplifier failure is fatal (4xx/5xx); detector failure is fail-open (null + warning)
  │
  ├─► judgeFaithfulness({ redactedCriticalFields, rawSimplification, language })  [lib/faithfulness.ts]
  │     audits post-substitution simplification against the redacted critical_fields
  │     verdicts: VERIFIED | VERIFIED_WITH_OMISSIONS | UNVERIFIED
  │     language-aware: Hindi/Devanagari paraphrases of durations / frequencies are not flagged
  │     on non-VERIFIED with differences, re-simplifies once with judge findings as
  │     extraGuidance, then re-judges. Final verdict is the second pass.
  │     judge errors → fail-open (null + warning)
  │
  ├─► applyCriticalFieldSubstitution(simplification, criticalFields)        [lib/renderers.ts]
  │     replaces {{cN}} with <span class="critical-field" data-id="cN">VERBATIM</span>
  │     STRUCTURAL LOCK: substitution happens here, never in the LLM call
  │
  ├─► reconstructSimplification(withCriticals, vault)                       [lib/renderers.ts]
  │     re-injects PII tokens with real values for the client-bound payload
  │
  ▼
client (browser)
  receives ProcessResponse {
    extraction, redactedExtraction, simplification,
    vaultSize, vault,                       // serialised Map for /api/resimplify round-trip
    warnings, faithfulness, injection, meta
  }
  state machine in app/page.tsx swaps "processing" → "result" with the initial level + language
    seeded in a per-(level,language) cache.

──────────────── on slider toggle (form or language) ────────────────

client (browser)
  │  POST /api/resimplify  { redactedExtraction, extraction, vault, level, language? }
  ▼
app/api/resimplify/route.ts
  │
  ├─► simplify({ redactedExtraction, level, language })
  │     levelGuidance() + languageGuidance() append constraints to the simplifier prompt
  │
  ├─► judgeFaithfulness(..., language)                     same retry loop as above
  │
  ├─► applyCriticalFieldSubstitution + reconstructSimplification
  │
  ▼
client (browser)
  receives { simplification, faithfulness, warnings, meta: { totalLatencyMs, level, language } }
  cache[`${level}|${language}`] populated; UI swaps simplification + faithfulness in place.
  Subsequent toggles to a cached pair are instant (no network).

──────────────── on "play all signs" click ────────────────

client (browser)
  │  buildSequence(simplification, dictionary)              [lib/isl_sequencer.ts, useMemo]
  │    walks sections in document order, splits on critical-field spans,
  │    tokenises non-critical text via lib/chip_resolver.ts,
  │    emits one ISLSequenceItem per word that resolves to a dictionary entry
  │  playback state { currentIndex, status } in SideBySideViewer
  │
  ▼
ISLPlayAllPlayer (floating bottom-right)
  │  for each item: <video src="/api/isl-video/<fileId>" autoPlay muted playsInline>
  │
  ▼
app/api/isl-video/[fileId]/route.ts
  │  pipes Drive's `?alt=media` response body straight to the browser response
  │  Drive API key stays server-only; CORS sidestepped (browser → our origin only)
  │  Cache-Control: public, max-age=86400, immutable
  │
  ▼
sign video plays inline; on `ended`, parent advances. Last item → status "complete".
SimplifiedText renders the active chip with a soft navy highlight + left bar; auto-scrolls
into view via a per-chip ref registry.
```

---

## 4. What works, with evidence

### Stage 0 (pre-existing)

| Stage | Test | Status | Where |
|---|---|---|---|
| Hello Gemini | Real image, gemini-2.5-flash, returns one-sentence description | ✅ commit `fd776a7` | `lib/gemini_client.ts` |
| PII vault — benchmark | 14/14 expected vault entries on the mock STEMI discharge | ✅ commit `2a7d916` | `npx tsx scripts/test_pii_vault.ts` |
| PII vault — Bengal real doc | 12/12 expected entries (BIPLAB ROY) | ✅ commit `8497be5` | same script |
| PII vault — LLM-augmented Pass 2 | LLM-flagged spans merge with regex; case-insensitive name dedup; rural addresses | ✅ commit `df585d0` | covered by extractor smoke tests |
| Extractor — medical, legal, government | 3-page Bengal discharge; Budgam summary suit; Bihar OBC NCL | ✅ all HTTP 200 paths verified | `npx tsx scripts/test_extractor.ts ...` |
| Simplifier | Cross-field invariant 1:1 actions; placeholders all resolve | ✅ commits `2430b8f`, `2022688` | `npx tsx scripts/test_simplifier.ts --cached` |
| ISL dictionary | 10,243 unique terms synced; key-less JSON | ✅ commit `1f8cbb7` | `curl /api/isl-dictionary` |

### Stage 1

| # | Item | Status | Where |
|---|---|---|---|
| 14 | Faithfulness judge + three-state badge | ✅ commit `52713ff` | 3/3 synthetic tests pass; live route VERIFIED_WITH_OMISSIONS on real discharge; judge sees redacted only |
| 15 | Injection-check detector + dismissible notice | ✅ commit `8c259fb` | 4/4 synthetic tests pass; parallel with simplifier; ~1.3 s detector latency |
| 16 | Reading-form slider (paragraphs / shorter / list) | ✅ commit `e098b65`, polish in `11c094e` | `/api/resimplify` HTTP 200 on both `shorter` (22 s) and `list` (23 s); client cache verified |
| 17 | Status-aware error copy + retry-same-doc + longer narrative | ✅ commit `cf660d0` | 400/413 server-side smoke tests pass |
| 18 | Two demo presets with cached responses | ⏭️ skipped | No longer needed once Gemini moved to paid tier |
| 19 | SafetyBadges expand-on-click for the vault count | ⏭️ skipped | Cosmetic; the existing copy already says "N personal details kept private" |

### Stage 2

| # | Item | Status | Commits |
|---|---|---|---|
| 6.1.1 | Devanagari PII regex cues | ✅ | `9dfbc60` |
| 6.1.2 | `target_language` parameter on simplifier | ✅ | `5909e5b` |
| 6.1.3 | Cross-language faithfulness judge | ✅ | `9492bc4` |
| 6.1.4 | Hindi ISL aliases + language toggle UI + UX polish | ✅ | `935cc17`, `11c094e` |
| 6.2 | Click-to-highlight | ⏭️ skipped (PDF iframe limit) | — |
| 6.3 | Per-paragraph confidence dots | ⏭️ skipped (low impact) | — |
| 6.4 | Intent classifier + refusal | ⏭️ deferred by design (audience misalignment) | spec at `6ca0fd9` |

### ISL Play-All (post-Stage-2 follow-up)

| Layer | Status | Commits |
|---|---|---|
| Types (`videoFallbackUrl`, `ISLSequenceItem`) | ✅ | `e1999ba` |
| Chip-resolver extraction (`lib/chip_resolver.ts`, regression test) | ✅ | `a513d93` |
| Sequencer (`lib/isl_sequencer.ts`, 8 test cases + 1 regression) | ✅ | `e470a7e`, `d444877` (fix) |
| Drive-streaming proxy (`/api/isl-video/[fileId]`) | ✅ | `a6c1e11` |
| Dictionary URL rewrite to proxy + fallback link | ✅ | `e0b2ab8` |
| Inline `<video>` in chip popover | ✅ | `bf5bfbf` |
| Dictionary fetch hoisted to SideBySideViewer | ✅ | `e4da704` |
| `activeChip` highlight + auto-scroll in SimplifiedText | ✅ | `9fc057b`, `2b8c6c7` (fix) |
| Play-all button + floating player | ✅ | `6ef3f3c`, `eac035c`, `2a5a716` (fix) |
| Readable highlight + Hindi-coverage notice | ✅ | `6f51c5c` |

Three real bugs were caught and fixed during execution: a renderer/sequencer divergence on critical-field HTML (`d444877`), a sequence-shrinkage race on simplification regenerate (`2a5a716`), and an extractor sentinel-split drop that produced undefined fields under the Devanagari patterns (`2b8c6c7`).

---

## 5. Known sharp edges (acceptable for v1)

- **Over-redacted "10:28 a.m."** — vision LLM tags admission times as DATE in `pii_spans`. Vault tokenises correctly. Cosmetic over-redaction; safer direction.
- **`SDO MOTIHARI SADAR` flagged as NAME** — OBC certificate's signing role tagged as a name because of the "Digitally signed by …" cue. Same false-positive class; safer direction.
- **Hindi ISL coverage is limited** — the alias map has ~30 hand-curated Hindi → English entries. A play-all run on a Hindi document produces a sparser sequence than English. Surfaced honestly via the inline tip below the play-all button. Future work: expand the alias map to ~100 entries OR (heavier) Gemini-driven sequence enrichment for Hindi mode.
- **PDF original column is an iframe**, so click-to-highlight (Stage 2 6.2) is bounded to "scroll to the page" rather than visual span-level highlight. Image documents have full DOM access and could support sub-paragraph highlight in a future Stage 3.
- **Faithfulness omissions on the discharge** — a typical real-document run returns VERIFIED_WITH_OMISSIONS with 4-7 omitted fields, mostly UHIDs and dates the simplifier reasonably skipped (header bookkeeping).
- **Resimplify latency** — ~22 s per slider toggle on first visit. Cache hit is instant.

---

## 6. How to run things

```bash
# Dev server
npm run dev

# Full pipeline test against an image
npx tsx scripts/test_extractor.ts demo_assets/<file>.png [<more files>]
npx tsx scripts/test_simplifier.ts --save-extraction demo_assets/<file>.png
npx tsx scripts/test_simplifier.ts --cached    # reuses cached extraction; faster prompt iteration

# Stage 1 / Stage 2 test harnesses
npx tsx scripts/test_faithfulness.ts --synthetic   # 3 deterministic faithfulness cases
npx tsx scripts/test_faithfulness.ts --cached      # real simplifier → judge end-to-end
npx tsx scripts/test_injection.ts --synthetic      # 1 clean + 3 injection styles

# ISL play-all unit tests
npx tsx scripts/test_chip_resolver.ts              # tokeniser + Devanagari alias resolution
npx tsx scripts/test_isl_sequencer.ts              # 9 cases incl. critical-field-HTML regression

# PII vault (no Gemini calls; cheap)
npx tsx scripts/test_pii_vault.ts

# Re-sync the ISL dictionary from Drive (run when ISLRTC publishes new signs)
npx tsx scripts/sync_isl_dictionary.ts

# Typecheck the whole project
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit

# Lint
npx next lint --dir lib --dir app --dir components --dir scripts
```

---

## 7. Memory state (session-persistent)

The user has auto-memory at `C:\Users\Rishabh Kumar\.claude\projects\c--Users-Rishabh-Kumar-AIC-Hackathon\memory\`:

- **`MEMORY.md`** — index
- **`feedback_git_attribution.md`** — push to `https://github.com/SirCoolerArc/SugamPath` after every major change; never include AI/Anthropic attribution in commit messages
- **`project_hindi_support.md`** — Stage 2 6.1 plan (now executed)

---

## 8. Files of interest

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project contract — read first, every session |
| `PROGRESS.md` | This file — live status snapshot |
| `README.md` | Public-facing project description (judges read this) |
| `PRESENTATION.md` | Slide-by-slide deck content for the live demo |
| `lib/types.ts` | All Zod schemas + TS types in one place |
| `lib/gemini_client.ts` | Sole point of contact with Gemini SDK; retry, safety, RECITATION error class |
| `lib/pii_vault.ts` | Two-pass tokeniser (regex + LLM `pii_spans`); case-insensitive name dedup |
| `lib/extractor.ts` | Vision multi-image; validation-driven retry loop; vault application with sentinel-fallback |
| `lib/renderers.ts` | Simplifier orchestration (level- and language-aware) + structural critical-field substitution + PII reconstruction |
| `lib/faithfulness.ts` | LLM-as-judge audit; verdict normalisation; language-aware judge prompt |
| `lib/injection_check.ts` | Adversarial-content detector |
| `lib/chip_resolver.ts` | Shared tokeniser + dictionary index + Devanagari alias resolver + critical-field span splitter |
| `lib/isl_sequencer.ts` | Pure `buildSequence(simplification, dictionary)` — walks sections in document order, skips critical-field HTML |
| `data/pii_patterns.ts` | 16 ordered Indian PII regexes (Latin + Devanagari cues) |
| `data/isl_dictionary.json` | 10,243 ISLRTC sign entries; videoUrl points at `/api/isl-video/<fileId>` after route rewrite |
| `data/hindi_isl_aliases.ts` | ~30 hand-curated Hindi → English term mappings for chip resolution |
| `prompts/extract.md` | Vision + structured extraction; closed-enum kinds; pii_spans mandatory |
| `prompts/simplify.md` | `{{cN}}` placeholders; PII tokens flow through; no advice. Form + language constraints appended at runtime |
| `prompts/faithfulness.md` | Three-verdict judge; language-aware so Hindi/Devanagari paraphrases of durations are not fabrications |
| `prompts/injection_check.md` | Adversarial-content detector |
| `app/api/process/route.ts` | Single multipart POST: extract → (simplify ∥ inject) → faithfulness → render → respond |
| `app/api/resimplify/route.ts` | JSON POST for slider/language toggles; ~22 s per call |
| `app/api/isl-dictionary/route.ts` | GET — converts Drive API media URLs to our proxy URLs at request time |
| `app/api/isl-video/[fileId]/route.ts` | Drive-streaming proxy; key stays server-only; CORS sidestepped |
| `app/page.tsx` | State machine: idle → processing → result → error. Cache keyed by `(level, language)` |
| `components/SideBySideViewer.tsx` | 5/7 asymmetric desktop, stacked mobile. Hosts both sliders, audio + play-all row, floating player mount |
| `components/SimplifiedText.tsx` | Section renderer; per-chip ref registry; `activeChip` highlight + auto-scroll |
| `components/ISLTermChip.tsx` | Inline expand-on-click; inline `<video>`; close on click-outside / Esc / × |
| `components/ISLPlayAllButton.tsx` | Toolbar button next to AudioPlayer; disabled when sequence empty |
| `components/ISLPlayAllPlayer.tsx` | Floating bottom-right player; pause/skip/stop/replay/close; ESC-aware; 3 s auto-advance on video error |
| `components/AudioPlayer.tsx` | Browser SpeechSynthesis; locale follows language toggle; `voiceschanged` listener |
| `components/ActionItemsPanel.tsx` | Numbered cards, "verify with" framing |
| `components/SafetyBadges.tsx` | Vault count + page count + latency + faithfulness + injection (conditional) |
| `components/InjectionNotice.tsx` | Top-of-page rust-accent banner; dismissible |
| `components/ReadingFormSlider.tsx`, `LanguageToggle.tsx` | Three-position sliders with static labels |
| `scripts/sync_isl_dictionary.ts` | Walks the ISLRTC Google Drive archive |
| `scripts/test_*.ts` | Hand-run test harnesses (no test framework dep) |
| `docs/superpowers/specs/` | Brainstorming specs (intent classifier deferred; play-all approved + shipped) |
| `docs/superpowers/plans/` | Implementation plans (play-all 11-task plan executed) |
