import { NextRequest, NextResponse } from "next/server";

import { extract, ExtractionFailedError } from "@/lib/extractor";
import {
  simplify,
  applyCriticalFieldSubstitution,
  reconstructSimplification,
  SimplificationFailedError,
} from "@/lib/renderers";
import { reconstructExtraction } from "@/lib/extractor";
import { GeminiRecitationError, type GeminiImage } from "@/lib/gemini_client";
import type { ProcessResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB across all uploaded pages
const ACCEPTED_MIME_PREFIXES = ["image/", "application/pdf"];

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: "Could not parse multipart form body.", detail: errMessage(err) },
      { status: 400 },
    );
  }

  // Accept either a single `document` file or multiple `document` files
  // (one per page). FormData.getAll preserves submission order, which we
  // rely on so multi-page docs reach the extractor in correct page order.
  const fileEntries = form.getAll("document").filter((v): v is File => v instanceof File);
  if (fileEntries.length === 0) {
    return NextResponse.json(
      { error: "No 'document' file in form data. Send one or more files in the 'document' field." },
      { status: 400 },
    );
  }

  let totalBytes = 0;
  for (const f of fileEntries) {
    if (!ACCEPTED_MIME_PREFIXES.some((p) => f.type.startsWith(p))) {
      return NextResponse.json(
        { error: `Unsupported file type '${f.type}' for ${f.name}. Send images or PDFs.` },
        { status: 400 },
      );
    }
    totalBytes += f.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `Total upload size ${(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds limit of ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`,
      },
      { status: 413 },
    );
  }

  // Convert files to base64 in parallel.
  const images: GeminiImage[] = await Promise.all(
    fileEntries.map(async (f) => ({
      base64: Buffer.from(await f.arrayBuffer()).toString("base64"),
      mimeType: f.type,
    })),
  );

  const startedAt = Date.now();

  // ─── Stage 1: extraction ────────────────────────────────────────────────
  let extractResult;
  try {
    extractResult = await extract({ images });
  } catch (err) {
    if (err instanceof ExtractionFailedError) {
      return NextResponse.json(
        {
          error: "Could not extract a structured representation of this document.",
          stage: "extraction",
          attempts: err.attempts,
          detail: err.lastErrors,
        },
        { status: 422 },
      );
    }
    if (err instanceof GeminiRecitationError) {
      return NextResponse.json(
        {
          error: "The model declined to process this document due to a content-safety filter.",
          stage: "extraction",
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Extraction failed.", stage: "extraction", detail: errMessage(err) },
      { status: 502 },
    );
  }

  const { extraction, redactedExtraction, vault, warnings: extractionWarnings } = extractResult;

  // ─── Stage 2: simplification ────────────────────────────────────────────
  let simplifyResult;
  try {
    simplifyResult = await simplify({ redactedExtraction });
  } catch (err) {
    if (err instanceof SimplificationFailedError) {
      return NextResponse.json(
        {
          error: "Could not generate a simplified version of this document.",
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

  const { simplification: rawSimplification, warnings: simplificationWarnings } = simplifyResult;

  // ─── Stage 3: render ────────────────────────────────────────────────────
  // 1. Substitute {{cN}} placeholders with verbatim critical-field HTML spans
  //    (uses the PII-RECONSTRUCTED extraction so verbatim values include real
  //    names/dates/amounts — these are SHOWN to the user, not sent anywhere).
  const withCriticals = applyCriticalFieldSubstitution(
    rawSimplification,
    extraction.critical_fields,
  );
  // 2. Re-attach PII tokens to the simplified prose (e.g. [NAME_002] -> "GAUTAM
  //    MUKHOPADHYAY") for the final client-bound payload.
  const finalSimplification = reconstructSimplification(withCriticals, vault);

  // The redactedExtraction we return to the client has tokens for PII in
  // every text field, but readers occasionally want to see the original text
  // alongside the simplified version. Send the PII-reconstructed extraction
  // as the canonical "original" view; the redacted form is also returned so
  // the UI can offer a "see what the model saw" diagnostic mode.
  const reconstructedExtraction = reconstructExtraction(extraction, vault);

  const totalLatencyMs = Date.now() - startedAt;

  // Vault is dropped here: it lives only in this request closure. Once we
  // return, garbage collection reclaims it. Nothing persisted, nothing logged.
  const response: ProcessResponse & { meta: { totalLatencyMs: number; pages: number } } = {
    extraction: reconstructedExtraction,
    redactedExtraction,
    simplification: finalSimplification,
    vaultSize: vault.size,
    warnings: [...extractionWarnings, ...simplificationWarnings],
    meta: {
      totalLatencyMs,
      pages: images.length,
    },
  };

  return NextResponse.json(response);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
