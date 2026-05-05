import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  type SafetySetting,
} from "@google/generative-ai";

const MODEL_ID = "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

// Loosen the four user-configurable safety filters to BLOCK_NONE. Discharge
// summaries occasionally trip DANGEROUS_CONTENT (drug names + dose language),
// court summons can trip HARASSMENT (legal threat phrasing), and we are
// processing the user's *own* document for accessibility — there is no third
// party to harm. The two non-configurable filters (RECITATION, internal CSAM)
// remain on; we handle RECITATION blocks separately below.
const PERMISSIVE_SAFETY_SETTINGS: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export interface CallGeminiOptions {
  imageBase64?: string;
  imageMimeType?: string;
  timeoutMs?: number;
}

export class GeminiRecitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiRecitationError";
  }
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
  const model = client.getGenerativeModel({
    model: MODEL_ID,
    safetySettings: PERMISSIVE_SAFETY_SETTINGS,
  });

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

  // generationConfig.thinkingConfig.thinkingBudget = 0 disables the model's
  // internal "thinking" pass on Gemini 2.5 Flash. Empirically this reduces
  // false-positive RECITATION blocks on transcription-style prompts (the
  // thinking trace itself sometimes pattern-matches as recitation), and
  // halves latency.
  const generationConfig = {
    thinkingConfig: { thinkingBudget: 0 },
  } as Record<string, unknown>;

  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withTimeout(
        model.generateContent({
          contents: [{ role: "user", parts }],
          generationConfig,
        }),
        timeoutMs,
      );

      // Detect RECITATION/SAFETY blocks. The SDK throws on hard blocks but on
      // soft blocks it returns an empty response with a finishReason. Cover both.
      const candidate = result.response.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason === "RECITATION" || finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
        throw new GeminiRecitationError(
          `Gemini blocked the response with finishReason=${finishReason}. ` +
            `This usually means the model thought its output too closely resembled training data. ` +
            `Try changing the prompt to ask for paraphrased/structured output instead of verbatim text.`,
        );
      }

      const text = result.response.text();
      if (!text) {
        throw new Error(
          `Gemini returned empty text (finishReason=${finishReason ?? "unknown"}).`,
        );
      }
      return text;
    } catch (err) {
      lastErr = err;

      // Never retry RECITATION — same input will always block; let caller handle.
      if (err instanceof GeminiRecitationError) throw err;

      if (attempt < MAX_RETRIES && isTransient(err)) {
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  if (lastErr instanceof Error) {
    throw new Error(`Gemini call failed after ${MAX_RETRIES} attempts: ${lastErr.message}`);
  }
  throw new Error(`Gemini call failed with unknown error: ${String(lastErr)}`);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  // 5xx, 429, network glitches — all worth a retry
  return (
    /\b5\d{2}\b/.test(m) ||
    /\b429\b/.test(m) ||
    /Service Unavailable/i.test(m) ||
    /high demand/i.test(m) ||
    /rate.?limit/i.test(m) ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(m) ||
    /timed out/i.test(m)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Gemini call timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
