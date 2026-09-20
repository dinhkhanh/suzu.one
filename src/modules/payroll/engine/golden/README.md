# Golden payroll cases

Every `.json` file in this folder is one payroll case: a person, a month, and the figures the
engine must produce to the đồng. `golden.test.ts` picks up whatever is here — **adding a case is
dropping a file in**, nothing else changes.

## The cases here today are synthetic

The real payroll Excel files did not exist when the engine was written, so each case was invented
and its expected figures worked out **by hand** from SRS Appendix A and the values `pnpm db:seed`
seeds into the statutory parameter store. Every file says so in `"source"`, and its `derivation`
holds the arithmetic step by step, so a reviewer can check the expectation without running the
code.

They are not a substitute for the real thing. The phase's exit criterion is that the golden tests
match the existing Excel payroll to the đồng.

## Adding a real case

1. Take one person's month out of the accountant's spreadsheet.
2. Anonymise it: no name, no employee code, no tax code, no bank account. `personId` is generated
   from the file name and never read.
3. Write the file, e.g. `20-szm-2026-07-nguyen-a.json` — keep a number prefix so the order is stable.
4. Fill `derivation` with how the spreadsheet got there (or "from the entity's July 2026 sheet,
   row 14" when the sheet itself is the authority), and set `"source"` to where it came from.
5. Put the spreadsheet's own figures in `expect`. Only the keys you give are checked, so a case
   may check nothing but the net if that is all that was agreed.
6. Run `pnpm test golden`. A difference is either a bug in the engine or an error in the
   spreadsheet — the parallel run (FR-PAY-38) exists to tell those apart, and the answer is
   recorded in the phase note, never papered over by editing the expectation.

## What a fixture may leave out

The statutory snapshot, the pay component catalogue and the pay policy come from the seed, so a
file says only what makes its case different:

| Field | Default |
|---|---|
| `policy` | `DEFAULT_PAYROLL_POLICY` (working-day pro-rating, 8 h/day, no union, Simple profile untaxed) |
| `profile` | statutory, resident, progressive PIT, no exemption, not a union member |
| `employment` | no dependants, 12 months of service, employed all month |
| `wageRegion` | I |
| statutory values | `STATUTORY_SEED` as at the end of the month |
| components | the 30 starter components of `seed-components.ts` |

`monthStandardDays` is the working days the **month** asks of a full-time person — the divisor. It
is deliberately separate from the person's own `timesheet.standardDays`, which is smaller for a
joiner or a leaver.
