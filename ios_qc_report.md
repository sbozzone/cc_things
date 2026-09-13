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

- [ ] **IOS-QC-004 — Task editor initially focuses completion control instead of title**
  - **Severity:** Minor
  - **Device/OS:** iPhone 15 Pro-sized viewport, 393 × 852
  - **Reproduce steps:**
    1. Tap an existing task row.
    2. Observe the newly opened Edit task dialog.
    3. Inspect the active element.
  - **Expected:** If the editor is intended for immediate text editing, the title field receives focus; otherwise no destructive/action control should receive initial focus unexpectedly.
  - **Actual:** The completion checkbox receives initial focus. Editing still works after tapping the title.
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
