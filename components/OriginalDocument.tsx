"use client";

import Image from "next/image";

interface Props {
  previews: string[];
}

export function OriginalDocument({ previews }: Props) {
  return (
    <div className="space-y-4">
      {previews.map((src, i) => (
        <figure
          key={i}
          className="border bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          style={{ borderColor: "var(--ink-faint)" }}
        >
          <Image
            src={src}
            alt={`Page ${i + 1} of the original document`}
            width={800}
            height={1100}
            unoptimized
            className="w-full h-auto block"
          />
          {previews.length > 1 && (
            <figcaption
              className="mono px-3 py-2"
              style={{
                fontSize: "var(--t-xs)",
                color: "var(--ink-quiet)",
                borderTop: "var(--hairline)",
                background: "var(--paper-deep)",
              }}
            >
              page&nbsp;{i + 1}&nbsp;/&nbsp;{previews.length}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}
