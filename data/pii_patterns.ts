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

  // 5. UHID (hospital patient ID) — captured by the label, not by shape, since
  //    the digits alone are indistinguishable from any other number. Same for
  //    "MR No.", "Patient ID", "OPD No.".
  {
    kind: "UHID",
    regex: /\b(?:UHID(?:\s*No\.?)?|MR\s*No\.?|Patient\s*ID|OPD\s*No\.?)\s*:\s*([A-Z0-9-]+)\b/gi,
    valueGroup: 1,
  },

  // 6. Dates in DD/MM/YYYY (Indian standard). Also supports DD-MM-YYYY.
  //    Two-digit years are out of scope — discharge summaries always use four.
  {
    kind: "DATE",
    regex: /\b(\d{2}[/-]\d{2}[/-]\d{4})\b/g,
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

  // 9. Person name with honorific cue. Captures one to four capitalised tokens
  //    after a title; tokens may be full words ("Ramesh") or single-letter
  //    initials ("S.", "B."). The honorific itself is preserved in output;
  //    only the name is tokenised.
  //    Examples (capture group only, not the title):
  //      "Mr. Ramesh Kumar"               -> "Ramesh Kumar"
  //      "Dr. Anand Kulkarni"             -> "Anand Kulkarni"
  //      "Brig. (Dr.) S. B. Purkayastha"  -> "S. B. Purkayastha"
  {
    kind: "NAME",
    regex:
      /\b(?:Mr|Mrs|Ms|Miss|Dr|Smt|Shri|Prof|Brig)\.?(?:[ \t]*\(Dr\.?\))?[ \t]+((?:[A-Z](?:[a-z]+|\.)[ \t]*){1,4}[A-Z][a-z]+|(?:[A-Z](?:[a-z]+|\.)[ \t]*){1,4})/g,
    valueGroup: 1,
  },

  // 10. Institutional name — ALL-CAPS line containing a recognisable suffix
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
