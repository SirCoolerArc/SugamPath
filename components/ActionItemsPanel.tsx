"use client";

import { Clock, ShieldAlert, UserCheck } from "lucide-react";

import type { SimplifiedAction } from "@/lib/types";

interface Props {
  actions: SimplifiedAction[];
  warnings: string[];
}

export function ActionItemsPanel({ actions, warnings }: Props) {
  return (
    <div
      className="border"
      style={{
        background: "var(--paper-deep)",
        borderColor: "var(--ink-faint)",
      }}
    >
      <header
        className="px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: "var(--hairline)" }}
      >
        <p className="mono-label">— what you actually need to do</p>
        <p
          className="mono"
          style={{ fontSize: "var(--t-xs)", color: "var(--ink-quiet)" }}
        >
          {actions.length} item{actions.length === 1 ? "" : "s"}
        </p>
      </header>

      {actions.length > 0 && (
        <ol className="divide-y" style={{ borderColor: "var(--ink-faint)" }}>
          {actions.map((a, i) => (
            <li
              key={a.id}
              className="px-6 py-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2"
              style={{ borderColor: "var(--ink-faint)" }}
            >
              <span
                className="mono"
                style={{
                  color: "var(--ink-quiet)",
                  fontSize: "var(--t-xs)",
                  fontVariantNumeric: "tabular-nums",
                  paddingTop: "0.25em",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <p
                  style={{
                    fontSize: "var(--t-md)",
                    fontFamily: "var(--font-display)",
                    color: "var(--ink)",
                    lineHeight: 1.4,
                  }}
                  dangerouslySetInnerHTML={{ __html: a.what }}
                />
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
                  <Meta icon={<Clock size={11} strokeWidth={1.75} />} label="when">
                    <span dangerouslySetInnerHTML={{ __html: a.deadline_plain }} />
                  </Meta>
                  <Meta icon={<UserCheck size={11} strokeWidth={1.75} />} label="verify with">
                    <span dangerouslySetInnerHTML={{ __html: a.verify_with_plain }} />
                  </Meta>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {warnings.length > 0 && (
        <div
          className="px-6 py-5"
          style={{
            borderTop: "var(--hairline)",
            background: "var(--paper-sunk)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={14} strokeWidth={1.75} color="var(--rust)" />
            <p
              className="mono-label"
              style={{ color: "var(--rust)" }}
            >
              — go to a doctor immediately if
            </p>
          </div>
          <ul className="space-y-2 ml-6 list-disc list-outside" style={{ color: "var(--ink)" }}>
            {warnings.map((w, i) => (
              <li
                key={i}
                style={{ fontSize: "var(--t-sm)", lineHeight: 1.55 }}
                dangerouslySetInnerHTML={{ __html: w }}
              />
            ))}
          </ul>
        </div>
      )}

      <p
        className="mono px-6 py-3"
        style={{
          borderTop: "var(--hairline)",
          fontSize: "var(--t-xs)",
          color: "var(--ink-quiet)",
          background: "var(--paper)",
        }}
      >
        SugamPath translates. It does not decide. Verify each step with the person or office named.
      </p>
    </div>
  );
}

function Meta({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="inline-flex items-baseline gap-1.5"
      style={{ fontSize: "var(--t-sm)", color: "var(--ink-muted)" }}
    >
      <span style={{ color: "var(--ink-quiet)", transform: "translateY(2px)" }}>{icon}</span>
      <span className="mono-label" style={{ marginRight: "0.4em" }}>{label}</span>
      <span style={{ color: "var(--ink)" }}>{children}</span>
    </div>
  );
}
