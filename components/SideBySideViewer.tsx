"use client";

import { OriginalDocument } from "@/components/OriginalDocument";
import { SimplifiedText } from "@/components/SimplifiedText";
import { ActionItemsPanel } from "@/components/ActionItemsPanel";
import { SafetyBadges } from "@/components/SafetyBadges";
import { AudioPlayer } from "@/components/AudioPlayer";
import { InjectionNotice } from "@/components/InjectionNotice";
import { ReadingFormSlider } from "@/components/ReadingFormSlider";
import type {
  Extraction,
  FaithfulnessResult,
  InjectionCheckResult,
  ReadingLevel,
  Simplification,
} from "@/lib/types";

interface Props {
  previews: string[];
  extraction: Extraction;
  simplification: Simplification;
  vaultSize: number;
  faithfulness: FaithfulnessResult | null;
  injection: InjectionCheckResult | null;
  meta: { totalLatencyMs: number; pages: number };
  readingLevel: ReadingLevel;
  onReadingLevelChange: (level: ReadingLevel) => void;
  regenerating: boolean;
  regenerationError: string | null;
}

export function SideBySideViewer({
  previews,
  extraction,
  simplification,
  vaultSize,
  faithfulness,
  injection,
  meta,
  readingLevel,
  onReadingLevelChange,
  regenerating,
  regenerationError,
}: Props) {
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
          <OriginalDocument previews={previews} />
        </aside>

        <article className="lg:col-span-7 fade-up fade-up-delay-2">
          <div className="flex items-start justify-between gap-6 mb-6">
            <ReadingFormSlider
              value={readingLevel}
              onChange={onReadingLevelChange}
              busy={regenerating}
            />
            <AudioPlayer simplification={simplification} />
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
            <SimplifiedText simplification={simplification} />

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
