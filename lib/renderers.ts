import fs from "node:fs/promises";
import path from "node:path";

import { callGemini } from "@/lib/gemini_client";
import { parseSimplification } from "@/lib/validator";
import { reconstruct, type PIIVault } from "@/lib/pii_vault";
import type {
  CriticalField,
  Extraction,
  Simplification,
} from "@/lib/types";

const MAX_ATTEMPTS = 3;

export interface SimplifyInput {
  /** The REDACTED extraction (PII tokens, no real names/IDs). The simplifier
   *  must only ever see this form. */
  redactedExtraction: Extraction;
}

export interface SimplifyResult {
  simplification: Simplification;
  attempts: number;
  warnings: string[];
}

export class SimplificationFailedError extends Error {
  constructor(
    message: string,
    public attempts: number,
    public lastErrors: string[],
    public lastRawExcerpt: string,
  ) {
    super(message);
    this.name = "SimplificationFailedError";
  }
}

/**
 * Run the simplifier prompt over a validated, redacted extraction. Validates
 * the response, retries up to MAX_ATTEMPTS with appended error guidance on
 * validation failure. Returns the raw `Simplification` — note that this is
 * still in `{{cN}}`-placeholder form and contains PII tokens. Use
 * `applyCriticalFieldSubstitution` and `reconstructSimplification` to produce
 * the client-bound form.
 */
export async function simplify(input: SimplifyInput): Promise<SimplifyResult> {
  const basePrompt = await loadPrompt();
  const warnings: string[] = [];

  // The action ids the simplifier must echo back exactly. Used by the
  // validator to enforce 1:1 correspondence with the extraction.
  const knownActionIds = new Set(input.redactedExtraction.action_items.map((a) => a.id));

  let lastErrors: string[] = [];
  let lastRawExcerpt = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(basePrompt, input.redactedExtraction, lastErrors, attempt);

    const raw = await callGemini(prompt);

    const result = parseSimplification(raw, knownActionIds);
    if (result.ok) {
      if (attempt > 1) {
        warnings.push(`Simplification succeeded on attempt ${attempt} after ${attempt - 1} retry/retries.`);
      }
      return { simplification: result.data, attempts: attempt, warnings };
    }

    lastErrors = result.errors;
    lastRawExcerpt = result.rawJsonExcerpt;
  }

  throw new SimplificationFailedError(
    `Simplification failed after ${MAX_ATTEMPTS} attempts.`,
    MAX_ATTEMPTS,
    lastErrors,
    lastRawExcerpt,
  );
}

/**
 * Replace `{{cN}}` placeholders with HTML spans wrapping the verbatim
 * critical-field values. This is the structural critical-field lock from
 * CLAUDE.md §9.2 — the LLM never sees the verbatim values when generating
 * simplified text; the substitution happens here in code, so a paraphrase of
 * "Aspirin 75 mg" → "the blood-thinner" is mathematically impossible.
 *
 * Tokens that don't correspond to a known critical field are left unchanged
 * (the renderer logs a warning later if any survive).
 */
export function applyCriticalFieldSubstitution(
  simplification: Simplification,
  criticalFields: readonly CriticalField[],
): Simplification {
  const byId = new Map(criticalFields.map((c) => [c.id, c.verbatim]));
  const sub = (s: string) => substituteCriticalFields(s, byId);

  return {
    ...simplification,
    sections: simplification.sections.map((sec) => ({
      heading: sub(sec.heading),
      body: sub(sec.body),
    })),
    simplified_actions: simplification.simplified_actions.map((a) => ({
      ...a,
      what: sub(a.what),
      deadline_plain: sub(a.deadline_plain),
      verify_with_plain: sub(a.verify_with_plain),
    })),
    warnings_plain: simplification.warnings_plain.map(sub),
  };
}

/**
 * Re-attach PII across a Simplification (the inverse of the redaction that
 * happened upstream). Used when producing the client-bound payload.
 */
export function reconstructSimplification(
  simplification: Simplification,
  vault: PIIVault,
): Simplification {
  const r = (s: string) => reconstruct(s, vault);
  return {
    ...simplification,
    sections: simplification.sections.map((sec) => ({
      heading: r(sec.heading),
      body: r(sec.body),
    })),
    simplified_actions: simplification.simplified_actions.map((a) => ({
      ...a,
      what: r(a.what),
      deadline_plain: r(a.deadline_plain),
      verify_with_plain: r(a.verify_with_plain),
    })),
    warnings_plain: simplification.warnings_plain.map(r),
  };
}

/**
 * Find any unsubstituted `{{cN}}` placeholders surviving in a Simplification.
 * Returns the list of placeholder ids the renderer couldn't resolve. Caller
 * decides what to do (log, attach a warning, retry the simplifier).
 */
export function findUnresolvedPlaceholders(simplification: Simplification): string[] {
  const found = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\{\{(c\d+)\}\}/g)) found.add(m[1]);
  };
  for (const sec of simplification.sections) {
    scan(sec.heading);
    scan(sec.body);
  }
  for (const a of simplification.simplified_actions) {
    scan(a.what);
    scan(a.deadline_plain);
    scan(a.verify_with_plain);
  }
  for (const w of simplification.warnings_plain) scan(w);
  return [...found];
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function loadPrompt(): Promise<string> {
  const promptPath = path.join(process.cwd(), "prompts", "simplify.md");
  return fs.readFile(promptPath, "utf-8");
}

function buildPrompt(
  base: string,
  redactedExtraction: Extraction,
  lastErrors: string[],
  attempt: number,
): string {
  const inputSection = `\n\n---\n\n## Input extraction\n\n\`\`\`json\n${JSON.stringify(redactedExtraction, null, 2)}\n\`\`\`\n`;

  const retrySection =
    attempt === 1
      ? ""
      : `\n\n---\n\n## Retry guidance (attempt ${attempt})\n\nYour previous response failed validation:\n\n${lastErrors
          .map((e) => `- ${e}`)
          .join("\n")}\n\nRe-emit the JSON object correcting these issues. Output the JSON object and nothing else — no Markdown fences, no commentary.\n`;

  return base + inputSection + retrySection;
}

/**
 * Replace each `{{cN}}` token with `<span class="critical-field" data-id="cN">VALUE</span>`.
 * VALUE is HTML-escaped so verbatim drug names containing `&`, `<`, `>` survive.
 * Unknown ids are left as the raw `{{cN}}` so the caller can detect leaks.
 */
function substituteCriticalFields(input: string, byId: Map<string, string>): string {
  return input.replace(/\{\{(c\d+)\}\}/g, (match, id: string) => {
    const value = byId.get(id);
    if (value === undefined) return match;
    return `<span class="critical-field" data-id="${id}">${escapeHtml(value)}</span>`;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
