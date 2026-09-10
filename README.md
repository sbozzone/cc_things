# Clearing

A calm, local-first task manager: capture a thought, organise work, choose what to do
today, and keep commitments visible. Built from
`Things_Task_Manager_Requirements.docx` (R01–R35, N01–N08, A01–A12) as a responsive web
app with an installable PWA experience.

Original product name, icons and design system; independent data and sync service. It is
not a Things client and has no connection to Things Cloud.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

Nothing else is required. With no configuration the app is fully usable: it stores
everything in IndexedDB on the device, works offline, and says so in Settings.

```bash
npm run verify     # typecheck + 103 unit tests + production build
```

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project**, import the repository, and deploy. The framework is
   detected automatically; no build settings need changing.

That is a complete, working deployment — local-first, offline-capable, installable.

### Turning on accounts and cross-device sync

Sync is optional and off until both variables are present. A half-configured deployment
never pretends to be syncing.

1. In the Vercel project, **Storage → Create Database → Postgres**, and attach it. That
   sets `POSTGRES_URL`. Any other Postgres works too — set `DATABASE_URL` instead
   (Neon, Supabase and Railway connection strings all work as-is).
2. Add an environment variable `AUTH_SECRET`, at least 32 characters:

   ```bash
   openssl rand -base64 48
   ```

3. Redeploy. The database schema is created on first use — there is no migration step.

Then open the app, go to **Settings → Account & sync**, and create an account. Work
already on the device stays there and is uploaded to the account.

### Optional: inbound email capture

Set `INBOUND_EMAIL_SECRET` (16+ characters) and point a mail provider's inbound webhook
at `POST /api/inbound-email` with that value in an `x-inbound-secret` header. See
`.env.example`.

## Connecting a calendar

**Settings → Calendar** takes a read-only iCalendar (`.ics`) feed address — Google
Calendar's "Secret address in iCal format", or a published iCloud or Outlook calendar.
Events appear above tasks in Today and on the matching Upcoming day. Access is one-way:
a calendar change can never complete or reschedule a task, and the cache is device-local
so it is never synced as task data and never leaves in an export.

---

## How it is put together

```
src/core/      Pure domain rules. No React, no DOM, no I/O — all unit tested.
  types.ts       The logical data model (§12).
  clock.ts       Injectable clock and planning time zone.
  dates.ts       Date-only arithmetic and DST-aware reminder instants.
  rank.ts        Fractional indexing for ordering.
  membership.ts  List membership and the project scheduling policy (§4, §5).
  selectors.ts   Every view as a query over one record set.
  commands.ts    User actions, expressed as patches.
  recurrence.ts  Repeat templates, occurrences and their edge policies (§7).
  patches.ts     One patch shape for local edits and incoming sync deltas.
  ...            search, markdown, natural dates, calendar, portability.
src/db/        IndexedDB persistence: records and pending operations in one transaction.
src/state/     Store, bound actions, sync client, calendar cache.
src/ui/        Interface.
src/server/    Postgres, accounts, the sync engine, automation and email helpers.
src/app/       Next.js routes and API endpoints.
```

The shape that holds it together: **every change is a patch.** A keystroke in the editor,
an import, an operation arriving from another device and a write from the automation API
all produce the same `{ table, id, patch }` records. One write path applies them in
memory, commits them with their sync operations in a single durable IndexedDB
transaction, and captures an exact inverse for Undo.

### The date engine

Date-only values (`YYYY-MM-DD`) are never converted to an instant, so a September 10
deadline stays September 10 on every device. "Today" is resolved in one account-wide
planning zone, so changing devices never moves your planning day. Reminders are the only
values carrying a zone: they store the wall time, the IANA zone and the resolved
instant. A wall time inside a spring-forward gap is delivered at the next valid local
time; one that occurs twice in a fall-back is delivered at the first occurrence, once.

### Sync

Operations are incremental and idempotent by `opId`, so replaying a queue after a
reconnect never duplicates an item, a completion or a recurring occurrence. Changes to
different fields — and to different checklist rows — merge. A same-field clash is
resolved by server-assigned order, and the displaced value is retained for 30 days.
Deletion beats a stale edit: only an explicit restore reactivates deleted data.

## Automation API

Create a token in **Settings → Account & sync** (requires an account). All endpoints take
`Authorization: Bearer <token>` and accept an `Idempotency-Key` header on writes.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/tasks` | Search with `query`, `status`, `limit`, `cursor` |
| `POST` | `/api/v1/tasks` | Create a task, with checklist and tags |
| `GET` | `/api/v1/tasks/:id` | Retrieve one task |
| `PATCH` | `/api/v1/tasks/:id` | Update, complete, cancel, move or delete |
| `POST` | `/api/v1/projects` | Create a project with headings and tasks in one call |

Repeating a create with the same idempotency key returns the original id. An invalid
parent returns an actionable error and writes nothing partial.

Stable links: `/?view=today`, `/?view=project:<id>`, `/?task=<id>`.

## Keyboard

Every action has a button or menu; nothing needs a shortcut, and nothing needs a drag.
The full reference is in **Settings → Keyboard**. The common ones:

| | |
| --- | --- |
| `⌘/Ctrl + K` or `/` | Search |
| `N` / `Shift + N` | Add here / quick capture to Inbox |
| `1`–`6` | Jump to the built-in lists |
| `Enter` | Open the task editor |
| `T` `E` `A` `S` | Today, This Evening, Anytime, Someday |
| `⌘/Ctrl + Z` | Undo |

## Scope

`docs/REQUIREMENTS.md` maps every numbered requirement to where it is implemented and
states plainly what is not built. In short: **P0 is complete**, P1 is complete except
where it needs a provider this deployment does not have, and **P2 (native Apple clients)
is out of scope** for a web deployment.
