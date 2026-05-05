import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_ID = "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;

export interface CallGeminiOptions {
  imageBase64?: string;
  imageMimeType?: string;
  timeoutMs?: number;
}

export async function callGemini(
  prompt: string,
  options: CallGeminiOptions = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: MODEL_ID });

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: prompt },
  ];
  if (options.imageBase64) {
    parts.push({
      inlineData: {
        data: options.imageBase64,
        mimeType: options.imageMimeType ?? "image/jpeg",
      },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });
    const text = result.response.text();
    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }
    return text;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Gemini call failed: ${err.message}`);
    }
    throw new Error(`Gemini call failed with unknown error: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
