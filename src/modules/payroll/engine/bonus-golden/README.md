# Golden year-end bonus cases (FR-PAY-21)

Every `.json` file here is one person's year-end bonus with the arithmetic **worked out by hand**
in its `derivation` field, and `bonus.test.ts` checks the engine reproduces it.

A case is:

```jsonc
{
  "name": "what the case is about",
  "source": "synthetic",              // or "anonymised — 2027 run, person 41"
  "derivation": ["the arithmetic, step by step, in words"],
  "schemePatch": { "capMultiplierBp": 15000 },  // merged over DEFAULT_BONUS_SCHEME, top level
  "person": { "baseSalaryVnd": 20000000, "serviceMonths": 24, ... },
  "expect": { "computedAmountVnd": 20000000, ... }
}
```

Adding a real, anonymised case is dropping in a file: no code changes. Keep the `derivation`
long enough that a reviewer can check the figures without running anything — a case nobody wrote
down cannot be reviewed, and the test refuses a short one.
