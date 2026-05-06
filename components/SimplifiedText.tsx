"use client";

import { Fragment, useEffect, useState } from "react";

import { ISLTermChip } from "@/components/ISLTermChip";
import { tokeniseLine, getIndex, resolveEntry } from "@/lib/chip_resolver";
import type { ISLDictionaryEntry, Simplification } from "@/lib/types";

interface Props {
  simplification: Simplification;
}

export function SimplifiedText({ simplification }: Props) {
  const dictionary = useDictionary();

  return (
    <div className="space-y-10">
      {simplification.sections.map((section, idx) => (
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
            {renderBody(section.body, dictionary)}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ───── Dictionary loading ────────────────────────────────────────────── */

function useDictionary(): ISLDictionaryEntry[] {
  const [entries, setEntries] = useState<ISLDictionaryEntry[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/isl-dictionary");
        if (!res.ok) return;
        const json = (await res.json()) as ISLDictionaryEntry[];
        if (alive && Array.isArray(json)) setEntries(json);
      } catch {
        // Empty dictionary is a valid state — chips just won't appear.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return entries;
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

function renderBody(body: string, dictionary: ISLDictionaryEntry[]): React.ReactNode {
  const segments = splitOnCriticalSpans(body);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "critical" ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <Fragment key={i}>{renderTextWithChips(seg.text, dictionary)}</Fragment>
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
function renderTextWithChips(text: string, dictionary: ISLDictionaryEntry[]): React.ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => (
    <Fragment key={lineIdx}>
      {lineIdx > 0 && <br />}
      {chipifyLine(line, dictionary)}
    </Fragment>
  ));
}


function chipifyLine(line: string, dictionary: ISLDictionaryEntry[]): React.ReactNode {
  if (dictionary.length === 0 || !line) return line;
  const index = getIndex(dictionary);
  const tokens = tokeniseLine(line);

  return tokens.map((tok, i) => {
    if (!tok.isWord) return <Fragment key={i}>{tok.text}</Fragment>;
    const entry = resolveEntry(tok.text, index);
    if (!entry) return <Fragment key={i}>{tok.text}</Fragment>;
    return <ISLTermChip key={i} label={tok.text} entry={entry} />;
  });
}

