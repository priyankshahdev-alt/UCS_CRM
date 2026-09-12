# Accounts "Salary File" (₹ Excel) — Complete Logic

This document describes **every** calculation behind the salary Excel sheet
downloaded from the Accounts panel → **Salary File** button (there is also an
older simpler **Pay/Payroll** export, **Full Excel** and **Present Days**
export on the same screen — they are covered in §10).

- Excel generation (frontend): `ucs crm/src/panels/hr/components/Workers.jsx` → `doPagarExport`
- Data computation (backend): `backend/src/controllers/salaryController.js` → `getPagarExport`; `backend/src/models/salaryModel.js` → `getPagarExportData`
- Attendance / paid-days engine: `backend/src/utils/salaryDays.js` → `computePaidDays`, `computeSundayStats`
- AKI / incentive helpers: `backend/src/utils/incentive.js`
- Daily amounts merge: `backend/src/utils/dailyAchievementAggregator.js`

Data flow: browser calls `GET /api/salary/pagar-export?month=YYYY-MM` → the
backend computes one row per worker + collection buckets → returns raw numbers
→ the **browser** builds the `.xlsx` with formulas, groupings, subtotals and a
daily grid. The only numbers actually computed inside Excel itself are the
formula columns (see §8).

---

## 1. Endpoint & Month Handling

- Route: `GET /api/salary/pagar-export?month=YYYY-MM` (roles: accounts, admin, hr, super_admin).
- `month` defaults handled: full month always for past months; for the **current** month the run stops at **today (IST)** — days after today are never treated as absent (`viewingToday`).

---

## 2. Which Workers Get a Row

A row is created for every worker in `workers` who has a **current salary**
(the `salary_history` record with `to_month = null`, i.e. the latest open
record; `salary > 0`). Workers without a salary are skipped entirely.

Each worker row also carries:
- `status` = `employment_status` uppercased (`ACTIVE`, `ABSCONDED`, …).
- `salary_status` = **released** by default; **held** if a row exists for that
  worker + month in the `salary_holds` table (with its `reason`).

### Trailing "bucket" rows (no worker)
Receipt money that is not credited to a salaried worker must still appear in the
file so the file tallies with the Collection-Report cards:
- **Pg**, **Library**, **Suspense** → `CATEGORY` rows (zero salary/target/days).
- **Anjana FRO** (agent `Anjana`/`Anjana Vyas`) and **Priyank Shah** (every other
  unmatched *named* receipt) → rows with `status = ACTIVE`, `department = FRO`,
  so they live in the Active FRO section and feed the Active FRO + Grand totals.

Sort order (backend): Active → Absconded → everything else → CATEGORY; within a
group by department (FRO, Digital, Admin, NGO Admin, Event Manager,
Housekeeping, HR, HR-Recruiter), then by Name.

---

## 3. Salary Targets

**Who has a target:** only FRO workers; the target also gates the incentives.

Backend picks the target per worker for the month:

1. **Manual target wins** — `fro_monthly_targets` for that month
   (`month = YYYY-MM-01`), rows with `target_amount > 0` (rows created by
   incentive upserts with 0 are ignored); for multiple rows take the latest
   `created_at`.
2. **Fallback auto target** — `incentive_targets` for that month with
   `target_amount > 0` (latest month first); only used if the worker has no
   manual target.

> Auto-targets themselves are generated elsewhere for the first months as a
> multiple of salary by **months employed**, using multipliers `[1, 2.5, 3]`
> for month 1, 2, 3+ (see `getMonthsEmployed` in §7 and the auto-generation in
> `salaryController.getMySalaryBreakdown` / `getWorkerSalaryWithAllocations`).

---

## 4. "Achieved" — Collections Attribution (receipts)

Achieved/daily amounts come from the **`receipts`** table (this is what makes
the Salary File match the Accounts agent-wise report).

- Only rows with a `receipt_no`, within the month, positive amount.
- **Deduplication key:** `receipt_no | donor_id | amount | receipt_date | payment_id` — a receipt seen before is skipped.
- `project_id` is resolved to a project slug (`bsct`, `aflf`, `mann`, `pg`,
  `library`, `suspense`) by: literal slug → NGO uuid → NGO `code`/`name`.

**Bucketing order:**
1. **Suspense path** — agent is blank, `na`, or `suspense` → Suspense bucket.
2. **Pg / Library path** — agent name is `library` or `pg` → that category
   bucket (these are agent-based buckets even if `project_id` is `bsct`).
   Both category buckets split the amount into the BSCT / AFLF / MANN / Other
   columns from the receipt's own project; `Other` keeps the category total
   correct when the project doesn't resolve to an NGO.
3. **NGO pool** — otherwise the project must resolve to `bsct`/`aflf`/`mann`.
   The receipt is then attributed to the **active, non-test FRO** whose
   normalized name matches the receipt `agent_name` (name matching via
   `normalizeAgentName` + normalized keys). If that FRO is **salaried**, the
   money goes to the worker's `achieved`, the per-NGO split, and the day-grid;
   if the matched worker is not salaried (or no worker matches), it falls into
   the **Anjana FRO** bucket (agent `Anjana` / `Anjana Vyas`) or the
   **Priyank Shah** bucket (every other named unmatched receipt).

**Daily amounts:** the per-day grid (`daily`) is filled from the same attributed
receipts; then **manual `daily_achievements` override the day’s total** (manual
wins per day). AKI is then computed per day on the day totals.

---

## 5. Attendance Day-Category Rules

For each calendar day a status is derived (mirrored in
`salaryModel.getWorkerAttendanceByName`):

- Record present → `present`
- Record `late` → `late`
- Record `half-day` → `half-day`
- Approved leave (from `leaves` table, incl. multi-day) → `leave`
- Day before joining, or future day (day > today in current month) → `future`
- Non-Sunday with **no record** → `holiday` (if in `holidays` table) else
  **absent**
- Sunday with no record → `sunday`

**Punch-in status derivation** (`utils/attendanceStatus.js`, used when records
are created):
- Approved **half-day leave** on that date → `half-day`
- Punched in ≥ 240 minutes after office start → `half-day`
- Punched out ≥ 180 minutes before office end → `half-day`
- Else `late` if any lateness, otherwise `present`
- Office start/end default 10:00 / 19:00 (overridable per-worker
  `shift_start_time`/`shift_end_time`, or Office setting
  `office_start_time`/`office_end_time`).

---

## 6. Paid-Days Engine (`computePaidDays` + `computeSundayStats`)

All "days" below are computed once per worker/month in
`backend/src/utils/salaryDays.js`.

### 6.1 Base attendance counts
- Only records **from the join date onward** count when the worker joined this
  month (`joinedThisMonth` = join date is in the selected month).
- `presentDays` = records with `present` or `late` (after join).
- `halfDayCount` = records with `half-day`.
- `leaveCount` = records with `leave`.

### 6.2 Absence fabrication & deduction
- A weekday with **no attendance record** is treated as **absent** if: it is
  not a Sunday, not a holiday, not before the join date, and not in the future
  (`day > today` in the current month).
- Each **absent/leave weekday** deducts a day, and additionally **clubs with
  the nearest Sunday**:
  - **Saturday absent** → the following **Sunday** is also deducted.
  - **Monday absent/leave** → the previous **Sunday** is also deducted.
  - (Sundays before joining are excluded from this clubbing.)

### 6.3 Sunday rules (`computeSundayStats`)
- Worked Sundays = Sundays with record status `present`, `late` or `half-day`
  — including Sundays that were "cancelled" but still worked (they are paid,
  tracked as `sundayAdd` / `attendedCancelled`).
- **Clean month** (no absences, no late join, no compensatory workday): every
  Sunday is effectively paid — all the month's Sundays get the free allowance.
- **Dirty month**: free pool = `totalSundays − 1`. The not-worked, not-cancelled
  Sundays beyond that **free 1** are unpaid and deducted. Which ones? The
  earliest eligible un-attended Sundays, up to the unpaid count.
- **Late join** (joined after the 10th) **or ≥ 6 absences**: every remaining
  Sunday is cancelled as an **extra Sunday** and deducted (treated as
  unpaid); free-Sunday allowance disappears.
- Outputs used later: `attendedSundays`, `paidSundays`, `unpaidSundays`,
  `extraSundays`, `cancelledSundays` (clubbed or extra), and a readable
  `sundayReasons[]` list for the UI (e.g. *"clubbed with … (absent/leave)"*,
  *"extra (6+ absences or joined after the 10th)"*, *"not worked and beyond the
  free N Sunday(s)"*).

### 6.4 Lateness deduction (in days)
- `totalLateMinutes` = sum of `late_minutes` across after-join records.
- Deduction:
  - `> 480` min → `round(totalLateMinutes / 480 × 2) / 2` (rounds to nearest 0.5 day)
  - `> 240` min → **1 day**
  - `> 180` min → **0.5 day**
  - otherwise → **0**

### 6.5 Joining / training deduction
- Only if the worker **joined this month** **and** `months employed ≤ 3`
  (see §7) → a fixed **1.5 day** deduction.
- *This is the "Training Deduction" column.*

### 6.6 Compensatory Sundays & holidays
Compensatory workdays are configured (`salary_compensations` setting, editable
in the Accounts panel; a built-in example for Aug 2026: work 2026-08-23 for the
2026-08-28 holiday). A compensatory Sunday **replaces** the linked holiday; it
does **not** count toward the separate compulsory-Sunday quota.

- `holidayPaidDays` (only with `includeHolidayPay`, used by the Salary File):
  a holiday pays a day when the worker did not work it — unless it is a
  compensatory holiday whose compensatory **Sunday was worked** (present/late/
  half-day), in which case the holiday is **not** additionally paid.
- `compensatoryWorkDays` = number of compensatory Sundays actually worked.
- `compensatedHolidayDays` = number of holidays whose compensatory Sunday was
  worked (shown in the file).
- `requiredSundayWorkedDays` = `min(1, attendedSundays)` (a compliance flag).

### 6.7 The day totals
- `grossPresentDays` (= `paidDays`) =
  `presentDays + freeSundays + holidayPaidDays + sundayDeductionDays`
  where `freeSundays = max(0, paidSundays − attendedSundays)` and
  `sundayDeductionDays` = number of Sunday dates in the deducted set.
- `netPresentDays` (= `totalDueDays`, the "Net Present Days" used for money) =
  `max(0, grossPresentDays + halfDayCount × 0.5 − sundayDeductionDays
  − lateDeductionDays − joiningDeduction)`.
- **Absent days are NOT double-deducted**: absent days are simply excluded from
  `presentDays`; the "Absent Days" column is shown for information only.

---

## 7. `getMonthsEmployed` (reused everywhere)

`monthsEmployed = (refYear − joinYear) × 12 + (refMonth − joinMonth) + 1`
if today's day is ≥ the join day, else without the `+1`. Compare against the
end of the payroll month. Used for:
- **New joiner** flag: `months employed ≤ 3` (affects AKI payout and the
  1.5-day training deduction),
- auto-target multiplier index `[1, 2.5, 3]`.

---

## 8. Money Columns & Excel Formulas

`perDay = salary / daysInMonth` (days = calendar days of the month).

| Column | Value / formula |
|---|---|
| Salary | current `salary_history.salary` for the month |
| New Target | target from §3 (`0` for non-FRO / no target) |
| Total Achieved | sum of attributed receipts (include the Anjana/Priyank buckets for section subtotals) |
| BSCT / AFLF / Mann Achieved | attributed split by project |
| Balance | `=Target − Achieved` (blank when target = 0) |
| Achieved % | `=IF(Target>0, Achieved/Target*100, 0)` |
| Present Days | `gross_present_days` (§6.7) |
| Absent Days | count of absent-weekday dates after join (§6.2) |
| Half Days | `halfDayCount × 0.5` |
| Late Deduction / Sunday Deduction / Training Deduction | §6.4 / §6.3 / §6.5 |
| Net Present Days | `=Present + Half − LateDed − SunDed − TrainingDed` |
| Month Salary | `=Salary / daysInMonth × Net Present Days` |
| Monthly 10% Incentive | `achieved ≥ target` ? `round((achieved − target) × 0.1)` : `0` |
| Total AKI | sum of per-day AKI (slabs §9) on days with amount > 0 |
| Aaj Ka Incentive (AKI payout) | target met ? (`≤3 months`: `round(totalAKI)` : `round(totalAKI / 2)`) : `0` |
| Gross Payable | `= Month Salary + 10% Incentive + AKI` (also computed in JS for totals) |
| OT / Appreciation / Extra Incentive | manual column, `0` from backend |
| Pending Salary (prev month) | manual column, `0` from backend |
| Advance Deduction | active employee loans: `worker_loans` with status `approved`/`active` and `remaining_amount > 0` → sum of `monthly_deduction` |
| Net Payable | `=MAX(0, Gross + OT + Pending − Advance)` |
| Compensatory Sunday / Compensated Holiday / Required Sunday Worked | §6.6 |
| Daily grid (one column per day, `dd Mon`) | that day's attributed amount (manual `daily_achievements` win, §4) |

Totals (JS-computed literal values, no SUMIF/recalc quirks): Balance =
`target − achieved`; Net Present = `gross + half − late − sun − training`;
Gross = `month_salary + incentive + aki`.

### Groups & subtotals in the sheet
Rows are coloured green when the worker met their target. Sections and their
subtotal rows (only when the section has rows):

1. **Active FRO Total**
2. **Management Total** (Digital, Admin, NGO Admin, Event Manager, Housekeeping)
3. **HR Total** (HR, HR-Recruiter)
4. **Absconded Total**
5. Pg Total, Library Total, Suspense Total (one each)
6. **Grand Total**

(Anjana FRO and Priyank Shah are regular **Active FRO** rows; their numbers are
inside the Active FRO Total and the Grand Total.)

---

## 9. AKI Slabs ("Aaj Ka Incentive")

Per-day incentive depends on the **day of the week** and the day's collection
amount. Slabs are stored in the `aki_slabs` setting (fallback = defaults below);
a day with amount outside every slab earns 0.

| Day | Slabs (min → max ⇒ incentive ₹) |
|---|---|
| Sun | 3750–6999 ⇒200 · 7000–11999 ⇒400 · 12000–13749 ⇒800 · 13750–18999 ⇒1100 · ≥19000 ⇒1500 |
| Mon | 3000–5999 ⇒180 · 6000–8999 ⇒360 · 9000–11999 ⇒540 · 12000–13999 ⇒720 · ≥14000 ⇒900 |
| Tue | 2500–7999 ⇒100 · 8000–12499 ⇒400 · 12500–15999 ⇒700 · ≥16000 ⇒1100 |
| Wed | 3000–5499 ⇒250 · 5500–7499 ⇒300 · 7500–10499 ⇒450 · 10500–12499 ⇒610 · ≥12500 ⇒750 |
| Thu | 3750–6999 ⇒200 · 7000–11999 ⇒400 · 12000–13749 ⇒800 · 13750–18999 ⇒1100 · ≥19000 ⇒1500 |
| Fri | 3000–5999 ⇒180 · 6000–8999 ⇒360 · 9000–11999 ⇒540 · 12000–13999 ⇒720 · ≥14000 ⇒900 |
| Sat | 2500–3999 ⇒100 · 4000–7999 ⇒200 · 8000–12499 ⇒400 · 12500–15999 ⇒700 · ≥16000 ⇒1100 |

---

## 10. Related Exports on the Same Screen

### 10.1 Payroll export — "Pay" button (`GET /api/salary/payroll?month&extended=true`)
Older, simpler sheet (`salaryModel.getPayrollData`):
- one row per **salary allocation NGO-split** (or an `Unallocated` row when the
  worker has no allocation); `total_due` split by `salary_portion / salary`.
- `totalDue = round(salary − perDay × absentCount)` (absent = `absent` records
  only — no Sunday/lateness/training/compensatory logic).
- Extended mode adds: per-day, days-in-month, present/absent/sundays,
  department, DOJ, target, achieved, **monthly incentive**
  (`achieved ≥ target` → `round(overage × 0.1)`), **AKI payout**
  (`≤ 3 months` → full AKI, else half), **loan deduction**, bank details.

### 10.2 Present Days export (`GET /api/salary/present-days?month=YYYY-MM`)
Per worker: today's present/late/half/absent/leave counts, `computePaidDays`
result (paid days, late deduction, joining deduction, available days, Sunday
breakdown with `sunday_reasons`), the full day totals (§6), plus the worker's
month **collection** (from `fro_donor_logs`, three matching paths: donation
action / verified lead_done disposition / done disposition).

### 10.3 Worker attendance grid (`GET /api/salary/attendance?month&name`)
Day-by-day grid (status, late minutes, punch in/out, hours worked) for a worker
resolved by fuzzy name matching (§5 statuses).

### 10.4 Single worker breakdown (`GET /api/salary/my-breakdown`)
FRO panel / worker view: salary, per-day, paid days, all deductions (§6),
per-NGO allocation totals, FRO target + incentives (§3, §8-9) with auto-target
generation, and loan deductions.

### 10.5 Salary holds
- Only **accounts / super-admin** can write. `salary_holds` keyed by
  worker + `YYYY-MM`; absence of a row = **Released** ("Hold/Released" column in
  the file, `salary_status`).

### 10.6 Salary access code
Salary figures in HR/Accounts detail pages are hidden behind a per-user 4-digit
access code (`settings` key `accounts_access_code_{userId}`); endpoints:
status / create / verify / change under `/api/salary/access-code*`.

---

## 11. Money-Sensitive Tuning Settings

| Setting key | Effect |
|---|---|
| `salary_compensations` (Accounts "Compensations") | compensatory Sunday ↔ holiday pairs per month |
| `aki_slabs` (HR incentive settings) | per-day incentives used in §9 |
| `office_start_time` / `office_end_time` | attendance late/half-day thresholds (worker shift overrides) |
| `salary_holds` | per-worker per-month Hold/Released flag |
| `accounts_access_code_{userId}` | 4-digit code gating confidential salary display |
| `collection_teams` | team list for the Accounts TEAM congratulations (not salary math) |