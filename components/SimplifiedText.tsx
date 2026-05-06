"use client";

import { Fragment, useEffect, useState } from "react";

import { ISLTermChip } from "@/components/ISLTermChip";
import { HINDI_ISL_ALIASES } from "@/data/hindi_isl_aliases";
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

// Module-level memo — built once per dictionary identity (which itself is
// fetched once per page session). 10k+ terms × per-line regex would be
// catastrophic; an O(words-in-line) hash lookup is fast.
let cachedIndex: { dict: ISLDictionaryEntry[]; index: Map<string, ISLDictionaryEntry> } | null = null;

function getIndex(dictionary: ISLDictionaryEntry[]): Map<string, ISLDictionaryEntry> {
  if (cachedIndex && cachedIndex.dict === dictionary) return cachedIndex.index;
  const index = new Map<string, ISLDictionaryEntry>();
  for (const entry of dictionary) {
    const keys = [entry.term, ...(entry.aliases ?? [])];
    for (const k of keys) {
      const norm = k.toLowerCase().trim();
      if (!norm) continue;
      // First entry wins on collision so the dictionary's natural ordering
      // (alphabetised by sync script) gives stable behaviour.
      if (!index.has(norm)) index.set(norm, entry);
    }
  }
  cachedIndex = { dict: dictionary, index };
  return index;
}

// Tokenise a line into [text, isWord] runs. A "word" is a contiguous run of
// either Latin alphanumerics (with an internal apostrophe) OR Devanagari
// characters (ऀ-ॿ covers Hindi consonants, vowels, marks, and
// digits). A "non-word" is everything else — whitespace, punctuation,
// em-dashes — preserved verbatim so spacing and punctuation survive the
// re-emit unchanged. Latin and Devanagari runs are tokenised separately:
// "खून blood test" becomes three word tokens, not one.
function tokeniseLine(line: string): Array<{ text: string; isWord: boolean }> {
  const out: Array<{ text: string; isWord: boolean }> = [];
  const re = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|[ऀ-ॿ]+/g;
  let last = 0;
  for (const match of line.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push({ text: line.slice(last, idx), isWord: false });
    out.push({ text: match[0], isWord: true });
    last = idx + match[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), isWord: false });
  return out;
}

const DEVANAGARI_RE = /[ऀ-ॿ]/;

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

/**
 * Look up a token in the ISL index. For Latin tokens, lowercase the surface
 * form and probe directly. For Devanagari tokens, first translate via the
 * hand-curated Hindi → English alias map, then probe. Keeps the dictionary
 * (auto-generated by sync_isl_dictionary.ts) script-pure while letting Hindi
 * simplifications still chip the same medical / civic vocabulary.
 */
function resolveEntry(
  surface: string,
  index: Map<string, ISLDictionaryEntry>,
): ISLDictionaryEntry | undefined {
  if (DEVANAGARI_RE.test(surface)) {
    const englishKey = HINDI_ISL_ALIASES[surface];
    if (!englishKey) return undefined;
    return index.get(englishKey);
  }
  return index.get(surface.toLowerCase());
}
