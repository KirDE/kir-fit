# Named workouts and weekday assignments

## Data migration

`20261104213000_named_workouts_schedule` adds `WorkoutDayAssignment` keyed by
programme and weekday (Sunday=0). It renames the first legacy template in each
programme to `Default`, keeping its ID and every exercise setting. The programme's
existing `preferredWeekdays` are assigned to this same template. No workout
sessions, logged sets, body weights, or exercise configuration rows are rewritten.

New accounts and the seed create Default with the original eight starter
exercises and the original three training days. Reseeding does not recreate
removed exercises, rename customised plans or reset weekday assignments.

Guest data is migrated once, in the existing localStorage key: Default inherits
the old exercise settings and chosen days. Existing sessions, sets and weights
remain in place. Per-plan settings are independent; starting or editing one plan
does not append catalogue equipment to other plans.

## API

- `GET /settings/program`: templates with ordered exercise configuration,
  weekday assignments and the legacy preferredWeekdays array.
- `POST /settings/workouts`: create a named plan with its ordered equipment and
  sets, repetition range, rest time, increment and load unit.
- `PATCH /settings/workouts/:id`: edit an owned plan. Existing entries retain
  notes/custom labels/last inputs; removed entries do not delete session records.
- `PATCH /settings/program`: assign owned plans to unique weekdays. Legacy
  preferredWeekdays-only clients retain existing assignments for retained days.
- Programme-level locks serialize plan/schedule mutations. Cross-account plans,
  unknown equipment, duplicates, empty plans and invalid ranges are rejected.
- Dashboard uses the next scheduled day and its assigned template. The client
  sends its local calendar date so the server's UTC day cannot select yesterday's
  workout around midnight. The dashboard displays the actual name and count.
- Session exercise configuration remains snapshotted at start. Editing a plan
  changes future starts, not an existing session's exercises or logged sets.
  Restarting a session retains its selected template rather than switching to a
  different weekday's plan.

## UI

Settings contains a named workout editor (create/name, equipment, order,
sets/reps/rest/increment/unit) and one workout/rest-day selector per weekday.
Machine labels follow the separately configured equipment-name language; other
UI text follows the app language. All 23 catalogue models are available for
explicit selection. The existing machine catalogue remains in Settings only.

Leg Curl is renamed Seated Leg Curl with the same `leg-curl` identifier; history,
settings and image paths remain linked. Localised labels reflect the seated model.

## Verification

- Real PostgreSQL upgrade from all ten legacy migrations with a pre-existing
  programme, selected days, custom machine settings, active session and a logged
  set: IDs/settings/session/sets preserved and days assigned to Default.
- API integration tests cover plan ownership, duplicate/invalid input,
  cross-account assignment rejection, weekday selection, configured starts,
  exercise ordering and future-only changes.
- Guest tests cover one-time migration, independent plan settings, assignment
  persistence and preservation of an active session during template edits.
- Chromium 320/390/1440px: create/configure/reorder, assign to today's day, launch
  correct composition, log a set, edit future composition, resume unchanged
  session, finish and start the revised composition; Default stays unchanged.
