# Spec Amendments (Phase 1)

Decisions taken in the review of `docs/SPEC.md`. Where this file and the spec
differ, **this file wins** until the changes are merged into the spec.
Items marked **Owner decision** were chosen by the project owner. Items marked
**Default (pending)** are my proposals, applied unless the owner objects.

## A. Owner decisions

| ID | Topic | Decision | Spec sections affected |
| :--- | :--- | :--- | :--- |
| A-1 | Closed months | Corrections to a closed month are never edits. They are entered as new rows posted in the current open month. `Delivery_Ledger` gets a **Posting Month** column (same rule as invoices) and calculations use it, not the delivery month, to place hours. `Billing_Ledger` hours and $ are **typed values** (copied from the invoice); the accrual schedule is a check against them, not the source. The "Closed period changed" banner stays as a backstop. | §2.3, §4.6, §4.7, §5 rows 7, 8, 10, §8.2 |
| A-2 | Rounding | **Monthly accrual hours are not rounded**: Monthly = `Term Hours ÷ Months in Term`, unrounded. The final-month hours true-up is no longer needed. Dollars remain `ROUND(hours × rate, 2)` per billing row. Effective rate is stored unrounded. | §4.5, D-9, principle 4 |
| A-3 | Close-out / decision timing | **Release after delivery.** In a close-out or decision month, delivery is recognized first. Close-out: from `Opening + Additions`, then `Breakage = remaining balance`. Decision: only the carried amount is protected for delivery, breakage is `Opening − Carried`. | §5 rows 5, 9, 12, §6.3, §6.5 |
| A-4 | Backdated rate change | Closed-month **dollars and journals never change**. Hours and backlog in gap months may be restated at the new term's rate (consistent with D-4). S2's "unchanged" means dollars. | §6.4, S2 |
| A-5 | Open item 1 | Ruled out: every engagement has its own Harvest project (D-8 is strict). Hours logged to the wrong engagement are moved with **paired manual adjustments** (−X / +X), each with a reason and approver. | §4.7, D-8 |
| A-6 | Open item 2 | **No time limit or escalation in the spreadsheet.** `Awaiting Renewal` is a status only. No Settings field. | §13.2, §6.4 |
| A-7 | Open item 3 / journals | **Two separate journals per month**: RR (Dr 102 / Cr 801) and Projects (Dr 200 / Cr 801). Each is balanced on its own. This amends D-11 (aggregated per account, now per journal). `Journal_Register` stores the two journals separately. | §7, §8.2, D-11 |
| A-8 | Protections | Everything is **warning-only**. Role restrictions in §8.3 are a manual post-build step. | §8.3 |

## B. Defaults (pending owner approval)

| ID | Topic | Proposed default |
| :--- | :--- | :--- |
| B-1 | Journal descriptions | Plain descriptions, no breakage text. Breakage and catch-up are shown in the supporting detail. (The answer to open item 3 did not say.) |
| B-2 | Journal check | Replace "debit ≤ Σ Available $" with `debit ≤ Σ (Opening $ + Additions $)` per journal. |
| B-3 | Variance tolerance | Billing variance is red only above a tolerance, default **$0.05**, editable in Settings. Needed because monthly invoices of $916.67 total $11,000.04 over 12 months. |
| B-4 | Hours precision | Hours kept at full precision. Backlog below 1e-9 hours is treated as zero. Display is 2dp. Burn thresholds compare on values rounded to 6dp so 50.00% and 80.00% trigger exactly. |
| B-5 | Invoice spanning two terms | Not allowed. One billing row covers months in one term only. A catch-up across a renewal is two rows. |
| B-6 | Credit notes | Negative `Billing_Ledger` rows are allowed, posted in the month the credit note is dated. Duplicate check ignores negative rows. |
| B-7 | Mid-term amendments | Modelled by splitting the term into two adjacent terms. Renewal fields on the second part are left blank. |
| B-8 | No covering term | Months before an engagement's first term produce no row values. After the last term with no close-out, the last term's rate is used and the flag is `GOOD-FAITH`. |
| B-9 | Decision month | `Decision Posting Month` must be on or after the new term's start month (validation). |
| B-10 | Eligible deficit | Documented assumption: recognition clears the oldest backlog first (FIFO). |
| B-11 | Months and dates | All month cells are first-of-month dates, shown `yyyy-mm`, with validation. |
| B-12 | Pace dates | `AM_Pace_Monitoring` uses an **As-of date** in Settings (default `=TODAY()`), so tests can fix it. |
| B-13 | Capacity | `Calc_Engine` is pre-built for 100 engagement slots × the horizon. A note in the workbook says to start a new cutover before the horizon ends. |
| B-14 | Extra checks | Add: unmapped Harvest project rows, unmatched billing rows, and a monthly `Σ Closing $` vs Xero balance input. |
| B-15 | Build script | Standalone Apps Script project (opens the sheet by ID), so the finished workbook contains no script. |
| B-16 | Tests | S7 and S8 are checked at workbook level in step 3. Engine tests in step 1 cover S1–S6. |
