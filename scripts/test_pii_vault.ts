// One-off test harness for the PII vault. Run with:
//   npx tsx scripts/test_pii_vault.ts
//
// Loads the mock discharge summary (benchmark §1), runs tokenise(), and prints:
//   - the redacted text (compare visually against benchmark §2)
//   - the vault map (compare against benchmark §2 table)
//   - a pass/fail summary against the expected vault entries
//
// This file is dev-only; not loaded by the Next runtime.

import { tokenise, reconstruct } from "../lib/pii_vault";

const MOCK_DOCUMENT = `═══════════════════════════════════════════════════════════════════
        SHRI VIVEKANAND MUNICIPAL HOSPITAL, MUMBAI
        Department of Cardiology
        Acharya Donde Marg, Parel, Mumbai — 400012
        Tel: 022-2410-XXXX  |  www.svmh-mumbai.gov.in
═══════════════════════════════════════════════════════════════════

                      DISCHARGE SUMMARY

UHID No.       : 8472913
Patient Name   : Mr. Ramesh Kumar
Age / Sex      : 52 / Male
Address        : Flat 3B, Jagdamba CHS, Lalbaug, Mumbai — 400012
Mobile         : +91 98202 17392
Aadhaar (last 4): XXXX-XXXX-7392

Date of Admission : 28/04/2026, 11:42 IST
Date of Discharge : 05/05/2026, 15:30 IST
Treating Unit     : Cardiology Unit-II
Bed Number        : CCU-04 → Ward 7-B-12

ADMITTING DIAGNOSIS
───────────────────
Acute ST-Elevation Myocardial Infarction (STEMI) — Anterior Wall

FOLLOW-UP
─────────
Cardiology OPD on 19/05/2026 (Tuesday) at 10:00 AM with
Dr. Anand Kulkarni, OPD Block, 2nd Floor, Room 207.

INVESTIGATIONS REQUIRED BEFORE FOLLOW-UP
─────────────────────────────────────────
On 17/05/2026, get the following done at any registered laboratory:
   - Lipid Profile (Fasting)
   - HbA1c
   - Serum Creatinine and eGFR

EMERGENCY CONTACTS
──────────────────
Cardiac Care Unit, SVMH       : 022-2410-1208 (24×7)
Ambulance                     : 108

Treating Consultant
Dr. Anand Kulkarni, MD, DM (Cardiology)
Senior Cardiologist
Reg. No. MMC-2010-12345
                                                    [Signature]
`;

interface ExpectedVaultEntry {
  token: string;
  value: string;
}

const EXPECTED_VAULT: ExpectedVaultEntry[] = [
  { token: "[ORG_001]", value: "SHRI VIVEKANAND MUNICIPAL HOSPITAL, MUMBAI" },
  { token: "[ADDRESS_001]", value: "Acharya Donde Marg, Parel, Mumbai — 400012" },
  { token: "[ADDRESS_002]", value: "Flat 3B, Jagdamba CHS, Lalbaug, Mumbai — 400012" },
  { token: "[PHONE_001]", value: "022-2410-XXXX" },
  { token: "[PHONE_002]", value: "+91 98202 17392" },
  { token: "[UHID_001]", value: "8472913" },
  { token: "[NAME_001]", value: "Ramesh Kumar" },
  { token: "[NAME_002]", value: "Anand Kulkarni" },
  { token: "[AADHAAR_001]", value: "XXXX-XXXX-7392" },
  { token: "[REGNO_001]", value: "MMC-2010-12345" },
  { token: "[DATE_001]", value: "28/04/2026" },
  { token: "[DATE_002]", value: "05/05/2026" },
  { token: "[DATE_003]", value: "19/05/2026" },
  { token: "[DATE_004]", value: "17/05/2026" },
];

function main(): void {
  const { redacted, vault } = tokenise(MOCK_DOCUMENT);

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(" REDACTED TEXT (what leaves the API route for non-vision LLM calls)");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(redacted);

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(" VAULT MAP (token -> real value)");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const [token, value] of vault.entries()) {
    console.log(`  ${token.padEnd(18)} -> ${value}`);
  }

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(" CHECKS vs benchmark §2");
  console.log("═══════════════════════════════════════════════════════════════════");
  let pass = 0;
  let fail = 0;
  for (const exp of EXPECTED_VAULT) {
    const actual = vault.get(exp.token);
    if (actual === exp.value) {
      console.log(`  PASS  ${exp.token.padEnd(18)} = ${actual}`);
      pass++;
    } else {
      console.log(
        `  FAIL  ${exp.token.padEnd(18)} expected: ${exp.value}\n        got:      ${actual ?? "<missing>"}`,
      );
      fail++;
    }
  }
  console.log(`\n  ${pass}/${EXPECTED_VAULT.length} passed, ${fail} failed.`);

  // Round-trip check.
  const restored = reconstruct(redacted, vault);
  const roundTrip = restored === MOCK_DOCUMENT;
  console.log(`  Round-trip reconstruct() == original?  ${roundTrip ? "PASS" : "FAIL"}`);
  if (!roundTrip) {
    console.log("\n  Diff (first 500 chars where they differ):");
    for (let i = 0; i < Math.max(restored.length, MOCK_DOCUMENT.length); i++) {
      if (restored[i] !== MOCK_DOCUMENT[i]) {
        console.log(`    at index ${i}:`);
        console.log(`      original: ${JSON.stringify(MOCK_DOCUMENT.slice(i, i + 80))}`);
        console.log(`      restored: ${JSON.stringify(restored.slice(i, i + 80))}`);
        break;
      }
    }
  }
}

main();

// ─── Bengal hospital format test (real-world page 2) ─────────────────────────
// This second case uses the BIPLAB ROY discharge summary header style we
// observed in demo_assets/discharge_real_page2.png. It is the canonical test
// for the ALL-CAPS name and IP/Bed/DD-MM-YY fixes.

const BENGAL_DOC = `IP. Number: 728819 Admission Date: 18/04/2011 Discharge Date: 07/05/2011
Bed No.: 3042 Admission Time: 10:28 a.m. Discharge Time: P
Name of Patient: BIPLAB ROY                       Sex: Male
Age: 36 years
Guardian's Name: BENOY KUMAR ROY
Address: JHARGRAM (WEST MIDNAPOOR)
Telephone #: 9830484636
Consultant's Name: Dr. GAUTAM MUKHOPADHYAY (Consultant Onco Surgeon)

Patient was also seen on referral by: Dr. TAPAN KUMAR DASS (Consultant Physician) and Dr. M. B. DAS (Consultant Cardiothoracic Surgeon)

Operative Note: Total radical oesophagectomy done on 21/04/11.
`;

const BENGAL_EXPECTED: ExpectedVaultEntry[] = [
  { token: "[UHID_001]", value: "728819" },
  { token: "[UHID_002]", value: "3042" },
  { token: "[DATE_001]", value: "18/04/2011" },
  { token: "[DATE_002]", value: "07/05/2011" },
  { token: "[DATE_003]", value: "21/04/11" },
  { token: "[PHONE_001]", value: "9830484636" },
  { token: "[NAME_001]", value: "BIPLAB ROY" },
  { token: "[NAME_002]", value: "BENOY KUMAR ROY" },
  { token: "[NAME_003]", value: "GAUTAM MUKHOPADHYAY" },
  { token: "[NAME_004]", value: "TAPAN KUMAR DASS" },
  { token: "[NAME_005]", value: "M. B. DAS" },
  { token: "[ADDRESS_001]", value: "JHARGRAM (WEST MIDNAPOOR)" },
];

console.log("\n");
console.log("═══════════════════════════════════════════════════════════════════");
console.log(" SECOND TEST CASE: Bengal hospital format (BIPLAB ROY-style)");
console.log("═══════════════════════════════════════════════════════════════════");
const bengalResult = (function runBengal() {
  const { redacted, vault } = tokenise(BENGAL_DOC);

  console.log("\n REDACTED:");
  console.log(redacted);

  console.log("\n VAULT:");
  for (const [token, value] of vault.entries()) {
    console.log(`  ${token.padEnd(18)} -> ${value}`);
  }

  console.log("\n CHECKS:");
  let pass = 0;
  let fail = 0;
  for (const exp of BENGAL_EXPECTED) {
    const actual = vault.get(exp.token);
    if (actual === exp.value) {
      console.log(`  PASS  ${exp.token.padEnd(18)} = ${actual}`);
      pass++;
    } else {
      console.log(
        `  FAIL  ${exp.token.padEnd(18)} expected: ${exp.value}\n        got:      ${actual ?? "<missing>"}`,
      );
      fail++;
    }
  }
  console.log(`\n  ${pass}/${BENGAL_EXPECTED.length} passed, ${fail} failed.`);

  const restored = reconstruct(redacted, vault);
  const roundTrip = restored === BENGAL_DOC;
  console.log(`  Round-trip reconstruct() == original?  ${roundTrip ? "PASS" : "FAIL"}`);
  return { pass, fail };
})();

if (bengalResult.fail > 0) process.exit(1);
