// Build data/isl_dictionary.json from the ISLRTC archive on Google Drive.
//
// Usage:
//   npx tsx scripts/sync_isl_dictionary.ts
//
// Reads GOOGLE_DRIVE_API_KEY from .env.local. Walks the master folder
// published by the Ministry of Social Justice & Empowerment (referenced from
// the data.gov.in catalog), recurses one level into each sub-folder (A-Z,
// Numbers, MHSL, NCERT, New 2500), enumerates every .mp4/.mpg/.webm video,
// parses the filename into a term, dedupes by Drive file id (so the master
// "All Dictionary Videos" folder doesn't double-count), and writes a single
// JSON dictionary the chip component consumes.
//
// Idempotent: re-running just refreshes data/isl_dictionary.json.

import fs from "node:fs/promises";
import path from "node:path";

import type { ISLDictionaryEntry } from "../lib/types";

const MASTER_FOLDER_ID = "1U-Pr4r1-cupgNOOq9NH_uTsQnPSVEKco";
const VIDEO_EXT_RE = /\.(mp4|mpg|mpeg|m4v|webm|mov)$/i;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
  error?: { message: string; code: number };
}

async function loadEnv(): Promise<void> {
  try {
    const text = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // missing .env.local is fine; rely on real env
  }
}

async function listFolder(folderId: string, apiKey: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
    url.searchParams.set("fields", "files(id,name,mimeType,size),nextPageToken");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url);
    const body = (await res.json()) as DriveListResponse;
    if (body.error) {
      throw new Error(`Drive API: ${body.error.code} ${body.error.message}`);
    }
    out.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Strip the file extension and disambiguating suffixes the curators use:
 *   "Atom_(Sign_2).mp4"        -> "Atom"
 *   "Mausi_(Academic).mp4"      -> "Mausi"
 *   "Maths-Line_Segment_(Math).mp4" -> "Maths-Line Segment"
 *   "My_Name_Is.mp4"            -> "My Name Is"
 *   "m-RNA.mp4"                 -> "m-RNA"
 */
function parseTermFromFilename(filename: string): string {
  let name = filename.replace(VIDEO_EXT_RE, "");

  // Drop any parenthetical suffix the curators added for variants/subjects.
  // Examples seen: "(Sign_2)", "(Academic)", "(Maths)", "(Math)", "(Mysore)".
  name = name.replace(/[\s_]*\([^)]*\)[\s_]*$/g, "");

  // Underscores are the standard word separator; convert to spaces.
  name = name.replace(/_/g, " ");

  // Collapse runs of whitespace and trim.
  name = name.replace(/\s+/g, " ").trim();

  return name;
}

/**
 * Store videoUrl as a key-less template so the file can ship without
 * embedding the Drive API key. The /api/isl-dictionary route appends the
 * key from server env at request time.
 */
function buildVideoUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
}

/**
 * Generate plausible aliases for runtime word matching. The simplified text
 * uses lowercase prose; the dictionary canonical form preserves the curator's
 * casing for display. We add a few cheap inflections so e.g. "medicines",
 * "medicine's" both resolve to the "Medicine" entry.
 */
function buildAliases(term: string): string[] {
  const lower = term.toLowerCase();
  const aliases = new Set<string>([lower]);

  // Singular/plural pair.
  if (lower.endsWith("s")) aliases.add(lower.slice(0, -1));
  else aliases.add(`${lower}s`);

  // Hyphenated terms also matchable as space-separated.
  if (lower.includes("-")) aliases.add(lower.replace(/-/g, " "));

  aliases.delete(lower);
  return [...aliases];
}

interface SyncStats {
  foldersWalked: number;
  videosFound: number;
  uniqueTerms: number;
  duplicateIds: number;
  collisions: number;
}

async function main(): Promise<void> {
  await loadEnv();
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_DRIVE_API_KEY missing from .env.local");
  }

  console.log("Walking master folder...");
  const masterContents = await listFolder(MASTER_FOLDER_ID, apiKey);
  const subFolders = masterContents.filter(
    (f) => f.mimeType === "application/vnd.google-apps.folder",
  );
  const masterVideos = masterContents.filter((f) => VIDEO_EXT_RE.test(f.name));

  console.log(`  ${subFolders.length} sub-folders, ${masterVideos.length} videos at the root`);

  const stats: SyncStats = {
    foldersWalked: 1,
    videosFound: masterVideos.length,
    uniqueTerms: 0,
    duplicateIds: 0,
    collisions: 0,
  };

  const seenIds = new Set<string>();
  const byCanonical = new Map<string, ISLDictionaryEntry>();

  const ingest = (file: DriveFile) => {
    if (seenIds.has(file.id)) {
      stats.duplicateIds++;
      return;
    }
    seenIds.add(file.id);

    const term = parseTermFromFilename(file.name);
    if (!term) return;
    const key = term.toLowerCase();

    if (byCanonical.has(key)) {
      stats.collisions++;
      return; // first occurrence wins
    }

    byCanonical.set(key, {
      term,
      aliases: buildAliases(term),
      videoUrl: buildVideoUrl(file.id),
    });
  };

  for (const f of masterVideos) ingest(f);

  for (const sub of subFolders) {
    process.stdout.write(`  enumerating ${sub.name}... `);
    let entries: DriveFile[] = [];
    try {
      entries = await listFolder(sub.id, apiKey);
    } catch (err) {
      console.log(`SKIPPED (${err instanceof Error ? err.message : err})`);
      continue;
    }
    stats.foldersWalked++;
    const videos = entries.filter((f) => VIDEO_EXT_RE.test(f.name));
    stats.videosFound += videos.length;
    for (const f of videos) ingest(f);

    // Recurse one more level for nested groupings (e.g. "MHSL" might have
    // sub-categories). Cap depth at 2 to avoid runaway.
    const nestedFolders = entries.filter(
      (f) => f.mimeType === "application/vnd.google-apps.folder",
    );
    let nestedVideoCount = 0;
    for (const nested of nestedFolders) {
      try {
        const nestedEntries = await listFolder(nested.id, apiKey);
        stats.foldersWalked++;
        const nestedVideos = nestedEntries.filter((f) => VIDEO_EXT_RE.test(f.name));
        nestedVideoCount += nestedVideos.length;
        stats.videosFound += nestedVideos.length;
        for (const f of nestedVideos) ingest(f);
      } catch {
        // skip nested folder errors silently
      }
    }
    console.log(
      `${videos.length} video(s)${nestedVideoCount ? ` + ${nestedVideoCount} nested` : ""}`,
    );
  }

  stats.uniqueTerms = byCanonical.size;

  // Sort alphabetically by canonical lowercase term for stable output.
  const dictionary: ISLDictionaryEntry[] = [...byCanonical.values()].sort((a, b) =>
    a.term.toLowerCase().localeCompare(b.term.toLowerCase()),
  );

  const outputPath = path.join(process.cwd(), "data", "isl_dictionary.json");
  await fs.writeFile(outputPath, JSON.stringify(dictionary, null, 2) + "\n", "utf-8");

  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(" Sync complete");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Folders walked:      ${stats.foldersWalked}`);
  console.log(`  Videos discovered:   ${stats.videosFound}`);
  console.log(`  Duplicate Drive ids: ${stats.duplicateIds}  (master folder collisions)`);
  console.log(`  Term collisions:     ${stats.collisions}  (variant signs of same term)`);
  console.log(`  Unique terms:        ${stats.uniqueTerms}`);
  console.log(`  Written to:          ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
