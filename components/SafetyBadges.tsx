"use client";

import { useState } from "react";
import { Lock, FileText, Timer, ShieldCheck } from "lucide-react";

import type { FaithfulnessResult } from "@/lib/types";

interface Props {
  vaultSize: number;
  pages: number;
  latencyMs: number;
  faithfulness: FaithfulnessResult | null;
}

export function SafetyBadges({ vaultSize, pages, latencyMs, faithfulness }: Props) {
  const [expanded, setExpanded] = useState(false);

  const f = faithfulnessSummary(faithfulness);
  const expandable = f.expandable;

  return (
    <div className="hidden sm:flex flex-col items-end gap-2">
      <div className="flex items-stretch border" style={{ borderColor: "var(--ink-faint)" }}>
        <Badge
          icon={<Lock size={11} strokeWidth={2} />}
          value={vaultSize.toString().padStart(2, "0")}
          label={`personal ${vaultSize === 1 ? "detail" : "details"} kept private`}
          accent
          first
        />
        <Badge
          icon={<FileText size={11} strokeWidth={2} />}
          value={pages.toString().padStart(2, "0")}
          label={`page${pages === 1 ? "" : "s"} read end-to-end`}
        />
        <Badge
          icon={<Timer size={11} strokeWidth={2} />}
          value={`${(latencyMs / 1000).toFixed(0)}s`}
          label="careful reading time"
        />
        <Badge
          icon={<ShieldCheck size={11} strokeWidth={2} />}
          value={f.value}
          label={f.label}
          interactive={expandable}
          onClick={expandable ? () => setExpanded((v) => !v) : undefined}
        />
      </div>

      {expanded && f.details && (
        <FaithfulnessDetails details={f.details} />
      )}
    </div>
  );
}

function Badge({
  icon,
  value,
  label,
  accent = false,
  first = false,
  interactive = false,
  onClick,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  accent?: boolean;
  first?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span style={{ color: accent ? "var(--navy)" : "var(--ink-quiet)" }}>{icon}</span>
      <span
        className="mono"
        style={{
          fontSize: "var(--t-sm)",
          color: accent ? "var(--navy)" : "var(--ink)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span className="mono-label" style={{ fontSize: "10px" }}>
        {label}
      </span>
    </>
  );

  const baseStyle: React.CSSProperties = {
    borderLeft: first ? "none" : "var(--hairline)",
  };

  if (interactive && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="px-4 py-2.5 flex items-baseline gap-2 hover:bg-[color:var(--paper-deep)] transition-colors text-left"
        style={baseStyle}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="px-4 py-2.5 flex items-baseline gap-2" style={baseStyle}>
      {inner}
    </div>
  );
}

interface FaithfulnessSummary {
  value: string;
  label: string;
  expandable: boolean;
  details: FaithfulnessDetailsContent | null;
}

interface FaithfulnessDetailsContent {
  intro: string;
  omitted: { id: string; verbatim: string }[];
  fabricated: { fragment: string; note: string }[];
}

function faithfulnessSummary(f: FaithfulnessResult | null): FaithfulnessSummary {
  if (f === null) {
    return {
      value: "—",
      label: "original is authoritative",
      expandable: true,
      details: {
        intro:
          "We could not fully cross-check this view against the original. The original on the left is always the source of truth.",
        omitted: [],
        fabricated: [],
      },
    };
  }

  if (f.verdict === "VERIFIED") {
    return {
      value: "✓",
      label: "checked against original",
      expandable: false,
      details: null,
    };
  }

  if (f.verdict === "VERIFIED_WITH_OMISSIONS") {
    const omitted = f.differences
      .filter((d) => d.kind === "OMITTED")
      .map((d) => ({ id: d.field_id ?? "", verbatim: d.verbatim ?? "" }));
    return {
      value: omitted.length.toString().padStart(2, "0"),
      label: omitted.length === 1 ? "item also in original" : "items also in original",
      expandable: true,
      details: {
        intro:
          "These details are in the original but did not make it into the simplified view:",
        omitted,
        fabricated: [],
      },
    };
  }

  // UNVERIFIED
  return {
    value: "—",
    label: "original is authoritative",
    expandable: true,
    details: {
      intro:
        "We could not fully cross-check this view against the original. The original on the left is always the source of truth.",
      omitted: f.differences
        .filter((d) => d.kind === "OMITTED")
        .map((d) => ({ id: d.field_id ?? "", verbatim: d.verbatim ?? "" })),
      fabricated: f.differences
        .filter((d) => d.kind === "FABRICATED")
        .map((d) => ({ fragment: d.fragment ?? "", note: d.note })),
    },
  };
}

function FaithfulnessDetails({ details }: { details: FaithfulnessDetailsContent }) {
  return (
    <div
      className="border px-4 py-3 max-w-md"
      style={{
        borderColor: "var(--ink-faint)",
        background: "var(--paper-deep)",
      }}
    >
      <p style={{ fontSize: "var(--t-xs)", color: "var(--ink-muted)", lineHeight: 1.5 }}>
        {details.intro}
      </p>
      {details.omitted.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {details.omitted.map((o) => (
            <li
              key={o.id}
              className="mono"
              style={{ fontSize: "var(--t-xs)", color: "var(--ink)" }}
            >
              <span style={{ color: "var(--ink-quiet)" }}>{o.id} ·</span> {o.verbatim}
            </li>
          ))}
        </ul>
      )}
      {details.fabricated.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {details.fabricated.map((d, i) => (
            <li
              key={i}
              className="mono"
              style={{ fontSize: "var(--t-xs)", color: "var(--ink)" }}
            >
              <span style={{ color: "var(--ink-quiet)" }}>?</span> {d.fragment}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
