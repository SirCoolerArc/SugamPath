# SugamPath

> India's State communicates in a register that mathematically excludes 18 million deaf citizens (and millions more low-literacy adults) from understanding their own rights. We built the bridge — and built it so it cannot lie.

SugamPath takes any Indian bureaucratic document (hospital discharge summary, court summons, benefits letter, property notice, school report) and renders it in three accessible modalities alongside the original: simplified Hindi/English text, browser-TTS audio, and tappable Indian Sign Language video chips for domain terms — plus an action-items panel using verifying language.

**Hackathon prototype.** Built for the AIC × Anthropic Claude Hackathon at IIT Bombay, May 2026. Not production software. No persistence, no authentication, no warranties. The original document is always shown alongside any simplified rendition; the simplified text is never authoritative.

## Setup

```bash
npm install
cp .env.example .env.local   # then paste your GEMINI_API_KEY
npm run dev
```

See [`CLAUDE.md`](./CLAUDE.md) for the full project context, build stages, and safety rules. See [`docs/demo_benchmark.md`](./docs/demo_benchmark.md) for the gold-standard test harness.
