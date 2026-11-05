# Advanced Revenue Delivery Tracker — Phase 1 Specification

| | |
| :--- | :--- |
| **Status** | Draft for review |
| **Supersedes** | Product Requirements Prompt (PRP) v1 |
| **Platform** | Google Sheets, formulas only at runtime (no Apps Script in the live workbook) |
| **Scale** | < 50 active contracts, ex-GST, single currency |

This spec turns the original PRP into buildable rules. Where the PRP was
ambiguous or contradictory, the decision taken is recorded in
[§11 Decision Log](#11-decision-log).

---

## 1. Scope

### 1.1 In scope

The tracker covers revenue invoiced in advance and earned as hours are delivered:

| Revenue type | Billing | Deferred (balance sheet) | Earned (P&L) |
| :--- | :--- | :--- | :--- |
| Effort-Based Recurring Revenue (RR) | Monthly or annually in advance | **102** — Deferred Revenue (Recurring) | **801** — Advanced Revenue |
| Prepaid Projects | 100% upfront, never renews | **200** — Deferred Revenue (Prepaid Projects) | **801** — Advanced Revenue |

### 1.2 Out of scope

- FME (software / pass-through) and Value-Based RR. These are recognized on
  invoice and never enter the tracker. Only the **effort-based portion** of a
  contract's value is entered.
- Phase 2 (Harvest API import) and Phase 3 (Xero journal API). The data model
  is designed so these can be added later without restructuring (§10).

---

## 2. Core Principles

1. **One recognition rule.** Every month, for every engagement:
   `Recognized $ = MIN(Available $, (Delivered hrs + Backlog hrs) × Rate)`.
   Deficit absorption, over-servicing caps, the project cap and the
   delayed-renewal catch-up all follow from this one rule. None of them is a
   separate mechanism.
2. **Never below zero.** Deferred balances can never go negative. Delivery
   that the available balance can't cover becomes **backlog hours**, which are
   tracked but not recognized.
3. **Posting-month principle.** Every input that changes money carries the
   **month in which it is booked**, not the month it relates to. Invoices,
   renewal decisions, close-outs and manual adjustments are all booked this
   way. A late invoice or a backdated renewal therefore never changes a closed
   month; its effect lands in the current month as a catch-up.
4. **Hours drive, dollars follow.** Inputs are in hours. Dollars are always
   `hours × the term's effective rate`, rounded to cents.
5. **Formulas protected, inputs separated.** Every tab is either an *input* tab
   (people type here) or a *calculated* tab (formulas only, protected).

---

## 3. Key Concepts

| Term | Meaning |
| :--- | :--- |
| **Client** | A customer, identified by name. Names come from one master list and are always picked from a dropdown. |
| **Engagement** | A continuous revenue stream with one client in one deferred account. An RR retainer is one engagement across all its renewals. Each prepaid project is its own engagement. The running balance is kept **per engagement**. |
| **Term** | One contract period of an engagement (e.g. an RR year, or the whole project). Each term has its own hours, value and rate. |
| **Effective rate** | `Effort-based term value ÷ Term hours`. Default $220/hr, but always calculated per term. |
| **Accrual** | Hours scheduled to be added to the pool in a calendar month, based on billing cadence. |
| **Available $** | `Opening deferred $ + Additions $ this month`. |
| **Backlog hrs** | Hours delivered but not yet recognized because no funds covered them (over-servicing or good-faith delivery). |
| **Breakage** | Unused deferred dollars released to revenue when a term closes without them being carried over. |

---

## 4. Workbook Architecture

```
 INPUT TABS                                   CALCULATED TABS (protected)
 ──────────                                   ───────────────────────────
 Settings ─────────────┐
 Clients ──────────────┤
 Engagements ──────────┤
 Contract_Terms ───────┼──► Accrual_Schedule ──┐
 Billing_Ledger ───────┤                       ├──► Calc_Engine ──┬──► Monthly_Reconciliation
 Delivery_Ledger ──────┤                       │                  ├──► AM_Pace_Monitoring
 Opening_Balances ─────┘───────────────────────┘                  └──► Journal_Register (check)
```

### 4.1 `Settings` (Finance only)

| Field | Example | Notes |
| :--- | :--- | :--- |
| Default rate | 220.00 | Pre-fills new terms only. Never used in calculations. |
| RR deferred account | 102 | |
| Project deferred account | 200 | |
| Earned revenue account | 801 | Credit side for both types. |
| Cutover month | 2026-07 | First month the tracker calculates. |
| Calc horizon (months) | 60 | How many months Calc_Engine generates from cutover. |
| Last closed month | 2026-09 | Updated by Finance after posting each month's journal (§8). |
| Burn alert thresholds | 50% / 80% | |
| Xero balance at cutover — 102 | | For the cutover control check (§9). |
| Xero balance at cutover — 200 | | |

### 4.2 `Clients`

One column: **Client Name** (unique). It is the source for every client
dropdown. Renaming a client is done here only.

### 4.3 `Engagements`

| Column | Input / Formula | Notes |
| :--- | :--- | :--- |
| Engagement Name | Input | Unique. Convention: client name, plus a suffix when needed (e.g. `Acme`, `Acme – Website Rebuild`). |
| Client | Dropdown (`Clients`) | |
| Type | Dropdown: `RR`, `Project` | |
| Deferred Account | Formula | `RR → 102`, `Project → 200`. |
| Harvest Project | Input | Must match the Harvest project name exactly. One Harvest project per engagement. |
| Status | Formula | `Active`, `Awaiting Renewal`, `Closed` (derived, §6.4). |

### 4.4 `Contract_Terms`

One row per term. Renewals add a new row to the same engagement.

| Column | Input / Formula | Who | Notes |
| :--- | :--- | :--- | :--- |
| Engagement | Dropdown | AM | |
| Term Start | Date (1st of month) | AM | For a delayed renewal, this is the **backdated** start date. |
| Term End | Date (last day of month) | AM | |
| Billing Cadence | Dropdown: `Monthly`, `Annual`, `Upfront` | AM | `Upfront` is for projects. |
| Term Hours | Number | AM | |
| Effort-Based Value ($) | Number | AM | Effort-based portion only. |
| Effective Rate | Formula | — | `Value ÷ Hours`. |
| Months in Term | Formula | — | |
| **Renewal Decision** (for the *previous* term) | | | |
| Decision Posting Month | Month | Finance | The month the decision is booked. Blank = not yet decided. |
| `[+]` Approved Surplus Hours Rolled In | Number ≥ 0 | Finance | Hours, at **this** term's rate (§6.3). |
| `[−]` Deficit Hours Deducted | Number ≥ 0 | Finance | Capped at the eligible deficit (§6.3). |
| Admin Notes / Commercial Justification | Text | Finance | Required if either hours field is non-zero. |
| Approved By | Dropdown (CEO/COO/Finance) | Finance | |
| **Close-out** (no renewal / project complete) | | | |
| Close-out Posting Month | Month | Finance | Releases breakage and forgives backlog (§6.5). |

Validations:
- Terms of the same engagement must not overlap.
- `Upfront` cadence only for `Project` engagements. Projects have exactly one
  term and no renewal fields.

### 4.5 `Accrual_Schedule` (calculated)

A wide grid matching today's sheet layout: one row per term, one column per
calendar month. Each cell shows the hours that term **should** add in that
month:

| Cadence | Accrual rule |
| :--- | :--- |
| Monthly | `ROUND(Term Hours ÷ Months in Term, 2)` each month. **Final month = Term Hours − sum of earlier months**, so the term always totals exactly (fixes the 4.17 × 12 = 50.04 drift). |
| Annual | All term hours in the term's start month. |
| Upfront | All term hours in the term's start month. |

Conditional formatting shows whether each accrual has been invoiced (from
`Billing_Ledger`): **green** = invoiced, **amber** = due and not invoiced,
**grey** = future.

The schedule is a plan only. **Pool additions come only from `Billing_Ledger`.**

### 4.6 `Billing_Ledger` (EA)

One row per invoice raised. It is append-only.

| Column | Input / Formula | Notes |
| :--- | :--- | :--- |
| Invoice Posting Month | Month | Month the invoice is dated in Xero. This is when the funds count. |
| Engagement | Dropdown | |
| Covers From / Covers To | Month | Accrual months this invoice covers. A catch-up invoice for a delayed renewal covers several months in one row. |
| Hours Added | Formula | Sum of `Accrual_Schedule` for the engagement over the covered months. |
| Amount Added ($) | Formula | `Hours × term rate`. |
| Xero Invoice # | Input | |
| Xero Effort-Based Amount ($) | Input | EA types the effort-based amount from the invoice. |
| Variance | Formula | `Xero amount − Amount Added`. Flags red if ≠ 0. |
| Duplicate Check | Formula | Flags red if a covered month is already covered by another row. |

This is the "EA ticks invoiced" decision, recorded with the month it
happened (§11, D-7).

### 4.7 `Delivery_Ledger` (Team Leads)

Long format: one row per engagement per delivery month.

| Column | Input / Formula | Notes |
| :--- | :--- | :--- |
| Delivery Month | Month | |
| Harvest Project | Dropdown | Maps to an engagement via `Engagements`. |
| Engagement | Formula | Lookup. |
| Harvest Billable Hours | Number | Billable hours only. |
| Manual Adjustment Hours | Number (±) | |
| Adjustment Reason | Text | Required when the adjustment ≠ 0. |
| Approved By | Dropdown | Required when the adjustment ≠ 0. |
| Net Delivered Hours | Formula | `Harvest + Adjustment`. |

**Corrections to closed months** are not edits. Enter them as a manual
adjustment in the current open month, with the reason referencing the
original month.

### 4.8 `Opening_Balances` (Finance, once at cutover)

One row per engagement active at cutover:

| Column | Notes |
| :--- | :--- |
| Engagement | |
| Opening Deferred $ | Balance at the start of the cutover month. |
| Opening Backlog Hours | Unrecognized delivered hours carried in. |
| Term Hours Consumed Before Cutover | For burn rate on the current term. |
| Term Hours Invoiced Before Cutover | So `Billing_Ledger` doesn't need history before cutover. |

### 4.9 `Calc_Engine` (calculated, hidden from non-Finance)

A long table with one row per **engagement × month**, from the cutover month
for the configured horizon. With 50 engagements × 60 months that is 3,000 rows.
Rows are grouped by engagement, in month order, so each row reads its opening
values from the row directly above. All columns are formulas. The column logic
is defined in §5.

### 4.10 Output tabs

- **`Monthly_Reconciliation`** — select a month and see each engagement's
  three-point reconciliation, the catch-up amount, flags, and the journal block
  (§7).
- **`AM_Pace_Monitoring`** — burn rate, pace, projected run-out and renewal
  status per active term (§6.6).
- **`Journal_Register`** — Finance pastes the **posted** journal values (as
  values) after posting. It is used to detect changes to history (§8).

---

## 5. Monthly Calculation (per engagement, per month)

Let *m* be the month, and let the term covering *m* be the term whose
`Start ≤ m ≤ End`. If no term covers *m* (an unsigned renewal gap), use the
most recent prior term.

| # | Column | Formula |
| :--- | :--- | :--- |
| 1 | Rate | Effective rate of the covering term. |
| 2 | Opening $ | Prior month's Closing $ (from `Opening_Balances` at cutover). |
| 3 | Opening Backlog hrs | Prior month's Closing Backlog (from `Opening_Balances` at cutover). |
| 4 | Renewal Carryover $ (+/−) | See §6.3. Applies only in a Decision Posting Month. |
| 5 | Breakage $ | See §6.3 / §6.5. Released in a Decision or Close-out Posting Month. |
| 6 | Backlog Forgiven hrs | See §6.3 / §6.5. |
| 7 | Additions $ | Sum of `Billing_Ledger` Amount Added where Posting Month = *m*. |
| 8 | Additions hrs | Same, in hours. |
| 9 | **Available $** | `Opening $ − Breakage $ + Additions $` |
| 10 | Delivered hrs | Sum of `Delivery_Ledger` Net Delivered Hours for *m*. |
| 11 | Demand hrs | `Opening Backlog − Backlog Forgiven + Delivered` |
| 12 | **Recognized $ (delivery)** | `MIN(Available $, ROUND(Demand hrs × Rate, 2))` |
| 13 | Recognized hrs | `Recognized $ ÷ Rate` |
| 14 | **Closing $** | `Available $ − Recognized $` (always ≥ 0) |
| 15 | **Closing Backlog hrs** | `Demand hrs − Recognized hrs` (always ≥ 0) |
| 16 | Catch-up $ | `MAX(0, Recognized $ − ROUND(Delivered hrs × Rate, 2))`: the part of this month's revenue that clears earlier backlog. |
| 17 | **Total Revenue $** | `Recognized $ + Breakage $` → the journal amount for this engagement. |
| 18 | Flags | `OVER-SERVICED` if Closing Backlog > 0 and a term is active; `GOOD-FAITH` if no term covers *m*; `CATCH-UP` if Catch-up $ > 0; `PROJECT CAP` if a Project has Closing Backlog > 0. |

Because the backlog is in hours and is recognized at the **current** term's
rate, good-faith hours worked during a delayed renewal are valued at the
renewed contract's rate.

---

## 6. Business Rules

### 6.1 Pool replenishment

The pool grows only when the EA logs an invoice in `Billing_Ledger`. A
scheduled accrual that hasn't been invoiced adds nothing. That's how a delayed
renewal leaves the pool at $0.

### 6.2 Over-servicing and deficit absorption (within a term)

When delivery exceeds the available balance, the excess goes into backlog. The
next invoice's dollars **first** clear the backlog (step 11 → 12) before any
balance is left over. This needs no admin action and gives the PRP §4.3
behaviour directly.

### 6.3 Renewal (term N → term N+1)

The renewal decision is entered on the **new** term's row and takes effect in
its **Decision Posting Month** (*P*).

**Surplus.** Let `L` = Opening $ in month *P* (the unused balance still held).
- `Carried $ = MIN(L, Approved Surplus Hours × new rate)`.
- `Breakage $ = L − Carried $`. It is released to 801 in month *P*.
- Finance chooses the surplus hours. If the rate changes, they adjust the hours
  so that the carried dollars match the liability they intend to keep (PRP §5.1).

**Deficit.** Only backlog that came from the *old* term can be forgiven.
Good-faith hours worked in months covered by the new (backdated) term are
always kept.
- `Eligible Deficit hrs = MAX(0, Opening Backlog(P) − Delivered hrs in months [new Term Start … P−1])`
- `Deficit Hours Deducted` is capped at the Eligible Deficit.
- `Backlog Forgiven hrs = Eligible Deficit − Deficit Hours Deducted`. These are
  removed and are **never** recognized.
- Deducted hours stay in backlog, so they are recognized from the new term's
  funds as they arrive. They also count as consumed for the new term's burn
  rate (§6.6).

**Until the decision is entered**, nothing is released or forgiven. The old
balance stays available for good-faith delivery, and the engagement shows
`Awaiting Renewal` once the old Term End has passed.

### 6.4 Delayed renewal and good-faith delivery

1. The old term ends. The AM sees `Awaiting Renewal` in `AM_Pace_Monitoring`.
2. Delivery continues. Any old unused balance is used first, then hours build
   up in backlog. The revenue journal shows $0 for that engagement (PRP Option A).
3. The renewal is signed. The AM adds the new term row with the **backdated**
   start date. Because no invoice exists for those months yet, earlier
   calculations don't change.
4. The EA raises the catch-up invoice and logs **one** `Billing_Ledger` row that
   covers all elapsed months, posted in the current month.
5. In the current month, Recognized $ = this month's delivery + all good-faith
   backlog, capped at available funds. That is the single catch-up journal. No
   closed month changes.

### 6.5 Close-out (no renewal, client churn, or project complete)

Enter a **Close-out Posting Month** on the term. In that month:
- `Breakage $ = Opening $`, which releases the whole remaining balance to 801.
- `Backlog Forgiven hrs = Opening Backlog`. Over-servicing is written off
  operationally, with no journal.
- After that, the engagement is `Closed` and its balances stay at zero.

### 6.6 Projects

- One term, `Upfront` cadence, account 200, no renewal fields.
- The cap is automatic: a project never receives further additions, so any
  delivery beyond the prepaid pool goes to backlog and is never recognized.
  It is flagged `PROJECT CAP`.
- When work finishes, Finance enters Close-out. Any unused balance is released
  as breakage.

### 6.7 Burn rate and pace (per active term)

| Metric | Formula |
| :--- | :--- |
| Entitlement hrs | `Term Hours + Approved Surplus Hours` |
| Consumed hrs | `Deficit Hours Deducted + Delivered hrs in term months (+ pre-cutover consumed)` |
| **Burn %** | `Consumed ÷ Entitlement` |
| Time elapsed % | `Months elapsed in term ÷ Months in Term` |
| Pace gap | `Burn % − Time elapsed %` (positive = ahead of the calendar) |
| Projected run-out | `Today + (Entitlement − Consumed) ÷ trailing 3-month avg delivered hrs` |

| Burn % | Tag |
| :--- | :--- |
| < 50% | — |
| ≥ 50% | 🟡 **50% Milestone**: review pace against elapsed time |
| ≥ 80% | 🔴 **80% Exhaustion Warning**: start renewal or change-order discussion |
| ≥ 100% | ⛔ **Exhausted** |

---

## 7. Xero Journal Block

`Monthly_Reconciliation` produces one aggregated manual journal for the
selected month:

| Account | Description | Debit | Credit |
| :--- | :--- | ---: | ---: |
| 102 | Release of deferred RR — *Mon YYYY* | Σ Total Revenue $ (RR engagements) | |
| 200 | Release of deferred projects — *Mon YYYY* | Σ Total Revenue $ (Project engagements) | |
| 801 | Advanced revenue earned — *Mon YYYY* | | Σ of both |

- Breakage and catch-up are included in the totals. The supporting detail per
  engagement is shown directly below the block.
- A line with a zero amount is hidden.
- Check: Debits = Credits, and each debit ≤ the sum of Available $ for that account.

---

## 8. Period Close and Protection

### 8.1 Monthly close procedure (Finance)

1. Confirm that `Delivery_Ledger` and `Billing_Ledger` are complete for the month.
2. Review `Monthly_Reconciliation` flags.
3. Post the journal in Xero.
4. Paste the posted journal lines into `Journal_Register` **as values**.
5. Set `Settings › Last closed month` to this month.
6. Manually add a protected range over that month's `Delivery_Ledger` rows.

### 8.2 History change detection

For every closed month, `Monthly_Reconciliation` compares the recalculated
journal with `Journal_Register`. Any difference shows a red banner:
**"Closed period changed — recalculated journal no longer matches posted journal."**
Without scripts, this is the guardrail that catches back-dated edits.

### 8.3 Protected ranges

| Range | Protection |
| :--- | :--- |
| `Settings`, all formula columns, `Accrual_Schedule`, `Calc_Engine`, output tabs | Warning-only, with the message: *"Caution: This cell contains core revenue recognition logic. Edit only with Finance/COO authorization."* |
| Closed-month rows in `Delivery_Ledger` and `Billing_Ledger` | Restricted to Finance (added at close). |
| Renewal decision and close-out columns in `Contract_Terms` | Restricted to CEO/COO/Finance. |

### 8.4 Role matrix

| Role | Edits | Monitors |
| :--- | :--- | :--- |
| EA | `Billing_Ledger` | Variance and duplicate flags, amber accruals |
| Team Leads | `Delivery_Ledger` | Over-serviced flags |
| AMs | `Engagements`, `Contract_Terms` (term details) | `AM_Pace_Monitoring` |
| CEO / COO / Finance | `Settings`, renewal decisions, close-outs, `Opening_Balances`, `Journal_Register` | Everything |

---

## 9. Cutover

1. Pick the cutover month and enter it in `Settings`.
2. Load `Clients`, `Engagements` and current `Contract_Terms` from the legacy sheet.
3. Enter `Opening_Balances` for each engagement.
4. **Control check:** Σ Opening $ for RR = Xero 102 balance, and Σ Opening $
   for projects = Xero 200 balance. It shows red until both tie to the cent.
5. Run one month in parallel with the legacy sheet before switching over.

---

## 10. Repository Deliverables

| Path | Contents |
| :--- | :--- |
| `docs/SPEC.md` | This document. |
| `engine/` | Reference implementation of §5–§6 as plain code, with automated tests. It is the source of truth for expected results. |
| `test-data/` | Synthetic scenarios (fake clients only) with expected monthly outputs, covering every case in §12. |
| `apps-script/` | A **one-time build script** that creates the workbook in a blank Google Sheet: tabs, headers, formulas, dropdowns, validation, conditional formatting and warning protections. It can also load a synthetic dataset. The workbook it produces contains no scripts. |

Phase 2 (Harvest API) will write into `Delivery_Ledger`, and Phase 3 (Xero)
will read the journal block. Neither changes the calculation tabs.

---

## 11. Decision Log

| ID | Topic | Decision | Changes from the PRP |
| :--- | :--- | :--- | :--- |
| D-1 | Recognition | One rule: `MIN(Available, (Delivered + Backlog) × Rate)`. The catch-up is not a separate feature. | Merges §4.2, §4.3 and §4.4. |
| D-2 | Deficit | Absorbed automatically within a term. At renewal, Finance decides how many deficit hours to deduct; the rest is forgiven. | Resolves double counting between §4.3 and §5.1. |
| D-3 | Unused balance | Released to revenue (breakage) when the renewal decision or close-out is booked, unless approved as carryover. | New. The PRP was silent. |
| D-4 | Rate | One effective rate per term. Carryover is converted to new-rate hours at renewal. Backlog is valued at the current term rate. | Clarifies §5.1. |
| D-5 | Accounts | RR = 102, Projects = 200, Earned = 801 for both. | The PRP had "200 / 103" and no credit account. |
| D-6 | Identity | Client names from a dropdown. Engagement is the running-balance key. Each term is its own row. | The PRP assumed Contract IDs. |
| D-7 | Billing | Pool additions come only from `Billing_Ledger` rows with a posting month. The schedule is a plan. | Adds a tab not in the PRP. |
| D-8 | Harvest | One Harvest project per engagement, billable hours only. | |
| D-9 | Months | Calendar-month columns. Monthly accruals use a final-month true-up. | |
| D-10 | Burn rate | Denominator = full term entitlement + carryover. A pace gap metric is shown alongside. | |
| D-11 | Journal | Aggregated per account. | |
| D-12 | Platform | Google Sheets, formulas only. Locking and history-change detection are manual or formula-based. | PRP §6.3 automatic locking isn't possible without scripts. |
| D-13 | Cutover | Opening balances at a cutover month, tied to Xero. | |

---

## 12. Acceptance Scenarios

All amounts at $220/hr unless stated. These become the `test-data/` cases.

### S1 — Monthly RR with over-servicing (deficit absorption)
48 hrs/yr, $10,560, monthly invoicing (4 hrs = $880 per month).

| Month | Opening $ | Add $ | Delivered | Backlog in | Recognized $ | Closing $ | Backlog out |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 880 | 6 | 0 | 880 | 0 | 2 |
| 2 | 0 | 880 | 3 | 2 | 880 | 0 | 1 |
| 3 | 0 | 880 | 2 | 1 | 660 | 220 | 0 |

Checks: the balance never goes below 0, and the backlog is cleared by later invoices before any balance is left over.

### S2 — Delayed renewal with good-faith catch-up
Annual term of 50 hrs, $11,000, ending July. Opening $ in August = $440 (2 hrs
unused). The renewal (50 hrs, $11,000, backdated to Aug) is signed and invoiced
in November. No decision is needed on surplus or deficit.

| Month | Opening $ | Add $ | Delivered | Backlog in | Recognized $ | Closing $ | Backlog out | Flag |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| Aug | 440 | 0 | 5 | 0 | 440 | 0 | 3 | GOOD-FAITH |
| Sep | 0 | 0 | 5 | 3 | 0 | 0 | 8 | GOOD-FAITH |
| Oct | 0 | 0 | 5 | 8 | 0 | 0 | 13 | GOOD-FAITH |
| Nov | 0 | 11,000 | 4 | 13 | 3,740 | 7,260 | 0 | CATCH-UP $2,860 |

Checks: Aug–Oct are unchanged after the renewal is entered, and November holds a single catch-up journal.

### S3 — Renewal with partial deficit forgiveness
The old term ends with 6 backlog hours. The renewal starts on time (monthly,
4 hrs/month). Finance deducts 4 hrs and forgives 2.
Month 1 of the new term: Demand = 6 − 2 + 3 delivered = 7 hrs, so Recognized
= $880 (capped), Closing Backlog = 3. Burn consumed = 4 + 3 = 7 hrs.

### S4 — Renewal with surplus carryover and rate change
The old term has $1,100 left (5 hrs at $220). The new term rate is $250.
Finance approves 4 hrs of surplus: Carried = MIN(1,100, 4 × 250) = $1,000, so
Breakage = $100 is released in the decision month. Entitlement = Term Hours + 4.

### S5 — Project cap and close-out
100 hrs, $22,000 upfront, account 200. Month 1: 60 hrs, so $13,200. Month 2:
50 hrs, so $8,800 (capped), Backlog = 10, flagged `PROJECT CAP`, burn 110%.
At close-out the 10 hrs are forgiven, with no journal.
Variant: if only 90 hrs are delivered, close-out releases $2,200 breakage (Dr 200 / Cr 801).

### S6 — Burn alerts
Tags appear at exactly 50.00% and 80.00% consumption, not one hour later.

### S7 — Closed-period protection
After a month is closed and registered, editing one of its `Delivery_Ledger`
rows triggers the "Closed period changed" banner.

### S8 — Cutover control
The opening balances tie to the Xero balances for 102 and 200. A $0.01
difference shows red.

---

## 13. Open Items

1. Projects that are delivered partly via an RR Harvest project: is that ruled out by D-8?
2. How long can a term go `Awaiting Renewal` before AM escalation? (Suggest 60 days.)
3. Should the journal description show breakage separately from delivery, even though the journal is aggregated?
