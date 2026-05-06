# SugamPath — Presentation Slide Deck

> **Audience:** AIC × Anthropic Claude Hackathon judges (IIT Bombay). One judge (Peter Kulcsár Szabó) explicitly evaluates scalable backends and agentic workflows.
> **Format:** 5-6 minute live demo + Q&A. Three minutes of live demo + two-three minutes of slide-only content.
> **Goal of this file:** give the slide-makers (Neepun and Dhruv) the *content* — the words, numbers, and visuals — slide by slide. The slide aesthetic is their call. They can also paste this whole file into Gamma as a prompt and refine the output.

**Strategic posture for the entire deck:** lead with the user, not the technology. Lead with the safety story, not the feature list. Most teams will treat ethics as the last slide. We bake it into the architecture and demo it visibly. The product is the proof.

---

## Deck structure at a glance

1. **Hook** (15s)
2. **The user** (45s)
3. **Live demo, Act I** — uploading, side-by-side, ISL chip (60s)
4. **Live demo, Act II** — the safety reveal (45s)
5. **Live demo, Act III** — Play All Signs (45s)
6. **What else this handles** — breadth via screenshots (30s)
7. **Architecture, agentic without a framework** (45s)
8. **Scalability, ethics, design commitments** (30s)
9. **Limits and honesty** (15s)
10. **Close** (15s)
11. **Team / repo / contact** (back-pocket Q&A slide)

Adjust as needed; total target ≈ 5:30. Anchor moments: the ISL chip clicking, the network tab showing tokenised PII (optional), and the Play All Signs cursor walking the document.

---

## Slide 1 — Title / Hook

**Visual:** Large project title. Subtitle in a smaller, calmer typeface. A single image of a deaf adult holding a hospital discharge summary, or an Indian Sign Language sign being performed, would carry the slide. Avoid stock illustration — use a real photo if possible.

### Title
**SugamPath**

### Subtitle
*The bridge between the State and the citizen it forgets to talk to.*

### One-line spoken hook
> "India has 18 million deaf citizens. India has 250 certified Indian Sign Language interpreters. The State sends those citizens documents in a register that mathematically excludes them — discharge summaries, court summons, benefits letters — and the gap is structural, not incidental. We built the bridge. And we built it so it cannot lie."

**Speaker note:** Land *"and we built it so it cannot lie"* with a slight pause before. That is the sentence the deck pivots on.

---

## Slide 2 — The user

**Visual:** Two photos side-by-side, or one composite image. A deaf adult, just discharged from hospital, looking at a multi-page document. Beside the image, three numbers in display-size type.

### Three numbers
- **18 million** deaf Indians (Census of India)
- **250** certified ISL interpreters
- **22 percentage-point gap** in college completion between deaf and hearing populations

### Composite-user paragraph (read aloud, do not put on slide)
> "Imagine a deaf adult in their thirties who has just had heart surgery and is being discharged. They are handed a six-page document with their dose schedule, their follow-up date, their warning signs, and the contact phone for the hospital social worker. They cannot phone the hospital social worker. They cannot read the document fluently. The State has communicated. The citizen has not received."

**Speaker note:** This slide carries the entire impact case. Take 45 seconds. Do not rush it. The numbers are public; the lived consequence is what the judges will remember.

### One-line on the slide, below the numbers
*The State communicates. The citizen does not receive. SugamPath bridges that gap.*

---

## Slide 3 — Live demo: Act I (upload + side-by-side + chip)

**This is a slide that says "switching to live demo."** Keep it minimal — one line, large, on the screen — and switch to the actual app.

### On-screen text
*Live demo — discharge summary*

### Demo script (the presenter narrates while clicking)
1. **Drop the discharge summary onto the upload zone.** "Six pages. A real anonymised discharge summary."
2. **(Optional, 15s — the voice-query moment.)** Before clicking Submit, click the microphone icon in the query input and ask aloud: *"When is my next visit?"* — or in Hindi: *"क्या मुझे कोई जांच करवानी है?"* The Web Speech API transcribes; the answer comes back in the same language, drawn only from the document. *"For a user who wants to know one specific thing — a follow-up date, a dose schedule — they don't have to read the whole simplification. They speak. The answer comes back in the language they asked in. And the prompt is constrained: it answers only from the document, refuses advice."* If time is tight, skip this beat and surface it in Q&A.
3. **Watch the typewriter pipeline narrate itself.** Don't read the screen aloud — let the narration land. *"This is the system telling the user, in real time, what it's doing. Not a spinner. The ethics story is in the loading screen."*
4. **The side-by-side view appears.** "On the left, the original. On the right, the rewritten version in plain English at a fifth-grade reading level. The original is always visible. The rewritten text is never the source of truth."
5. **Click an ISL chip — say, "Doctor".** The video plays inline in the popover. *"Each underlined word in the rewritten text is a sign-language term. Tap any one and watch the sign — inline, no new tab, no friction."*

**Speaker note:** Time this to ≤ 60 seconds without the voice-query beat, ≤ 75 seconds with it. If the API is slow, do not wait silently — narrate what's happening.

---

## Slide 4 — Live demo: Act II (the safety reveal)

**Still in live-demo mode.** Stay on the result page.

### Demo script
1. **Click on a dose in the simplified column.** Show that the dose is a span with a turmeric underline. *"Drug names, doses, dates, money amounts, legal sections — every load-bearing token in the document — flow through the pipeline as placeholders. The simplifier never sees them. The substitution happens in code, after generation. The model cannot accidentally turn 'Aspirin 75 mg' into 'diabetes medicine'. It is structural, not textual."*
2. **Open the Faithfulness badge.** *"After the simplification is generated, a second LLM call audits it against the extracted critical fields. The judge looks for omissions and fabrications. The verdict is shown here — quietly — and on the rare cases where it isn't VERIFIED, the system retries with the judge's findings as guidance and re-judges. The system second-guesses itself before showing the user anything."*
3. **(Optional, if time allows)** Open the browser's Network tab and click on one of the simplifier requests. Show that the request body contains `[NAME_001]`, `[DATE_002]` instead of real values. *"PII is tokenised before any external call. The vault is in-memory, request-scoped, garbage-collected the moment the response sends. The Drive API key for the sign videos is server-only — it never reaches the browser. No persistence, anywhere."*

**Speaker note:** This is the slide where the deck differentiates itself. Most teams treat ethics as a closing slide; we built it in, and we are showing the proof. If the network tab demo feels risky in the moment, drop it — the rest of the act is enough.

---

## Slide 5 — Live demo: Act III (Play All Signs)

**Still in live-demo mode.**

### Demo script
1. **Press "Play All Signs".** A floating player appears bottom-right. *"This is the feature that makes SugamPath actually for a deaf primary user, not just for a literate person who occasionally needs a sign."*
2. **Watch the cursor walk the document.** As each sign plays, the corresponding word in the simplified text is highlighted with a soft navy tint. *"Every chip in the simplified text plays in document order. The user can read the word and watch the sign at the same time."*
3. **(Optional)** Toggle the language slider to हिन्दी, then to दोनों (code-mixed). Show that the same flow works on Hindi text with Devanagari chips. Acknowledge: *"ISL signs are English-grounded — the play-all flow covers more of the document when the text is in English. We surface that honestly with a tip below the button."*

**Speaker note:** Land this slide with: *"This is the press-one-button mode. Watch the document signed end-to-end. No reading required."*

---

## Slide 6 — What else this handles

**Switch back to slides.** Single slide showing three documents handled by the same architecture.

### Layout
A 1×3 grid (or 3 stacked cards). Each card shows a screenshot of the side-by-side view for a different document type.

### Documents
1. **Hospital discharge summary** (this is the live demo)
2. **Court summons** (or any tribunal notice)
3. **Ayushman Bharat rejection letter** (or any benefits letter)

### Caption under the grid
*One pipeline. Five document types tested. The architecture is identical for every document the State sends a citizen — medical, legal, civic, educational, fiscal.*

**Speaker note (read aloud, do not put on slide):** *"We picked the discharge summary for the live demo because the stakes are most visceral. The architecture is identical for every other document the State sends a citizen."*

---

## Slide 7 — Architecture, agentic without a framework

**This is the technical-execution slide.** Heavy lifting on the diagram.

### Diagram (build this in Gamma or hand-draw)

```
USER  →  /api/process
                 │
                 ├─ 1. Vision extraction (Gemini)
                 │     ├─ Zod schema validation
                 │     └─ retry up to 3× with error guidance
                 │
                 ├─ 2. PII vault (regex + LLM-supplied spans)
                 │     ├─ tokenises Aadhaar / phone / names / addresses / dates
                 │     └─ Devanagari label cues for Hindi documents
                 │
                 ├─ 3. Simplification ║ 4. Injection check  (parallel)
                 │     critical-fields locked as {{cN}} placeholders
                 │
                 ├─ 5. Faithfulness judge (second LLM call)
                 │     audits simplification against extracted critical fields
                 │     non-VERIFIED → retry with judge findings as guidance
                 │
                 ├─ 6. Critical-field substitution (deterministic, in code)
                 │     {{c1}} → <span data-id="c1">Aspirin 75 mg</span>
                 │
                 ├─ 7. PII reconstruction on response object
                 │
                 └─ Response: simplification + faithfulness + injection + warnings
```

### Three statements next to the diagram

- **Tool composition** — every stage is a typed-result function. No state machine framework.
- **Conditional branching on intent** — non-VERIFIED retries; SUSPICIOUS surfaces a banner.
- **Multi-call self-correction** — the faithfulness judge audits the simplifier; the system second-guesses itself before showing anything.

### One-line tagline (large, beside the diagram)
*Every property an agent framework promises, in plain TypeScript. We chose to ship the behaviour, not the dependency.*

**Speaker note (anticipating Peter Kulcsár Szabó's question):** *"We deliberately did not adopt LangGraph. Under hackathon time pressure, an agent framework is added complexity without added capability for a workflow this well-defined. The architecture is functionally agentic — tool composition, conditional flow, retry, self-correction, escalation — without the framework overhead."*

---

## Slide 8 — Scalability, ethics, design commitments

**Three columns. Each is one short bullet list.**

### Column 1 — Scalable
- Stateless API; no session affinity required
- No persistence — no database, no cache, no S3, no Redis
- LLM provider abstracted to one file (`lib/gemini_client.ts`)
- Cost of scale is the cost of inference, nothing more

### Column 2 — Ethical (mechanism, not policy)
- PII vault — tokenised before every external call
- Critical-field locking — substitution in code, not in prompt
- Faithfulness judge — second LLM audits the first
- Prompt-injection defence — separate guardrail call

### Column 3 — Design commitments (CLAUDE.md §3)
- The original is always visible
- We translate, we don't decide
- Critical fields never get paraphrased
- PII never leaves the user's machine in plain text
- Documents are not persisted, anywhere
- The model is not a lawyer or a doctor — refuses by omission

### Single line under all three columns
*The pitch is "the bridge cannot lie." The architecture is what makes that sentence true.*

---

## Slide 9 — Limits and honesty

**One slide. Acknowledges what we did not solve.** Including this slide is itself part of the ethical-alignment story; do not skip it.

### What we shipped
- Vision extraction, PII vault, simplifier, faithfulness audit, injection detector, ISL chip popover, ISL Play-All flow, three-position reading-form slider, three-position language toggle (English / Hindi / code-mixed), audio playback in both languages, **voice + text query at upload** (Web Speech API for dictation; the answer comes back in the asker's language, refuses advice, and is grounded in the document only).

### What we deferred, and why
- **Click-to-highlight cross-references** — PDF originals render in an iframe; visual span-level highlight is bounded. Achievable for image documents in a future iteration.
- **Per-paragraph confidence dots** — low marginal value at the demo time we had; the existing faithfulness badge already carries the trust story.
- **A typed-only follow-up question box** — we originally specced this and then refused to build it: a free-text *typed* input centres a literate user, and our primary user is deaf or low-literacy. We then rebuilt the feature with **voice input** as the primary path, which addresses the audience concern: a deaf user doesn't need to type, a low-literacy adult can ask verbally. The deferral was the right call; rebuilding it differently is what made it shippable.
- **Hindi ISL coverage is limited.** ~30 hand-curated Hindi → English alias entries. A Hindi play-all is sparser than English. We surface this in the UI itself.

### One-line takeaway
*We shipped what advanced the user. The features we initially deferred were rebuilt only when we found a shape that fit the primary user, not just the demo.*

---

## Slide 10 — Close

**Single slide. One image. One sentence.**

### Visual
The composite image from Slide 1 — or a fresh photo of the side-by-side view with the Play-All cursor mid-highlight. Whatever lands cleanly.

### Sentence (large, one line, top of slide)
*We translate. We don't decide.*

### Sentence (smaller, below)
*We built the bridge. And the bridge cannot lie.*

**Speaker note:** Pause for a beat after the second line. That's the end. Don't keep talking.

---

## Slide 11 — Team / repo / contact (back-pocket / Q&A)

**Single slide. Show only if there's time, or in Q&A. Do not include in the main 5-minute flow.**

### Team

| Name | Roll number |
|---|---|
| Rishabh Kumar | 24B2419 |
| Neepun | 24B0691 |
| Dhruva | 24B2433 |
| Dhruv | 24B2418 |

### Repository
[github.com/SirCoolerArc/SugamPath](https://github.com/SirCoolerArc/SugamPath)

### Built for
AIC × Anthropic Claude Hackathon, IIT Bombay, May 2026

---

## Anticipated Q&A — what the judges are likely to ask

These are not slides. These are talking points for the team to memorise. If a question lands, the answer should be ≤ 30 seconds.

### "Why this LLM specifically?"
> Gemini 2.5 Flash — vision pass on the raw image, structured JSON output, multilingual, 1M-token context. The pipeline is provider-agnostic; `lib/gemini_client.ts` is the one file that imports the SDK. Swapping to Claude or GPT is a one-file change.

### "Why not LangGraph or LangChain?"
> Under hackathon time pressure, an agent framework is added dependency complexity without added capability for a workflow this well-defined. Every property a framework would offer — tool composition, conditional flow, validation-driven retry, self-correction, escalation — the architecture has in plain TypeScript. We chose to ship the behaviour, not the dependency.

### "How does this scale to 10 million users?"
> The request path is stateless. The PII vault is a request-scoped closure, garbage-collected when the response sends. There's no database, no cache, no shared state to manage. The cost of scale is the cost of inference. Different stages can use different models — cheap Flash for extraction, larger model for the faithfulness audit — to control cost.

### "What stops the model from giving medical / legal advice?"
> Three layers. (1) The simplifier prompt explicitly forbids generation of advice text — predict outcomes, recommend actions, evaluate quality are all on the deny list. (2) The faithfulness judge would catch an advice-flavoured fabrication as an UNVERIFIED verdict. (3) Action items use verifying language ("verify your follow-up with Dr. X"), never commanding language. The original document is always shown alongside the rewritten text — the user can always check what the document actually says.

### "What happens if Gemini hallucinates a drug name?"
> The simplifier never references drug names, doses, or dates by string. It references them by ID — `{{c1}}`, `{{c2}}`. Post-generation, a deterministic substitution in code replaces each placeholder with the verbatim value from the extraction. The model cannot paraphrase a critical field because it never produces the string in the first place. This is structural, not textual.

### "How is PII actually handled?"
> Two-pass tokeniser. Pass 1: 16 regex patterns covering Indian PII shapes plus Devanagari label cues. Pass 2: the extractor's vision LLM emits a `pii_spans` array listing every PII fragment it transcribed; these merge as additional candidates. Every downstream LLM call sees only `[NAME_001]`, `[DATE_002]` tokens. The vault is in-memory, request-scoped, never logged, never persisted, never sent to the client (only its size). PII is reconstructed onto the response object after generation completes.

### "Is this for deaf users or low-literacy users?"
> Both, primarily. The product was designed around the deaf primary user — the one with the most demanding modality requirements. Low-literacy users benefit from the same simplifications, the same audio playback, the same ISL clarifications of vocabulary. The design didn't have to be split.

### "What did you decide *not* to build, and why?"
> The original 6.4 spec was a typed-only follow-up question box with an intent classifier. We had a full design and an implementation plan ready. We pulled it the night before submission because a typed-only input centres a literate user, and our primary user is deaf or low-literacy. The deferral was the right call — but a teammate then rebuilt the feature with **voice input** as the primary path, which addresses the audience concern. So what we *don't* have is the typed-only intent classifier; what we *do* have is voice-first question-answering grounded in the document. The spec for the deferred design is preserved in `docs/superpowers/specs/` as a record.

### "How does the voice-query work, and what stops it from giving advice?"
> Three layers, same architecture as the rest of the product. (1) `prompts/query.md` is constrained to answer *only* from the document — it explicitly says *"if the document doesn't contain the answer, say so."* (2) The same advice-deny list applies: *"should I take this?"*, *"is this safe?"*, *"should I sue?"* all return a polite refusal that redirects the user to a doctor or lawyer. (3) Critical fields stay locked as `{{cN}}` placeholders, so the answer text cannot paraphrase a drug name or dose. The voice path is just a Web Speech API transcriber on the way in; the language and safety properties are identical to the typed path.

### "What's next after the hackathon?"
> Three things, ranked. (1) Expand the Hindi → English ISL alias map to ~100+ entries so Hindi play-all coverage matches English. (2) PDF.js-based rendering of PDF originals to enable visual span-level click-to-highlight. (3) An accessibility audit by deaf users of an actual rendered discharge summary — the gap between "we built this for deaf users" and "deaf users use this" is real and we don't pretend to have closed it in two days.

---

## Demo timing template

| Slide | Mode | Target |
|---|---|---|
| 1. Hook | Slides | 0:00 – 0:15 |
| 2. The user | Slides | 0:15 – 1:00 |
| 3. Demo Act I — upload + (optional voice query) + side-by-side + chip | Live | 1:00 – 2:15 |
| 4. Demo Act II — safety reveal | Live | 2:00 – 2:45 |
| 5. Demo Act III — Play All Signs | Live | 2:45 – 3:30 |
| 6. What else this handles | Slides | 3:30 – 4:00 |
| 7. Architecture | Slides | 4:00 – 4:45 |
| 8. Scalability + ethics + commitments | Slides | 4:45 – 5:15 |
| 9. Limits and honesty | Slides | 5:15 – 5:30 |
| 10. Close | Slides | 5:30 – 5:45 |
| 11. Team / repo | (Q&A only) | — |

If the demo runs long, drop the voice-query beat in Act I and the network-tab moment in Act II (Slide 4). If the demo is going short, expand Slide 7 with a deeper dive into one stage (the faithfulness judge is the highest-impact deep dive). The voice-query is the most droppable live moment because it can be surfaced cleanly in Q&A; the safety reveal in Act II is the moment that *cannot* be cut without losing the deck's pivot.

---

## Notes for the slide-makers (Neepun and Dhruv)

- **Typography.** A serif display face for the headline lines (the slide titles, *"We translate. We don't decide."*) plus a clean sans-serif for body text reads more confident than two sans-serifs. Avoid Comic Sans or Times — pick something like Garamond / EB Garamond (free) for serif, and Inter or IBM Plex Sans for sans.
- **Colour.** The product itself uses a calm "newsprint" palette — paper-warm background, ink-black text, navy accent, turmeric accent, occasional rust for warnings. Match the deck to that palette so demo and slides read as one piece.
- **Avoid:** dark backgrounds with white text (the screenshots will look out of place); animated transitions (the content carries the impact); icons that don't say something specific.
- **One image per slide ceiling.** If a slide needs two images, it might be two slides.
- **Architecture diagram (Slide 7).** Either redraw the ASCII diagram in Excalidraw / Figma at high resolution, or screenshot it monospace and apply a subtle drop shadow. Don't try to render the ASCII directly in the slide — it'll look like terminal output, which it is.
- **Live demo segments.** Have a single-line "Live demo — discharge summary" slide as a transition card so the cut from slides to browser is intentional, not jarring.
- **Backup.** Record a 3-minute screencast of the live demo before presenting. If the live demo fails on stage, the screencast is the safety net. Have it ready in a tab.
