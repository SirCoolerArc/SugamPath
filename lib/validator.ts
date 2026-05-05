import { z } from "zod";
import { ExtractionSchema, type Extraction, extractionInvariantViolations } from "@/lib/types";

export interface ParseSuccess {
  ok: true;
  data: Extraction;
}
export interface ParseFailure {
  ok: false;
  errors: string[];
  rawJsonExcerpt: string;
}
export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Parse a Gemini text response as an Extraction. Strips Markdown code fences
 * if present (Gemini emits ```json ... ``` even when asked not to).
 */
export function parseExtraction(rawText: string): ParseResult {
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

  const result = ExtractionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: zodErrors(result.error),
      rawJsonExcerpt: cleaned.slice(0, 500),
    };
  }

  const invariantErrors = extractionInvariantViolations(result.data);
  if (invariantErrors.length > 0) {
    return {
      ok: false,
      errors: invariantErrors,
      rawJsonExcerpt: cleaned.slice(0, 500),
    };
  }

  return { ok: true, data: result.data };
}

function stripJsonFence(text: string): string {
  // Matches ```json ... ``` or ``` ... ``` wrappers.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : text;
}

function zodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}
