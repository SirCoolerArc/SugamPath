import { tokeniseLine, getIndex, resolveEntry, splitOnCriticalSpans } from "@/lib/chip_resolver";
import type { ISLDictionaryEntry, ISLSequenceItem, Simplification } from "@/lib/types";

/**
 * Walk a simplification's sections in document order and emit one
 * ISLSequenceItem per word token that resolves to a dictionary entry. The
 * floating "play all" player consumes this sequence; SimplifiedText
 * highlights the chip at the current `(sectionIndex, tokenIndex)`.
 *
 * Repeats are included — every occurrence of "doctor" produces its own item.
 * This matches decision (2) in the spec: a deaf user watching the document
 * end-to-end sees the same sign multiple times the same way a hearing user
 * hears the same word multiple times.
 *
 * The walk uses the same tokeniser and resolver SimplifiedText uses for
 * rendering (lib/chip_resolver.ts), so the rendered chip and the sequenced
 * chip are guaranteed to be the same chip.
 */
export function buildSequence(
  simplification: Simplification,
  dictionary: ISLDictionaryEntry[],
): ISLSequenceItem[] {
  if (dictionary.length === 0) return [];
  const index = getIndex(dictionary);
  const out: ISLSequenceItem[] = [];

  simplification.sections.forEach((section, sectionIndex) => {
    // Per-section token ordinal. Increments for every word token (including
    // ones that don't resolve), mirroring SimplifiedText's React keying so
    // the highlight target is identifiable by (sectionIndex, tokenIndex).
    let tokenIndex = 0;
    const segments = splitOnCriticalSpans(section.body);
    for (const seg of segments) {
      if (seg.kind === "critical") continue; // critical-field HTML is rendered as a verbatim span, never chipified
      const lines = seg.text.split("\n");
      for (const line of lines) {
        const tokens = tokeniseLine(line);
        for (const tok of tokens) {
          if (!tok.isWord) continue;
          const entry = resolveEntry(tok.text, index);
          if (entry) {
            out.push({
              entry,
              sectionIndex,
              tokenIndex,
              surface: tok.text,
            });
          }
          tokenIndex++;
        }
      }
    }
  });

  return out;
}
