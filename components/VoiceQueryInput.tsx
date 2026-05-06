"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Languages } from "lucide-react";

// ─── Web Speech API types (not in default TS lib) ────────────────────────────
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

type VoiceLang = "en" | "hi";

interface Props {
  /** Called with the transcribed/typed query text and the chosen language. */
  onSubmit: (query: string, language: VoiceLang) => void;
  /** True while the parent is waiting for the API response. */
  loading?: boolean;
  /** Disable the entire component (e.g. no files uploaded yet). */
  disabled?: boolean;
}

export function VoiceQueryInput({ onSubmit, loading, disabled }: Props) {
  const [lang, setLang] = useState<VoiceLang>("en");
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Check browser support once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRec = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRec) setSupported(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const SpeechRec = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = lang === "hi" ? "hi-IN" : "en-IN";

    recognition.onstart = () => setRecording(true);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join(" ")
        .trim();
      if (transcript) setText((prev) => (prev ? prev + " " + transcript : transcript));
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" and "aborted" are user-initiated — not worth surfacing.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.warn("Speech recognition error:", event.error);
      }
      setRecording(false);
    };

    recognition.onend = () => setRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
  }, [recording, lang]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || loading) return;
    onSubmit(trimmed, lang);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="mt-6"
      style={{
        background: "var(--paper-deep)",
        border: "1px solid var(--ink-faint)",
        transition: "border-color 120ms ease",
      }}
    >
      {/* ── Header row: label + language toggle ── */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "var(--hairline)" }}
      >
        <p
          className="mono-label"
          style={{ fontSize: "var(--t-xs)", margin: 0 }}
        >
          or ask a specific question
        </p>

        <button
          onClick={() => setLang((l) => (l === "en" ? "hi" : "en"))}
          className="flex items-center gap-1.5 px-2 py-1 transition-colors"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-xs)",
            letterSpacing: "0.06em",
            color: "var(--ink-quiet)",
            background: "var(--paper-sunk)",
            border: "none",
            cursor: "pointer",
          }}
          title={`Switch to ${lang === "en" ? "Hindi" : "English"}`}
          type="button"
        >
          <Languages size={12} strokeWidth={1.5} />
          {lang === "en" ? "EN" : "HI"}
        </button>
      </div>

      {/* ── Input row: mic + text + submit ── */}
      <div className="flex items-center gap-3 px-5 py-3">
        {supported && (
          <button
            onClick={toggleRecording}
            disabled={disabled || loading}
            className={`flex-shrink-0 p-2 rounded-full transition-all ${recording ? "mic-recording" : ""}`}
            style={{
              background: recording ? "var(--rust)" : "var(--paper-sunk)",
              color: recording ? "var(--paper)" : "var(--ink-quiet)",
              border: "none",
              cursor: disabled || loading ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
            title={recording ? "Stop recording" : `Speak in ${lang === "en" ? "English" : "Hindi"}`}
            type="button"
            aria-label={recording ? "Stop recording" : "Start voice input"}
          >
            {recording ? <MicOff size={18} strokeWidth={1.5} /> : <Mic size={18} strokeWidth={1.5} />}
          </button>
        )}

        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            lang === "en"
              ? "e.g. When is my next appointment?"
              : "जैसे: मेरी अगली अपॉइंटमेंट कब है?"
          }
          disabled={disabled || loading}
          className="flex-1 min-w-0 py-1.5 px-0 bg-transparent outline-none"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "var(--t-sm)",
            color: "var(--ink)",
            border: "none",
            borderBottom: "1px solid var(--ink-faint)",
            opacity: disabled ? 0.5 : 1,
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={!text.trim() || disabled || loading}
          className="flex-shrink-0 px-4 py-2 transition-all disabled:cursor-not-allowed"
          style={{
            background: !text.trim() || disabled ? "var(--paper-sunk)" : "var(--navy)",
            color: !text.trim() || disabled ? "var(--ink-quiet)" : "var(--paper)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            border: "none",
            cursor: !text.trim() || disabled || loading ? "not-allowed" : "pointer",
          }}
          type="button"
        >
          {loading ? "asking…" : "ask this →"}
        </button>
      </div>

      {/* ── Hint when recording ── */}
      {recording && (
        <div
          className="px-5 pb-3 mono-label"
          style={{ color: "var(--rust)", fontSize: "10px" }}
        >
          🔴 listening in {lang === "en" ? "English" : "हिन्दी"}… speak now
        </div>
      )}

      {!supported && (
        <div
          className="px-5 pb-3 mono-label"
          style={{ color: "var(--ink-quiet)", fontSize: "10px" }}
        >
          Voice input not supported in this browser — type your question instead.
        </div>
      )}
    </div>
  );
}
