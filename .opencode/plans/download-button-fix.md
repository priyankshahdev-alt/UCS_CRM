# Fix: Extra Download buttons in ActivityPlanner (19 vs 15)

## Problem
In the ActivityPlanner (Monthly Planner) grid for BSCT September 2026, Download buttons appear on 19 rows, but only 15 planner-created events exist (`event_head_planner_event_links` has 15 rows for BSCT September). The 4 extra buttons come from the legacy fallback in `findScheduledEvent`, which matches any event with the same name + date + NGO, even events that were not created through the planner.

## Root cause
- `findScheduledEvent` (ActivityPlanner.jsx ~3291) first checks the durable row link and the suggestion-level link, then falls back to `findExistingPlannedEvent`, which filters `monthEvents` by exact name/date/NGO.
- `alreadyScheduled` (~3633) uses `findScheduledEvent`, so fallback-matched events make `alreadyScheduled` true and the Download button renders whenever `allDone` is also true.
- The Monthly Report only includes durable-linked events, so it shows 15, creating the mismatch.

## Plan
1. Add a strict resolver in `client/src/panels/event-head/pages/ActivityPlanner.jsx`:
   ```js
   const findLinkedScheduledEvent = (key, date, label) => {
     if (!key) return null
     const rowLink = plannerLinkMap[linkMapKey(key, rowNgoId(key))]
     const linkedId = rowLink
       ? rowLink.event_id
       : (key ? rowSuggestionsFor(key).find((s) => Number(s.suggested_event_id) > 0)?.suggested_event_id : null)
     if (!linkedId) return null
     return monthEvents.find((ev) => String(ev?.id) === String(linkedId)) || null
   }
   ```
   This omits the `findExistingPlannedEvent` fallback.

2. Change `alreadyScheduled` to use the strict resolver:
   ```js
   const alreadyScheduled =
     Boolean(key && createdKeys.has(linkMapKey(key, rowNgoId(key)))) ||
     Boolean(findLinkedScheduledEvent(key, date, label))
   ```

3. Keep `findScheduledEvent` (with fallback) for display-only uses such as `rowEventName`, so legacy event names still render. Optionally use the strict resolver in `deleteScheduledProgramme` to avoid deleting an unrelated fallback-matched event.

## Expected result
- Download button appears only for the 15 durable/suggestion-linked events (plus any created in the current session).
- Monthly Report BSCT September remains 15.
- No change to task completion (`allDone`) logic.

## Verification
- Open ActivityPlanner for BSCT, September 2026 and count Download buttons: should be 15.
- Confirm Monthly Report BSCT September still shows 15 events.
- Create one new event via planner and confirm its row switches to Download without affecting other rows.
