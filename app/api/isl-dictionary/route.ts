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

  // Convert the dictionary's Drive API media URLs (which return raw bytes and
  // some browsers treat as a download) into Drive's public web viewer URLs
  // (`/file/d/<id>/view`). The viewer plays the clip in a new tab without
  // forcing a local download. ISLRTC's archive is shared with "anyone with
  // the link", so no API key is needed for the viewer.
  const enriched = baseCache.map((entry) => ({
    ...entry,
    videoUrl: toDriveViewerUrl(entry.videoUrl),
  }));

  return NextResponse.json(enriched, {
    headers: {
      // Browser may aggressively cache; let it. Bust by restarting server
      // (the dictionary changes only when sync_isl_dictionary.ts re-runs).
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const DRIVE_API_FILE_ID = /googleapis\.com\/drive\/v3\/files\/([^/?#]+)/i;

function toDriveViewerUrl(url: string): string {
  const m = url.match(DRIVE_API_FILE_ID);
  if (!m) return url;
  return `https://drive.google.com/file/d/${m[1]}/view`;
}
