"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

/**
 * The pipeline runs ~25 seconds. Instead of a spinner, we narrate the
 * safety steps in real time. The narration is hand-scripted to match the
 * actual stages that run server-side; the timing is a rough estimate but
 * close enough that the user sees a coherent story while they wait.
 *
 * Demo moment — judges see this and the ethics story is delivered without
 * needing a slide.
 */

interface PipelineStep {
  delayMs: number;     // when to start typing this line, from request start
  text: string;
  meta?: string;       // small mono caption that appears under the line
}

const PIPELINE: PipelineStep[] = [
  { delayMs: 200,    text: "Reading the document",                  meta: "Gemini 2.5 Flash · vision pass" },
  { delayMs: 4_500,  text: "Identifying personal information",      meta: "regex + LLM-flagged spans" },
  { delayMs: 6_500,  text: "Tokenising it before any further call", meta: "names, IDs, addresses → opaque tokens" },
  { delayMs: 9_000,  text: "Locking critical fields",               meta: "doses, dates, amounts cannot be paraphrased downstream" },
  { delayMs: 13_000, text: "Rewriting in plain words",              meta: "active voice · short sentences · 5th-grade reading level" },
  { delayMs: 22_000, text: "Restoring your information for display only", meta: "tokens replaced on the way back to your browser" },
];

interface Props {
  previews: string[];
  fileCount: number;
}

export function ProcessingStage({ previews, fileCount }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="px-8 lg:px-16 py-16 lg:py-24 max-w-5xl mx-auto">
      <div className="grid lg:grid-cols-12 gap-16 items-start">
        {/* Faded original on the left */}
        <div className="lg:col-span-5 hidden lg:block">
          <p className="mono-label mb-6">— your document</p>
          <div
            className="space-y-3"
            style={{ filter: "grayscale(60%)", opacity: 0.55 }}
          >
            {previews.map((src, i) => (
              <div key={i} className="border" style={{ borderColor: "var(--ink-faint)" }}>
                <Image
                  src={src}
                  alt={`Page ${i + 1}`}
                  width={500}
                  height={700}
                  unoptimized
                  className="w-full h-auto block"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Narrative on the right */}
        <div className="lg:col-span-7">
          <p className="mono-label mb-6 fade-up">
            — processing {fileCount} page{fileCount > 1 ? "s" : ""}
          </p>
          <h2
            className="display mb-12 fade-up"
            style={{ fontSize: "clamp(1.75rem, 3.5vw, var(--t-2xl))" }}
          >
            We do this carefully, on purpose.
          </h2>

          <ol className="space-y-7">
            {PIPELINE.map((step, i) => (
              <PipelineLine
                key={i}
                step={step}
                elapsed={elapsed}
                isCurrent={isCurrentStep(elapsed, i)}
              />
            ))}
          </ol>

          <p
            className="mono mt-16"
            style={{ color: "var(--ink-quiet)", fontSize: "var(--t-xs)" }}
          >
            elapsed&nbsp;&nbsp;<span style={{ color: "var(--ink-muted)" }}>
              {(elapsed / 1000).toFixed(1)}s
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function isCurrentStep(elapsed: number, idx: number): boolean {
  for (let j = PIPELINE.length - 1; j >= 0; j--) {
    if (elapsed >= PIPELINE[j].delayMs) return j === idx;
  }
  return false;
}

function PipelineLine({
  step,
  elapsed,
  isCurrent,
}: {
  step: PipelineStep;
  elapsed: number;
  isCurrent: boolean;
}) {
  const started = elapsed >= step.delayMs;
  const charsToShow = started
    ? Math.min(step.text.length, Math.floor((elapsed - step.delayMs) / 28))
    : 0;
  const visible = step.text.slice(0, charsToShow);
  const done = charsToShow >= step.text.length;

  return (
    <li
      className="grid grid-cols-[auto_1fr] gap-4 items-baseline transition-opacity duration-500"
      style={{ opacity: started ? 1 : 0.25 }}
    >
      <span
        className="mono"
        style={{
          color: done ? "var(--navy)" : "var(--ink-quiet)",
          fontSize: "var(--t-xs)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {done ? "✓" : started ? "◯" : " "}
      </span>
      <div>
        <p
          className={isCurrent && !done ? "caret" : ""}
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--t-md)",
            color: started ? "var(--ink)" : "var(--ink-quiet)",
            letterSpacing: "-0.01em",
          }}
        >
          {visible}
        </p>
        {done && step.meta && (
          <p
            className="mono mt-1.5"
            style={{ fontSize: "var(--t-xs)", color: "var(--ink-quiet)" }}
          >
            {step.meta}
          </p>
        )}
      </div>
    </li>
  );
}
