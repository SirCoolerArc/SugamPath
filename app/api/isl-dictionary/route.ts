import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import type { ISLDictionaryEntry } from "@/lib/types";

export const runtime = "nodejs";

// Cache the parsed dictionary across requests within a single server process.
// 10k+ entries; cheap to keep, expensive to re-read.
let baseCache: ISLDictionaryEntry[] | null = null;

export async function GET(): Promise<NextResponse> {
  if (baseCache === null) {
    try {
      const raw = await fs.readFile(
        path.join(process.cwd(), "data", "isl_dictionary.json"),
        "utf-8",
      );
      const parsed = JSON.parse(raw) as unknown;
      baseCache = Array.isArray(parsed) ? (parsed as ISLDictionaryEntry[]) : [];
    } catch {
      baseCache = [];
    }
  }

  // Inject the Drive API key at request time. The dictionary file ships with
  // key-less video URLs; the key lives only in server env (.env.local /
  // deployment env) and is appended on the way out so the client can stream
  // directly from Drive without a server-side proxy.
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY ?? "";
  const enriched = apiKey
    ? baseCache.map((entry) => ({
        ...entry,
        videoUrl: appendKey(entry.videoUrl, apiKey),
      }))
    : baseCache;

  return NextResponse.json(enriched, {
    headers: {
      // Browser may aggressively cache; let it. Bust by restarting server
      // (the dictionary changes only when sync_isl_dictionary.ts re-runs).
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function appendKey(url: string, apiKey: string): string {
  if (!url.includes("googleapis.com/drive/")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}key=${encodeURIComponent(apiKey)}`;
}
