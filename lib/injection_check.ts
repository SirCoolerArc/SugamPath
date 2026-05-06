import fs from "node:fs/promises";
import path from "node:path";

import { callGemini } from "@/lib/gemini_client";
import {
  InjectionCheckResultSchema,
  type Extraction,
  type InjectionCheckResult,
} from "@/lib/types";

const MAX_ATTEMPTS = 2;

export interface InjectionCheckInput {
  /** The redacted extraction. The detector reads paragraphs[].original_span;
   *  PII tokens flow through unchanged and are not interpreted. */
  redactedExtraction: Extraction;
}

export class InjectionCheckError extends Error {
  constructor(message: string, public lastErrors: string[], public lastRawExcerpt: string) {
    super(message);
    this.name = "InjectionCheckError";
  }
}

/**
 * Run the adversarial-content detector over the extraction's paragraphs.
 * Returns `CLEAN` or `SUSPICIOUS` with a list of flagged excerpts. Throws
 * `InjectionCheckError` only if the LLM call fails after MAX_ATTEMPTS — caller
 * should fail-open and surface a null result (the simplification still ships
 * regardless).
 */
export async function checkForInjection(
  input: InjectionCheckInput,
): Promise<InjectionCheckResult> {
  const basePrompt = await loadPrompt();

  const detectorInput = {
    paragraphs: input.redactedExtraction.paragraphs.map((p) => ({
      id: p.id,
      intent: p.intent,
      original_span: p.original_span,
    })),
  };

  const prompt = `${basePrompt}\n\n---\n\n## Input\n\n<document>\n${JSON.stringify(detectorInput, null, 2)}\n</document>\n`;

  let lastErrors: string[] = [];
  let lastRawExcerpt = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await callGemini(prompt);
    const result = parseInjectionCheck(raw);
    if (result.ok) return result.data;
    lastErrors = result.errors;
    lastRawExcerpt = result.rawJsonExcerpt;
  }

  throw new InjectionCheckError(
    `Injection detector failed after ${MAX_ATTEMPTS} attempts.`,
    lastErrors,
    lastRawExcerpt,
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function loadPrompt(): Promise<string> {
  const promptPath = path.join(process.cwd(), "prompts", "injection_check.md");
  return fs.readFile(promptPath, "utf-8");
}

interface ParseSuccess {
  ok: true;
  data: InjectionCheckResult;
}
interface ParseFailure {
  ok: false;
  errors: string[];
  rawJsonExcerpt: string;
}
type ParseResult = ParseSuccess | ParseFailure;

function parseInjectionCheck(rawText: string): ParseResult {
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

  const result = InjectionCheckResultSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      rawJsonExcerpt: cleaned.slice(0, 500),
    };
  }

  // Cross-check: verdict must be consistent with findings array.
  const data = result.data;
  const expected: typeof data.verdict = data.findings.length > 0 ? "SUSPICIOUS" : "CLEAN";
  if (data.verdict !== expected) {
    return { ok: true, data: { ...data, verdict: expected } };
  }

  return { ok: true, data };
}

function stripJsonFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : text;
}
