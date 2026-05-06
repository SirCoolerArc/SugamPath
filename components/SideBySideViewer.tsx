"use client";

import { useEffect, useMemo, useState } from "react";

import { OriginalDocument } from "@/components/OriginalDocument";
import { SimplifiedText } from "@/components/SimplifiedText";
import { ActionItemsPanel } from "@/components/ActionItemsPanel";
import { SafetyBadges } from "@/components/SafetyBadges";
import { AudioPlayer } from "@/components/AudioPlayer";
import { InjectionNotice } from "@/components/InjectionNotice";
import { ReadingFormSlider } from "@/components/ReadingFormSlider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { buildSequence } from "@/lib/isl_sequencer";
import type {
  Extraction,
  FaithfulnessResult,
  InjectionCheckResult,
  ISLDictionaryEntry,
  ReadingLevel,
  Simplification,
  TargetLanguage,
} from "@/lib/types";

interface Props {
  previews: string[];
  mimeTypes: string[];
  extraction: Extraction;
  simplification: Simplification;
  vaultSize: number;
  faithfulness: FaithfulnessResult | null;
  injection: InjectionCheckResult | null;
  meta: { totalLatencyMs: number; pages: number };
  readingLevel: ReadingLevel;
  onReadingLevelChange: (level: ReadingLevel) => void;
  language: TargetLanguage;
  onLanguageChange: (language: TargetLanguage) => void;
  regenerating: boolean;
  regenerationError: string | null;
}

export function SideBySideViewer({
  previews,
  mimeTypes,
  extraction,
  simplification,
  vaultSize,
  faithfulness,
  injection,
  meta,
  readingLevel,
  onReadingLevelChange,
  language,
  onLanguageChange,
  regenerating,
  regenerationError,
}: Props) {
  const dictionary = useDictionary();
  const sequence = useMemo(
    () => buildSequence(simplification, dictionary),
    [simplification, dictionary],
  );

  return (
    <section className="px-6 lg:px-12 pt-8 pb-32">
      {injection && injection.verdict === "SUSPICIOUS" && (
        <InjectionNotice injection={injection} />
      )}

      {/* Top strip: doc title + safety badges */}
      <div className="max-w-7xl mx-auto mb-10 flex items-end justify-between gap-6 fade-up">
        <div className="min-w-0">
          <p className="mono-label mb-2">{extraction.document_type.replace(/_/g, " ")}</p>
          <h2
            className="display truncate"
            style={{ fontSize: "clamp(1.5rem, 3vw, var(--t-2xl))" }}
          >
            {extraction.issuing_authority}
          </h2>
        </div>
        <SafetyBadges
          vaultSize={vaultSize}
          pages={meta.pages}
          latencyMs={meta.totalLatencyMs}
          faithfulness={faithfulness}
          injection={injection}
        />
      </div>

      <hr className="hairline max-w-7xl mx-auto mb-10" />

      {/* Asymmetric 5/7 split — the simplified column is the protagonist */}
      <div className="max-w-7xl mx-auto grid lg:grid-cols-12 gap-10 lg:gap-16">
        <aside className="lg:col-span-5 lg:sticky lg:top-8 self-start fade-up fade-up-delay-1">
          <p className="mono-label mb-4">— the original</p>
          <OriginalDocument previews={previews} mimeTypes={mimeTypes} />
        </aside>

        <article className="lg:col-span-7 fade-up fade-up-delay-2">
          <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
            <div className="flex items-start gap-10 flex-wrap">
              <ReadingFormSlider
                value={readingLevel}
                onChange={onReadingLevelChange}
                busy={regenerating}
              />
              <LanguageToggle
                value={language}
                onChange={onLanguageChange}
                busy={regenerating}
              />
            </div>
            <AudioPlayer simplification={simplification} language={language} />
          </div>

          {regenerationError && (
            <p
              className="mono-label mb-4"
              style={{ color: "var(--rust)", fontSize: "10px" }}
            >
              — {regenerationError}
            </p>
          )}

          <div
            style={{
              opacity: regenerating ? 0.5 : 1,
              transition: "opacity 200ms ease",
            }}
          >
            <SimplifiedText simplification={simplification} dictionary={dictionary} />

            {(simplification.simplified_actions.length > 0 ||
              simplification.warnings_plain.length > 0) && (
              <div className="mt-12">
                <ActionItemsPanel
                  actions={simplification.simplified_actions}
                  warnings={simplification.warnings_plain}
                />
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

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
