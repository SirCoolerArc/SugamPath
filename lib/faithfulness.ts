import fs from "node:fs/promises";
import path from "node:path";

import { callGemini } from "@/lib/gemini_client";
import { applyCriticalFieldSubstitution } from "@/lib/renderers";
import {
  FaithfulnessResultSchema,
  type CriticalField,
  type FaithfulnessResult,
  type Simplification,
} from "@/lib/types";

const MAX_ATTEMPTS = 2;

export interface FaithfulnessInput {
  /** The REDACTED extraction's critical_fields. The judge sees these (no PII).
   *  Critical-field verbatim values for kinds like `appointment` can contain
   *  names which are already tokenised in the redacted form. */
  redactedCriticalFields: readonly CriticalField[];
  /** The simplifier's RAW output (with `{{cN}}` placeholders intact, PII
   *  tokenised). The judge needs the post-substitution form, so we apply the
   *  substitution against the redacted critical_fields locally. */
  rawSimplification: Simplification;
}

export class FaithfulnessJudgeError extends Error {
  constructor(message: string, public lastErrors: string[], public lastRawExcerpt: string) {
    super(message);
    this.name = "FaithfulnessJudgeError";
  }
}

/**
 * Run the faithfulness judge over the simplifier's output. Returns one of three
 * verdicts:
 *
 *   - `VERIFIED`                — every critical_field verbatim appears in the
 *                                 simplified text; no fabricated numbers/dates.
 *   - `VERIFIED_WITH_OMISSIONS` — at least one critical field is missing from
 *                                 the simplified text, but nothing fabricated.
 *   - `UNVERIFIED`              — at least one number/date/dose appears in the
 *                                 simplified text with no critical-field source.
 *
 * The judge sees only the redacted (PII-tokenised) form. PII never leaves the
 * box. Throws `FaithfulnessJudgeError` if the judge call itself fails after
 * MAX_ATTEMPTS — caller should fail-open and surface a null result.
 */
export async function judgeFaithfulness(
  input: FaithfulnessInput,
): Promise<FaithfulnessResult> {
  const basePrompt = await loadPrompt();

  const redactedSubstituted = applyCriticalFieldSubstitution(
    input.rawSimplification,
    input.redactedCriticalFields,
  );
  const simplifiedText = serialiseSimplification(redactedSubstituted);

  const judgeInput = {
    critical_fields: input.redactedCriticalFields.map((c) => ({
      id: c.id,
      kind: c.kind,
      verbatim: c.verbatim,
    })),
    simplified_text: simplifiedText,
  };

  const prompt = `${basePrompt}\n\n---\n\n## Input\n\n<extraction>\n${JSON.stringify(judgeInput, null, 2)}\n</extraction>\n`;

  let lastErrors: string[] = [];
  let lastRawExcerpt = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await callGemini(prompt);
    const result = parseFaithfulness(raw);
    if (result.ok) return result.data;
    lastErrors = result.errors;
    lastRawExcerpt = result.rawJsonExcerpt;
  }

  throw new FaithfulnessJudgeError(
    `Faithfulness judge failed after ${MAX_ATTEMPTS} attempts.`,
    lastErrors,
    lastRawExcerpt,
  );
}

/** Build the retry-guidance string the simplifier prompt receives when the
 *  judge flags omissions or fabrications. Folded into the base simplify prompt
 *  via `simplify({ extraGuidance })`. */
export function buildSimplifyRetryGuidance(result: FaithfulnessResult): string {
  if (result.differences.length === 0) return "";
  const lines: string[] = [
    "The previous simplification was audited and the following issues were found. Re-emit the simplified output addressing each one:",
  ];
  for (const d of result.differences) {
    if (d.kind === "OMITTED") {
      lines.push(
        `- OMITTED: critical field ${d.field_id ?? ""} (verbatim: "${d.verbatim ?? ""}") was not referenced. Reference it as {{${d.field_id}}} in an appropriate section.`,
      );
    } else if (d.kind === "FABRICATED") {
      lines.push(
        `- FABRICATED: the phrase "${d.fragment ?? ""}" appeared but no critical field has this value. Remove it or replace it with a {{cN}} reference if it corresponds to a real critical field.`,
      );
    }
  }
  return lines.join("\n");
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function loadPrompt(): Promise<string> {
  const promptPath = path.join(process.cwd(), "prompts", "faithfulness.md");
  return fs.readFile(promptPath, "utf-8");
}

/** Flatten a Simplification (already substituted) into one text blob for the
 *  judge. Preserves the `<span class="critical-field" data-id="cN">` tags so
 *  the judge can read both the values and their ids. */
function serialiseSimplification(s: Simplification): string {
  const parts: string[] = [];
  for (const sec of s.sections) {
    parts.push(`## ${sec.heading}`);
    parts.push(sec.body);
  }
  if (s.simplified_actions.length) {
    parts.push("## Action items");
    for (const a of s.simplified_actions) {
      parts.push(`- [${a.id}] ${a.what}`);
      parts.push(`  when: ${a.deadline_plain}`);
      parts.push(`  verify: ${a.verify_with_plain}`);
    }
  }
  if (s.warnings_plain.length) {
    parts.push("## Warnings");
    for (const w of s.warnings_plain) parts.push(`- ${w}`);
  }
  return parts.join("\n\n");
}

interface ParseSuccess {
  ok: true;
  data: FaithfulnessResult;
}
interface ParseFailure {
  ok: false;
  errors: string[];
  rawJsonExcerpt: string;
}
type ParseResult = ParseSuccess | ParseFailure;

function parseFaithfulness(rawText: string): ParseResult {
  const cleaned = stripJsonFence(rawText).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      errors: [`response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`],
      rawJsonExcerpt: cleaned.slice(0, 500),
    };
  }

  const result = FaithfulnessResultSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      rawJsonExcerpt: cleaned.slice(0, 500),
    };
  }

  const data = result.data;
  const hasFabricated = data.differences.some((d) => d.kind === "FABRICATED");
  const hasOmitted = data.differences.some((d) => d.kind === "OMITTED");
  const expected: typeof data.verdict = hasFabricated
    ? "UNVERIFIED"
    : hasOmitted
      ? "VERIFIED_WITH_OMISSIONS"
      : "VERIFIED";
  if (data.verdict !== expected) {
    return { ok: true, data: { ...data, verdict: expected } };
  }

  return { ok: true, data };
}

function stripJsonFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : text;
}
