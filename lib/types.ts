// All shared TypeScript types live here. See docs/demo_benchmark.md §3 for the
// gold-standard shape this schema must satisfy.

import { z } from "zod";

// ─── Critical field kinds ────────────────────────────────────────────────────
// Open enum — Gemini may invent reasonable kinds (e.g. "deadline", "salt_limit").
// The validator checks the *shape* but not the kind vocabulary, so a new kind
// won't fail extraction; it just becomes a string. Known kinds get richer
// downstream rendering.
export const CRITICAL_FIELD_KINDS = [
  "medication",
  "appointment",
  "lab_deadline",
  "lab_value",
  "salt_limit",
  "weight_limit",
  "phone",
  "amount",
  "identifier",
  "date",
  "address",
  "other",
] as const;

export const CriticalFieldSchema = z.object({
  id: z.string().regex(/^c\d+$/, "id must look like c1, c2, ..."),
  kind: z.string().min(1),
  verbatim: z.string().min(1),
});
export type CriticalField = z.infer<typeof CriticalFieldSchema>;

// ─── Paragraphs ──────────────────────────────────────────────────────────────
export const PARAGRAPH_INTENTS = [
  "diagnosis",
  "hospital_course",
  "medication",
  "follow_up",
  "lab_order",
  "lifestyle",
  "warning_sign",
  "emergency_contact",
  "header",
  "other",
] as const;

export const ParagraphSchema = z.object({
  id: z.string().regex(/^p[a-z0-9_]+$/i, "id must look like p1, p_meds, ..."),
  intent: z.string().min(1),
  original_span: z.string().min(1),
  simplifiable: z.boolean(),
  critical_field_refs: z.array(z.string().regex(/^c\d+$/)).default([]),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;

// ─── Action items ────────────────────────────────────────────────────────────
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const ActionItemSchema = z.object({
  id: z.string().regex(/^a\d+$/, "id must look like a1, a2, ..."),
  what: z.string().min(1),
  deadline: z.string().min(1), // free-form: "[DATE_004]", "Daily, ongoing", "Immediate"
  source_paragraph_id: z.string().min(1),
  verify_with: z.string().min(1),
  confidence: z.enum(CONFIDENCE_LEVELS),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

// ─── PII spans (LLM-emitted, regex-augmenting) ───────────────────────────────
// The extractor's JSON includes a `pii_spans` array listing every PII
// fragment the LLM transcribed. The downstream PII vault uses these as
// additional candidates to tokenise alongside its regex matches. Optional in
// the schema so older-format responses still validate.
export const PII_SPAN_KINDS = [
  "NAME",
  "ADDRESS",
  "PHONE",
  "AADHAAR",
  "PAN",
  "DATE",
  "UHID",
  "MONEY",
  "EMAIL",
  "URL_PERSONAL",
  "OTHER",
] as const;

export const PIISpanSchema = z.object({
  kind: z.string().min(1),
  value: z.string().min(1),
});
export type PIISpan = z.infer<typeof PIISpanSchema>;

// ─── Top-level extraction output ─────────────────────────────────────────────
export const ExtractionSchema = z.object({
  document_type: z.string().min(1),
  language_detected: z.string().min(1),
  issuing_authority: z.string().min(1),
  patient_token: z.string().min(1),       // "Patient Name" or "Not found"
  issue_date_token: z.string().min(1),    // discharge date / letter date / "Not found"
  paragraphs: z.array(ParagraphSchema).min(1),
  critical_fields: z.array(CriticalFieldSchema),
  action_items: z.array(ActionItemSchema),
  warning_signs: z.array(z.string().min(1)).default([]),
  red_flags: z.array(z.string()).default([]),
  pii_spans: z.array(PIISpanSchema).default([]),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// ─── Cross-field invariants (checked after Zod parse) ────────────────────────
// Returns a list of human-readable violations. Empty list = OK.
export function extractionInvariantViolations(e: Extraction): string[] {
  const errors: string[] = [];

  // Every critical_field_ref in a paragraph must point to an existing critical field.
  const knownCriticalIds = new Set(e.critical_fields.map((c) => c.id));
  for (const p of e.paragraphs) {
    for (const ref of p.critical_field_refs) {
      if (!knownCriticalIds.has(ref)) {
        errors.push(`paragraph ${p.id} references unknown critical field ${ref}`);
      }
    }
  }

  // Every action_item.source_paragraph_id must exist.
  const knownParagraphIds = new Set(e.paragraphs.map((p) => p.id));
  for (const a of e.action_items) {
    if (!knownParagraphIds.has(a.source_paragraph_id)) {
      errors.push(
        `action_item ${a.id} references unknown paragraph ${a.source_paragraph_id}`,
      );
    }
  }

  // Critical field ids must be unique.
  const seen = new Set<string>();
  for (const c of e.critical_fields) {
    if (seen.has(c.id)) errors.push(`duplicate critical field id ${c.id}`);
    seen.add(c.id);
  }

  return errors;
}

// ─── Reading-form levels (Stage 1 #16) ───────────────────────────────────────
// Three positions on the client-side slider — see components/ReadingFormSlider.
// Server uses the level to append a constraint to the simplifier prompt; the
// underlying pipeline (faithfulness, render, vault reconstruction) is identical
// across levels.
export const READING_LEVELS = ["paragraphs", "shorter", "list"] as const;
export type ReadingLevel = (typeof READING_LEVELS)[number];
export const DEFAULT_READING_LEVEL: ReadingLevel = "paragraphs";

// ─── Target language (Stage 2 #22) ───────────────────────────────────────────
// Indian users code-switch; the demo defaults to English but Hindi-primary and
// code-mixed renderings are first-class. Threaded through `simplify()` and
// folded into the simplifier prompt as an extra constraint section. The
// faithfulness judge is language-aware separately.
export const TARGET_LANGUAGES = ["en", "hi", "code-mixed"] as const;
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];
export const DEFAULT_TARGET_LANGUAGE: TargetLanguage = "en";

// ─── Simplification (Checkpoint 4.3 output) ──────────────────────────────────
// What the simplifier emits, before any client-side post-processing. Critical
// field references appear as `{{cN}}` placeholders that the renderer
// substitutes later. PII tokens (e.g. `[NAME_001]`) flow through untouched
// until the final reconstruct pass on the client-bound payload.
export const SimplifiedSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
});
export type SimplifiedSection = z.infer<typeof SimplifiedSectionSchema>;

export const SimplifiedActionSchema = z.object({
  id: z.string().regex(/^a\d+$/),
  what: z.string().min(1),
  deadline_plain: z.string().min(1),
  verify_with_plain: z.string().min(1),
});
export type SimplifiedAction = z.infer<typeof SimplifiedActionSchema>;

export const SimplificationSchema = z.object({
  language: z.string().min(1),                 // 'en' for Stage 0
  sections: z.array(SimplifiedSectionSchema),
  simplified_actions: z.array(SimplifiedActionSchema),
  warnings_plain: z.array(z.string().min(1)).default([]),
});
export type Simplification = z.infer<typeof SimplificationSchema>;

// ─── Faithfulness check (Stage 1 #14) ────────────────────────────────────────
// Output of the LLM-as-judge audit that compares the post-substitution
// simplified text against the extraction's critical_fields. See
// `prompts/faithfulness.md` and `lib/faithfulness.ts`.
export const FAITHFULNESS_VERDICTS = [
  "VERIFIED",
  "VERIFIED_WITH_OMISSIONS",
  "UNVERIFIED",
] as const;
export type FaithfulnessVerdict = (typeof FAITHFULNESS_VERDICTS)[number];

export const FAITHFULNESS_DIFFERENCE_KINDS = ["OMITTED", "FABRICATED"] as const;

export const FaithfulnessDifferenceSchema = z.object({
  kind: z.enum(FAITHFULNESS_DIFFERENCE_KINDS),
  field_id: z.string().regex(/^c\d+$/).optional(),
  verbatim: z.string().optional(),
  fragment: z.string().optional(),
  note: z.string().min(1),
});
export type FaithfulnessDifference = z.infer<typeof FaithfulnessDifferenceSchema>;

export const FaithfulnessResultSchema = z.object({
  verdict: z.enum(FAITHFULNESS_VERDICTS),
  differences: z.array(FaithfulnessDifferenceSchema).default([]),
  critical_fields_in_original: z.array(z.string().regex(/^c\d+$/)).default([]),
  critical_fields_in_simplified: z.array(z.string().regex(/^c\d+$/)).default([]),
});
export type FaithfulnessResult = z.infer<typeof FaithfulnessResultSchema>;

// ─── Injection check (Stage 1 #15) ───────────────────────────────────────────
// Output of the adversarial-content detector that scans extracted paragraphs
// for text directed at an automated assistant (NOTE TO AI, "ignore previous
// instructions", pre-approval claims, etc.). See `prompts/injection_check.md`
// and `lib/injection_check.ts`.
export const INJECTION_VERDICTS = ["CLEAN", "SUSPICIOUS"] as const;
export type InjectionVerdict = (typeof INJECTION_VERDICTS)[number];

export const INJECTION_PATTERNS = [
  "direct_ai_instruction",
  "pre_approval_claim",
  "imperative_to_assistant",
  "role_play_injection",
  "prompt_leakage_attempt",
  "other",
] as const;

export const InjectionFindingSchema = z.object({
  paragraph_id: z.string().min(1),
  pattern: z.string().min(1),
  excerpt: z.string().min(1),
});
export type InjectionFinding = z.infer<typeof InjectionFindingSchema>;

export const InjectionCheckResultSchema = z.object({
  verdict: z.enum(INJECTION_VERDICTS),
  findings: z.array(InjectionFindingSchema).default([]),
});
export type InjectionCheckResult = z.infer<typeof InjectionCheckResultSchema>;

// ─── ISL dictionary entry (data/isl_dictionary.json) ────────────────────────
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

// ─── Pipeline response (what /api/process returns to the client) ─────────────
export interface ProcessResponse {
  extraction: Extraction;            // PII reconstructed for client display
  redactedExtraction: Extraction;    // tokenised form (what the simplifier saw)
  simplification: Simplification;    // PII reconstructed; {{cN}} substituted to HTML spans
  vaultSize: number;                 // for the "PII vaulted" badge
  vault: Array<[string, string]>;    // serialised PIIVault — needed client-side for /api/resimplify
  warnings: string[];                // any non-fatal extraction notes
  faithfulness: FaithfulnessResult | null; // null only if the judge call itself errored
  injection: InjectionCheckResult | null;  // null only if the detector call itself errored
}
