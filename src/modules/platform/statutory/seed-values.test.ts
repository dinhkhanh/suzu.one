import { expect, it } from "vitest";
import { PARAMETER_KEYS, PARAMETERS } from "./catalogue";
import { STATUTORY_SEED } from "./seed-values";

it("seeds every parameter in the catalogue with a value of the right shape", () => {
  expect(STATUTORY_SEED.map((seed) => seed.key).sort()).toEqual([...PARAMETER_KEYS].sort());
  for (const seed of STATUTORY_SEED) expect(PARAMETERS[seed.key].safeParse(seed.value).success, seed.key).toBe(true);
});

it("rejects brackets that do not ascend or do not end open", () => {
  expect(PARAMETERS["pit.brackets"].safeParse([{ upTo: 10, rate: 500 }]).success).toBe(false);
  expect(PARAMETERS["pit.brackets"].safeParse([{ upTo: 30, rate: 500 }, { upTo: 10, rate: 1000 }, { upTo: null, rate: 2000 }]).success).toBe(false);
  expect(PARAMETERS["insurance.employee_rates"].safeParse({ bhxh: 8.5, bhyt: 150, bhtn: 100 }).success).toBe(false);
});
