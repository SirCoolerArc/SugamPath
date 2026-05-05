import { PIIKind, PII_PATTERNS } from "@/data/pii_patterns";

export type PIIVault = Map<string, string>;

export interface TokeniseResult {
  redacted: string;
  vault: PIIVault;
}

/**
 * An extra PII span supplied by the LLM at extraction time. Used to augment
 * the regex-based pass for things regex cannot reliably detect (names
 * introduced by varied cues, multi-component rural addresses, etc.).
 *
 * `kind` should be one of the PIIKind values. Unknown kinds default to OTHER.
 */
export interface ExtraSpan {
  kind: string;
  value: string;
}

const KNOWN_KINDS = new Set<PIIKind>([
  "AADHAAR",
  "PAN",
  "PHONE",
  "REGNO",
  "UHID",
  "DATE",
  "MONEY",
  "NAME",
  "ADDRESS",
  "ORG",
]);

const NAMELIKE_KINDS = new Set<PIIKind>(["NAME", "ORG"]);

/**
 * Replace every PII match in `text` with a stable `[KIND_NNN]` token.
 *
 * Identical values within the same call deduplicate to the same token, so the
 * second occurrence of "19/05/2026" reuses `[DATE_003]` rather than minting
 * `[DATE_004]`. The vault is request-scoped — the caller is responsible for
 * discarding it after the response is sent.
 *
 * If `extraSpans` is provided, those spans are tokenised AFTER the regex pass.
 * This is the LLM-augmented mode: the extractor passes Gemini's `pii_spans`
 * here to catch names/addresses regex couldn't reach.
 */
export function tokenise(text: string, extraSpans: ExtraSpan[] = []): TokeniseResult {
  const vault: PIIVault = new Map();
  // Reverse lookup: dedup-key -> token. The vault map itself stores
  // token -> real value (the direction needed for reconstruction).
  const valueToToken = new Map<string, string>();
  const counters = new Map<PIIKind, number>();

  let working = text;

  // ─── Pass 1: regex patterns ──────────────────────────────────────────────
  for (const pattern of PII_PATTERNS) {
    // Each pattern is reset because we re-create the regex matcher per pass
    // (the `g` flag means lastIndex would otherwise carry across calls).
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

    working = working.replace(regex, (...args) => {
      const groups = args.slice(1, -2) as string[];
      const fullMatch = args[0] as string;
      const value = (groups[pattern.valueGroup - 1] ?? "").trim();
      if (!value) return fullMatch;

      const dedupKey = makeDedupKey(pattern.kind, value);
      const existing = valueToToken.get(dedupKey);
      const token = existing ?? mintToken(pattern.kind, counters);
      if (!existing) {
        valueToToken.set(dedupKey, token);
        vault.set(token, value);
      }

      // Preserve any prefix the regex matched outside the value group
      // (e.g. "UHID No.       :" before the captured ID).
      const valueStart = fullMatch.indexOf(value);
      if (valueStart <= 0) return token;
      return fullMatch.slice(0, valueStart) + token + fullMatch.slice(valueStart + value.length);
    });
  }

  // ─── Pass 2: LLM-supplied extra spans ────────────────────────────────────
  // Sort spans longest-first so a longer multi-word value wins over a shorter
  // suffix when both are PII (e.g. "GAUTAM MUKHOPADHYAY" before "MUKHOPADHYAY").
  const sortedSpans = [...extraSpans].sort((a, b) => b.value.length - a.value.length);

  for (const span of sortedSpans) {
    const kind = normaliseKind(span.kind);
    const value = span.value.trim();
    if (!value) continue;

    // Already vaulted (case-insensitive for name-like kinds)? Re-use the same
    // token and just substitute remaining occurrences.
    const dedupKey = makeDedupKey(kind, value);
    let token = valueToToken.get(dedupKey);

    if (!token) {
      // No existing token — but only mint one if the value still appears
      // verbatim somewhere in the working text. Otherwise the regex pass
      // already handled it under a different formatting.
      if (!working.includes(value)) continue;
      token = mintToken(kind, counters);
      valueToToken.set(dedupKey, token);
      vault.set(token, value);
    }

    // Replace ALL remaining literal occurrences of this value with the token.
    // Use a literal-string regex (escape special characters) so dots/parens
    // inside values don't act as metacharacters.
    const literalRegex = new RegExp(escapeRegex(value), "g");
    working = working.replace(literalRegex, token);
  }

  return { redacted: working, vault };
}

/**
 * Substitute `[KIND_NNN]` tokens back with the original values from the vault.
 * Tokens that aren't present in the vault are left untouched.
 */
export function reconstruct(text: string, vault: PIIVault): string {
  return text.replace(/\[([A-Z]+_\d{3,})\]/g, (match, inner: string) => {
    const value = vault.get(`[${inner}]`);
    return value ?? match;
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function mintToken(kind: PIIKind, counters: Map<PIIKind, number>): string {
  const next = (counters.get(kind) ?? 0) + 1;
  counters.set(kind, next);
  return `[${kind}_${String(next).padStart(3, "0")}]`;
}

/**
 * Build a dedup key. NAME/ORG keys are case-insensitive so "Gautam Mukhopadhyay"
 * and "GAUTAM MUKHOPADHYAY" reuse the same token (whichever was minted first
 * keeps its real-value form in the vault).
 */
function makeDedupKey(kind: PIIKind, value: string): string {
  if (NAMELIKE_KINDS.has(kind)) return `${kind}::${value.toLowerCase().replace(/\s+/g, " ")}`;
  return `${kind}::${value}`;
}

/**
 * Map an arbitrary string kind from the LLM to a known PIIKind. Anything
 * unrecognised is silently coerced to OTHER... except OTHER itself isn't in the
 * regex enum, so we treat it as a catch-all NAME-like kind that just gets
 * tokenised as `[OTHER_NNN]`. We extend the type loosely here because the
 * mintToken counter map accepts any string key at runtime.
 */
function normaliseKind(raw: string): PIIKind {
  const upper = raw.toUpperCase().trim();
  if ((KNOWN_KINDS as Set<string>).has(upper)) return upper as PIIKind;
  // Allow extra LLM-supplied kinds (EMAIL, URL_PERSONAL, OTHER) — they aren't
  // in the regex enum but the counter map and token format accept any uppercase
  // string at runtime.
  if (upper === "EMAIL" || upper === "URL_PERSONAL" || upper === "OTHER") {
    return upper as unknown as PIIKind;
  }
  return "OTHER" as unknown as PIIKind;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
