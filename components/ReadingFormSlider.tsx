"use client";

import type { ReadingLevel } from "@/lib/types";

interface Props {
  value: ReadingLevel;
  onChange: (level: ReadingLevel) => void;
  busy?: boolean;
}

interface Position {
  level: ReadingLevel;
  description: string;
}

const POSITIONS: Position[] = [
  { level: "paragraphs", description: "Plain words, in short paragraphs." },
  { level: "shorter", description: "Shorter sentences. Easier to scan." },
  { level: "list", description: "Each fact on its own line." },
];

export function ReadingFormSlider({ value, onChange, busy = false }: Props) {
  const activeIndex = POSITIONS.findIndex((p) => p.level === value);
  const description = POSITIONS[activeIndex]?.description ?? POSITIONS[0].description;

  return (
    <div className="flex flex-col items-start gap-2 select-none">
      <p className="mono-label" style={{ fontSize: "10px" }}>
        — the form of the simplified version
      </p>

      <div
        className="relative flex items-center"
        style={{ width: "180px", height: "24px" }}
        role="radiogroup"
        aria-label="Reading form"
      >
        {/* Track */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            height: "1px",
            background: "var(--ink-faint)",
          }}
        />

        {POSITIONS.map((p, i) => {
          const isActive = i === activeIndex;
          const offsetPct = (i / (POSITIONS.length - 1)) * 100;
          return (
            <button
              key={p.level}
              type="button"
              onClick={() => !busy && onChange(p.level)}
              role="radio"
              aria-checked={isActive}
              aria-label={p.description}
              disabled={busy}
              className="absolute flex items-center justify-center transition-colors"
              style={{
                left: `${offsetPct}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "20px",
                height: "20px",
                background: "transparent",
                border: "none",
                cursor: busy ? "wait" : "pointer",
                padding: 0,
              }}
            >
              <span
                style={{
                  width: isActive ? "12px" : "8px",
                  height: isActive ? "12px" : "8px",
                  borderRadius: "50%",
                  background: isActive ? "var(--navy)" : "var(--paper)",
                  border: `1px solid ${isActive ? "var(--navy)" : "var(--ink-faint)"}`,
                  transition: "all 150ms ease",
                  display: "block",
                }}
              />
            </button>
          );
        })}
      </div>

      <p
        style={{
          fontSize: "var(--t-xs)",
          color: busy ? "var(--ink-quiet)" : "var(--ink-muted)",
          fontStyle: "italic",
          fontFamily: "var(--font-body)",
          minHeight: "1.4em",
          transition: "color 150ms ease",
        }}
      >
        {busy ? "regenerating in plain words…" : description}
      </p>
    </div>
  );
}
