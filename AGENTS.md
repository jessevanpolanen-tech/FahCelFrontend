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
