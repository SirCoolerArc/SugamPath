# PROMPT — SugamPath Stage 2 kickoff

You are the coding agent for **SugamPath**, an Indian-bureaucracy accessibility app for deaf and low-literacy users. **Stage 0 and Stage 1 have shipped.** Your job in this session is to deliver Stage 2 — the items that take the product from "demonstrated safety story" to "actually usable in the languages and patterns the primary user expects."

The human directing you is a strong prompt engineer who has been pair-coding through Stage 0 and Stage 1. They have not slept much. Reduce their cognitive load: small commits, clear names, comments only where logic is non-obvious, ask before refactors and dependencies.

---

## Quick context (no warm-up — go straight to Checkpoint 6.1)

This session continues immediately from the Stage 1 session. Skip the customary read-everything-and-summarise dance — the previous session already verified env, typecheck, lint, and git state on the same machine in the last few minutes. The repo is at `ffcea2f` on `main`, working tree clean, `stage-1-complete` tagged, both Gemini keys set, dev server stopped.

**Read `CLAUDE.md` and `PROGRESS.md` only as you need them** — Stage 2 work touches specific files, not the whole codebase. Reach for them when a checkpoint says to.

**One thing to internalise before code:** the Hindi support memory at `~/.claude/projects/c--Users-Rishabh-Kumar-AIC-Hackathon/memory/project_hindi_support.md` lists four concrete patches for Checkpoint 6.1. Read it once, then start with sub-item 1.

If anything seems wrong (typecheck fails, env keys missing, dev server squatting on port 3000), surface that *when you hit it* — don't pre-flight everything looking for trouble.

---

## Step 1 — Stage 2 build plan

Work through these in order. **Stop at each checkpoint and confirm direction with the user before proceeding.** Do not chain checkpoints into a continuous burst.

The order matters: 22 (Hindi) is the highest user-impact item; 20 (advice refusal) is last because it's the most design-ambiguous and benefits from brainstorming before coding.

### Checkpoint 6.1 — Hindi output toggle (CLAUDE.md §8 #22)

**Highest priority for the primary user.** Indian users code-switch; the demo is currently English-only.

Before writing code, re-read **`~/.claude/projects/c--Users-Rishabh-Kumar-AIC-Hackathon/memory/project_hindi_support.md`**. It enumerates the four concrete gaps. Address them as separate small commits, not one big bundle:

1. **Devanagari regex cues in `data/pii_patterns.ts`** — add patterns for `नाम\s*:`, `पता\s*:`, `दिनांक\s*:`. Today, Hindi-only documents would leak PII via regex Pass 1; LLM Pass 2 catches them but defence-in-depth is worth the small commit.
2. **`target_language` parameter on the simplifier prompt** — extend `SimplifyInput` with a `language: "en" | "hi" | "code-mixed"` field analogous to `level`. `levelGuidance()` is the precedent for runtime prompt-section appending. Default stays `en`. Test against the cached extraction in all three modes.
3. **Cross-language faithfulness judge** — the judge prompt currently assumes critical-field verbatims appear *as-is* in the simplified text. Hindi/code-mixed simplification may transliterate or keep some values in their source script. The judge prompt needs to allow this. Update `prompts/faithfulness.md` to be language-aware, then re-run the synthetic tests in `scripts/test_faithfulness.ts` to confirm no regression on English documents.
4. **Hindi/English aliases in `data/isl_dictionary.json`** — currently English-keyed only. Add a Hindi key for each entry where a stable Hindi term exists; the simpler option is a small lookup table mapping common Hindi terms to their English equivalents, applied in the chip resolver in `components/SimplifiedText.tsx`. Discuss the trade-off with the user before picking — both are valid.

UI: a small language toggle on the result view, peer to the reading-form slider. Three positions: **English / हिन्दी / दोनों** (both — code-mixed). Routes through the existing resimplify cache machinery — cache is now keyed by `(level, language)` instead of `level`.

**Stop after each of the four sub-items. Wait for the user's "continue" between sub-items so the prompt can be iterated cleanly.**

### Checkpoint 6.2 — Click-to-highlight cross-references (CLAUDE.md §8 #23)

When the user clicks a critical-field span (`<span class="critical-field" data-id="cN">`) in the simplified column, scroll/zoom the original column to the matching `original_span`. Existing data:

- `extraction.critical_fields[]` has each `{ id, kind, verbatim }`
- `extraction.paragraphs[]` has each paragraph's `original_span` and `critical_field_refs[]`
- The original column already renders the page images via `OriginalDocument.tsx`

Achievable target: **paragraph-level highlight.** When a critical-field span is clicked, find the paragraph that references it (`paragraph.critical_field_refs.includes(id)`), and scroll the original column to the page that paragraph belongs to (best-effort — the extraction doesn't carry page numbers today). If the page can't be inferred, fall back to highlighting the verbatim text inside the simplified column briefly to acknowledge the click.

Sub-paragraph precision (bbox highlights on the source image) requires the extractor to emit bounding boxes. Out of scope unless the user explicitly asks for it; that would be a Stage 3 effort.

**Stop after testing.**

### Checkpoint 6.3 — Per-paragraph confidence indicators (CLAUDE.md §8 #21)

Cheaper than it sounds:

1. Add `confidence: "low" | "medium" | "high"` to `ParagraphSchema` in `lib/types.ts`. Make it optional with a default of `"high"` so old extractions still validate.
2. Update `prompts/extract.md` to ask the LLM to emit a confidence per paragraph based on OCR clarity and intent ambiguity.
3. In `SimplifiedText.tsx`, render a small coloured dot beside the section heading: green for high, amber for medium, rust for low. Hover or tap shows a tiny mono-label tooltip *"the original was hard to read here"* / *"this section is clearly stated"*.

The simplifier doesn't need to change — it already groups paragraphs into sections, so the dot is rendered at section level by aggregating min-confidence across the paragraphs that make up that section.

**Stop after testing.**

### Checkpoint 6.4 — Intent classifier + advice refusal flow (CLAUDE.md §8 #20)

The most design-ambiguous item. Before coding, brainstorm with the user:

- **Where does the input box live?** Above the simplified column? Floating? On a separate "ask a question" tab? CLAUDE.md §3 invariant 6 says the model is not a lawyer/doctor — refusal must be visible and intentional, not hidden.
- **What counts as advice?** *"Should I sue?"*, *"Is this dose safe?"*, *"What does this mean for me legally?"*, *"Can I appeal this?"* are all examples. *"What does this paragraph mean?"* is closer to interpretation than advice and may be borderline.
- **Refusal copy.** *"We translate, we don't decide."* is the project's framing. The refusal should redirect to a real professional category (DLSA / NALSA / a doctor / a hospital social worker) where applicable.

Architecture:
- New endpoint `/api/intent` (or extend `/api/process` with a query param). Takes the user's prompt + the extraction. Returns `{ intent: "simplification" | "advice" | "interpretation", confidence, suggested_redirect }`.
- Two prompts: `prompts/intent_classify.md` and `prompts/advice_refusal.md`.
- Refusal UI is a new component, not a modal — modals feel adversarial. Inline note next to the input box, similar in tone to `InjectionNotice.tsx`.

**Brainstorm first. Wait for user direction. Don't write code until the design is settled.**

---

## Step 2 — Tag and ship

When Stage 2 is complete and clean:

```bash
git tag -a stage-2-complete -m "Stage 2 complete: Hindi support, click-to-highlight, paragraph confidence, intent classifier"
git push origin main --tags
```

Update `PROGRESS.md` to reflect the new state.

If any Stage 2 item is half-done and the hackathon submission deadline (2 PM, 6 May 2026 — see `CLAUDE.md` §2) is within striking distance: **revert the half-done item, ship Stage 1 polished.** Stage 1 is the demo path. Stage 2 enriches it but does not gate it.

---

## Standards while you work

- **Author:** repo-local git config is set to `Rishabh Kumar <rishabhxkumar@gmail.com>`. Never include `Co-Authored-By: Claude`, "Generated with Claude Code", or any AI/Anthropic attribution in commit messages or PR bodies. **This rule is hard.** See `~/.claude/projects/c--Users-Rishabh-Kumar-AIC-Hackathon/memory/feedback_git_attribution.md`.
- **Push after every checkpoint.** The user wants to see commits roll in.
- **Conventional commit prefixes:** `feat:`, `fix:`, `chore:`, `docs:`. Scope the prefix when it helps: `feat(hindi): …`.
- **Small commits.** One per checkpoint at minimum. Hindi (6.1) is intentionally split into four sub-commits so prompt iteration stays clean.
- **No new dependencies without asking.** The dependency list is locked: `@google/generative-ai`, `zod`, `lucide-react`, plus Next/React/Tailwind.
- **No console.logs in committed code.** Use a tiny `lib/log.ts` if needed.
- **Stop at every checkpoint.** Do not chain.
- **Use TodoWrite** to track within a checkpoint. Mark done as soon as done.
- **Respect the existing prompt iteration discipline.** The user leads prompt content for new prompts (`intent_classify.md`, `advice_refusal.md`, language-aware updates to `simplify.md` and `faithfulness.md`) in the same way they led `extract.md`. Draft a v1 to seed iteration; expect them to revise.

---

## When in doubt

- Ship the demo path, not the architecture.
- Hindi support is the highest user-impact Stage 2 item — primary user is Indian, demo has English bias today.
- The judge sees a 3–5 minute demo and the codebase. Stage 1 already tells a strong demo story; Stage 2 deepens user reach without changing the headline.
- If a feature isn't in Stage 2 (#20–23), it doesn't exist in this session.
- If you're about to add a dependency or refactor working code: stop, ask.

Begin with Checkpoint 6.1, sub-item 1 (Devanagari regex cues).
