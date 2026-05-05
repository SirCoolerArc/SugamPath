import { PIIKind, PII_PATTERNS } from "@/data/pii_patterns";

export type PIIVault = Map<string, string>;

export interface TokeniseResult {
  redacted: string;
  vault: PIIVault;
}

/**
 * Replace every PII match in `text` with a stable `[KIND_NNN]` token.
 *
 * Identical values within the same call deduplicate to the same token, so the
 * second occurrence of "19/05/2026" reuses `[DATE_003]` rather than minting
 * `[DATE_004]`. The vault is request-scoped — the caller is responsible for
 * discarding it after the response is sent.
 */
export function tokenise(text: string): TokeniseResult {
  const vault: PIIVault = new Map();
  // Reverse lookup: real value -> token, used for dedup. The vault map itself
  // stores token -> real value (the direction needed for reconstruction).
  const valueToToken = new Map<string, string>();
  const counters = new Map<PIIKind, number>();

  let working = text;

  for (const pattern of PII_PATTERNS) {
    // Each pattern is reset because we re-create the regex matcher per pass
    // (the `g` flag means lastIndex would otherwise carry across calls).
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

    working = working.replace(regex, (...args) => {
      const groups = args.slice(1, -2) as string[];
      const fullMatch = args[0] as string;
      const value = (groups[pattern.valueGroup - 1] ?? "").trim();
      if (!value) return fullMatch;

      // Dedup: same kind + same value -> same token.
      const dedupKey = `${pattern.kind}::${value}`;
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

function mintToken(kind: PIIKind, counters: Map<PIIKind, number>): string {
  const next = (counters.get(kind) ?? 0) + 1;
  counters.set(kind, next);
  return `[${kind}_${String(next).padStart(3, "0")}]`;
}
