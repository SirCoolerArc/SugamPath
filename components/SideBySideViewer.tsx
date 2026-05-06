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
import { ISLPlayAllButton } from "@/components/ISLPlayAllButton";
import { ISLPlayAllPlayer } from "@/components/ISLPlayAllPlayer";
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

  const [playback, setPlayback] = useState<{
    currentIndex: number;
    status: "playing" | "paused" | "complete";
  } | null>(null);

  // Reset playback whenever the underlying simplification changes (form /
  // language regenerate, or new document upload). Cleanest resolution.
  useEffect(() => {
    setPlayback(null);
  }, [simplification]);

  const handlePlayAll = () => {
    if (sequence.length === 0) return;
    setPlayback({ currentIndex: 0, status: "playing" });
  };

  const handleAdvance = () => {
    setPlayback((p) => {
      if (!p) return p;
      if (p.currentIndex >= sequence.length - 1) {
        return { ...p, status: "complete" };
      }
      return { currentIndex: p.currentIndex + 1, status: "playing" };
    });
  };

  const handlePauseToggle = () => {
    setPlayback((p) => {
      if (!p || p.status === "complete") return p;
      return { ...p, status: p.status === "playing" ? "paused" : "playing" };
    });
  };

  const handleStop = () => setPlayback(null);
  const handleReplay = () => setPlayback({ currentIndex: 0, status: "playing" });

  // Guard against the race where simplification regenerates mid-playback:
  // the useMemo recomputes `sequence` with the new (possibly shorter)
  // simplification before the useEffect that resets `playback` to null
  // gets a chance to run. Falling through gracefully on this render keeps
  // the conditional player render below the only place that needs to know
  // about it.
  const activeItem = playback ? sequence[playback.currentIndex] : undefined;

  const activeChip = activeItem
    ? {
        sectionIndex: activeItem.sectionIndex,
        tokenIndex: activeItem.tokenIndex,
      }
    : null;

  const currentSectionHeading = activeItem
    ? simplification.sections[activeItem.sectionIndex]?.heading ?? ""
    : "";

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
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <AudioPlayer simplification={simplification} language={language} />
                <ISLPlayAllButton
                  onClick={handlePlayAll}
                  disabled={sequence.length === 0 || playback !== null}
                  count={sequence.length}
                />
              </div>
              {language !== "en" && sequence.length > 0 && (
                <p
                  style={{
                    fontSize: "var(--t-xs)",
                    color: "var(--ink-quiet)",
                    fontStyle: "italic",
                    fontFamily: "var(--font-body)",
                    maxWidth: "32ch",
                    textAlign: "right",
                    lineHeight: 1.4,
                  }}
                >
                  ISL signs are English-grounded — the play-all flow covers more of the document when the text is in English.
                </p>
              )}
            </div>
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
            <SimplifiedText
              simplification={simplification}
              dictionary={dictionary}
              activeChip={activeChip}
            />

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
      {playback !== null && sequence[playback.currentIndex] && (
        <ISLPlayAllPlayer
          sequence={sequence}
          currentIndex={playback.currentIndex}
          status={playback.status}
          currentSectionHeading={currentSectionHeading}
          onAdvance={handleAdvance}
          onPauseToggle={handlePauseToggle}
          onStop={handleStop}
          onReplay={handleReplay}
        />
      )}
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
