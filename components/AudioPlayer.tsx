"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square } from "lucide-react";

import type { Simplification } from "@/lib/types";

interface Props {
  simplification: Simplification;
}

type State = "idle" | "playing" | "paused";

export function AudioPlayer({ simplification }: Props) {
  const [state, setState] = useState<State>("idle");
  const [supported, setSupported] = useState(true);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) {
      setSupported(false);
    }
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!supported) return null;

  const startReading = () => {
    if (typeof window === "undefined") return;
    window.speechSynthesis.cancel();
    const text = buildReadableText(simplification);
    if (!text.trim()) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.92;
    utter.pitch = 1;
    utter.lang = "en-IN";
    utter.onend = () => setState("idle");
    utter.onerror = () => setState("idle");
    utterRef.current = utter;
    window.speechSynthesis.speak(utter);
    setState("playing");
  };

  const pause = () => {
    window.speechSynthesis.pause();
    setState("paused");
  };
  const resume = () => {
    window.speechSynthesis.resume();
    setState("playing");
  };
  const stop = () => {
    window.speechSynthesis.cancel();
    setState("idle");
  };

  return (
    <div
      className="inline-flex items-center gap-1 border"
      style={{ borderColor: "var(--ink-faint)" }}
    >
      {state === "playing" ? (
        <ToolbarButton onClick={pause} label="Pause">
          <Pause size={13} strokeWidth={2} />
        </ToolbarButton>
      ) : (
        <ToolbarButton
          onClick={state === "paused" ? resume : startReading}
          label={state === "paused" ? "Resume" : "Read aloud"}
        >
          <Play size={13} strokeWidth={2} />
        </ToolbarButton>
      )}
      {state !== "idle" && (
        <ToolbarButton onClick={stop} label="Stop">
          <Square size={11} strokeWidth={2} />
        </ToolbarButton>
      )}
      <span
        className="mono-label px-3"
        style={{
          color: state === "idle" ? "var(--ink-quiet)" : "var(--navy)",
          borderLeft: "var(--hairline)",
        }}
      >
        {state === "playing" ? "reading" : state === "paused" ? "paused" : "read aloud"}
      </span>
    </div>
  );
}

function ToolbarButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="px-2.5 py-2 hover:bg-[color:var(--paper-sunk)] transition-colors"
    >
      {children}
    </button>
  );
}

/* Strip HTML tags and join sections + actions + warnings into a single
   readable string. Critical-field <span>s become bare text (their value),
   PII tokens that survived show through unchanged. */
function buildReadableText(s: Simplification): string {
  const stripHtml = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  for (const sec of s.sections) {
    chunks.push(stripHtml(sec.heading));
    chunks.push(stripHtml(sec.body));
  }
  for (const a of s.simplified_actions) {
    chunks.push(`${stripHtml(a.what)} ${stripHtml(a.deadline_plain)}.`);
  }
  for (const w of s.warnings_plain) chunks.push(stripHtml(w));
  return chunks.join(". ");
}
