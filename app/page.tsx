"use client";

import { useCallback, useState } from "react";

import { DocumentUploader } from "@/components/DocumentUploader";
import { ProcessingStage } from "@/components/ProcessingStage";
import { SideBySideViewer } from "@/components/SideBySideViewer";
import type {
  Extraction,
  FaithfulnessResult,
  InjectionCheckResult,
  Simplification,
} from "@/lib/types";

interface ProcessSuccess {
  extraction: Extraction;
  redactedExtraction: Extraction;
  simplification: Simplification;
  vaultSize: number;
  warnings: string[];
  faithfulness: FaithfulnessResult | null;
  injection: InjectionCheckResult | null;
  meta: { totalLatencyMs: number; pages: number };
}

interface ProcessError {
  error: string;
  stage?: string;
  detail?: string | string[];
}

type Stage =
  | { kind: "idle" }
  | { kind: "processing"; files: File[]; previews: string[] }
  | { kind: "result"; data: ProcessSuccess; previews: string[]; files: File[] }
  | { kind: "error"; error: ProcessError; previews: string[] };

export default function Home() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const handleSubmit = useCallback(async (files: File[]) => {
    const previews = files.map((f) => URL.createObjectURL(f));
    setStage({ kind: "processing", files, previews });

    const form = new FormData();
    for (const f of files) form.append("document", f);

    try {
      const res = await fetch("/api/process", { method: "POST", body: form });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: `Server returned non-JSON response (${res.status}).`, detail: text.slice(0, 200) };
      }

      if (!res.ok) {
        setStage({ kind: "error", error: body as ProcessError, previews });
        return;
      }
      setStage({ kind: "result", data: body as ProcessSuccess, previews, files });
    } catch (err) {
      setStage({
        kind: "error",
        error: { error: err instanceof Error ? err.message : String(err) },
        previews,
      });
    }
  }, []);

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
        <ProcessingStage previews={stage.previews} fileCount={stage.files.length} />
      )}

      {stage.kind === "result" && (
        <SideBySideViewer
          previews={stage.previews}
          extraction={stage.data.extraction}
          simplification={stage.data.simplification}
          vaultSize={stage.data.vaultSize}
          faithfulness={stage.data.faithfulness}
          injection={stage.data.injection}
          meta={stage.data.meta}
        />
      )}

      {stage.kind === "error" && <ErrorView error={stage.error} onReset={reset} />}
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

function ErrorView({ error, onReset }: { error: ProcessError; onReset: () => void }) {
  return (
    <section className="px-8 lg:px-16 py-24 max-w-2xl mx-auto fade-up">
      <p className="mono-label mb-4" style={{ color: "var(--rust)" }}>— processing failed</p>
      <h2 className="display mb-4" style={{ fontSize: "var(--t-xl)" }}>
        We couldn’t process this document.
      </h2>
      <p style={{ color: "var(--ink-muted)" }}>{error.error}</p>
      {error.stage && (
        <p className="mono-label mt-3">stage: {error.stage}</p>
      )}
      {error.detail && (
        <pre
          className="mono mt-6 p-4 overflow-x-auto"
          style={{
            background: "var(--paper-deep)",
            fontSize: "var(--t-xs)",
            color: "var(--ink-muted)",
            border: "var(--hairline)",
          }}
        >
          {Array.isArray(error.detail) ? error.detail.join("\n") : error.detail}
        </pre>
      )}
      <button
        onClick={onReset}
        className="mt-8 px-5 py-3 transition-colors"
        style={{
          background: "var(--ink)",
          color: "var(--paper)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--t-sm)",
          letterSpacing: "0.05em",
        }}
      >
        try a different document
      </button>
    </section>
  );
}
