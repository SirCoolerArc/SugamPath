import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { extract, ExtractionFailedError } from "@/lib/extractor";
import { callGemini, GeminiRecitationError, type GeminiImage } from "@/lib/gemini_client";
import { reconstruct } from "@/lib/pii_vault";
import type { Extraction } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
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

  const fileEntries = form.getAll("document").filter((v): v is File => v instanceof File);
  if (fileEntries.length === 0) {
    return NextResponse.json(
      { error: "No 'document' file in form data." },
      { status: 400 },
    );
  }

  const query = form.get("query");
  if (!query || typeof query !== "string" || !query.trim()) {
    return NextResponse.json(
      { error: "No 'query' string in form data." },
      { status: 400 },
    );
  }

  const language = (form.get("language") as string) || "en";

  let totalBytes = 0;
  for (const f of fileEntries) {
    if (!ACCEPTED_MIME_PREFIXES.some((p) => f.type.startsWith(p))) {
      return NextResponse.json(
        { error: `Unsupported file type '${f.type}'.` },
        { status: 400 },
      );
    }
    totalBytes += f.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: `Total upload size exceeds ${MAX_TOTAL_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  const images: GeminiImage[] = await Promise.all(
    fileEntries.map(async (f) => ({
      base64: Buffer.from(await f.arrayBuffer()).toString("base64"),
      mimeType: f.type,
    })),
  );

  const startedAt = Date.now();

  // ─── Stage 1: extraction (reuse the full pipeline) ──────────────────────
  let extractResult;
  try {
    extractResult = await extract({ images });
  } catch (err) {
    if (err instanceof ExtractionFailedError) {
      return NextResponse.json(
        { error: "Could not extract the document.", stage: "extraction" },
        { status: 422 },
      );
    }
    if (err instanceof GeminiRecitationError) {
      return NextResponse.json(
        { error: "The model declined to process this document.", stage: "extraction" },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Extraction failed.", detail: errMessage(err) },
      { status: 502 },
    );
  }

  const { extraction, redactedExtraction, vault } = extractResult;

  // ─── Stage 2: answer the user's question ────────────────────────────────
  const promptTemplate = await loadQueryPrompt();
  const prompt = buildQueryPrompt(
    promptTemplate,
    redactedExtraction,
    query.trim(),
    language,
  );

  let rawAnswer: string;
  try {
    rawAnswer = await callGemini(prompt);
  } catch (err) {
    if (err instanceof GeminiRecitationError) {
      return NextResponse.json(
        { error: "The model declined to answer.", stage: "query" },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Query failed.", detail: errMessage(err) },
      { status: 502 },
    );
  }

  // ─── Parse the response ─────────────────────────────────────────────────
  let parsed: { answer: string; language: string; answerable: boolean };
  try {
    const cleaned = rawAnswer
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // If Gemini didn't return valid JSON, treat the raw text as the answer.
    parsed = { answer: rawAnswer.trim(), language, answerable: true };
  }

  // ─── Substitute {{cN}} placeholders and reconstruct PII ─────────────────
  const critFieldMap = new Map(extraction.critical_fields.map((c) => [c.id, c.verbatim]));
  let answer = parsed.answer;
  answer = answer.replace(/\{\{(c\d+)\}\}/g, (match, id: string) => {
    const value = critFieldMap.get(id);
    if (value === undefined) return match;
    return `<span class="critical-field" data-id="${id}">${escapeHtml(value)}</span>`;
  });
  // Reconstruct PII tokens
  answer = reconstruct(answer, vault);

  const totalLatencyMs = Date.now() - startedAt;

  return NextResponse.json({
    answer,
    language: parsed.language || language,
    answerable: parsed.answerable ?? true,
    meta: { totalLatencyMs },
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function loadQueryPrompt(): Promise<string> {
  const promptPath = path.join(process.cwd(), "prompts", "query.md");
  return fs.readFile(promptPath, "utf-8");
}

function buildQueryPrompt(
  base: string,
  redactedExtraction: Extraction,
  query: string,
  language: string,
): string {
  const inputSection = `\n\n---\n\n## Document extraction\n\n\`\`\`json\n${JSON.stringify(redactedExtraction, null, 2)}\n\`\`\`\n`;
  const querySection = `\n\n---\n\n## User's question\n\n${query}\n`;
  const langSection = `\n\n---\n\n## Answer language\n\nAnswer in ${language === "hi" ? "Hindi (हिन्दी, Devanagari script)" : "English"}. PII tokens and {{cN}} placeholders flow through unchanged.\n`;

  return base + inputSection + querySection + langSection;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
