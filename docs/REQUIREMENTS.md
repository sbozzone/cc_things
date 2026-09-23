# Requirement coverage

Every numbered requirement from `Things_Task_Manager_Requirements.docx`, where it lives,
and — where something is not built — exactly what is missing and why.

**Status key:** ✅ built · ⚙️ built, needs deployment configuration · ➖ not built

---

## 3. Capture tasks and preserve their details

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R01 | Quick capture | ✅ | `ui/QuickCapture.tsx`, `ui/AppShell.tsx`. Add action in every view, `Shift+N` anywhere, defaults to Inbox, title-only accepted. Drafts survive interruption via `sessionStorage`; a blank submission creates nothing. |
| R02 | Task content | ✅ | `core/types.ts`, `ui/TaskEditor.tsx`. Every field persists as it is typed — no Save step. |
| R03 | Checklists | ✅ | `core/commands.ts` (`appendChecklist`), `ui/TaskEditor.tsx`. Multi-line paste creates one row per non-blank line. Rows have no dates or project membership; completing a task leaves unchecked rows intact. |
| R04 | Contextual insertion | ✅ | `core/selectors.ts` (`AddTarget` per section). Upcoming day sections carry their date; Logbook and Trash route capture to Inbox. |
| R05 | Complete, cancel, reopen | ✅ | `core/commands.ts` (`setTaskStatus`), `core/patches.ts` (`inverseOf`). Cancel is distinct from complete; Undo is immediate; pending reminders are cancelled. |
| R06 | Delete and restore | ✅ | `core/commands.ts` (`deleteTask`, `restoreProject`, `purgeExpiredTrash`). 30-day Trash, then purge; restore offers a home when the parent is gone. |

## 4. Organise responsibilities and projects

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R07 | Areas and projects | ✅ | `core/types.ts`, `core/commands.ts`. One structural parent per task; nested areas and projects excluded by the model. |
| R08 | Project headings | ✅ | `core/commands.ts` (`moveHeading`, `archiveHeading`). A heading moves with all its tasks in order; archiving is blocked while a child is open. |
| R09 | Project status and progress | ✅ | `core/membership.ts` (`projectProgress`), `ui/ProjectHeader.tsx`. Accessible percentage; empty denominator shows none; completing a project asks how to resolve open tasks. |
| R10 | Duplicate and promote | ✅ | `core/duplicate.ts`, `ui/DuplicateDialog.tsx`, heading menu in `ui/ListView.tsx`. Fresh ids, original untouched, choices for keeping dates and resetting completion; task→project turns checklist rows into child tasks; heading→project keeps its tasks with their notes, tags, order and dates. Reversible through Undo. |

## 5. Navigation and list membership

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R11 | Built-in lists | ✅ | `core/selectors.ts`. All eight views are queries over one record set; names and order fixed. |
| R12 | Counts and selection | ✅ | `core/selectors.ts` (`sidebarCounts`). Open tasks only; a task with both markers counts once. |
| R13 | Today rollover | ✅ | `core/membership.ts` (`inToday`, `inEvening`), `state/store.ts` (30-second tick plus a focus check). Works while open and after an overnight restart. |
| R14 | Upcoming interactions | ✅ | `core/selectors.ts` (`upcomingView`), `ui/ListView.tsx`. Same-day start and deadline markers coalesce into one row. |

## 6. Date and planning rules

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R15 | Separate date concepts | ✅ | `core/commands.ts` (`setWhen`, `setDeadline`), `ui/DatePopover.tsx`. |
| R16 | Natural language entry | ✅ | `core/natural-dates.ts`. English phrases, locale-sensitive numeric dates, preview before commit, no silent guessing. |

All boundary policies in §6 are implemented in `core/dates.ts` and `core/membership.ts`
and covered by tests: date-only storage, one account planning zone, conflicting dates
warned but savable, reached deadline overriding a hold, clearing a start clearing its
reminder, evening carryover, and time-zone changes leaving date-only values fixed.

## 7. Repeating tasks and projects

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R17 | Repeat patterns | ✅ | `core/recurrence.ts`. Fixed and completion-relative; every-N days/weeks/months/years, selected weekdays, day-of-month, ordinal weekday, end date. |
| R18 | Templates and occurrences | ✅ | `core/recurrence.ts`, `ui/RepeatEditor.tsx`. Separate template and occurrences, pause/resume/stop/skip/create-early, three-date preview. |

The full §7 contract is implemented and tested: occurrence keys, missed-date generation,
day-31 and February-29 fallbacks, deadline lead time, project copies as date offsets,
completion reversal (retract if untouched, flag for review if edited), and cancel/stop.

Repeating **projects** are modelled, materialize correctly (`RepeatSnapshot.headings`)
and can be authored from the project header's **Repeat** button: `projectSnapshot`
captures the open tasks, their headings and each start date as an offset from the
anchor, so every copy lands relative to its own occurrence date. Making an existing task
or project repeat records it as the anchor-date occurrence (`existingId`), so generation
continues from it rather than producing a second copy.

## 8. Reminders and calendar display

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R19 | Timed reminders | ⚙️ | `core/commands.ts`, `core/dates.ts` (`resolveInstant`), `ui/DueReminders.tsx`. Wall time, zone and resolved instant stored; snooze 10/30/60; rescheduling moves delivery and bumps the generation; completion cancels it. **Delivery is the in-app due list only** — the requirement's server-scheduled Web Push path is not built, so a reminder surfaces when the app is open rather than as an OS notification. |
| R20 | Calendar event display | ⚙️ | `core/calendar.ts`, `state/calendar.ts`, `ui/CalendarPanel.tsx`. Read-only, above tasks in Today and the matching Upcoming day, all-day and multi-day, source link. Needs a feed address. |
| R21 | Calendar adapter contract | ⚙️ | `core/calendar.ts`. Provider/instance ids and revisions kept, dedup by identity not title, midnight spanning, bounded cache, five-minute staleness, refresh on focus. |

**Provider choice deviates from the proposed baseline.** The requirement proposes a
Google Calendar OAuth adapter first. This build implements a read-only **iCalendar
(`.ics`) feed** adapter instead, behind the same display contract: it covers Google,
iCloud and Outlook, and needs no OAuth client registration to work on a fresh deploy. An
OAuth adapter can be added behind the same interface without touching the display code.

## 9. Search, tags and efficient editing

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R22 | Tags and inheritance | ✅ | `core/tags.ts`, `ui/Pickers.tsx`. Nesting without cycles, calculated inheritance with inspectable origins, AND filtering, parent includes descendants. |
| R23 | Search and navigation | ✅ | `core/search.ts`, `ui/SearchPalette.tsx`. Incremental names, Search All for notes/checklists/Logbook, Trash excluded unless chosen, all five special views. |
| R24 | Quick move and batch actions | ✅ | `ui/Pickers.tsx`, `ui/ListView.tsx` (`SelectionBar`). Order preserved, whole-selection validation, Undo. |
| R25 | Independent ordering | ✅ | `core/rank.ts`, `core/commands.ts` (`reorderTask`). Today's order is stored separately from structural order. |
| R26 | Advanced insertion and gestures | ⚙️ | `ui/ListView.tsx`. Drag-to-reorder with drop indicators and full menu/keyboard equivalents; a cancelled drag changes nothing. **The draggable creation control and swipe gestures are not built** — every action they would accelerate is reachable by button and keyboard. |

## 10. Rich notes and connected capture

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R27 | Notes and appearance | ✅ | `core/markdown.ts`, `ui/Markdown.tsx`. Markdown rendered as React elements, never as HTML, so embedded markup cannot execute; source preserved. Light/dark/system, scalable text, reduced motion, collapsible sidebar. |
| R28 | Multiple windows | ✅ | Stable links (`?view=`, `?task=`) in `ui/AppShell.tsx`. Two tabs share one IndexedDB database, and `state/store.ts` announces every committed patch set over a `BroadcastChannel` so other tabs apply it in memory at once — without persisting or queueing it again. A replace or erase tells other tabs to reload from the shared store. |
| R29 | Email capture | ⚙️ | `server/email.ts`, `api/inbound-email`, `api/auth/email-inbox`, `ui/AutomationPanel.tsx`. Subject as title, HTML sanitized to text, attachments ignored with a note, 100/day and 10 000 characters, deduplicated by message id. Each account issues, pauses, rotates or removes its own address under **Settings → Automation**; addresses live under `INBOUND_EMAIL_DOMAIN`. Needs a mail provider's inbound webhook. |
| R30 | Links and automation | ✅ | `api/v1/*`, `server/automation.ts`, `ui/AutomationPanel.tsx`. Scoped revocable tokens created and revoked under **Settings → Automation** (the secret is shown once), validation, idempotency keys, pagination, structured project creation. |

## 11. Native Apple platform requirements

| | Requirement | Status |
| --- | --- | --- |
| R31 | Native capabilities (Quick Entry, share extension, Siri/Shortcuts, widgets, Apple Calendar, Handoff, Watch, Vision, Touch Bar) | ➖ **Out of scope for this deliverable.** |

These are P2 and require native Apple clients built and signed in Xcode; they cannot be
part of a web deployment. The groundwork they depend on is in place: one data model, one
recurrence engine, one sync protocol, and an HTTP API a Shortcuts action can call today.

## 12. Logical data model

✅ `core/types.ts` implements every listed entity and invariant.

Two deliberate simplifications, both preserving the stated behaviour:

- **View order** is stored as `rank` and `todayRank` fields on the task rather than as a
  separate table. Today's order stays independent of structural order, which is what the
  requirement tests for, with far less sync surface.
- **Calendar subscriptions and their event cache are device-local.** §12 asks for device
  capabilities and permission state to be device-local; this extends that to the feed
  address, so a secret calendar URL never travels through sync or an export.

## 13. Accounts, offline operation and recovery

| | Requirement | Status | Where |
| --- | --- | --- | --- |
| R32 | Account access and isolation | ⚙️ | `server/auth.ts`, `api/auth/*`. scrypt passwords, signed httpOnly session cookies, owner authorization on every read and write, session revocation. Task text and tokens never enter logs. **Password reset by email is not built** (no mail provider is assumed). |
| R33 | Durable local operations | ✅ | `db/idb.ts`, `db/local.ts`, `state/store.ts`. Record and pending operation commit in one transaction; four distinguishable states; a storage failure surfaces as "Not saved" with export offered. |
| R34 | Synchronisation and conflicts | ⚙️ | `server/sync.ts`, `state/sync-client.ts`, `api/sync/conflicts`, `ui/ConflictsPanel.tsx`. Idempotent by `opId`, field-level merge, server-order resolution with 30-day displaced values, deletion before stale edits. Displaced values are listed under **Settings → Account & sync**, where each can be read beside the value that won, restored as an ordinary undoable edit (`actions.restoreDisplacedValue`), or dismissed. Needs a configured database. |
| R35 | Export, import and account deletion | ⚙️ | `core/portability.ts`, `ui/SettingsPanel.tsx`, `api/auth/account`, `ui/AccountPanel.tsx`. Versioned JSON, validation, count preview, merge or copy, readable text export. Account deletion asks for the password again, removes every server row the account owns in one transaction, clears the session and erases the device's local copy. |

## 14. Quality requirements

| | Requirement | Status |
| --- | --- | --- |
| N01–N04 | Interaction speed, search/startup, sync delivery, notification scheduling | ⚙️ Designed for, **not measured.** No benchmark run against the stated 10 000-task fixture exists, so no claim is made about the p95 targets. |
| N05 | Accessibility | ⚙️ Built to WCAG 2.2 AA: keyboard paths for every action, visible focus, roles and labels throughout, status conveyed beyond colour, no drag required, 44px touch targets on the phone layout. **Colour contrast is checked automatically** — `npm run check:contrast` asserts every text and UI-component pair in both themes against AA, and runs as part of `npm run verify`. Still **not audited** for the rest: no automated axe run or screen-reader pass. |
| N06 | Responsive behaviour | ✅ 320px upward, no horizontal scrolling in core flows, text zoom unrestricted (`maximumScale: 5`), reduced motion honoured from both the system and the in-app setting. |
| N07 | Reliability and recovery | ⚙️ Client-side replay is implemented and tested. Availability, restore-time and backup targets are properties of the chosen host and database, not of this code. |
| N08 | Safe content handling | ✅ Notes and pasted content never rendered as HTML; inbound email sanitized; imports validated whole-or-nothing; sync operations validated against an allow-list; calendar fetches restricted to public HTTPS. |

## 15. Acceptance scenarios

| | Scenario | Covered by |
| --- | --- | --- |
| A01 | Offline capture, close, reopen, reconnect | Partly — `core/__tests__/portability.test.ts` and the durable write path; the multi-device half needs a live database. |
| A02 | Hierarchy and heading move | `membership.test.ts` "moves a heading with all its tasks" |
| A03 | Start moved, deadline unchanged | `membership.test.ts` "moves a start without touching the deadline" |
| A04 | Evening task through midnight | `membership.test.ts` "keeps an unfinished evening task in Today" |
| A05 | Someday project with a dated child | `membership.test.ts` "lets an explicit task start date override the inherited hold" |
| A06 | Fixed and completion-relative weekly rules | `recurrence.test.ts` (six cases) |
| A07 | Day 31, February 29, both DST transitions | `dates.test.ts`, `recurrence.test.ts` |
| A08 | Concurrent checklist and note edits | Partly — the merge rules are in `server/sync.ts`; validation is tested, the two-device merge is not. |
| A09 | Delete on one device, edit offline on another | Partly — `membership.test.ts` covers delete/restore; the cross-device half is untested. |
| A10 | Calendar changes and revoked access | `calendar.test.ts` (seven cases) |
| A11 | Export, import, repeated merge | `portability.test.ts` (six cases) |
| A12 | Keyboard and screen reader only | Not automated. Keyboard paths exist and were exercised by hand; no screen-reader pass was run. |

**125 unit tests** cover the domain rules. **18 browser interaction checks** cover
capture, editing, scheduling, list membership, headings, duplication, promotion, undo
and reload persistence.

The gap worth naming: everything requiring **two live devices against a real database**
is implemented but not yet exercised end to end. That is the first thing to test after
the first deploy with `DATABASE_URL` set.

## 16. Implementation sequence

Built in the order §16 asks for: data model and clock/date rules first, then capture,
hierarchy and list queries, then ordering, tags and search, then accounts, sync and
recovery, and only then recurrence, integrations and the automation API.
