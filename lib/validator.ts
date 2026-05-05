import { z } from "zod";
import {
  ExtractionSchema,
  SimplificationSchema,
  type Extraction,
  type Simplification,
  extractionInvariantViolations,
} from "@/lib/types";

export interface ParseSuccess<T> {
  ok: true;
  data: T;
}
export interface ParseFailure {
  ok: false;
  errors: string[];
  rawJsonExcerpt: string;
}
export type ParseResult<T = Extraction> = ParseSuccess<T> | ParseFailure;

/**
 * Parse a Gemini text response as an Extraction. Strips Markdown code fences
 * if present (Gemini emits ```json ... ``` even when asked not to).
 */
export function parseExtraction(rawText: string): ParseResult<Extraction> {
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

/**
 * Parse a Gemini text response as a Simplification. Same fence-stripping +
 * Zod-validation flow as parseExtraction, but with simplifier-specific
 * cross-field invariants.
 */
export function parseSimplification(
  rawText: string,
  knownActionIds: ReadonlySet<string>,
): ParseResult<Simplification> {
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

  const result = SimplificationSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: zodErrors(result.error),
      rawJsonExcerpt: cleaned.slice(0, 500),
    };
  }

  // Cross-field invariant: every simplified_actions[].id must correspond to a
  // known action_item id from the extraction. The simplifier may not invent
  // new actions and may not skip them either (the renderer expects 1:1).
  const errors: string[] = [];
  const seenIds = new Set<string>();
  for (const a of result.data.simplified_actions) {
    if (!knownActionIds.has(a.id)) {
      errors.push(`simplified_actions[id=${a.id}] does not match any extraction action_item`);
    }
    if (seenIds.has(a.id)) errors.push(`duplicate simplified_actions id ${a.id}`);
    seenIds.add(a.id);
  }
  for (const knownId of knownActionIds) {
    if (!seenIds.has(knownId)) {
      errors.push(`simplified_actions is missing entry for action_item id=${knownId}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, rawJsonExcerpt: cleaned.slice(0, 500) };
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
