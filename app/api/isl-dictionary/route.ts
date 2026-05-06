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

  // Each entry's `videoUrl` is rewritten to point at our streaming proxy
  // (/api/isl-video/<fileId>) so <video> elements can play it inline. The
  // original Drive viewer URL is preserved as `videoFallbackUrl` for the
  // chip popover's "Open on Drive ↗" footer link and as the fallback when
  // the proxy fails.
  const enriched = baseCache.map((entry) => {
    const fileId = extractDriveFileId(entry.videoUrl);
    if (!fileId) return entry; // unrecognised URL shape; pass through
    return {
      ...entry,
      videoUrl: `/api/isl-video/${fileId}`,
      videoFallbackUrl: `https://drive.google.com/file/d/${fileId}/view`,
    };
  });

  return NextResponse.json(enriched, {
    headers: {
      // Browser may aggressively cache; let it. Bust by restarting server
      // (the dictionary changes only when sync_isl_dictionary.ts re-runs).
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const DRIVE_API_FILE_ID = /googleapis\.com\/drive\/v3\/files\/([^/?#]+)/i;

function extractDriveFileId(url: string): string | null {
  const m = url.match(DRIVE_API_FILE_ID);
  return m ? m[1] : null;
}
