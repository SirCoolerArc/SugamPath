"use client";

import { useState } from "react";
import { Hand, ExternalLink } from "lucide-react";

import type { ISLDictionaryEntry } from "@/lib/types";

interface Props {
  label: string;
  entry: ISLDictionaryEntry;
}

const VIDEO_EXTS = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

export function ISLTermChip({ label, entry }: Props) {
  const [open, setOpen] = useState(false);
  const isDirectVideo = VIDEO_EXTS.test(entry.videoUrl);

  return (
    <span className="relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Show Indian Sign Language video for "${label}"`}
        className="inline-flex items-baseline gap-1 px-1.5 py-0 transition-colors"
        style={{
          color: open ? "var(--paper)" : "var(--navy)",
          background: open ? "var(--navy)" : "transparent",
          borderBottom: open ? "none" : "1px dotted var(--navy)",
          fontFamily: "var(--font-body)",
          cursor: "pointer",
        }}
      >
        <Hand
          size={11}
          strokeWidth={1.75}
          style={{ marginRight: "1px", transform: "translateY(1px)" }}
        />
        <span>{label}</span>
      </button>

      {open && (
        <span
          className="chip-expand block absolute left-0 top-full z-20 mt-2 p-3"
          style={{
            background: "var(--paper)",
            border: "1px solid var(--ink)",
            minWidth: "240px",
            boxShadow: "0 8px 24px -8px rgba(0,0,0,0.18)",
          }}
          role="dialog"
          aria-label={`ISL video for "${label}"`}
        >
          <p
            className="mono-label mb-2"
            style={{ color: "var(--navy)" }}
          >
            — Indian Sign Language
          </p>
          <p
            className="display mb-3"
            style={{ fontSize: "var(--t-md)" }}
          >
            {entry.term}
          </p>

          {isDirectVideo ? (
            <video
              src={entry.videoUrl}
              controls
              autoPlay
              loop
              muted
              className="block w-full"
              style={{ background: "var(--ink)" }}
            />
          ) : (
            <a
              href={entry.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-1 mono"
              style={{
                color: "var(--navy)",
                fontSize: "var(--t-xs)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              }}
            >
              open the sign on ISLRTC <ExternalLink size={11} />
            </a>
          )}

          {entry.caption && (
            <p
              className="mt-2"
              style={{ fontSize: "var(--t-xs)", color: "var(--ink-muted)" }}
            >
              {entry.caption}
            </p>
          )}
        </span>
      )}
    </span>
  );
}
