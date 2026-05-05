"use client";

import { Lock, FileText, Timer } from "lucide-react";

interface Props {
  vaultSize: number;
  pages: number;
  latencyMs: number;
}

export function SafetyBadges({ vaultSize, pages, latencyMs }: Props) {
  return (
    <div className="hidden sm:flex items-stretch border" style={{ borderColor: "var(--ink-faint)" }}>
      <Badge
        icon={<Lock size={11} strokeWidth={2} />}
        value={vaultSize.toString().padStart(2, "0")}
        label="items vaulted"
        accent
        first
      />
      <Badge
        icon={<FileText size={11} strokeWidth={2} />}
        value={pages.toString().padStart(2, "0")}
        label={`page${pages === 1 ? "" : "s"} read`}
      />
      <Badge
        icon={<Timer size={11} strokeWidth={2} />}
        value={`${(latencyMs / 1000).toFixed(1)}s`}
        label="processing"
      />
    </div>
  );
}

function Badge({
  icon,
  value,
  label,
  accent = false,
  first = false,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  accent?: boolean;
  first?: boolean;
}) {
  return (
    <div
      className="px-4 py-2.5 flex items-baseline gap-2"
      style={{
        borderLeft: first ? "none" : "var(--hairline)",
      }}
    >
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
    </div>
  );
}
