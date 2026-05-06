"use client";

import { Fragment, useEffect, useRef } from "react";

import { ISLTermChip } from "@/components/ISLTermChip";
import { tokeniseLine, getIndex, resolveEntry } from "@/lib/chip_resolver";
import type { ISLDictionaryEntry, Simplification } from "@/lib/types";

interface Props {
  simplification: Simplification;
  dictionary: ISLDictionaryEntry[];
  /** When non-null, the chip at this (sectionIndex, tokenIndex) renders with
   *  a "currently signing" highlight and is scrolled into view. Used by the
   *  play-all flow; null in normal rendering. */
  activeChip?: { sectionIndex: number; tokenIndex: number } | null;
}

export function SimplifiedText({ simplification, dictionary, activeChip = null }: Props) {
  // Map from "sectionIdx:tokenIdx" → chip DOM node, populated by ref callbacks
  // during render. Persists across re-renders so the auto-scroll effect can
  // find the active chip without rebuilding the map.
  const chipNodeRegistry = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!activeChip) return;
    const node = chipNodeRegistry.current.get(`${activeChip.sectionIndex}:${activeChip.tokenIndex}`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeChip]);

  return (
    <div className="space-y-10">
      {simplification.sections.map((section, idx) => {
        const ctx: RenderContext = {
          dictionary,
          sectionIndex: idx,
          tokenCounter: { current: 0 },
          activeChip,
          chipNodeRegistry: chipNodeRegistry.current,
        };
        return (
          <section key={idx}>
            <h3
              className="display mb-3"
              style={{
                fontSize: "var(--t-lg)",
                color: "var(--ink)",
                fontVariationSettings: '"opsz" 32',
              }}
            >
              {section.heading}
            </h3>
            <div
              style={{
                fontSize: "var(--t-md)",
                lineHeight: 1.65,
                color: "var(--ink)",
              }}
            >
              {renderBody(section.body, ctx)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ───── Body renderer ─────────────────────────────────────────────────── */
/**
 * The body comes from the simplifier with critical-field HTML spans already
 * inlined (e.g. `Take <span class="critical-field" data-id="c1">Aspirin 75 mg</span> daily`).
 * We need to:
 *  1. Preserve those spans verbatim.
 *  2. Within plain-text portions, wrap any ISL-dictionary term in an
 *     ISLTermChip React component.
 *  3. Honour newlines and bullet markers so bullet lists render correctly.
 *
 * Strategy: split the body into segments — each segment is either a
 * critical-field span (rendered via dangerouslySetInnerHTML in a span) or
 * plain text (further split by ISL term matches).
 */

interface CriticalSegment { kind: "critical"; html: string }
interface TextSegment { kind: "text"; text: string }
type Segment = CriticalSegment | TextSegment;

const CRITICAL_SPAN_RE = /<span class="critical-field"[\s\S]*?<\/span>/g;

interface RenderContext {
  dictionary: ISLDictionaryEntry[];
  sectionIndex: number;
  /** Mutable ref-cell holding the running token ordinal across the section.
   *  We use a ref-cell rather than a number so all the helpers share the
   *  same counter regardless of how the segments are sliced. */
  tokenCounter: { current: number };
  activeChip: { sectionIndex: number; tokenIndex: number } | null;
  /** Map from "sectionIndex:tokenIndex" → DOM node, populated by chip refs. */
  chipNodeRegistry: Map<string, HTMLElement>;
}

function renderBody(body: string, ctx: RenderContext): React.ReactNode {
  const segments = splitOnCriticalSpans(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "critical" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <Fragment key={i}>{renderTextWithChips(seg.text, ctx)}</Fragment>
        ),
      )}
    </>
  );
}

function splitOnCriticalSpans(body: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(CRITICAL_SPAN_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) segments.push({ kind: "text", text: body.slice(lastIndex, idx) });
    segments.push({ kind: "critical", html: match[0] });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: "text", text: body.slice(lastIndex) });
  }
  return segments;
}

/**
 * Walk a plain-text segment, honouring "\n" as a line break and "•" as a
 * bullet. Within each line, scan for ISL dictionary terms (case-insensitive,
 * word-bounded) and wrap each match in an ISLTermChip.
 */
function renderTextWithChips(text: string, ctx: RenderContext): React.ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => (
    <Fragment key={lineIdx}>
      {lineIdx > 0 && <br />}
      {chipifyLine(line, ctx)}
    </Fragment>
  ));
}


function chipifyLine(line: string, ctx: RenderContext): React.ReactNode {
  if (ctx.dictionary.length === 0 || !line) return line;
  const index = getIndex(ctx.dictionary);
  const tokens = tokeniseLine(line);

  return tokens.map((tok, i) => {
    if (!tok.isWord) return <Fragment key={i}>{tok.text}</Fragment>;
    // Capture this token's ordinal *before* incrementing — every word token
    // (resolved or not) advances the counter so the ordinal matches the
    // sequencer's view (lib/isl_sequencer.ts uses the same rule).
    const tokenIndex = ctx.tokenCounter.current;
    ctx.tokenCounter.current += 1;

    const entry = resolveEntry(tok.text, index);
    if (!entry) return <Fragment key={i}>{tok.text}</Fragment>;

    const isActive =
      ctx.activeChip !== null &&
      ctx.activeChip.sectionIndex === ctx.sectionIndex &&
      ctx.activeChip.tokenIndex === tokenIndex;

    const refKey = `${ctx.sectionIndex}:${tokenIndex}`;

    return (
      <ChipWithRef
        key={i}
        label={tok.text}
        entry={entry}
        isActive={isActive}
        refKey={refKey}
        registry={ctx.chipNodeRegistry}
      />
    );
  });
}

/* ───── ChipWithRef ───────────────────────────────────────────────────── */

interface ChipWithRefProps {
  label: string;
  entry: ISLDictionaryEntry;
  isActive: boolean;
  refKey: string;
  registry: Map<string, HTMLElement>;
}

/**
 * Wraps ISLTermChip with a ref callback that registers its DOM node in a
 * shared registry, plus a "currently signing" highlight overlay when active.
 * The registry lets the parent (SimplifiedText) scroll the active chip into
 * view via a useEffect on activeChip.
 */
function ChipWithRef({ label, entry, isActive, refKey, registry }: ChipWithRefProps) {
  return (
    <span
      ref={(node) => {
        if (node) registry.set(refKey, node);
        else registry.delete(refKey);
      }}
      data-chip-key={refKey}
      style={{
        display: "inline-block",
        background: isActive ? "var(--navy)" : "transparent",
        color: isActive ? "var(--paper)" : "inherit",
        padding: isActive ? "0 4px" : 0,
        borderRadius: isActive ? "2px" : 0,
        transition: "background 150ms ease, color 150ms ease",
      }}
    >
      <ISLTermChip label={label} entry={entry} />
    </span>
  );
}
