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

// ─── Pipeline response (what /api/process returns to the client) ─────────────
export interface ProcessResponse {
  extraction: Extraction;            // PII reconstructed for client display
  redactedExtraction: Extraction;    // tokenised form (what the simplifier saw)
  vaultSize: number;                 // for the "PII vaulted" badge
  warnings: string[];                // any non-fatal extraction notes
}
