"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { FileText, Upload, X } from "lucide-react";

const ACCEPT = "image/*,application/pdf";
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

interface Props {
  onSubmit: (files: File[]) => void;
}

export function DocumentUploader({ onSubmit }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (!f.type.match(/^(image\/|application\/pdf$)/)) continue;
      if (next.some((existing) => existing.name === f.name && existing.size === f.size)) continue;
      next.push(f);
    }
    const total = next.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      setError(`Total upload exceeds ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setError(null);
    setFiles(next);
  }, [files]);

  const removeFile = (idx: number) => {
    setFiles(files.filter((_, i) => i !== idx));
    setError(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const handleSubmit = () => {
    if (files.length === 0) return;
    onSubmit(files);
  };

  const totalKB = files.reduce((sum, f) => sum + f.size, 0) / 1024;

  return (
    <div
      className="border"
      style={{
        background: "var(--paper-deep)",
        borderColor: dragOver ? "var(--navy)" : "var(--ink-faint)",
        borderWidth: dragOver ? "2px" : "1px",
        transition: "border-color 120ms ease, border-width 120ms ease",
      }}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="px-8 py-12 text-center cursor-pointer"
        style={{ borderBottom: files.length > 0 ? "var(--hairline)" : "none" }}
      >
        <Upload
          className="mx-auto mb-5"
          size={32}
          strokeWidth={1.25}
          color="var(--ink-quiet)"
        />
        <p className="display mb-2" style={{ fontSize: "var(--t-md)" }}>
          Drop your document here
        </p>
        <p style={{ color: "var(--ink-muted)", fontSize: "var(--t-sm)" }}>
          or click to browse · images and PDFs · up to 10&nbsp;MB
        </p>
        <p className="mono-label mt-5">
          one document &nbsp;·&nbsp; multiple pages OK
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="divide-y" style={{ borderColor: "var(--ink-faint)" }}>
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center justify-between px-6 py-3"
              style={{ borderColor: "var(--ink-faint)" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={16} color="var(--ink-quiet)" strokeWidth={1.5} />
                <span
                  className="truncate"
                  style={{ fontSize: "var(--t-sm)", color: "var(--ink)" }}
                >
                  {f.name}
                </span>
                <span className="mono" style={{ color: "var(--ink-quiet)", fontSize: "var(--t-xs)" }}>
                  {(f.size / 1024).toFixed(0)}&nbsp;KB
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                aria-label={`Remove ${f.name}`}
                className="p-1 rounded hover:bg-[color:var(--paper-sunk)] transition-colors"
              >
                <X size={14} color="var(--ink-quiet)" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          className="px-6 py-3 mono"
          style={{
            borderTop: "var(--hairline)",
            color: "var(--rust)",
            fontSize: "var(--t-xs)",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderTop: "var(--hairline)" }}
      >
        <span className="mono-label">
          {files.length === 0
            ? "no files"
            : `${files.length} page${files.length > 1 ? "s" : ""} · ${totalKB.toFixed(0)} KB`}
        </span>
        <button
          onClick={handleSubmit}
          disabled={files.length === 0}
          className="px-5 py-2.5 transition-all disabled:cursor-not-allowed"
          style={{
            background: files.length === 0 ? "var(--paper-sunk)" : "var(--ink)",
            color: files.length === 0 ? "var(--ink-quiet)" : "var(--paper)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          read this →
        </button>
      </div>
    </div>
  );
}
