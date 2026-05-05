"use client";

import { useState } from "react";

interface ProcessResponse {
  description?: string;
  error?: string;
  meta?: {
    filename: string;
    size: number;
    mimeType: string;
    latencyMs: number;
  };
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setResult(null);

    const form = new FormData();
    form.append("document", file);

    try {
      const res = await fetch("/api/process", { method: "POST", body: form });
      const data: ProcessResponse = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 px-6 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">SugamPath — Hello Gemini</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Step 3 sanity check. Upload any document image; we ask Gemini for a one-sentence
            description.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-neutral-700">
            Document image
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
            />
          </label>
          <button
            type="submit"
            disabled={!file || loading}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300 disabled:cursor-not-allowed"
          >
            {loading ? "Calling Gemini…" : "Send to Gemini"}
          </button>
        </form>

        {result && (
          <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-3">
            <h2 className="text-sm font-medium text-neutral-700">Response</h2>
            {result.error ? (
              <p className="text-sm text-red-600 whitespace-pre-wrap">{result.error}</p>
            ) : (
              <>
                <p className="text-base whitespace-pre-wrap">{result.description}</p>
                {result.meta && (
                  <p className="text-xs text-neutral-500">
                    {result.meta.filename} · {(result.meta.size / 1024).toFixed(1)} KB ·{" "}
                    {result.meta.mimeType} · {result.meta.latencyMs} ms
                  </p>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
