-- Two statutory keys the payroll engine now reads (R3): how holiday overtime is paid (SRS Q13) and
-- which salary a day of unused leave is priced on (FR-PAY-18). The engine refuses to calculate
-- without them, and so does an offer preview, so they arrive with the deploy rather than waiting
-- for somebody to run the seed. Same rows as `seed-values.ts`, approved and unverified like every
-- seeded value, and only where the key has no version at all.
--
-- Only in a database that already holds statutory parameters: a fresh database (a new
-- environment, the test databases) gets the whole catalogue from the seed, which skips keys that
-- exist.
INSERT INTO "statutory_parameter" ("key", "value", "valid_from", "status", "legal_reference", "note", "is_verified")
SELECT v."key", v."value"::jsonb, v."valid_from"::date, 'approved', v."legal_reference", v."note", false
FROM (VALUES
  ('overtime.holiday_pay', '{"mode":"in_addition"}', '2021-01-01', 'Bộ luật Lao động 2019, Điều 98.1.c; Nghị định 145/2020/NĐ-CP, Điều 55 — SRS Q13', 'in_addition: hours worked on a public holiday are paid at the holiday multiplier on top of the holiday''s own salary, which the monthly salary already carries. inclusive: the multiplier includes that salary, so those hours are paid at the multiplier minus 100%. The chief accountant confirms the company''s reading (SRS Q13).'),
  ('leave.payout_basis', '{"salary":"base_plus_insurable_allowances"}', '2021-01-01', 'Bộ luật Lao động 2019, Điều 113.3; Nghị định 145/2020/NĐ-CP, Điều 67.3', 'A day of unused leave paid out on leaving is the salary under the labour contract of the month before the month of leaving, divided by that month''s normal working days. Seeded as the base salary plus the allowances that count towards the insurance base; the chief accountant confirms which allowances belong.')
) AS v("key", "value", "valid_from", "legal_reference", "note")
WHERE EXISTS (SELECT 1 FROM "statutory_parameter")
  AND NOT EXISTS (SELECT 1 FROM "statutory_parameter" p WHERE p."key" = v."key");
