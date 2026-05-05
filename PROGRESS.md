# PROGRESS.md — SugamPath status at Stage 1 entry

> **Read this file together with `CLAUDE.md`** at the start of every new session. `CLAUDE.md` is the immutable contract; `PROGRESS.md` is the live snapshot. If they ever conflict, `CLAUDE.md` wins, and the conflict gets flagged.

---

## 1. Where we are

- **Stage 0 — complete and tagged.** All 13 items of `CLAUDE.md` §8 shipped. Tag: `stage-0-complete` (commit `64e6945`).
- **ISL integration — complete and bonus.** Originally Stage 2 territory; landed because the Government of India's data.gov.in catalog exposes the ISLRTC archive via Google Drive, and we built a sync script that pulls the full **10,243-term** dictionary into the app. Commit `1f8cbb7`.
- **Stage 1 — not started.** This session's job is to ship items 14–19 from `CLAUDE.md` §8.

**Latest commit:** `1f8cbb7` on `main`, pushed to `https://github.com/SirCoolerArc/SugamPath`.

---

## 2. What ships today (concretely)

A user can:
1. Open `http://localhost:3000`, see an editorial landing page with the one-line pitch and three "promise" cards.
2. Drag-drop or click to upload one or more page images / a PDF (cap: 10 MB total).
3. Watch a typewritten "we do this carefully, on purpose" loading screen narrate the safety pipeline as it runs (~25 s).
4. See a side-by-side view: original document on the left, simplified plain-English text on the right, with critical-field spans (turmeric underline) and inline ISL chips for any of 10,243 ISLRTC terms.
5. Click any ISL chip to expand an inline `<video>` element streaming the sign directly from Drive.
6. Click "READ ALOUD" to hear the simplified text via browser SpeechSynthesis (en-IN).
7. See action items in a numbered panel below the simplified text, each with `what` / `when` / `verify with`.
8. See three safety badges showing **N personal details kept private**, **M pages read end-to-end**, **Ts careful reading time**.

PII is tokenised before any LLM call beyond the initial vision pass; reconstructed only on the response object returned to the client; never persisted.

---

## 3. End-to-end pipeline

```
client (browser)
  │  multipart POST /api/process  (one or more File entries under "document")
  ▼
app/api/process/route.ts
  │
  ├─► extract({ images })                              [lib/extractor.ts]
  │     │
  │     ├─► callGemini(prompt, { images })             [lib/gemini_client.ts]
  │     │     vision pass on raw images, returns JSON text
  │     │
  │     ├─► parseExtraction(rawText)                   [lib/validator.ts]
  │     │     strips JSON fences, Zod-validates, retries up to 3× with appended error guidance
  │     │
  │     └─► tokeniseExtraction(extraction)             [lib/extractor.ts → lib/pii_vault.ts]
  │           regex Pass 1 + LLM-supplied pii_spans Pass 2
  │           returns { extraction (PII reconstructed), redactedExtraction (tokenised), vault }
  │
  ├─► simplify({ redactedExtraction })                 [lib/renderers.ts]
  │     │
  │     ├─► callGemini(prompt + redacted JSON inline)  [lib/gemini_client.ts]
  │     │     simplifier sees only tokens; cannot leak PII; cannot inline critical fields
  │     │
  │     └─► parseSimplification(rawText, knownActionIds) [lib/validator.ts]
  │           cross-field invariant: 1:1 simplified_actions ↔ extraction action_items
  │
  ├─► applyCriticalFieldSubstitution(simplification, criticalFields)  [lib/renderers.ts]
  │     replaces {{cN}} with <span class="critical-field" data-id="cN">VERBATIM</span>
  │     STRUCTURAL LOCK: substitution happens here, never in the LLM call
  │
  ├─► reconstructSimplification(withCriticals, vault)  [lib/renderers.ts]
  │     re-injects PII tokens with real values for the client-bound payload
  │
  ▼
client (browser)
  receives ProcessResponse { extraction, redactedExtraction, simplification, vaultSize, warnings, meta }
  state machine in app/page.tsx swaps from "processing" to "result"
  SideBySideViewer renders: OriginalDocument | SimplifiedText (+ chip + audio) | ActionItemsPanel
```

---

## 4. What works, with evidence

| Stage | Test | Status | Where |
|---|---|---|---|
| Hello Gemini | Real image, gemini-2.5-flash, returns one-sentence description | ✅ commit `fd776a7` | `lib/gemini_client.ts` |
| PII vault — benchmark | 14/14 expected vault entries on the mock STEMI discharge from `docs/demo_benchmark.md` §1 | ✅ commit `2a7d916` | `npx tsx scripts/test_pii_vault.ts` |
| PII vault — Bengal-format real doc | 12/12 expected vault entries (BIPLAB ROY style) | ✅ commit `8497be5` | same script |
| PII vault — LLM-augmented Pass 2 | LLM-flagged spans merge with regex matches; case-insensitive name dedup; dot-format dates; rural addresses | ✅ commit `df585d0` | covered by extractor smoke tests |
| Extractor — medical (3-page) | Real Bengal hospital discharge, 3 pages, multi-image | ✅ HTTP 200 path verified | `npx tsx scripts/test_extractor.ts demo_assets/discharge_real_page{1,2,3}.png` |
| Extractor — legal | Real summary-suit application from a Budgam court | ✅ HTTP 200 via curl, 22 s | `npx tsx scripts/test_extractor.ts demo_assets/legal_notice_page{1,2}.png` |
| Extractor — government certificate | Real Bihar OBC non-creamy-layer certificate | ✅ HTTP 200, all 6 dates + 6 names + 7 address fragments + 3 cert IDs vaulted | `npx tsx scripts/test_extractor.ts demo_assets/ncl_certificate.png` |
| Simplifier | Cross-field invariant 1:1 actions; placeholders all resolve; critical-field spans render correctly | ✅ commits `2430b8f`, `2022688` | `npx tsx scripts/test_simplifier.ts --cached` |
| API route end-to-end | curl POST, multi-file, status-coded errors | ✅ commit `c2586ec`, smoke-tested HTTP 200 in 22 s | `curl -X POST /api/process -F "document=@..."` |
| UI | Compiles, fonts load (Fraunces + Newsreader + JetBrains Mono), responsive 5/7 desktop / stacked mobile | ✅ commit `9deb9a4`, `npm run dev` boots clean | `npm run dev` |
| Uploader | Drag-drop multi-file with `<label>` click-forwarding fix and extension-fallback MIME | ✅ commit `80726c8` | manual browser test |
| ISL dictionary | 10,243 unique terms synced from ISLRTC Drive archive; key-less JSON with server-side injection | ✅ commit `1f8cbb7` | `curl /api/isl-dictionary` returns 2 MB enriched JSON |
| ISL chip — direct video | `Medicine.mp4` streams as `video/mp4` from Drive | ✅ verified via `curl -I` | `lib/types.ts` defines `ISLDictionaryEntry` |

---

## 5. What is intentionally not done yet

### Stage 1 (CLAUDE.md §8 #14–19) — the work this next session does

| # | Item | Notes |
|---|---|---|
| 14 | `lib/faithfulness.ts` + `prompts/faithfulness.md` — second Gemini call audits original vs. simplified for critical-field preservation; warning banner on diff | **Highest priority — the load-bearing demo moment.** |
| 15 | `prompts/injection_check.md` + integration — adversarial-content detector, red banner | Enables the optional poisoned-document demo moment. |
| 16 | Reading-level slider (Standard / Easy / Very Easy) | Prompt parameter swap. UI control. |
| 17 | Loading + error states polish | Loading is excellent; error path could harden 422/502 specifically. |
| 18 | Two more demo documents preset-loaded | Adds a "try a sample" picker on the landing page. |
| 19 | `components/SafetyBadges.tsx` expand-on-click | Show the redacted-text panel from the badge. Currently just a quiet display. |

### Stage 2 (CLAUDE.md §8 #20–23) — only if Stage 1 is fully clean by hour 18

20. User-prompt input box + intent classifier (refusal flow on "should I sue?")
21. Confidence indicators per simplified paragraph
22. Hindi output toggle
23. Click-to-highlight cross-references between simplified and original

---

## 6. Known sharp edges (acceptable for v1, may want to tighten later)

- **Over-redacted "10:28 a.m."** — the LLM tags the admission time as a DATE in `pii_spans`. Vault correctly tokenises it. Cosmetic over-redaction; safer direction.
- **`SDO MOTIHARI SADAR` flagged as NAME** — the OBC certificate's signing role got tagged as a name because the cue is "Digitally signed by …". Same class of false positive; same direction (more redaction is safer).
- **Telephone OCR error `983048436`** — the Bengal hospital phone got 9 digits instead of 10 from Gemini's vision pass. Vision-side limitation, not a vault bug.
- **`p23` repeated header on multi-page docs** — when the same header appears on multiple pages, the extractor sometimes emits a small header paragraph for the duplicate. Marked `simplifiable: false`, so the simplified text doesn't show it. Cosmetic.
- **Geist fonts left in `app/fonts/`** — scaffold residue, unused by the new design system. Harmless ~1 MB. Cleanup is one `rm -rf app/fonts` whenever convenient.

---

## 7. Memory state (session-persistent)

The user has auto-memory at `C:\Users\Rishabh Kumar\.claude\projects\c--Users-Rishabh-Kumar-AIC-Hackathon\memory\`. The next session's `using-superpowers` skill should pick this up automatically; if it doesn't, manually consult:

- **`MEMORY.md`** — index of all memories
- **`feedback_git_attribution.md`** — push to `https://github.com/SirCoolerArc/SugamPath` after every major change; commits must be authored as `Rishabh Kumar <rishabhxkumar@gmail.com>`; never include `Co-Authored-By: Claude` or "Generated with Claude Code" footers anywhere a commit reaches GitHub
- **`project_hindi_support.md`** — current Hindi pipeline status (vault Pass 2 covers it for now) and the four concrete gaps to fix in Stage 2

---

## 8. How to run things

```bash
# Dev server
npm run dev

# Full pipeline test against an image (extract + simplify + render)
npx tsx scripts/test_extractor.ts demo_assets/<file>.png [<more files>]
npx tsx scripts/test_simplifier.ts --save-extraction demo_assets/<file>.png
npx tsx scripts/test_simplifier.ts --cached    # reuses cached extraction; faster prompt iteration

# PII vault unit tests (no Gemini calls; cheap, run any time)
npx tsx scripts/test_pii_vault.ts

# Re-sync the ISL dictionary from Drive (run when ISLRTC publishes new signs)
npx tsx scripts/sync_isl_dictionary.ts

# Typecheck the whole project
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit
```

---

## 9. Files of interest, one-liners

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project contract — read first, every session |
| `PROGRESS.md` | This file — live status snapshot |
| `PROMPT_STAGE1.md` | Kickoff prompt for the Stage 1 session (read after `CLAUDE.md` and this file) |
| `lib/types.ts` | All Zod schemas + TS types in one place |
| `lib/gemini_client.ts` | Sole point of contact with Gemini SDK; retry, safety, thinkingBudget=0, RECITATION error class |
| `lib/pii_vault.ts` | Two-pass tokeniser (regex + LLM `pii_spans` augmentation), case-insensitive name dedup |
| `lib/extractor.ts` | Vision multi-image, validation-driven retry loop, vault application |
| `lib/renderers.ts` | Simplifier orchestration + structural critical-field substitution + PII reconstruction |
| `lib/validator.ts` | Strips Markdown fences; Zod parse + cross-field invariants for both stages |
| `data/pii_patterns.ts` | 13 ordered Indian PII regexes (Aadhaar, PAN, phone, dates, names, addresses, REGNO, UHID/IP/Bed, ORG) |
| `data/isl_dictionary.json` | 10,243 ISLRTC sign entries; key-less video URLs (server appends key at request time) |
| `prompts/extract.md` | Locked v2 — closed `kind` enum, no PII fields, header skip, imperative actions, `pii_spans` mandatory |
| `prompts/simplify.md` | Locked v1 — `{{cN}}` placeholders only, PII tokens flow through, no advice, suppress name echo |
| `prompts/faithfulness.md` | **Stage 1 #14 placeholder — to be written** |
| `prompts/injection_check.md` | **Stage 1 #15 placeholder — to be written** |
| `app/api/process/route.ts` | Single end-to-end POST endpoint: multipart → extract → simplify → render → respond |
| `app/api/isl-dictionary/route.ts` | GET endpoint serving the dictionary with API key injected at request time |
| `app/page.tsx` | State machine: idle → processing → result → error |
| `components/DocumentUploader.tsx` | Drag-drop + multi-file with `<label>` click-forwarding |
| `components/ProcessingStage.tsx` | The typewritten safety-narrative loading screen — demo headline UI moment |
| `components/SideBySideViewer.tsx` | 5/7 asymmetric desktop, stacked mobile |
| `components/SimplifiedText.tsx` | Renders sections, preserves critical-field spans, O(words) ISL chip lookup |
| `components/ISLTermChip.tsx` | Inline expand-on-click; `<video>` for direct URLs, external link otherwise |
| `components/AudioPlayer.tsx` | Browser SpeechSynthesis, en-IN, play/pause/stop |
| `components/ActionItemsPanel.tsx` | Numbered cards, "verify with" framing |
| `components/SafetyBadges.tsx` | Three-pane mono strip with vault count, page count, latency |
| `scripts/sync_isl_dictionary.ts` | Walks the ISLRTC Google Drive archive, writes `data/isl_dictionary.json` |
| `scripts/test_*.ts` | Dev harnesses for vault / extractor / simplifier |
| `docs/demo_benchmark.md` | Gold-standard mock document + expected outputs (test harness reference) |

---

## 10. Stage 1 entry plan

Per `CLAUDE.md` §8 priority order, do the items that move the demo first:

**14 (faithfulness) → 15 (injection check) → 19 (badge expand) → 17 (error states polish) → 16 (slider) → 18 (presets).**

Faithfulness is the literal "the bridge cannot lie" demo moment from the one-line pitch. Without it, the pitch is aspirational; with it, demonstrated. Should be ~90 minutes including testing. Injection check is similarly small (~60 minutes) and enables the optional poisoned-document moment in `CLAUDE.md` §12 1:30–2:15.

**Cutoff rule from `CLAUDE.md` §8:** if Stage 1 isn't cleanly complete by hour 18, ship Stage 0 polished rather than Stage 1 broken.

See **`PROMPT_STAGE1.md`** for the structured kickoff for the next session.
