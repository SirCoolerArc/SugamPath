"use client";

import { Hand } from "lucide-react";

interface Props {
  onClick: () => void;
  disabled: boolean;
  /** Number of signs in the sequence; used in the button label and tooltip. */
  count: number;
}

/**
 * Toolbar button that opens the play-all floating player. Sits next to the
 * AudioPlayer in SideBySideViewer; matches its visual idiom (small button,
 * mono-label legend on the right). Disabled when the sequence is empty —
 * which can happen if the simplified text has no chip-matching tokens (e.g.
 * a Hindi-only document where the alias map missed every term).
 */
export function ISLPlayAllButton({ onClick, disabled, count }: Props) {
  return (
    <div
      className="inline-flex items-center gap-1 border"
      style={{ borderColor: "var(--ink-faint)" }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={
          disabled
            ? "No ISL signs in this text"
            : `Play all ${count} signs in this document`
        }
        title={disabled ? "no ISL signs in this text" : `play all ${count} signs`}
        className="px-2.5 py-2 hover:bg-[color:var(--paper-sunk)] transition-colors"
        style={{
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <Hand size={13} strokeWidth={2} />
      </button>
      <span
        className="mono-label px-3"
        style={{
          color: disabled ? "var(--ink-quiet)" : "var(--navy)",
          borderLeft: "var(--hairline)",
        }}
      >
        {disabled ? "no signs" : `play all signs (${count})`}
      </span>
    </div>
  );
}
