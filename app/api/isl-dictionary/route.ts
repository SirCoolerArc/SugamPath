import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import type { ISLDictionaryEntry } from "@/lib/types";

export const runtime = "nodejs";

let cache: ISLDictionaryEntry[] | null = null;

export async function GET(): Promise<NextResponse> {
  if (cache === null) {
    try {
      const raw = await fs.readFile(
        path.join(process.cwd(), "data", "isl_dictionary.json"),
        "utf-8",
      );
      const parsed = JSON.parse(raw) as unknown;
      cache = Array.isArray(parsed) ? (parsed as ISLDictionaryEntry[]) : [];
    } catch {
      cache = [];
    }
  }
  return NextResponse.json(cache);
}
