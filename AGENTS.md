# AGENTS.md — Base44 dev environment notes

## What this is

Static, build-step-free marketing site + operator dashboard (FahCel frontend).
No `package.json`, no bundler, no test runner. HTML/JS/JSX served directly;
`dashboard.jsx` is transpiled in the browser by `@babel/standalone`.

## How it runs here

nginx (alpine) serves the repo bind-mounted at `/usr/share/nginx/html` on port
3000. Config: `.base44/nginx.conf`, which replicates `vercel.json`:
- **cleanUrls** — `try_files $uri $uri.html $uri/` serves `/book-a-demo` from
  `book-a-demo.html`.
- **`/api/*` proxy** — forwards to `https://dr-fry-sequencerr.vercel.app`
  (the shared hosted backend). Pages also fall back to that absolute URL
  directly, so the proxy is belt-and-braces.
- **301 redirects** for legacy `FahCel%20*.html` URLs and `/demo` → `/book-a-demo`,
  `/playbook` → `/cold-chain-excursion-playbook`.
- **`/favicon.ico`** → `/assets/fahcel-logo.jpg`.

Edits to any HTML/JS/JSX file appear on the next request (nginx reads from
disk); no rebuild needed. Call `reload_preview` after edits so the user sees
them.

## Permissions quirk

The repo directory can land with `drwx------` (mode 700), which nginx's worker
user cannot traverse → 403. Fix: `chmod 755 /app && chmod -R a+rX /app` on the
host before starting. This is already handled; only re-run if a fresh clone
restores mode 700.

## No credentials needed

The backend is a shared hosted Vercel API (`dr-fry-sequencerr.vercel.app`),
multi-tenant by `tenant=fahcel`. No API keys or secrets are required for the
frontend to run — the dashboard and capture pages call the backend by absolute
URL with `Access-Control-Allow-Origin: *`.

## Verifying

```bash
docker compose -f docker-compose.base44.yml ps          # healthy
curl -s -o /dev/null -w '%{http_code}' localhost:3000/  # 200
curl -s localhost:3000/ | grep '<title>'                # FahCel landing
```

See `CLAUDE.md` for the full project knowledge base (page inventory, backend
endpoints, dashboard architecture, deploy workflow).

## Public-page languages

- English remains at the original URLs; Dutch/German live at `/nl` and `/de`
  plus the same page slugs. The five public pages have static, reciprocal
  hreflang links. Internal collateral and the Dutch USB-logger draft are excluded.
- Edit English source pages and `locales/*.tsv` (source, Dutch, German columns).
  Dynamic UI copy is in `locales/scripts.json`; never translate backend payload
  keys, option values, or tenant identifiers. Rebuild after source edits:
  `docker run --rm -v "$PWD":/app -w /app python:3.12-slim python scripts/build-locales.py`.
  Add `--check` to detect stale output. `/nl/*.html` and `/de/*.html` are generated
  and committed so Vercel needs no Python runtime or new build step.
- The generator owns only `languages:head` and `languages:nav` blocks in the
  English pages. Localized assets and links use root-relative paths; switching
  languages preserves the current page, query parameters and section fragment.
- Translated printable guides use doc-page's existing flowing mode, not the
  fixed-height English page boxes: longer translations otherwise get clipped.
  The exported `sheet` part lets the translated guide fit a narrow screen.
- Do not submit live lead forms during testing: they write to the shared backend
  and may send real email. Test validation/navigation without completing a lead.
- Healthcheck must use `127.0.0.1`, not `localhost` (nginx listens on IPv4).
