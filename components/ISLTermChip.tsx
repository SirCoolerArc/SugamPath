"use client";

import { useEffect, useRef, useState } from "react";
import { Hand, ExternalLink, X } from "lucide-react";

import type { ISLDictionaryEntry } from "@/lib/types";

interface Props {
  label: string;
  entry: ISLDictionaryEntry;
}

export function ISLTermChip({ label, entry }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent | PointerEvent) {
      const node = wrapperRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className="relative inline-block align-baseline">
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
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute top-2 right-2 flex items-center justify-center transition-colors"
            style={{
              width: "20px",
              height: "20px",
              color: "var(--ink-quiet)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            <X size={12} strokeWidth={2} />
          </button>

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
            watch the sign on Google Drive <ExternalLink size={11} />
          </a>

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
