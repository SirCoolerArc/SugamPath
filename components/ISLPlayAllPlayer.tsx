"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward, X, RotateCcw, ExternalLink } from "lucide-react";

import type { ISLSequenceItem } from "@/lib/types";

interface Props {
  sequence: ISLSequenceItem[];
  currentIndex: number;
  status: "playing" | "paused" | "complete";
  /** Heading of the section the current chip belongs to, for context. */
  currentSectionHeading: string;
  onAdvance: () => void;
  onPauseToggle: () => void;
  onStop: () => void;
  onReplay: () => void;
}

/**
 * Floating player for the ISL play-all sequence. Bottom-right of the
 * viewport. Owns the <video> element and the failure-handling timer; the
 * parent owns sequence/index/status state. ESC closes; click-outside does
 * NOT close (the user might be reading mid-playback).
 */
export function ISLPlayAllPlayer({
  sequence,
  currentIndex,
  status,
  currentSectionHeading,
  onAdvance,
  onPauseToggle,
  onStop,
  onReplay,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [errored, setErrored] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const item = sequence[currentIndex];

  // Reset error state and clear pending auto-advance timer whenever the
  // current item changes (advance, replay, etc.).
  useEffect(() => {
    setErrored(false);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, [currentIndex, status]);

  // Reflect status into the <video> element's playback. status="playing" =>
  // video should be playing; status="paused" => video should be paused;
  // status="complete" => video stays paused on its last frame (don't poke it).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (status === "playing") void v.play().catch(() => {/* autoplay blocked */});
    else if (status === "paused") v.pause();
  }, [status, currentIndex]);

  // ESC closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onStop();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStop]);

  // Cleanup any pending timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  if (!item) return null;

  const handleEnded = () => {
    if (status === "complete") return;
    onAdvance();
  };

  const handleError = () => {
    setErrored(true);
    // Auto-advance after 3s if the user does nothing; lets the playback flow
    // recover from a single broken sign without manual intervention.
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => onAdvance(), 3000);
  };

  return (
    <div
      role="dialog"
      aria-label="Indian Sign Language playback"
      style={{
        position: "fixed",
        right: "24px",
        bottom: "24px",
        zIndex: 40,
        width: "320px",
        background: "var(--paper)",
        border: "1px solid var(--ink)",
        boxShadow: "0 8px 24px -8px rgba(0,0,0,0.18)",
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: "var(--hairline)" }}
      >
        <div className="min-w-0">
          <p
            className="mono-label"
            style={{ fontSize: "10px", color: "var(--navy)" }}
          >
            — Indian Sign Language
          </p>
          <p
            className="truncate"
            style={{ fontSize: "var(--t-sm)", fontWeight: 500 }}
          >
            {item.entry.term}
          </p>
          <p
            className="truncate"
            style={{ fontSize: "var(--t-xs)", color: "var(--ink-muted)" }}
          >
            {currentSectionHeading} · {currentIndex + 1} / {sequence.length}
          </p>
        </div>
        <button
          type="button"
          onClick={onStop}
          aria-label="Close ISL playback"
          className="flex items-center justify-center transition-colors"
          style={{
            width: "24px",
            height: "24px",
            color: "var(--ink-quiet)",
            background: "transparent",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div style={{ background: "var(--ink-faint)" }}>
        {errored ? (
          <div className="px-3 py-6 text-center" style={{ minHeight: "180px" }}>
            <p
              style={{
                fontSize: "var(--t-sm)",
                color: "var(--ink-muted)",
                lineHeight: 1.5,
              }}
            >
              couldn&rsquo;t load this sign
            </p>
            {item.entry.videoFallbackUrl && (
              <a
                href={item.entry.videoFallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 mono"
                style={{
                  color: "var(--navy)",
                  fontSize: "var(--t-xs)",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                open on Drive <ExternalLink size={11} />
              </a>
            )}
            <p
              className="mt-2"
              style={{ fontSize: "10px", color: "var(--ink-quiet)", fontStyle: "italic" }}
            >
              skipping in 3s…
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            key={`${currentIndex}-${item.entry.videoUrl}`}
            src={item.entry.videoUrl}
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={handleEnded}
            onError={handleError}
            className="block w-full"
            style={{ maxHeight: "240px", background: "var(--ink-faint)" }}
          />
        )}
      </div>

      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderTop: "var(--hairline)" }}
      >
        {status === "complete" ? (
          <>
            <button
              type="button"
              onClick={onReplay}
              className="inline-flex items-center gap-1.5 mono"
              style={{
                color: "var(--navy)",
                fontSize: "var(--t-xs)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
                cursor: "pointer",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
              aria-label="Replay all signs"
            >
              <RotateCcw size={12} strokeWidth={2} />
              replay
            </button>
            <button
              type="button"
              onClick={onStop}
              className="mono"
              style={{
                color: "var(--ink-quiet)",
                fontSize: "var(--t-xs)",
                cursor: "pointer",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
              aria-label="Close"
            >
              close
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPauseToggle}
                aria-label={status === "paused" ? "Resume playback" : "Pause playback"}
                className="px-2 py-1 hover:bg-[color:var(--paper-sunk)] transition-colors"
                style={{ background: "transparent", border: "1px solid var(--ink-faint)", cursor: "pointer" }}
              >
                {status === "paused" ? (
                  <Play size={12} strokeWidth={2} />
                ) : (
                  <Pause size={12} strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                onClick={onAdvance}
                aria-label="Skip to next sign"
                className="px-2 py-1 hover:bg-[color:var(--paper-sunk)] transition-colors"
                style={{ background: "transparent", border: "1px solid var(--ink-faint)", cursor: "pointer" }}
              >
                <SkipForward size={12} strokeWidth={2} />
              </button>
            </div>
            <span
              className="mono-label"
              style={{ fontSize: "10px", color: "var(--ink-quiet)" }}
            >
              {status === "paused" ? "paused" : "playing"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
