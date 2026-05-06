import { NextRequest, NextResponse } from "next/server";

import {
  simplify,
  applyCriticalFieldSubstitution,
  reconstructSimplification,
  SimplificationFailedError,
} from "@/lib/renderers";
import {
  judgeFaithfulness,
  buildSimplifyRetryGuidance,
  FaithfulnessJudgeError,
} from "@/lib/faithfulness";
import { GeminiRecitationError } from "@/lib/gemini_client";
import {
  ExtractionSchema,
  READING_LEVELS,
  TARGET_LANGUAGES,
  DEFAULT_TARGET_LANGUAGE,
  type FaithfulnessResult,
  type ReadingLevel,
  type Simplification,
  type TargetLanguage,
} from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

// ─── Request schema ─────────────────────────────────────────────────────────
// The client sends the redacted extraction (what the LLM sees), the
// PII-reconstructed extraction (used for the final {{cN}} HTML span values),
// the vault as serialised key/value pairs, and the desired reading level.
// PII is already on the wire as part of the original /api/process response,
// so round-tripping it here does not increase exposure.
const VaultEntrySchema = z.tuple([z.string(), z.string()]);

const ResimplifyRequestSchema = z.object({
  redactedExtraction: ExtractionSchema,
  extraction: ExtractionSchema,
  vault: z.array(VaultEntrySchema),
  level: z.enum(READING_LEVELS),
  // Optional for back-compat with clients that haven't been updated yet;
  // server defaults to "en" when missing. The cache key on the client side is
  // expected to be (level, language).
  language: z.enum(TARGET_LANGUAGES).optional(),
});

export interface ResimplifyResponse {
  simplification: Simplification;
  faithfulness: FaithfulnessResult | null;
  warnings: string[];
  meta: { totalLatencyMs: number; level: ReadingLevel; language: TargetLanguage };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json(
      { error: "Could not parse JSON body.", detail: errMessage(err) },
      { status: 400 },
    );
  }

  const parseResult = ResimplifyRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid resimplify request.",
        detail: parseResult.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
        ),
      },
      { status: 400 },
    );
  }

  const { redactedExtraction, extraction, vault: vaultEntries, level } = parseResult.data;
  const language = parseResult.data.language ?? DEFAULT_TARGET_LANGUAGE;
  const vault = new Map(vaultEntries);

  const startedAt = Date.now();
  const warnings: string[] = [];

  // ─── Simplify with the requested level ─────────────────────────────────
  let rawSimplification: Simplification;
  try {
    const result = await simplify({ redactedExtraction, level, language });
    rawSimplification = result.simplification;
    warnings.push(...result.warnings);
  } catch (err) {
    if (err instanceof SimplificationFailedError) {
      return NextResponse.json(
        {
          error: "Could not generate a simplified version at this reading form.",
          stage: "simplification",
          attempts: err.attempts,
          detail: err.lastErrors,
        },
        { status: 422 },
      );
    }
    if (err instanceof GeminiRecitationError) {
      return NextResponse.json(
        {
          error: "The model declined to simplify this document due to a content-safety filter.",
          stage: "simplification",
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Simplification failed.", stage: "simplification", detail: errMessage(err) },
      { status: 502 },
    );
  }

  // ─── Faithfulness judge (with single retry on a non-VERIFIED first pass) ─
  let faithfulness: FaithfulnessResult | null = null;
  try {
    const firstVerdict = await judgeFaithfulness({
      redactedCriticalFields: redactedExtraction.critical_fields,
      rawSimplification,
    });
    if (firstVerdict.verdict !== "VERIFIED" && firstVerdict.differences.length > 0) {
      try {
        const retryResult = await simplify({
          redactedExtraction,
          level,
          language,
          extraGuidance: buildSimplifyRetryGuidance(firstVerdict),
        });
        rawSimplification = retryResult.simplification;
        const secondVerdict = await judgeFaithfulness({
          redactedCriticalFields: redactedExtraction.critical_fields,
          rawSimplification,
        });
        faithfulness = secondVerdict;
      } catch {
        faithfulness = firstVerdict;
      }
    } else {
      faithfulness = firstVerdict;
    }
  } catch (err) {
    if (err instanceof FaithfulnessJudgeError) {
      warnings.push(
        "Faithfulness judge errored after retries; surfacing simplification without audit.",
      );
    } else {
      warnings.push(
        `Faithfulness judge unavailable (${errMessage(err)}); surfacing simplification without audit.`,
      );
    }
  }

  // ─── Render: substitute critical fields, reconstruct PII ───────────────
  const withCriticals = applyCriticalFieldSubstitution(
    rawSimplification,
    extraction.critical_fields,
  );
  const finalSimplification = reconstructSimplification(withCriticals, vault);

  const response: ResimplifyResponse = {
    simplification: finalSimplification,
    faithfulness,
    warnings,
    meta: {
      totalLatencyMs: Date.now() - startedAt,
      level,
      language,
    },
  };

  return NextResponse.json(response);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
