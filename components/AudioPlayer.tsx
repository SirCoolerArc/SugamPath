"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square } from "lucide-react";

import type { Simplification, TargetLanguage } from "@/lib/types";

interface Props {
  simplification: Simplification;
  language: TargetLanguage;
}

type State = "idle" | "playing" | "paused";

export function AudioPlayer({ simplification, language }: Props) {
  const [state, setState] = useState<State>("idle");
  const [supported, setSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    // Chrome on Windows populates the voice list asynchronously: the first
    // `getVoices()` call before `voiceschanged` fires returns []. We listen for
    // the event and cache the result so the click handler always has voices
    // ready. Some browsers emit `voiceschanged` only after the list is ready;
    // others have voices immediately. Cover both.
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
      window.speechSynthesis.cancel();
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
    // Pick the BCP-47 locale that gives the broadest character coverage. For
    // code-mixed output the Hindi voice handles Devanagari and at least
    // attempts Latin tokens; the en-IN voice silently skips Devanagari runs,
    // which is what was making Hindi pages "only read the underlined parts".
    utter.lang = language === "en" ? "en-IN" : "hi-IN";
    const preferredVoice = pickVoice(utter.lang, voices);
    if (preferredVoice) utter.voice = preferredVoice;
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

/** Pick the best-matching installed voice for the requested locale. Browsers
 *  ship different voice sets, so we fall back gracefully:
 *    1. exact lang match (e.g. "hi-IN")
 *    2. language-only match (e.g. any "hi-*")
 *    3. null — let the browser pick its default for that lang
 */
function pickVoice(lang: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  const prefix = lang.split("-")[0].toLowerCase();
  const sameLang = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  return sameLang ?? null;
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
