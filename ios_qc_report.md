# getToDo iPhone QC Report

**Test date:** September 13, 2026  
**Application:** getToDo v0.1.0  
**Target requested:** iPhone 15 Pro Simulator, iOS 17+  
**Tested environment:** Local Debug build at `http://localhost:3000`, Chromium responsive viewport at 393 × 852 CSS px (portrait) and 852 × 393 CSS px (landscape)  
**Automation:** Browser automation plus Vitest and TypeScript/build checks  
**Important limitation:** Apple iPhone Simulator, Mobile Safari/WebKit, XCTest, real iOS safe-area values, home-screen launch, physical gestures, permission sheets, and background/foreground lifecycle events are unavailable on this Windows host. Results requiring those facilities are marked Blocked or Partial.

## Executive Summary

The implemented getToDo PWA task flows are functional at iPhone 15 Pro dimensions. Project and task creation, multi-character title editing, scheduling, project reassignment, local persistence, light/dark themes, PWA assets, and production compilation passed. No browser console errors, crashes, infinite spinners, or horizontal page overflow were observed.

The release cannot be certified as an iOS 17 simulator build from this test bed. Local authentication was unavailable because the local build has no database or authentication secret configured. The undersized mobile hit areas, Move picker selection semantics, and cramped Settings footer found in the initial run were corrected and reverified at 393 × 852.

| Result | Count |
|---|---:|
| Passed | 11 |
| Partial | 2 |
| Blocked | 3 |
| Failed | 0 |
| Product issues logged | 4 (3 resolved) |
| Environment blockers logged | 2 |

## Test Results

| ID | Test | Result | Evidence |
|---|---|---|---|
| T01 | App launch at iPhone 15 Pro portrait size | Pass | Loaded Today view without crash, spinner, clipping, or horizontal overflow. |
| T02 | iPhone landscape layout | Pass | 852 × 393 layout switched to split sidebar/content view with no horizontal overflow. |
| T03 | Create project | Pass | Created `QC Mobile Project`; UI changed from empty state to the project screen. |
| T04 | Create task | Pass | Created `Mobile QC task`; project count changed to one open task. |
| T05 | Edit task title continuously | Pass | Typed multiple sequential characters; textarea stayed focused and dialog remained open. Final test title: `Mobile QC task edited`. |
| T06 | Schedule task | Pass | Set task to Today; the row and editor both immediately displayed `Today`. |
| T07 | Reassign task | Pass | Moved task from the project to Inbox, verified it appeared in Today, then moved it back to `QC Mobile Project`. |
| T08 | Project picker at keyboard-reduced height | Pass | At 393 × 500, Inbox and `QC Mobile Project` remained fully inside the viewport and tappable. |
| T09 | Light and Dark mode | Pass | Explicit Light and Dark settings applied correct document theme and readable colors; theme was restored to System after testing. |
| T10 | Persistence after relaunch-style reload | Pass/Partial | Task and selected dark theme persisted after reload. True iOS minimize/resume could not be exercised. |
| T11 | PWA resources | Pass | `/manifest.webmanifest`, `/sw.js`, and `/icon-192.png` returned HTTP 200. Manifest declares `display: standalone`. |
| T12 | Browser console | Pass | No warning or error entries were captured during tested flows. |
| T13 | Authentication session API | Pass | `GET /api/auth/session` returned HTTP 200 with an explicit `syncConfigured: false` state. |
| T14 | Login with supplied credentials | Blocked | `POST /api/auth/sign-in` returned HTTP 501 because `DATABASE_URL` and `AUTH_SECRET` are not configured locally. |
| T15 | Registration/email verification/onboarding | Blocked/N/A | The product implements direct email/password account creation only. It has no verification-link or onboarding flow, and local accounts are disabled without server configuration. |
| T16 | Billing/tier upgrade | Blocked/N/A | No billing, plans, subscriptions, or tier-upgrade feature exists in this repository. |
| T17 | Camera, Location, and native notification permission sheets | N/A | Core getToDo flows do not use Camera or Location. Native iOS permission sheets cannot be tested in Chromium responsive mode. |
| T18 | Edge swipe, home indicator, Dynamic Island, minimize/resume | Partial | Responsive layout and CSS safe-area usage were inspected, but native iOS hardware/lifecycle behavior requires Xcode Simulator or a physical device. |

## Automated and Build Verification

- TypeScript check: passed with no errors.
- Unit tests: 103/103 passed across 11 test files.
- WCAG contrast script: all Light and Dark token pairs passed WCAG AA.
- Optimized production build: passed; all static and API routes compiled successfully.
- Warm local HTTP timings: page 110 ms; manifest 4 ms; service worker 3 ms; icon 2 ms.
- API observations: session HTTP 200; unconfigured sign-in HTTP 501 with a clear error body.

## Issues

- [ ] **IOS-QC-001 — Native iOS 17 simulator certification unavailable**
  - **Severity:** Blocker (test environment)
  - **Device/OS:** Requested iPhone 15 Pro Simulator / iOS 17+; tested Chromium at equivalent CSS dimensions on Windows
  - **Reproduce steps:**
    1. Open the repository on the current Windows host.
    2. Attempt to launch an iPhone Simulator or run XCTest.
    3. Observe that Xcode/iOS Simulator is not available and the repository is a Next.js PWA rather than an Xcode project.
  - **Expected:** Execute against Mobile Safari in an iPhone 15 Pro Simulator and collect device logs.
  - **Actual:** Only responsive browser emulation is available; native safe-area, permission, lifecycle, and gesture behavior cannot be certified.
  - **Logs/URL:** `http://localhost:3000`; no iOS device log exists.

- [ ] **IOS-QC-002 — Local authentication is not configured**
  - **Severity:** Major (test environment/configuration)
  - **Device/OS:** iPhone 15 Pro-sized Chromium viewport; local Debug build
  - **Reproduce steps:**
    1. Open Settings.
    2. Select **Account & sync**.
    3. Attempt `POST /api/auth/sign-in` with the supplied test credentials.
  - **Expected:** A configured staging environment accepts or rejects the credentials through the normal login UI.
  - **Actual:** The UI states that accounts are unavailable; the API returns HTTP 501 because `DATABASE_URL` and `AUTH_SECRET` are missing.
  - **Logs/URL:** `http://localhost:3000/api/auth/sign-in` — `{"error":"Accounts are not configured on this deployment."}`

- [x] **IOS-QC-003 — Mobile touch targets are smaller than 44 × 44 pt**
  - **Severity:** Major
  - **Device/OS:** iPhone 15 Pro-sized viewport, 393 × 852
  - **Reproduce steps:**
    1. Open Today on a 393 px-wide viewport.
    2. Inspect the header, task row, and task editor controls.
    3. Measure their rendered hit areas.
  - **Expected:** Frequently used mobile controls provide approximately 44 × 44 pt tappable areas.
  - **Actual:** Header icon buttons are 36 × 36; task completion controls are 24 × 24; editor action buttons are 32 px high; editor close/trash buttons are 36 × 36; the title textarea is 22 px high.
  - **Resolution:** Resolved. Phone-width buttons, options, tabs, inputs, selects, textareas, and labeled checkboxes now expose at least 44 × 44 px hit areas. The completion artwork remains 24 × 24 inside a 44 × 44 hit area. Reverification found no undersized visible controls in the Today view, task editor, or Settings dialog.
  - **Logs/URL:** `http://localhost:3000/?view=today`; DOM measurements captured during the run.

- [x] **IOS-QC-004 — Task editor initially focuses completion control instead of title**
  - **Severity:** Minor
  - **Device/OS:** iPhone 15 Pro-sized viewport, 393 × 852
  - **Reproduce steps:**
    1. Tap an existing task row.
    2. Observe the newly opened Edit task dialog.
    3. Inspect the active element.
  - **Expected:** If the editor is intended for immediate text editing, the title field receives focus; otherwise no destructive/action control should receive initial focus unexpectedly.
  - **Actual:** The completion checkbox receives initial focus. Editing still works after tapping the title.
  - **Resolution:** Resolved. The dialog focus trap now honours a `data-autofocus` marker and leaves focus alone when a child has already placed it, so the title field receives initial focus on both the phone modal and the inline desktop editor.
  - **Logs/URL:** `http://localhost:3000/?view=today`; accessibility snapshot showed the checkbox as active.

- [x] **IOS-QC-005 — Move picker announces Inbox as selected even when task is in a project**
  - **Severity:** Minor
  - **Device/OS:** iPhone 15 Pro-sized viewport, 393 × 852
  - **Reproduce steps:**
    1. Open a task assigned to `QC Mobile Project`.
    2. Tap **Move · QC Mobile Project**.
    3. Inspect the Move to listbox with accessibility semantics.
  - **Expected:** The current destination is identified as selected, or keyboard focus is exposed separately from selection.
  - **Actual:** Inbox is marked `aria-selected=true` because it is the first keyboard-active option, despite the task being assigned to the project.
  - **Resolution:** Resolved. The current task parent now receives `aria-selected=true`, a visible `Current` label, and initial keyboard highlight. The same semantics are supplied for project-area moves and same-parent multi-selection moves.
  - **Logs/URL:** `http://localhost:3000/?view=project:…`; accessibility snapshot of dialog `Move to`.

- [x] **IOS-QC-006 — Settings footer and tabs are cramped at iPhone width**
  - **Severity:** Minor
  - **Device/OS:** iPhone 15 Pro-sized viewport, 393 × 852
  - **Reproduce steps:**
    1. Open Settings at 393 px width.
    2. View the General tab and bottom footer.
    3. Observe the horizontal tab strip and version/build/status row.
  - **Expected:** Settings navigation and footer metadata remain easy to scan without partial labels or dense wrapping.
  - **Actual:** The final tab label is partially hidden until horizontally scrolled; the offline message wraps into several narrow lines while version and build metadata are tightly packed beside it.
  - **Resolution:** Resolved for the footer. At phone widths the sync message is shortened and stacked above a separate version/build row; the full message and inline metadata remain on larger screens. Settings tabs retain intentional horizontal scrolling, now with 44 px minimum tab height.
  - **Logs/URL:** `http://localhost:3000/?view=today`, Settings dialog.

## Product-Scope Notes

- There is no Camera or Location feature, so permission prompts and camera simulator behavior are not applicable.
- There are no swipe actions on task rows; tap and keyboard-accessible controls are the implemented interaction model.
- There is no billing or tier system.
- Account creation is direct email/password registration. Email verification and onboarding are not implemented requirements in the current code.
- Local work is intentionally available without an account. Cross-device sync requires a configured database and authentication secret.

## Recommended Next Steps

1. Run this same hero suite on macOS with Xcode Simulator using iPhone 15 Pro / iOS 17 or newer, then repeat once on a physical iPhone.
2. Increase mobile hit areas to at least 44 × 44 pt without necessarily enlarging the visible icons.
3. Provide staging `DATABASE_URL` and `AUTH_SECRET` values plus a known disposable account before certifying login and sync.
4. Correct Move picker selection semantics so the current parent is announced accurately.
5. Simplify or stack the Settings footer metadata on narrow screens.

## October 6, 2026 — v0.7.5 print and calendar regression checks

The reported AirPrint preview contained the regular Upcoming screen rather than the selected day's paper layout. The selected-day article now stays mounted through repeated `beforeprint`/`afterprint` phases, and Safari's native Share → Print uses the chosen date too.

| Check | Result | Evidence |
|---|---|---|
| iPhone-sized viewport, 393 × 852 | Pass | Real day-print action survived two simulated preview/render cycles; paper CSS showed only Friday, October 9, 2026, with 13 tasks and 2 calendar events. App header, sort controls, other dates, and selection controls were hidden. |
| Long day, mobile and desktop | Pass | 32 tasks plus 2 events split into 17 rows per column. At desktop size the column bottoms differed by about 31 CSS px (less than one task row), leaving the unused bottom of the sheet clear. |
| Short day and switching dates | Pass | Short lists remained in one column. Printing Tuesday after Friday replaced the article with Tuesday's single task rather than retaining Friday's rows. |
| Desktop regression, 1280 × 900 | Pass | The same selected-day layout and balanced columns remained available after repeated print phases. |
| Browser console | Pass | No warning or error entries during the print checks. |
| Real iPhone AirPrint dialog and physical output | Pending device check | Windows cannot run Mobile Safari or Xcode's iPhone Simulator. Responsive checks and explicit lifecycle simulation do not certify native AirPrint output. |

The browser fixture used only generated, in-memory QA records and was removed after testing. No personal tasks or calendar feeds were modified.

Calendar coverage now includes today's and future appointments in Upcoming, initial-launch refresh, and account-backed connection configuration. Downloaded event caches remain device-local; connection URLs and events remain excluded from task exports. Existing desktop connections migrate once when that account opens the updated app, then another device can recover them through sync. Automated tests cover migration, cache freshness, enable/disable/remove behavior, account changes, and server payload restrictions.

Release verification: TypeScript passed; all 156 tests across 17 files passed; all eight light/dark palette contrast audits passed; the optimized production build passed. The removed QA fixture is absent from production routes. Live personal calendar providers and native AirPrint still require the user's device check after deployment.

## October 6, 2026 — v0.7.6 spell check

Task titles, task notes, and checklist entries now explicitly request native spelling checks with `spellCheck={true}`. Coverage includes the main and inline task composers, Quick Capture title/notes, and existing/new checklist rows. The shared title/notes textarea also covers project and area text. Password, email, calendar feed, and technical fields are unchanged. This does not force autocorrection or override the user's browser/device spelling settings; dictionary availability and visible spelling suggestions require a device check.

Verification: four rendered-component regression tests confirm the emitted spelling-check attributes. All 160 tests across 18 files, TypeScript, and the optimized production build passed.

## October 6, 2026 — v0.7.7 errands grouping and route ordering

Implementation follows the approved preference: errands first on screen and paper,
manually ordered, with automatic classification that follows the title. A standalone
`@` or `@Location` marker derives a read-only Errands tag; email addresses are ignored.
Removing the marker removes the computed membership without touching manual tags.

| Check | Result | Evidence |
|---|---|---|
| My Day, Upcoming, All Tasks | Pass | Errands precede ordinary tasks even under alphabetical/tag sorts. My Day collects errands across projects; Evening remains separate. Upcoming preserves each concrete date, including month sections. Calendar appointments stay before tasks. |
| Independent route order | Pass | A saved `errandRank` does not alter project rank, My Day rank, parent, dates, or tags. Hidden/filtered stops retain their global positions. Undo, duplication, import/export, invalid IDs, and 2,000-stop normalization are covered. |
| Desktop browser | Pass | Keyboard handle movement reordered All Tasks errands and that order appeared in My Day. Ordinary alphabetical sorting remained intact. |
| Phone-width browser, measured 393 × 852 CSS px | Pass | Route-handle pointer drag reordered Friday errands under alphabetical sort. Handles measured 44 × 44 CSS px. No horizontal overflow was observed. This was a responsive Chromium check, not Mobile Safari or a native touch test. |
| Screen/paper agreement | Pass | Selected Friday's print article had the exact reordered task sequence. My Day paper markup uses the same Errands/Other tasks grouping. Existing balanced-column printing is unchanged. Native AirPrint output remains a device check. |
| Automatic tag filter and title edits | Pass | Selecting Errands showed only marked tasks; changing `Return clamps @ Lowe’s` to `Return clamps from Lowe’s` removed it from that filter while retaining the task under Other tasks. Emails stayed outside Errands. |
| Recurring tasks and manual tags | Pass | Templates/materialization cannot persist the virtual tag. Occurrences derive classification from their own title. A manually created tag named Errands remains independent. |
| Browser console after fixture correction | Pass | No warning/error entries during the functional checks. An initial temporary fixture import typo was corrected before testing; the fixture was removed before production build. |

All browser records were generated in memory with persistence disabled; no personal
tasks, accounts, or calendar feeds were modified. Temporary browser tabs were closed
and viewport overrides reset. The test route is absent from the production build.

Release verification: TypeScript passed; 203 tests across 22 files passed; all eight
light/dark palette contrast audits passed; the optimized production build passed.

## October 17, 2026 — v0.7.8 checklist ordering

Every checklist row now has a dedicated reorder handle. On touch screens the handle
uses pointer capture and a touch-only drag surface so editing text, toggling a checkbox,
and scrolling outside the handle remain independent. The nearest row shows an insertion
line while dragging. Keyboard users can focus the same handle and press Up or Down.
Moves update the row's fractional rank through the existing action pipeline, so the new
order is undoable, persists after reload, and participates in cross-device sync.

Automated coverage verifies moves between rows and to both list boundaries, plus the
rendered touch and keyboard affordance. A physical Mobile Safari drag remains a device
check. Release verification passed TypeScript, 206 tests across 24 files, all eight
light/dark palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.9 print checklists and Due labels

My Day and single-day Upcoming print controls now include an **Expand checklists**
option. When selected, the paper layout includes every live checklist row in its saved
order, with completed rows checked and struck through. Upcoming's existing paper-height
measurement includes the expanded rows before choosing one or two columns.

The task editor no longer shows the task-level **When** action. Existing scheduling
data, scheduled-task behavior, repeat rules, and project scheduling remain unchanged.
The user-facing **Deadline** label is now **Due** (or **due date** in prose) throughout
the task, project, batch-action, date-picker, search, recurrence, and special-list UI.

Release verification passed TypeScript, 208 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.10 My Day due-date rollover

Creating a task in My Day or adding an existing open task to My Day now sets its due
date to the current planning day. At the next planning-day rollover, any still-open task
that remains explicitly selected in My Day advances to the new current due date.
Completed, canceled, deleted, and unselected tasks retain their existing dates.

Release verification passed TypeScript, 209 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.11 current recurring tasks

Fixed-date recurring task templates now materialize only the occurrence that becomes
active on the current planning day. Missed dates are advanced without creating a stack
of open copies. During maintenance, older open copies linked to active fixed task
templates are marked completed, so All Tasks retains only the current occurrence.

Completion-relative recurrence and repeating projects retain their existing behavior;
paused and stopped templates are not auto-completed.

Release verification passed TypeScript, 209 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.12 held-task recovery

Tasks already held in Someday or scheduled for a future day now show a focused
**Move to Anytime** action in the task editor. Using it clears the hidden planning date,
evening state, and reminders while preserving the task's due date, list, tags, notes,
checklist, and other content. Anytime tasks do not show the action, and the full task-level
When field remains removed.

Release verification passed TypeScript, 210 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.13 simplified primary navigation

Removed the standalone Anytime and Someday destinations from the sidebar and numbered
navigation shortcuts. Their task data and planning states remain intact and searchable
through All Tasks. The four primary destinations are now Inbox, My Day, Upcoming, and
Logbook; shortcuts 1–4 follow that same order.

Release verification passed TypeScript, 211 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.14 empty Trash

The Trash view now has an **Empty Trash** button. A confirmation states the number of
items and that deletion is permanent before removing trashed tasks, projects, and their
private child data. Emptying Trash also clears stale Undo history so a permanently
removed record cannot be partially recreated. The existing 30-day automatic cleanup
remains unchanged.

Release verification passed TypeScript, 212 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.15 Weekly Review and My Day suggestions

Added a non-destructive **Weekly Review** under More lists. It groups Inbox captures,
overdue tasks, paused repeats, held Someday or future-scheduled work, projects without
a next task, and otherwise-uncategorized tasks untouched for 30 days. A task appears in
at most one review section, and opening the review changes nothing automatically.

My Day now offers an optional **Suggestions** panel when important or soon-due available
tasks exist. Suggested tasks can be opened or added to My Day individually; ToDone never
adds them automatically. Weekly Review can also be pinned to Favorite Views.

Release verification passed TypeScript, 214 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.

## October 17, 2026 — v0.7.16 reusable saved views

Quick find searches and active tag filters can now be saved under a user-chosen name.
The saved definition is a live, non-destructive task query: newly matching tasks appear
automatically, Search All can include notes, checklist rows, and Logbook tasks, and Trash
is always excluded.

Saved views appear under **More lists** by default. Each can be pinned independently to
Favorite Views or deleted without affecting any matching tasks.

Release verification passed TypeScript, 217 tests across 24 files, all eight light/dark
palette contrast audits, and the optimized production build.
