import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// Videos are typically 0.5–5 MB. Allow up to 60s for slow Drive streams.
export const maxDuration = 60;

const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

interface RouteContext {
  params: { fileId: string };
}

/**
 * Stream a Google Drive video file's bytes through our origin to the browser.
 *
 * Why a proxy rather than direct Drive URLs in <video> elements:
 *  - The Drive API key would have to ship in the browser bundle (NEXT_PUBLIC),
 *    which makes it extractable by anyone visiting the site.
 *  - Drive's `?alt=media` 302-redirects to a googleusercontent.com URL whose
 *    CORS headers do not allow <video> playback in many browser/version
 *    combinations, so the browser fetches but cannot render.
 *
 * This proxy reads the API key from server-only env, fetches the bytes,
 * and pipes them straight to the browser response. Memory footprint is one
 * stream-chunk at a time — never the whole video.
 */
export async function GET(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { fileId } = ctx.params;

  if (!fileId || !DRIVE_FILE_ID_RE.test(fileId)) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 404 });
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is not configured to proxy ISL videos." },
      { status: 500 },
    );
  }

  const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media&key=${encodeURIComponent(apiKey)}`;

  let driveRes: Response;
  try {
    driveRes = await fetch(driveUrl);
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach Drive.", detail: errMessage(err) },
      { status: 502 },
    );
  }

  if (!driveRes.ok) {
    // Surface Drive's status, but don't leak its body (which sometimes
    // contains the API key context in error messages).
    return NextResponse.json(
      { error: "Drive returned an error.", driveStatus: driveRes.status },
      { status: 502 },
    );
  }

  const body = driveRes.body;
  if (!body) {
    return NextResponse.json({ error: "Drive returned no body." }, { status: 502 });
  }

  // Forward Content-Type from Drive (typically video/mp4). Set our own
  // aggressive cache header — file IDs are immutable in the dictionary.
  const contentType = driveRes.headers.get("content-type") ?? "video/mp4";
  const contentLength = driveRes.headers.get("content-length");

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400, immutable",
  };
  if (contentLength) headers["Content-Length"] = contentLength;

  return new Response(body, { status: 200, headers });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
