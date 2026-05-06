// Indian PII regex patterns. Order matters: more specific patterns must come
// before more general ones to avoid being eaten by them (e.g. REGNO before
// PHONE; AADHAAR_MASKED before bare digit runs).
//
// Each pattern produces tokens of the form `[KIND_NNN]`. Identical captured
// values reuse the same token within a request — see lib/pii_vault.ts.

export type PIIKind =
  | "AADHAAR"
  | "PAN"
  | "PHONE"
  | "REGNO"
  | "UHID"
  | "DATE"
  | "MONEY"
  | "NAME"
  | "ADDRESS"
  | "ORG";

export interface PIIPattern {
  kind: PIIKind;
  /**
   * The capturing group at index `valueGroup` is the actual sensitive value.
   * Anything matched outside that group (lookarounds, prefix labels) is
   * preserved verbatim in the redacted output.
   */
  regex: RegExp;
  valueGroup: number;
}

// Order is significant. Patterns are applied top-to-bottom against the
// running text; later patterns cannot match inside text already replaced by
// earlier ones (because earlier replacements turn the source into `[KIND_NNN]`
// placeholders, which subsequent patterns won't match).
export const PII_PATTERNS: PIIPattern[] = [
  // 1. Doctor's registration number (e.g. "MMC-2010-12345"). State medical
  //    council prefix + year + serial. Must come before PHONE so the digit
  //    pattern doesn't grab it.
  {
    kind: "REGNO",
    regex: /\b([A-Z]{2,5}-\d{4}-\d{3,6})\b/g,
    valueGroup: 1,
  },

  // 2. Aadhaar — 12 digits, optionally masked. Common forms:
  //      "1234 5678 9012", "1234-5678-9012", "XXXX-XXXX-1234".
  //    Masked form (with X) is what discharge summaries usually print.
  {
    kind: "AADHAAR",
    regex: /\b((?:[X*]{4}|\d{4})[\s-]?(?:[X*]{4}|\d{4})[\s-]?\d{4})\b/gi,
    valueGroup: 1,
  },

  // 3. PAN — 5 letters + 4 digits + 1 letter (e.g. "ABCDE1234F").
  {
    kind: "PAN",
    regex: /\b([A-Z]{5}\d{4}[A-Z])\b/g,
    valueGroup: 1,
  },

  // 4. Indian phone numbers — three shapes:
  //      a) +91 mobile:    "+91 98202 17392", "+91-98202-17392", "+919820217392"
  //      b) Bare 10-digit mobile starting 6/7/8/9
  //      c) Landline with STD code: "022-2410-1208", "022-2410-XXXX",
  //         "(022) 2410 1208"
  {
    kind: "PHONE",
    regex:
      /(\+91[\s-]?\d{5}[\s-]?\d{5}|\b[6-9]\d{9}\b|\b0?\d{2,4}[\s-]\d{3,4}[\s-][\dX]{4}\b)/g,
    valueGroup: 1,
  },

  // 5. UHID-style hospital IDs — captured by the label, not by shape, since the
  //    digits alone are indistinguishable from any other number. Covers UHID,
  //    MR No., Patient ID, OPD No., IP No./Number, and Bed No. seen on real
  //    Indian hospital discharge summaries.
  {
    kind: "UHID",
    regex:
      /\b(?:UHID(?:\s*No\.?)?|MR\s*No\.?|Patient\s*ID|OPD\s*No\.?|IP\.?\s*(?:No\.?|Number)|Bed\s*No\.?)\s*:\s*([A-Z0-9-]+)\b/gi,
    valueGroup: 1,
  },

  // 6. Dates in DD/MM/YYYY (Indian standard), DD/MM/YY, and DD.MM.YYYY (used
  //    on legal notices and government memos, e.g. "13.09.2017"). Supports
  //    /, -, and . as separators; year may be 2- or 4-digit.
  {
    kind: "DATE",
    regex: /\b(\d{2}[/.\-]\d{2}[/.\-](?:\d{4}|\d{2}))\b/g,
    valueGroup: 1,
  },

  // 7. Monetary amounts — Rs./₹/INR followed by digits with optional
  //    thousands separators and decimals.
  {
    kind: "MONEY",
    regex:
      /((?:Rs\.?|₹|INR)\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)/gi,
    valueGroup: 1,
  },

  // 8. Multi-line address ending in a 6-digit Indian PIN code. Captured back
  //    to the previous comma or " — " separator. PIN codes never start with 0.
  //    This catches "Acharya Donde Marg, Parel, Mumbai — 400012" and
  //    "Flat 3B, Jagdamba CHS, Lalbaug, Mumbai — 400012".
  {
    kind: "ADDRESS",
    regex:
      /([A-Z][A-Za-z0-9.,/\- ]+?(?:[—-]\s*|,\s*)[1-9]\d{5})/g,
    valueGroup: 1,
  },

  // 9. Address by label cue — for short addresses without a PIN code, e.g.
  //    "Address: JHARGRAM (WEST MIDNAPOOR)". Captures the line content after
  //    "Address:" up to end-of-line (or two-space separator on multi-column
  //    headers). Restricted to ALL-CAPS or Title Case to avoid grabbing
  //    "Address as advised by doctor".
  {
    kind: "ADDRESS",
    regex:
      /(?:^|[ \t]*\b)Address\s*:\s+([A-Z][A-Z0-9 ()/,.\-']{4,}?)(?=\s{2,}[A-Z][a-z]+:|\s*$|\n)/gm,
    valueGroup: 1,
  },

  // 10. Person names introduced by ALL-CAPS-friendly header labels found on
  //     hospital and benefits documents:
  //       "Name of Patient: BIPLAB ROY"
  //       "Guardian's Name: BENOY KUMAR ROY"
  //       "Consultant's Name: Dr. GAUTAM MUKHOPADHYAY"
  //       "Patient Name: Mr. Ramesh Kumar"
  //     Captures up to four name tokens (Word, ALL-CAPS, or initial), tolerating
  //     an optional "Dr." / "Mr." prefix inside the value. Stops at end-of-line,
  //     at the next labelled column (single space "Sex: Male" or two-space
  //     "Sex: Male" — Gemini sometimes collapses column whitespace), or at a
  //     parenthesis (consultant role suffix like "(Consultant Onco Surgeon)").
  {
    kind: "NAME",
    regex:
      /\b(?:Patient\s*Name|Name\s*of\s*Patient|Guardian'?s?\s*Name|Consultant'?s?\s*Name|Name\s*of\s*MO\s*\/?\s*Consultant)\s*:\s+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Smt\.?|Shri)?\s*((?:[A-Z][A-Za-z]*\.?[ \t]*){1,5}?)(?=\s*$|\s+[A-Z][a-z]+\s*:|\s*\(|\n)/gm,
    valueGroup: 1,
  },

  // 11. "Patient was also seen on referral by: Dr. X and Dr. Y" — capture each
  //     doctor name after Dr./Mr./etc. inside a referral block. Listed before
  //     the generic NAME pattern so the doctor names get tokenised even when
  //     they are ALL-CAPS without a trailing Title-Case word.
  {
    kind: "NAME",
    regex:
      /\b(?:Dr|Mr|Mrs|Ms|Miss|Smt|Shri|Prof|Brig)\.?(?:[ \t]*\(Dr\.?\))?[ \t]+((?:[A-Z]\.?[ \t]+){0,3}[A-Z]{2,}(?:[ \t]+[A-Z]{2,}){0,3})\b/g,
    valueGroup: 1,
  },

  // 12. Person name with honorific cue, mixed-case form (e.g. "Mr. Ramesh
  //     Kumar", "Brig. (Dr.) S. B. Purkayastha"). Kept after the ALL-CAPS
  //     variant above so neither eats the other.
  {
    kind: "NAME",
    regex:
      /\b(?:Mr|Mrs|Ms|Miss|Dr|Smt|Shri|Prof|Brig)\.?(?:[ \t]*\(Dr\.?\))?[ \t]+((?:[A-Z](?:[a-z]+|\.)[ \t]*){1,4}[A-Z][a-z]+|(?:[A-Z](?:[a-z]+|\.)[ \t]*){1,4})/g,
    valueGroup: 1,
  },

  // 13. Devanagari-cue name — Hindi label "नाम" (name) followed by the value
  //     up to end-of-line or the next labelled field. Captures one to five
  //     Devanagari word tokens, tolerating an honorific (श्री / श्रीमती / डॉ.)
  //     immediately before the value. Defence-in-depth: LLM Pass 2 also
  //     enumerates these, but the regex pass catches Hindi-only documents
  //     before any text leaves the API route.
  {
    kind: "NAME",
    regex:
      /नाम\s*:\s*(?:श्री|श्रीमती|कुमारी|डॉ\.?|डा\.?)?\s*((?:[ऀ-ॿ]+[ \t]*){1,5})(?=\s*$|\s{2,}|\n|[।,])/gm,
    valueGroup: 1,
  },

  // 14. Devanagari-cue address — Hindi label "पता" (address). Captures the
  //     line content after the colon up to end-of-line or two-space column
  //     break. Devanagari range plus digits, common punctuation, and PIN.
  {
    kind: "ADDRESS",
    regex:
      /पता\s*:\s*([ऀ-ॿ0-9 ,./\-()]{4,}?)(?=\s*$|\s{2,}[ऀ-ॿ]+\s*:|\n)/gm,
    valueGroup: 1,
  },

  // 15. Devanagari-cue date — Hindi label "दिनांक" (date). Value is digit-based
  //     with /, -, or . separators; matches the same shapes as the Latin DATE
  //     pattern but anchored on the Hindi label so we redact even if the
  //     digit-only DATE rule above missed an unusual separator context.
  {
    kind: "DATE",
    regex: /दिनांक\s*:\s*(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2}))\b/g,
    valueGroup: 1,
  },

  // 16. Institutional name — ALL-CAPS line containing a recognisable suffix
  //     (HOSPITAL, COURT, CORPORATION, AUTHORITY, BOARD, MUNICIPALITY, OFFICE,
  //     COMMISSION, TRIBUNAL, UNIVERSITY, COLLEGE). Line-anchored so it
  //     doesn't grab paragraph-internal capitalisation. Allows leading
  //     whitespace because formal letterheads are typically centred/indented.
  {
    kind: "ORG",
    regex:
      /^[ \t]*([A-Z][A-Z .,&/'-]*(?:HOSPITAL|COURT|CORPORATION|AUTHORITY|BOARD|MUNICIPALITY|OFFICE|COMMISSION|TRIBUNAL|UNIVERSITY|COLLEGE|MUNICIPAL|NIGAM|SAMITI)[A-Z .,&/'-]*?)[ \t]*$/gm,
    valueGroup: 1,
  },
];
