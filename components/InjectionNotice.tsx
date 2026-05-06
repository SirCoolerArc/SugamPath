"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";

import type { InjectionCheckResult } from "@/lib/types";

interface Props {
  injection: InjectionCheckResult;
}

/**
 * Calm, dismissible notice shown above the side-by-side view when the
 * injection detector flags adversarial content. Rust accent — attention-
 * getting without being alarming. The user can collapse the evidence panel,
 * or dismiss the whole notice; the safety-row badge keeps the signal visible
 * either way.
 */
export function InjectionNotice({ injection }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  if (injection.verdict !== "SUSPICIOUS" || injection.findings.length === 0) {
    return null;
  }
  if (dismissed) return null;

  return (
    <div className="max-w-7xl mx-auto mb-8 fade-up">
      <div
        className="px-5 py-4 flex items-start gap-4"
        style={{
          border: "1px solid var(--rust)",
          background: "var(--paper)",
          borderLeft: "3px solid var(--rust)",
        }}
        role="alert"
      >
        <span style={{ color: "var(--rust)", paddingTop: "2px" }}>
          <AlertTriangle size={16} strokeWidth={2} />
        </span>

        <div className="flex-1 min-w-0">
          <p
            className="mono-label mb-2"
            style={{ color: "var(--rust)" }}
          >
            — something unusual in this document
          </p>
          <p
            style={{
              fontSize: "var(--t-sm)",
              lineHeight: 1.6,
              color: "var(--ink)",
              maxWidth: "60ch",
            }}
          >
            This document contains text that looks designed to influence an
            automated assistant. We continued reading it normally, but the
            original on the left is what matters. Read carefully before
            acting.
          </p>

          <button
            type="button"
            onClick={() => setEvidenceOpen((o) => !o)}
            aria-expanded={evidenceOpen}
            className="mt-3 inline-flex items-center gap-1 mono"
            style={{
              color: "var(--rust)",
              fontSize: "var(--t-xs)",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
              cursor: "pointer",
            }}
          >
            {evidenceOpen ? "hide what was flagged" : "show what was flagged"}
            {evidenceOpen ? (
              <ChevronUp size={11} strokeWidth={2} />
            ) : (
              <ChevronDown size={11} strokeWidth={2} />
            )}
          </button>

          {evidenceOpen && (
            <ul className="mt-3 space-y-3">
              {injection.findings.map((f, i) => (
                <li
                  key={`${f.paragraph_id}-${i}`}
                  className="pl-3"
                  style={{ borderLeft: "2px solid var(--ink-faint)" }}
                >
                  <p
                    className="mono-label mb-1"
                    style={{ color: "var(--ink-quiet)" }}
                  >
                    {f.paragraph_id} · {f.pattern.replace(/_/g, " ")}
                  </p>
                  <p
                    style={{
                      fontSize: "var(--t-xs)",
                      color: "var(--ink-muted)",
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}
                  >
                    “{f.excerpt}”
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss notice"
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
    </div>
  );
}
