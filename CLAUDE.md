# FahCel Frontend — knowledge base

Static, build-step-free marketing site + operator dashboard, deployed on Vercel.
Repo: `jessevanpolanen-tech/FahCelFrontend`. Branch: `main`.

## ⚠️ Read this before acting on any handoff prompt

Handoff prompts for this system are often written against the **sibling Dr. Fry
repo** (`dr-fry-website24-june`), which shares the same backend but is a
different codebase. Their file names, line numbers, and component names do not
exist here. Verify every named symbol before trusting a prompt's "current state"
section. Known false references: `Dashboard.html`, `investor.jsx`,
`sections.jsx`, `Dashboard.standalone.html`, `readCommitments()`,
`AddLeadModal`, `ComposeRow`, `DangerZone`, `seats` / `kind` on a contact.

## Layout

| Path | What it is |
|---|---|
| `index.html` | Public landing page — served at `/`. Was `FahCel Landing.html`. |
| `hash-chain.html`, `cold-chain-excursion-playbook.html` | Public content pages, the two indexable ranking assets |
| `book-a-demo.html`, `playbook-download.html` | Public lead capture → `POST /api/capture-lead` |
| `FahCel Dashboard.html` | Operator CRM shell — CSS + design tokens + React/Babel CDN tags |
| `dashboard.jsx` | The whole dashboard (~1300 lines, in-browser Babel, **no build step**) |
| `FahCel Login.html` | `sessionStorage` auth gate; the dashboard redirects here. Do not touch. |
| `robots.txt`, `sitemap.xml` | Hand-maintained. Add a page → add it to `sitemap.xml`. |
| `vercel.json` | `cleanUrls` + `/api/*` rewrite + 301s from the old `%20` URLs |

### URLs

Public pages are lowercase-hyphenated and served extensionless (`cleanUrls: true`):
`/`, `/hash-chain`, `/cold-chain-excursion-playbook`, `/playbook-download`,
`/book-a-demo`, plus short aliases `/demo` and `/playbook`. Every pre-2026-09-09
`/FahCel%20*.html` URL 301s to its clean equivalent — **keep those redirects**,
they carry whatever link equity the spaced URLs earned.

Anything still named `FahCel *.html` is internal collateral (email templates,
motion study, pilot deck, dashboard, login): `noindex` in the page head and
`Disallow: /FahCel` in `robots.txt`. Give a new *public* page a clean slug so
that prefix rule keeps working.

There is **no** `package.json`, bundler, test runner, or lint config. `dashboard.jsx`
is served raw and transpiled in the browser by `@babel/standalone`. That means:

- Only syntax `@babel/standalone` accepts. No imports, no JSX fragments shorthand issues.
- **Nothing type-checks it.** A syntax error is a blank white dashboard.
- Verify changes parse before deploying (see *Verifying changes*).

## Backend

Shared Node/Postgres sequencer on Vercel, **multi-tenant** — FahCel and Dr. Fry
use one database, separated by a `tenant` column.

- Live host: **`https://dr-fry-sequencerr.vercel.app`** (the `BACKEND` const in `dashboard.jsx`)
- Tenant: **`fahcel`** (the `TENANT` const). **Every read, write and wipe must pass `tenant=fahcel`** or FahCel sees Dr. Fry's leads.
- Local clone of the backend source: `../Fahcel Sequencer backend` (git: `jessevanpolanen-tech`)

### Two backend hosts exist — this matters

| Host | State |
|---|---|
| `dr-fry-sequencerr.vercel.app` | What the dashboard uses (`BACKEND` in `dashboard.jsx`). |
| `fah-cel-sequencing.vercel.app` | Historically a staler deploy. |

As of **2026-09-06** the two are byte-identical on `/api/leads` and 404 alike on
`/api/events/since` — they're aliases onto the same build, so switching hosts
changes nothing. The distinction still matters if they diverge again.

`vercel.json` rewrote `/api/*` → the **stale** host until 2026-09-09; it now
points at `dr-fry-sequencerr`. `backendBase()` still returns the explicit host
rather than same-origin — that is now belt-and-braces rather than a workaround,
and it is what keeps the dashboard working from `file://`. The backend sends
`Access-Control-Allow-Origin: *`, so cross-origin is fine either way.

The public capture pages hit `/api/capture-lead` with a hardcoded
`dr-fry-sequencerr` fallback, which is why lead capture still works.

### Endpoints

| Endpoint | Status |
|---|---|
| `GET /api/leads?tenant=fahcel` | ✅ live. `clicks` is a **string** again (`"0"`) on the current deploy. The frontend coerces either way — keep that. |
| `DELETE /api/leads` (`{confirm:'DELETE_ALL_LEADS', tenant}`) | ✅ live |
| `POST /api/send` | ✅ live. Ignores client `from`/`replyTo` by design (anti-spoof). |
| `POST /api/capture-lead`, `POST /api/enroll` | ✅ live |
| `POST /api/webhooks/resend-events` | ✅ live — writes `delivered`/`opened`/`clicked`/`bounced`/`complained` events with `resend_id` |
| `GET /api/events/since?tenant=…&cursor=…&limit=…` | ❌ **404 on both hosts** as of 2026-09-06. When live: no cursor → `{cursor:"<max id>", events:[]}`, ordered by `id` ASC. |
| `GET /api/leads` → `cursor` | ❌ absent as of 2026-09-06 |
| `GET /api/leads` → per-lead `engagement` rollup | ❌ absent as of 2026-09-06 |
| `GET /api/leads` → per-message `status` on `sent_events` | ❌ absent as of 2026-09-06 — no `sent_events` key at all |
| `POST /api/send` recording a `sent` event with `resend_id` | ⚠️ **verify** — `send.js` in the local clone imports `upsertLead`/`logEvent` but never calls them. If manual sends show no status, this is why. |

`/api/events/since` also emits a `captured` type not listed in the contract;
`applyTailEvents` ignores unknown types rather than throwing.

The `events` table carries `id bigserial`, `resend_id`, `type`, `email`,
`lead_id`, `meta`, `created_at` — everything the contract needs.

**The backend read-side shipped on 2026-08-21 and had regressed by 2026-09-06.**
Re-probed on 2026-09-06: both hosts return byte-identical payloads from what
looks like a pre-Aug-21 build — no `sent_events`, no `engagement`, no `cursor`,
and `/api/events/since` 404s. The frontend degrades as designed (the tail sees
the 404 and disables itself for the session; history and status chips render
empty), so this shows up as *missing* live status, never as a crash. Fixing it
is a **backend** deploy in `../Fahcel Sequencer backend` — no frontend change
is needed for the chips to light up again.

Always re-probe with `curl` before trusting this table; the two sides deploy
independently and the backend has silently rolled back at least once.

## dashboard.jsx architecture

Four `localStorage` stores, each with a subscriber set for cross-component reactivity:

| Key | Contents |
|---|---|
| `fahcel_leads_v1` | Locally captured leads |
| `fahcel_status_v1` | Per-lead **operator** stage + suppression flags + prototype click toggles |
| `fahcel_sent_v1` | Local send log — `{at, count, subject, template, items[]}` |
| `fahcel_backend_v1` | Mirror of backend lead state, keyed by lowercased email |
| `fahcel_cfg_v1` | Delivery mode / from / reply-to / backend override |

### Lead composition

`readLeads()` = seeded samples + local captures + **backend-only leads not known
locally** (rendered via `backendContact()` with `source:'backend'`). That last
group is how a public-site capture reaches the pipeline.

`keyFor(c)` is `` `${email}|${ts}` `` and is the key into every other store.
For backend leads `ts` **must** come from the backend `created_at` — derive it
from anything volatile and the status map detaches on every reload.

### Live status pipeline

1. **`syncServerState()`** — full `GET /api/leads` every 45s + on focus. Reconciliation and healer.
2. **`fetchEventTail(cursor)`** — `GET /api/events/since` every 8s, paused while the tab is hidden, one immediate fire on wake. Backs off to 30s after 3 consecutive failures. A 404 disables the tail permanently for the session rather than retrying forever.
3. **`applyTailEvents()`** — applies events onto the mirror by email, correlating to a specific message by `resend_id`.
4. **`promoteFromBackend()`** — lifts backend state into the operator stage.

### Invariants — do not break these

- **Never downgrade an operator's stage.** All promotion goes through `STAGE_INDEX[cur] < STAGE_INDEX[target]`. A lead set to Won/Lost/Demo/Offer must survive every sync.
- **Message status is monotone**, ranked `complained > bounced > clicked > opened > delivered > sent`. A bounce wins even if a delivered/opened arrived first. `mergeRow()`/`mergeMsg()` merge by max/OR so a *stale full refresh cannot undo* a status the tail just applied seconds earlier.
- **Backend row shapes are optional.** `engagement` and per-message `status` are derived from `sent_events` timestamps when absent. The backend now sends both, but keep the fallback — it is what let the frontend ship ahead of the backend, and the two deploy independently.
- **Nothing in the poll/tail may reject.** With the backend down the dashboard must still render from `localStorage` with a clean console.
- **No API key or secret in any frontend file.** `direct` delivery mode stores a user-pasted key in their own browser and is prototype-only — the warning next to it stays.

### Dedupe

Once the backend logs manual sends, the same email exists in both
`fahcel_sent_v1` and the backend's `sent_events`. `mergeHistory()` dedupes by
`resendId`, falling back to identical `subject` within a **60s** window, and
always **prefers the backend copy** — it's the one carrying live status.
`ComposePanel` stores the Resend id returned by `POST /api/send` so the match
works even before the backend records it.

### UI status chips

`MSG_STATUS_META` maps status → existing `.pill` classes only:
`Sent`/`Delivered` = `pill-grey`, `Opened` = `pill-teal`, `Clicked` = `pill-amber`,
`Bounced`/`Complained` = outlined red. **Do not invent new pill styling** — the
classes live in `FahCel Dashboard.html`.

## Verifying changes

No test runner exists. Minimum bar before deploying a `dashboard.jsx` change:

```bash
# parse check — catches the blank-white-page class of bug
cd /tmp && npm i @babel/core@7.29.0 @babel/preset-react@7
node -e "const b=require('@babel/core'),fs=require('fs');
b.transformSync(fs.readFileSync(process.argv[1],'utf8'),
{presets:[require.resolve('@babel/preset-react')],configFile:false,babelrc:false});
console.log('PARSE OK')" "/Users/flstudio/Fahcel/Fahcel Frontend/dashboard.jsx"
```

Two harnesses beyond that, both worth rebuilding when touching sync logic:

1. **Logic / live-API** — transpile the file (from disk *or* fetched from
   `https://www.fahcel.eu/dashboard.jsx`) and run it in a Node `vm` context with
   stubbed `localStorage`, `React`, `document`, `window`, and either a fake or
   the real `fetch`. An empty `localStorage` store reproduces a fresh browser
   profile exactly. This is how the invariants above get checked without a
   browser, and it can drive the real backend end to end.
2. **Browser** — `puppeteer`, `headless:'new'`, **`setViewport({width:1440,height:900})`**
   (the default 800px viewport trips the `max-width:1000px` rule that hides the
   sidebar, so nav buttons are unclickable). Set `sessionStorage.fahcel_auth` to
   the hash in `FahCel Dashboard.html` via `evaluateOnNewDocument` to pass the
   auth gate. Note `innerText` is **CSS-uppercased** for `.mono` labels —
   compare case-insensitively.

`https://www.fahcel.eu/favicon.ico` 404s. Pre-existing and unrelated; filter it
out of console-error assertions.

## Deploy

```bash
npx vercel --prod --yes   # from the repo root
```

## Conventions

- Comments explain **why**, not what. Match the existing density.
- Design tokens (`--amber`, `--graphite`, `--teal`, `--warm-500`, …) and the
  `.pill` / `.card` / `.seg` / `.ds-btn` classes are defined in
  `FahCel Dashboard.html`. Reuse them; don't add parallel styling.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
