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
| `usb-logger.html` | USB temperature logger product page + sample-pack form. **Hidden draft** — see *USB logger page* below. |
| `llms.txt` | Plain-text site summary for AI crawlers. Hand-maintained, like `sitemap.xml`. |
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

`/usb-logger` is deployed but deliberately **not** in that list: it is `noindex`
and its `sitemap.xml` entry is commented out until launch.

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
- Local clone of the backend source: `../Fahcel Sequencer backend`

### 🚨 The backend deploys from a DIFFERENT repo than the local clone pushes to

This is the single most expensive trap in this system. Verified 2026-09-20:

| | |
|---|---|
| Vercel project serving the API | `dr-fry-sequencerr` (`prj_w4pOAEXpiKStjYtfSpY6hHVAiS8E`) |
| **Auto-deploys from** | **`github.com/jessevanpolanen-tech/DrFrySequencerr`**, branch `main` |
| Local clone `../Fahcel Sequencer backend` pushes to | `DrFrySequencerr` ✅ **re-pointed 2026-09-20** (was `FahCelSequencing`) |

**Resolved 2026-09-20:** the local clone was re-cloned from `DrFrySequencerr`,
its 5 local-only commits confirmed already absorbed upstream, and the old tree
kept at `../Fahcel Sequencer backend.OLD`. The new clone has **no `.vercel/`
directory** — keep it that way, so deploys can only happen via git push and the
CLI-overwrite path stays closed. History below, because the failure mode is
subtle enough to re-create by accident.

**Pushing to `FahCelSequencing` deploys nothing.** Only pushes to
`DrFrySequencerr` reach production. The single way FahCelSequencing code has
ever gone live is a manual `vercel --prod` from the clone — and the next
`DrFrySequencerr` push silently overwrites it. That is exactly the
2026-08-21 → 2026-09-06 "silent rollback": CLI-deployed work, then reverted by
a git push to the other repo.

The two repos have diverged (~14 files). Each holds files the other lacks:
`api/debug.js`, `db/fix-tenant.sql`, `db/fix-leads-unique.sql` only in
FahCelSequencing; `api/sequence-export.js`, `db/migrate-namespace-sequences.sql`,
`docs/` only in DrFrySequencerr. The local clone matches neither — it is
2 commits behind FahCelSequencing *and* differs from deployed prod in the same
~14 files.

Both repos **do** currently carry tenant-scoped `dueEnrollments`,
`api/events/since.js`, and `send.js` event logging, so FahCel is not broken by
the split today. It is a live footgun, not an outage.

**Before touching the backend:** confirm which repo you are in, and remember
that `dr-fry-sequencerr` is one shared multi-tenant deployment — re-pointing its
git connection affects Dr. Fry too.

### ✅ `DrFrySequencerr` is the source of truth (confirmed 2026-09-20)

Not just because it is what deploys — it is genuinely the newer codebase:

- Newest commit 2026-09-11 vs FahCelSequencing's 2026-09-08.
- `api/leads.js` and `api/events/since.js` are **byte-identical** between the
  two repos, so the live-status plumbing is the same either way.
- It is **multi-tenant aware where FahCelSequencing is not.** Sequence ids are
  namespaced per brand — `drfry-founding`, `fahcel-founding`, `fahcel-playbook`,
  `kavel-founding`. FahCelSequencing still uses the old single-tenant names
  (`founding-outreach`, `playbook-nurture`) and knows nothing about Kavel.
- Only DrFrySequencerr carries `db/migrate-namespace-sequences.sql`, the
  migration from the old names to the namespaced ones.

`FahCelSequencing` is the **older fork**, despite carrying more FahCel-flavoured
copy (20 `fahcel.eu` refs vs 2). Do not treat "it says FahCel" as "it is newer".

Any earlier note that DrFrySequencerr was *behind* refers to the Aug-15
comparison against `DrFryWebsite24June/backend` — a different pair, and stale.

### ⚠️ One deployment, one `FROM_EMAIL`, two brands

`lib/resend.js#fromLine()` reads a single `FROM_EMAIL` / `FROM_NAME` env var and
deliberately has **no per-brand fallback** — its own comment says "each
deployment sets its own verified sender." But `dr-fry-sequencerr` is *one*
deployment serving both tenants, so **every FahCel sequence email goes out from
whatever `FROM_EMAIL` is set on that project**, which is probably a Dr. Fry
address. `lib/sequences.js` gets per-brand `site`/`contact` right via its
`BRAND` map; the envelope sender is not brand-aware at all.

Check `FROM_EMAIL` on the `dr-fry-sequencerr` Vercel project before trusting
FahCel's outbound branding. Properly fixing it means either a per-brand sender
argument through `sendEmail()`, or separate deployments per brand (which is what
the code was written to expect).

Smaller wart: `api/unsubscribe.js` hardcodes `jesse@drfry.nl` in two error-path
messages, so a FahCel recipient with a broken unsubscribe link is told to email
Dr. Fry. Happy path is fine.

### ⚠️ Orphaned sequence ids in the database

Both live FahCel leads are enrolled in **`playbook-nurture`**, which the
deployed code no longer defines (DrFrySequencerr namespaced it to
`fahcel-playbook`). Harmless today — both rows are terminal (`unsubscribed`,
`completed`) — but it means `db/migrate-namespace-sequences.sql` looks unrun.
New captures get the correct namespaced ids, so this only affects pre-migration
rows. Check for **active** enrollments on an old id before assuming it's inert.

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
| `GET /api/leads?tenant=fahcel` | ✅ live. `clicks` has been both string and int across deploys; the frontend coerces either way — keep that. |
| `DELETE /api/leads` (`{confirm:'DELETE_ALL_LEADS', tenant}`) | ✅ live |
| `POST /api/send` | ✅ live. Ignores client `from`/`replyTo` by design (anti-spoof). |
| `POST /api/capture-lead`, `POST /api/enroll` | ✅ live |
| `POST /api/webhooks/resend-events` | ✅ live — writes `delivered`/`opened`/`clicked`/`bounced`/`complained` events with `resend_id` |
| `GET /api/events/since?tenant=…&cursor=…&limit=…` | ✅ live (re-verified 2026-09-20). No cursor → `{cursor:"<max id>", events:[]}`, ordered by `id` ASC. |
| `GET /api/leads` → `cursor` | ✅ live (2026-09-20) |
| `GET /api/leads` → per-lead `engagement` rollup | ✅ live (2026-09-20) |
| `GET /api/leads` → per-message `status` on `sent_events` | ✅ live (2026-09-20) |
| `POST /api/send` recording a `sent` event with `resend_id` | ✅ live — `send.js` now calls `upsertLead` + `logEvent`. |

`/api/events/since` also emits a `captured` type not listed in the contract;
`applyTailEvents` ignores unknown types rather than throwing.

The `events` table carries `id bigserial`, `resend_id`, `type`, `email`,
`lead_id`, `meta`, `created_at` — everything the contract needs.

**Timeline:** the backend read-side shipped 2026-08-21, had silently regressed
to a pre-Aug-21 build by 2026-09-06, and was **restored and committed by
2026-09-20** (`c8ca984`, `c0d3674`, `14c7110`). Re-verified live on 2026-09-20:
`cursor`, `engagement`, `sent_events` with per-message `status` and `resend_id`
all present, `/api/events/since` returns 200. The whole live-status pipeline
works end to end — no frontend change was needed for the chips to light up,
which is what the derive-when-absent fallbacks bought.

### ⚠️ Open: no open/click events have ever been recorded

Across 43 `tenant=fahcel` events the only types present are `delivered` (19),
`send_failed` (10), `sent` (8), `captured`, `enrolled`, `replied`,
`unsubscribed`. **`opened`, `clicked`, `bounced` and `complained` have never
been recorded once.**

`delivered` arriving proves the webhook endpoint and its Svix signature check
work, and `resend-events.js` handles all four missing types. So the gap is in
the **Resend dashboard, not the code**: open/click tracking on the sending
domain, and/or the webhook's subscribed event list. Until that is switched on
a chip can never advance past `Delivered`, however healthy the tail is.

`send_failed` (last seen 2026-09-07) was a missing `RESEND_API_KEY` plus a
`next_due_at` not-null violation; deliveries resumed through 2026-09-16, so
both are resolved. Historical, not current.

Always re-probe with `curl` before trusting this table; the two sides deploy
independently and the backend has silently rolled back at least once.

## USB logger page — launch status

`usb-logger.html` → `/usb-logger`. **Deployed 2026-09-24 as a hidden draft**:
reachable by URL, but `noindex,nofollow`, not linked from any page, not in
`sitemap.xml` or `llms.txt`, and carrying an amber "Internal draft" banner.

**Why it is a draft:** 18 hardware figures are placeholders, each wrapped in
`<span class="tbd">` (amber dashed underline). No datasheet has been supplied.
Do **not** invent values to "finish" it — certifications (CE, RoHS, calibration
cert) are regulated claims, and the range/accuracy/battery numbers get quoted
back by buyers.

**Launch checklist** lives in the comment at the top of the file. In short:
replace every `.tbd` from the datasheet, confirm sample-pack terms (free? how
many?), add price/availability to the Product JSON-LD `offers`, swap the hero
illustration for a real photo, delete `.draftbar` + its CSS, flip robots to
`index,follow`, uncomment the sitemap block, then add the page to `llms.txt`.
`grep -c 'class="tbd"' usb-logger.html` must be 0 before launch.

**Sample-pack form** posts to `capture-lead` (absolute `dr-fry-sequencerr` URL
first, `/api` rewrite as fallback) with `tenant:'fahcel'`,
`source:'fahcel-usb-logger-sample'`, and **no** `enroll`/`sequenceId`. That is
deliberate: `capture-lead` only enrolls when asked, and an unknown sequence id
falls back to `fahcel-founding` — the cold pitch, wrong for someone who asked
for hardware. The lead is captured and the operator gets `notifyNewLead`; a
human ships the box. Add a `fahcel-usb-sample` sequence in the backend's
`lib/sequences.js` before ever enrolling from this form. On success the lead is
also mirrored into `fahcel_leads_v1` in that browser's `localStorage`.

Don't submit the live form while testing — it creates a real lead and emails
the operator.

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

The CLI uploads the **working tree**, untracked files included — not the last
commit. Uncommitted edits go live, and so would anything not excluded.
`.vercelignore` keeps `haccp-pro/` (separate repo), `plans/`, `CLAUDE.md` and
`.claude/` off the public site, plus the design-reference media. Add any new
internal folder there **before** the next deploy.

## Conventions

- Comments explain **why**, not what. Match the existing density.
- Design tokens (`--amber`, `--graphite`, `--teal`, `--warm-500`, …) and the
  `.pill` / `.card` / `.seg` / `.ds-btn` classes are defined in
  `FahCel Dashboard.html`. Reuse them; don't add parallel styling.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
