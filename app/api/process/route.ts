import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini_client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const file = form.get("document");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'document' file in form data." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = file.type || "image/jpeg";

    const startedAt = Date.now();
    const description = await callGemini(
      "Describe this document in one sentence.",
      { imageBase64: base64, imageMimeType: mimeType },
    );
    const latencyMs = Date.now() - startedAt;

    return NextResponse.json({
      description,
      meta: {
        filename: file.name,
        size: file.size,
        mimeType,
        latencyMs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
