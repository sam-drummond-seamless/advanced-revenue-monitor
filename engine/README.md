# engine/

Reference implementation of `docs/SPEC.md` sections 5 and 6, with `docs/SPEC-AMENDMENTS.md` applied.
It is the source of truth for expected results: `test-data/` fixtures and the sheet formulas are checked against it.

```bash
cd engine && npm install && npm test       # vitest
npm run typecheck                          # tsc --noEmit
```

## Layout

| File | Purpose |
| :--- | :--- |
| `src/calc.ts` | `runEngine`: the monthly calculation (spec 5, 6.1-6.6) for every engagement x month |
| `src/accrual.ts` | Accrual schedule and billing checks (spec 4.5, 4.6; A-2, B-3) |
| `src/burn.ts` | Burn rate, pace, tags (spec 6.7) |
| `src/journal.ts` | Two journals per month: RR and Projects (A-7, B-2) |
| `src/status.ts` | `Active` / `Awaiting Renewal` / `Closed` |
| `src/validate.ts` | Input rules (overlaps, cadence, decision month, one-term invoices, duplicates) |
| `test/s1-s2.test.ts` ... `s5-s6.test.ts` | Acceptance scenarios S1-S6 |
| `test/units.test.ts` | Rounding, months, accrual, status, validation, seeded fuzz of the invariants |

Money is integer cents; hours are unrounded numbers (A-2). Rounding matches Sheets `ROUND` (half away from zero).
S7 and S8 are workbook-level behaviours and are tested in step 3.

## Interpretations the spec leaves open

These are implemented as below and are called out for review.

1. **Decision month (A-3).** Delivery is recognized first from `Opening + Additions`. Additions are assumed consumed first, so the old balance still held is `MIN(Opening, remaining)`. Carried = `MIN(old balance, surplus hrs x new rate)`; breakage is the rest. With no delivery in the month this is exactly S4.
2. **Close-out month (A-3).** Delivery is recognized first, then all remaining $ is breakage and all remaining backlog is forgiven.
3. **`CATCH-UP` flag** follows spec 5 row 16 literally, so it also appears in S1 months 2 and 3 (funds clearing earlier backlog).
4. **`GOOD-FAITH`** = the month has work (delivery or backlog) and no invoice for the covering term has been posted yet (invoices are attributed to a term by `coversFrom`). This keeps S2's Aug-Oct flags the same before and after the backdated term is entered; a literal "no term covers m" rule would not.
5. **`PROJECT CAP`** replaces `OVER-SERVICED` for Projects.
6. **Pre-term activity** uses the first term's rate instead of being dropped (extends B-8, so no money is lost).
7. **Closed engagements**: after the close-out month, rows are zero and any later activity is ignored with a warning.
8. **Burn entitlement** uses the approved surplus hours as typed (spec 6.7), even if carried $ was capped by the balance.
