"use client";

import { useCallback, useState } from "react";

import { DocumentUploader } from "@/components/DocumentUploader";
import { ProcessingStage } from "@/components/ProcessingStage";
import { SideBySideViewer } from "@/components/SideBySideViewer";
import {
  DEFAULT_READING_LEVEL,
  DEFAULT_TARGET_LANGUAGE,
  type Extraction,
  type FaithfulnessResult,
  type InjectionCheckResult,
  type ReadingLevel,
  type Simplification,
  type TargetLanguage,
} from "@/lib/types";

/** Compose a cache key from the (level, language) pair. Both controls live on
 *  the same regenerate flow, so we cache by the combined choice — switching
 *  between (paragraphs, en) and (paragraphs, hi) is a real cache miss; flicking
 *  back is a hit. */
function cacheKeyOf(level: ReadingLevel, language: TargetLanguage): string {
  return `${level}|${language}`;
}

interface ProcessSuccess {
  extraction: Extraction;
  redactedExtraction: Extraction;
  simplification: Simplification;
  vaultSize: number;
  vault: Array<[string, string]>;
  warnings: string[];
  faithfulness: FaithfulnessResult | null;
  injection: InjectionCheckResult | null;
  meta: { totalLatencyMs: number; pages: number };
}

/** Cached resimplify result per reading level — avoids re-calling Gemini when
 *  the user toggles back to a level they've already seen this session. */
interface CachedLevelResult {
  simplification: Simplification;
  faithfulness: FaithfulnessResult | null;
}

interface ProcessError {
  error: string;
  stage?: string;
  detail?: string | string[];
  status?: number;          // HTTP status the route returned, or 0 for network failure
  isNetworkError?: boolean; // fetch threw before the request reached the server
}

type Stage =
  | { kind: "idle" }
  | { kind: "processing"; files: File[]; previews: string[] }
  | {
      kind: "result";
      data: ProcessSuccess;
      previews: string[];
      files: File[];
      readingLevel: ReadingLevel;
      language: TargetLanguage;
      cache: Record<string, CachedLevelResult>; // keyed by `${level}|${language}`
      regenerating: boolean;
      regenerationError: string | null;
    }
  | { kind: "error"; error: ProcessError; previews: string[]; files: File[] };

export default function Home() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const handleSubmit = useCallback(async (files: File[], reusePreviews?: string[]) => {
    // On retry we already have object URLs for the previews — reuse them so we
    // don't leak (or briefly flash) new ones. On a fresh submit, mint new URLs.
    const previews = reusePreviews ?? files.map((f) => URL.createObjectURL(f));
    setStage({ kind: "processing", files, previews });

    const form = new FormData();
    for (const f of files) form.append("document", f);

    try {
      const res = await fetch("/api/process", { method: "POST", body: form });
      const text = await res.text();
      let body: Partial<ProcessError> & Partial<ProcessSuccess>;
      try {
        body = JSON.parse(text) as Partial<ProcessError> & Partial<ProcessSuccess>;
      } catch {
        body = {
          error: `Server returned a response we could not read.`,
          detail: text.slice(0, 200),
        };
      }

      if (!res.ok) {
        setStage({
          kind: "error",
          error: { ...(body as ProcessError), status: res.status },
          previews,
          files,
        });
        return;
      }
      const data = body as ProcessSuccess;
      setStage({
        kind: "result",
        data,
        previews,
        files,
        readingLevel: DEFAULT_READING_LEVEL,
        language: DEFAULT_TARGET_LANGUAGE,
        // Seed the cache with the initial-load result so flicking back is free.
        cache: {
          [cacheKeyOf(DEFAULT_READING_LEVEL, DEFAULT_TARGET_LANGUAGE)]: {
            simplification: data.simplification,
            faithfulness: data.faithfulness,
          },
        },
        regenerating: false,
        regenerationError: null,
      });
    } catch (err) {
      setStage({
        kind: "error",
        error: {
          error: err instanceof Error ? err.message : String(err),
          status: 0,
          isNetworkError: true,
        },
        previews,
        files,
      });
    }
  }, []);

  const retry = useCallback(() => {
    if (stage.kind !== "error") return;
    void handleSubmit(stage.files, stage.previews);
  }, [stage, handleSubmit]);

  const regenerate = useCallback(
    async (nextLevel: ReadingLevel, nextLanguage: TargetLanguage) => {
      if (stage.kind !== "result") return;
      if (stage.regenerating) return;
      if (nextLevel === stage.readingLevel && nextLanguage === stage.language) return;

      const key = cacheKeyOf(nextLevel, nextLanguage);

      // Cache hit — swap instantly without any network.
      const cached = stage.cache[key];
      if (cached) {
        setStage((s) =>
          s.kind === "result"
            ? {
                ...s,
                readingLevel: nextLevel,
                language: nextLanguage,
                regenerationError: null,
                data: {
                  ...s.data,
                  simplification: cached.simplification,
                  faithfulness: cached.faithfulness,
                },
              }
            : s,
        );
        return;
      }

      // Cache miss — call /api/resimplify. Keep the previous simplification
      // visible (faded) until the response arrives.
      setStage((s) =>
        s.kind === "result" ? { ...s, regenerating: true, regenerationError: null } : s,
      );

      try {
        const res = await fetch("/api/resimplify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            redactedExtraction: stage.data.redactedExtraction,
            extraction: stage.data.extraction,
            vault: stage.data.vault,
            level: nextLevel,
            language: nextLanguage,
          }),
        });
        const text = await res.text();
        let body: {
          simplification?: Simplification;
          faithfulness?: FaithfulnessResult | null;
          error?: string;
        };
        try {
          body = JSON.parse(text);
        } catch {
          body = { error: "Server returned a response we could not read." };
        }

        if (!res.ok || !body.simplification) {
          setStage((s) =>
            s.kind === "result"
              ? {
                  ...s,
                  regenerating: false,
                  regenerationError: regenerationErrorMessage(res.status, body.error),
                }
              : s,
          );
          return;
        }

        const newCacheEntry: CachedLevelResult = {
          simplification: body.simplification,
          faithfulness: body.faithfulness ?? null,
        };
        setStage((s) =>
          s.kind === "result"
            ? {
                ...s,
                readingLevel: nextLevel,
                language: nextLanguage,
                regenerating: false,
                regenerationError: null,
                cache: { ...s.cache, [key]: newCacheEntry },
                data: {
                  ...s.data,
                  simplification: newCacheEntry.simplification,
                  faithfulness: newCacheEntry.faithfulness,
                },
              }
            : s,
        );
      } catch (err) {
        setStage((s) =>
          s.kind === "result"
            ? {
                ...s,
                regenerating: false,
                regenerationError: `couldn't switch form (${err instanceof Error ? err.message : "network error"}); keeping the previous version`,
              }
            : s,
        );
      }
    },
    [stage],
  );

  const handleLevelChange = useCallback(
    (next: ReadingLevel) => {
      if (stage.kind !== "result") return;
      void regenerate(next, stage.language);
    },
    [stage, regenerate],
  );

  const handleLanguageChange = useCallback(
    (next: TargetLanguage) => {
      if (stage.kind !== "result") return;
      void regenerate(stage.readingLevel, next);
    },
    [stage, regenerate],
  );

  const reset = useCallback(() => {
    if (stage.kind !== "idle") {
      for (const url of stage.previews ?? []) URL.revokeObjectURL(url);
    }
    setStage({ kind: "idle" });
  }, [stage]);

  return (
    <main className="min-h-screen">
      <SiteHeader showReset={stage.kind !== "idle"} onReset={reset} />

      {stage.kind === "idle" && (
        <Landing>
          <DocumentUploader onSubmit={handleSubmit} />
        </Landing>
      )}

      {stage.kind === "processing" && (
        <ProcessingStage
          previews={stage.previews}
          mimeTypes={stage.files.map((f) => f.type)}
          fileCount={stage.files.length}
        />
      )}

      {stage.kind === "result" && (
        <SideBySideViewer
          previews={stage.previews}
          mimeTypes={stage.files.map((f) => f.type)}
          extraction={stage.data.extraction}
          simplification={stage.data.simplification}
          vaultSize={stage.data.vaultSize}
          faithfulness={stage.data.faithfulness}
          injection={stage.data.injection}
          meta={stage.data.meta}
          readingLevel={stage.readingLevel}
          onReadingLevelChange={handleLevelChange}
          language={stage.language}
          onLanguageChange={handleLanguageChange}
          regenerating={stage.regenerating}
          regenerationError={stage.regenerationError}
        />
      )}

      {stage.kind === "error" && (
        <ErrorView error={stage.error} onReset={reset} onRetry={retry} />
      )}
    </main>
  );
}

/* ───── Header ─────────────────────────────────────────────────────────── */

function SiteHeader({ showReset, onReset }: { showReset: boolean; onReset: () => void }) {
  return (
    <header className="px-8 lg:px-16 pt-8 pb-6 flex items-baseline justify-between border-b" style={{ borderColor: "var(--ink-faint)" }}>
      <div className="flex items-baseline gap-3">
        <span className="text-2xl" aria-hidden>📄</span>
        <span
          className="display"
          style={{ fontSize: "var(--t-lg)", letterSpacing: "-0.025em" }}
        >
          SugamPath
        </span>
        <span className="mono-label hidden sm:inline ml-2">v0 · hackathon prototype</span>
      </div>

      {showReset && (
        <button
          onClick={onReset}
          className="mono-label hover:text-[color:var(--ink)] transition-colors"
          style={{ color: "var(--ink-quiet)" }}
        >
          ← upload another
        </button>
      )}
    </header>
  );
}

/* ───── Landing wrapper ────────────────────────────────────────────────── */

function Landing({ children }: { children: React.ReactNode }) {
  return (
    <section className="px-8 lg:px-16 py-16 lg:py-24 max-w-6xl mx-auto">
      <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-start">
        <div className="lg:col-span-7 fade-up">
          <p className="mono-label mb-6">An accessibility bridge for Indian bureaucracy</p>
          <h1
            className="display mb-8"
            style={{ fontSize: "clamp(2.25rem, 5vw, var(--t-3xl))" }}
          >
            Read what the&nbsp;State sends&nbsp;you.
          </h1>
          <p
            className="max-w-prose"
            style={{ fontSize: "var(--t-md)", color: "var(--ink-muted)", lineHeight: 1.6 }}
          >
            Upload any document — a hospital discharge, a court summons, a benefits letter,
            a property notice. SugamPath rewrites it in plain words, reads it aloud, and
            shows the key terms in Indian Sign Language. The original stays on the page.
            Personal information never leaves your browser unprotected.
          </p>
        </div>

        <div className="lg:col-span-5 fade-up fade-up-delay-2">
          {children}
        </div>
      </div>

      <div className="mt-24 grid sm:grid-cols-3 gap-12 fade-up fade-up-delay-3">
        <Promise title="The original is authoritative">
          We never replace your document. The simplified version sits beside it. You can
          always check what the original says.
        </Promise>
        <Promise title="Every important detail stays exact">
          Names, numbers, dates, amounts, legal sections — anything the document
          treats as load-bearing — pass through untouched. The simplified version
          cannot accidentally change a word that matters.
        </Promise>
        <Promise title="Your information stays here">
          Names, IDs, phone numbers, and addresses are tokenised in your browser before
          any external call. Nothing is stored. Nothing is logged.
        </Promise>
      </div>
    </section>
  );
}

function Promise({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="mono-label mb-3"
        style={{ color: "var(--navy)" }}
      >
        — promise
      </p>
      <h3 className="mb-3" style={{ fontSize: "var(--t-md)" }}>{title}</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: "var(--t-sm)", lineHeight: 1.6 }}>
        {children}
      </p>
    </div>
  );
}

/* ───── Error view ─────────────────────────────────────────────────────── */

interface ErrorPresentation {
  headline: string;
  body: string;
  allowRetrySame: boolean; // show the "try again with same document" button
}

/** Short inline message shown next to the slider when /api/resimplify fails.
 *  Stays kind, names what failed, and reassures the user the previous view is
 *  still on screen. */
function regenerationErrorMessage(
  status: number,
  serverError: string | undefined,
): string {
  const _ = serverError; // kept for future tailored copy if specific 4xx shapes emerge
  void _;
  if (status === 502) {
    return "the model is busy; keeping the previous version";
  }
  if (status === 422) {
    return "couldn't switch form for this document; keeping the previous version";
  }
  return "couldn't switch form; keeping the previous version";
}

function presentError(error: ProcessError): ErrorPresentation {
  const status = error.status ?? 0;
  const stage = error.stage;
  const message = error.error ?? "";
  // Gemini RECITATION blocks come back as 502 with a content-safety phrase.
  const isContentBlock =
    /content-safety|declined|recitation/i.test(message);

  if (error.isNetworkError) {
    return {
      headline: "We couldn’t reach the server.",
      body:
        "Check your internet connection and try again. Your document never left your browser.",
      allowRetrySame: true,
    };
  }

  if (status === 413) {
    return {
      headline: "This document is too large.",
      body:
        "We can read documents up to 10 MB. Try compressing the file, or upload fewer pages at a time.",
      allowRetrySame: false,
    };
  }

  if (status === 400) {
    return {
      headline: "We couldn’t read your upload.",
      body:
        "Something went wrong when we received your file. It may have been corrupted in transit. Try uploading again, or pick a different file.",
      allowRetrySame: true,
    };
  }

  if (status === 422 && stage === "extraction") {
    return {
      headline: "We couldn’t make sense of this document.",
      body:
        "The image may be unclear, or the document may be in a format we haven’t learned yet. The original is still safe with you — try a clearer scan, or a different document.",
      allowRetrySame: false,
    };
  }

  if (status === 422 && stage === "simplification") {
    return {
      headline: "We read your document, but couldn’t simplify it cleanly.",
      body:
        "Sometimes the language in a document is unusual enough that we can’t rewrite it safely. The original is always available to you on the side.",
      allowRetrySame: false,
    };
  }

  if (status === 502 && isContentBlock) {
    return {
      headline: "We can’t read this document.",
      body:
        "The model declined to read this document because parts of it look very close to text it was trained on. This isn’t your fault — try a different document.",
      allowRetrySame: false,
    };
  }

  if (status === 502) {
    return {
      headline: "The model is busy right now.",
      body:
        "We couldn’t reach the language model to read your document. This usually clears up in a moment.",
      allowRetrySame: true,
    };
  }

  // Fallback for anything we didn't anticipate.
  return {
    headline: "Something went wrong.",
    body:
      message ||
      "We hit an error we didn’t plan for. Your document never left your browser. Please try again, or pick a different document.",
    allowRetrySame: true,
  };
}

function ErrorView({
  error,
  onReset,
  onRetry,
}: {
  error: ProcessError;
  onReset: () => void;
  onRetry: () => void;
}) {
  const { headline, body, allowRetrySame } = presentError(error);

  return (
    <section className="px-8 lg:px-16 py-24 max-w-2xl mx-auto fade-up">
      <p className="mono-label mb-4" style={{ color: "var(--rust)" }}>
        — we couldn’t finish reading this
      </p>
      <h2 className="display mb-5" style={{ fontSize: "var(--t-xl)" }}>
        {headline}
      </h2>
      <p
        style={{
          color: "var(--ink-muted)",
          fontSize: "var(--t-md)",
          lineHeight: 1.6,
          maxWidth: "60ch",
        }}
      >
        {body}
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        {allowRetrySame && (
          <button
            onClick={onRetry}
            className="px-5 py-3 transition-colors"
            style={{
              background: "var(--ink)",
              color: "var(--paper)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--t-sm)",
              letterSpacing: "0.05em",
              cursor: "pointer",
            }}
          >
            try again with the same document
          </button>
        )}
        <button
          onClick={onReset}
          className="px-5 py-3 transition-colors"
          style={{
            background: allowRetrySame ? "transparent" : "var(--ink)",
            color: allowRetrySame ? "var(--ink)" : "var(--paper)",
            border: allowRetrySame ? "1px solid var(--ink)" : "none",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-sm)",
            letterSpacing: "0.05em",
            cursor: "pointer",
          }}
        >
          upload a different document
        </button>
      </div>

      {/* Tech detail — kept only as a small footnote for diagnostics. The
          status code is useful when the user shows a screenshot to support;
          the raw error text is hidden by default. */}
      {(error.status || error.stage) && (
        <p
          className="mono-label mt-12"
          style={{ color: "var(--ink-quiet)", fontSize: "10px" }}
        >
          {error.status ? `code ${error.status}` : ""}
          {error.status && error.stage ? " · " : ""}
          {error.stage ? `stage: ${error.stage}` : ""}
        </p>
      )}
    </section>
  );
}
