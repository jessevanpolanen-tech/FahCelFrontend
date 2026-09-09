const { useState, useEffect, useMemo } = React;

// ── FahCel client pipeline — a sales CRM for cold-chain operators ──
const CRM = {
  product: 'FahCel',
  demoLength: '30-min',
};

const STORE_KEY = 'fahcel_leads_v1';

// Shared sequencer backend — same Vercel deployment + Postgres as Dr. Fry.
// Every call is scoped by tenant so the two apps never see each other's leads.
const BACKEND = 'https://dr-fry-sequencerr.vercel.app';
const TENANT = 'fahcel';


const lc = (v) => String(v || '').trim().toLowerCase();
const toMs = (v) => { if (!v) return 0; const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; };

// Leads = anything captured locally + anything the backend knows that we've
// never seen here (public-page captures land straight in Postgres, so without
// this last group they'd never reach the pipeline).
//
// No sample data. The pipeline shows real leads only, so a wipe in Postgres is
// actually visible here — seeded rows used to render regardless of the backend,
// and any real lead sharing a seeded address was dropped by the dedupe below.
function readLeads() {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch {}
  const real = stored.map((s) => ({ ...s, source:'live' }));
  const known = new Set(real.map((c) => lc(c.email)));
  const remote = Object.values(readBackendLeadState())
    .filter((r) => r && r.email && !known.has(lc(r.email)))
    .map(backendContact);
  return [...real, ...remote].sort((a,b) => b.ts - a.ts);
}

// A backend-only lead rendered as a pipeline contact. `ts` comes from the
// backend's created_at so keyFor() stays stable across reloads — derive it
// from anything volatile and the per-lead status map detaches every refresh.
function backendContact(r) {
  return {
    name: r.name || r.email,
    org: r.org || '—',
    role: r.role || 'Website lead',
    email: r.email,
    ts: r.createdAt || 0,
    status: 'new',
    message: '',
    source: 'backend',
  };
}

// Sent-history store — records when you last emailed each lead, plus a
// per-message log so the compose panel can show a real history.
const SENT_KEY = 'fahcel_sent_v1';
const keyFor = (c) => `${c.email}|${c.ts}`;
function readSent() {
  try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}'); } catch { return {}; }
}
function recordSent(c, mail) {
  const all = readSent();
  const k = keyFor(c);
  const prev = all[k] || { count: 0 };
  const item = {
    at: Date.now(),
    subject: (mail && mail.subject) || '',
    template: (mail && mail.template) || '',
    // Resend's message id, when the proxy handed one back. It's what lets the
    // backend copy of this same send be recognised as a duplicate later.
    resendId: (mail && mail.resendId) || '',
  };
  const items = [...(prev.items || []), item].slice(-50);
  all[k] = { at: item.at, count: (prev.count || 0) + 1, subject: item.subject || prev.subject || '', template: item.template || prev.template || '', items };
  try { localStorage.setItem(SENT_KEY, JSON.stringify(all)); } catch {}
  return all;
}

// ─────────────────────────────────────────────────────────────────
// Backend lead state — a local mirror of what the sequencer knows
// ─────────────────────────────────────────────────────────────────
// Keyed by lowercased email. Persisted so the dashboard still renders leads,
// history and status chips when the backend is slow or unreachable, and so a
// reload doesn't blank the pipeline while the first poll is in flight.
const BACKEND_KEY = 'fahcel_backend_v1';
function readBackendLeadState() {
  try { const m = JSON.parse(localStorage.getItem(BACKEND_KEY) || '{}'); return (m && typeof m === 'object') ? m : {}; }
  catch { return {}; }
}
const backendSubs = new Set();
function publishBackendLeadState(map) {
  try { localStorage.setItem(BACKEND_KEY, JSON.stringify(map)); } catch {}
  backendSubs.forEach((fn) => fn(map));
}
function useBackendLeadState() {
  const [map, setMap] = useState(readBackendLeadState);
  useEffect(() => { const fn = (m) => setMap({ ...m }); backendSubs.add(fn); return () => backendSubs.delete(fn); }, []);
  return map;
}

// Per-message status — the furthest point a single email reached.
// complained > bounced > clicked > opened > delivered > sent.
// A bounce or complaint always wins, even if a delivered/opened arrived first.
function deriveMsgStatus(at) {
  if (at.complained) return 'complained';
  if (at.bounced) return 'bounced';
  if (at.clicked) return 'clicked';
  if (at.opened) return 'opened';
  if (at.delivered) return 'delivered';
  return 'sent';
}
const MSG_RANK = { sent:0, delivered:1, opened:2, clicked:3, bounced:4, complained:5 };

function normalizeSentEvent(e) {
  const at = {
    sent: toMs(e.created_at),
    delivered: toMs(e.delivered_at),
    opened: toMs(e.opened_at),
    clicked: toMs(e.clicked_at),
    bounced: toMs(e.bounced_at),
    complained: toMs(e.complained_at),
  };
  return {
    resendId: e.resend_id || '',
    subject: e.subject || '',
    body: e.body || '',
    step: e.step || '',
    source: e.source || 'sequence',
    createdAt: at.sent,
    at,
    // Trust the backend's own verdict when it ships one; older deployments
    // send the timestamps without it, so derive from those instead.
    status: e.status || deriveMsgStatus(at),
  };
}

// The per-lead rollup. Always present in the contract, absent on backends that
// predate it — derive it from the per-message timestamps in that case so the
// row-level counters work either way.
function normalizeEngagement(raw, events) {
  if (raw && typeof raw === 'object') {
    return {
      delivered: Number(raw.delivered) || 0,
      opened: Number(raw.opened) || 0,
      clicked: Number(raw.clicked) || 0,
      bounced: !!raw.bounced,
      complained: !!raw.complained,
      unsubscribed: !!raw.unsubscribed,
      lastEventAt: toMs(raw.last_event_at),
    };
  }
  const e = { delivered:0, opened:0, clicked:0, bounced:false, complained:false, unsubscribed:false, lastEventAt:0 };
  (events || []).forEach((m) => {
    if (m.at.delivered) e.delivered++;
    if (m.at.opened) e.opened++;
    if (m.at.clicked) e.clicked++;
    if (m.at.bounced) e.bounced = true;
    if (m.at.complained) e.complained = true;
    Object.values(m.at).forEach((t) => { if (t > e.lastEventAt) e.lastEventAt = t; });
  });
  return e;
}

function normalizeBackendRow(r) {
  const events = (r.sent_events || []).map(normalizeSentEvent).sort((a,b) => b.createdAt - a.createdAt);
  return {
    id: r.id || '',
    email: lc(r.email),
    name: r.name || '',
    org: r.org || '',
    role: r.role || '',
    createdAt: toMs(r.created_at),
    sequenceId: r.sequence_id || null,
    stepIndex: r.step_index == null ? null : Number(r.step_index),
    status: r.status || null,
    nextDueAt: r.next_due_at || null,
    enrolledAt: r.enrolled_at || null,
    // The live backend returns this as a string; the contract says INT.
    clicks: Number(r.clicks) || 0,
    repliedAt: r.replied_at || null,
    engagement: normalizeEngagement(r.engagement, events),
    sentEvents: events,
  };
}

// Status only ever advances, so merging a refreshed row over a locally
// tail-updated one is a max/OR per field. That keeps events applied seconds ago
// from being wiped by a full refresh whose snapshot predates them.
function mergeMsg(prev, next) {
  if (!prev) return next;
  const at = { ...prev.at };
  Object.keys(next.at).forEach((k) => { if (next.at[k] && next.at[k] > (at[k] || 0)) at[k] = next.at[k]; });
  const merged = { ...prev, ...next, at };
  const a = MSG_RANK[prev.status] || 0, b = MSG_RANK[next.status] || 0;
  merged.status = deriveMsgStatus(at);
  if (MSG_RANK[merged.status] < Math.max(a, b)) merged.status = a >= b ? prev.status : next.status;
  return merged;
}
function mergeRow(prev, next) {
  if (!prev) return next;
  const byId = new Map();
  const loose = [];
  prev.sentEvents.forEach((m) => { if (m.resendId) byId.set(m.resendId, m); else loose.push(m); });
  next.sentEvents.forEach((m) => {
    if (m.resendId) byId.set(m.resendId, mergeMsg(byId.get(m.resendId), m));
    else loose.push(m);
  });
  const seen = new Set();
  const legacy = loose.filter((m) => {
    const k = `${m.subject}|${m.createdAt}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const pe = prev.engagement, ne = next.engagement;
  return {
    ...prev, ...next,
    engagement: {
      delivered: Math.max(pe.delivered, ne.delivered),
      opened: Math.max(pe.opened, ne.opened),
      clicked: Math.max(pe.clicked, ne.clicked),
      bounced: pe.bounced || ne.bounced,
      complained: pe.complained || ne.complained,
      unsubscribed: pe.unsubscribed || ne.unsubscribed,
      lastEventAt: Math.max(pe.lastEventAt, ne.lastEventAt),
    },
    repliedAt: next.repliedAt || prev.repliedAt,
    sentEvents: [...byId.values(), ...legacy].sort((a,b) => b.createdAt - a.createdAt),
  };
}

// Full refresh from GET /api/leads. Rows absent from the response are dropped,
// so a backend-side wipe actually clears the mirror.
function writeBackendLeadState(rows) {
  const prev = readBackendLeadState();
  const next = {};
  (rows || []).forEach((r) => {
    const row = normalizeBackendRow(r);
    if (!row.email) return;
    next[row.email] = mergeRow(prev[row.email], row);
  });
  publishBackendLeadState(next);
  return next;
}

// ─────────────────────────────────────────────────────────────────
// Backend / Resend integration
// ─────────────────────────────────────────────────────────────────
// The browser can't safely hold a Resend API key, and Resend's send endpoint
// blocks direct browser calls. Recommended mode is "proxy": the deployed
// /backend holds the key and forwards to Resend. "direct" is prototype-only.
// "mailto" opens the operator's mail client (no backend needed).
const CFG_KEY = 'fahcel_cfg_v1';
const DEFAULT_SEND_ENDPOINT = `${BACKEND}/api/send`;
const CFG_DEFAULTS = { mode: 'mailto', fromName: 'FahCel', fromEmail: 'sales@fahcel.eu', replyTo: 'sales@fahcel.eu', backendUrl: BACKEND, endpoint: '', apiKey: '' };
function readCfg() {
  try { return { ...CFG_DEFAULTS, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return { ...CFG_DEFAULTS }; }
}
const cfgSubs = new Set();
function writeCfg(patch) {
  const next = { ...readCfg(), ...patch };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch {}
  cfgSubs.forEach((fn) => fn(next));
  return next;
}
function useCfg() {
  const [cfg, setCfg] = useState(readCfg);
  useEffect(() => { const fn = (c) => setCfg({ ...c }); cfgSubs.add(fn); return () => cfgSubs.delete(fn); }, []);
  return cfg;
}
const cfgConnected = (cfg) => (cfg.mode === 'proxy' && !!(cfg.endpoint || cfg.backendUrl || BACKEND) && !!cfg.fromEmail) || (cfg.mode === 'direct' && !!cfg.apiKey && !!cfg.fromEmail);

// ── One resolver for every backend call ───────────────────────────
// A Settings override wins; otherwise the known sequencer host. We deliberately
// do NOT route through the same-origin /api/* rewrite: vercel.json still points
// it at an older deployment that predates sent_events, so using it here would
// silently drop email history. The backend answers with
// Access-Control-Allow-Origin: *, so calling it cross-origin is fine — and it
// works identically from file:// during local editing.
function backendBase(cfg) {
  const base = String((cfg && cfg.backendUrl) || '').trim().replace(/\/$/, '');
  return base || BACKEND;
}
// Every read is tenant-scoped — FahCel and Dr. Fry share one database.
function apiUrl(cfg, path, params) {
  const url = new URL(backendBase(cfg) + path);
  url.searchParams.set('tenant', TENANT);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
  return url.toString();
}

// Shared "open the settings modal" signal so any panel can launch it.
let _settingsOpen = false;
const settingsOpenSubs = new Set();
function setSettingsOpen(v) { _settingsOpen = v; settingsOpenSubs.forEach((fn) => fn(v)); }
function useSettingsOpen() {
  const [o, setO] = useState(_settingsOpen);
  useEffect(() => { settingsOpenSubs.add(setO); return () => settingsOpenSubs.delete(setO); }, []);
  return o;
}
function fromLine(cfg) {
  if (!cfg.fromEmail) return '';
  return cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;
}

function normalizeSendEndpoint(value) {
  const endpoint = String(value || '').trim().replace(/\/$/, '');
  if (!endpoint) return DEFAULT_SEND_ENDPOINT;
  try {
    const url = new URL(endpoint, window.location.origin);
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/api/send';
    else if (url.pathname === '/api') url.pathname = '/api/send';
    return url.toString();
  } catch {
    return endpoint;
  }
}

// Deliver an email. Returns the Resend response on success, throws on failure.
async function sendEmail(cfg, { to, subject, text }) {
  const from = fromLine(cfg);
  const replyTo = cfg.replyTo || undefined;
  if (cfg.mode === 'proxy') {
    const configured = cfg.endpoint || cfg.backendUrl || BACKEND;
    const endpoint = normalizeSendEndpoint(configured);
    const options = {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: TENANT, to, from, subject, text, replyTo }),
    };
    let res = await fetch(endpoint, options);
    if (res.status === 404 && endpoint !== DEFAULT_SEND_ENDPOINT) {
      res = await fetch(DEFAULT_SEND_ENDPOINT, options);
    }
    const txt = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`Backend responded ${res.status}${txt ? ' · ' + txt.slice(0, 200) : ''}`);
    try { return JSON.parse(txt); } catch { return {}; }
  }
  if (cfg.mode === 'direct') {
    if (!cfg.apiKey) throw new Error('not-configured');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, reply_to: replyTo }),
    });
    const txt = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`Resend responded ${res.status}${txt ? ' · ' + txt.slice(0, 200) : ''}`);
    try { return JSON.parse(txt); } catch { return {}; }
  }
  throw new Error('not-configured');
}

// Lift live reply / sequence / engagement state from the backend into the local
// pipeline. Match by email; promote New→Sequenced→Clicked→Replied when the
// backend is ahead, never downgrading a lead an operator moved further along
// (demo / offer / won / lost). Backend suppression is mirrored onto the local
// flags so a bounced address can't be mailed again from Compose.
function promoteFromBackend(leads, byEmail) {
  const map = readStatusMap();
  const patches = {};
  (leads || []).forEach((c) => {
    const r = byEmail[lc(c.email)];
    if (!r) return;
    const k = keyFor(c);
    const cur = (map[k] && map[k].status) || c.status || 'new';
    const eng = r.engagement || {};
    const patch = {};

    let next = cur;
    if (r.repliedAt || r.status === 'replied') {
      if (STAGE_INDEX[cur] < STAGE_INDEX['replied']) next = 'replied';
    } else if ((eng.clicked || 0) > 0 || (r.clicks || 0) > 0) {
      if (STAGE_INDEX[cur] < STAGE_INDEX['engaged']) next = 'engaged';
    } else if (r.status === 'active') {
      if (STAGE_INDEX[cur] < STAGE_INDEX['sequenced']) next = 'sequenced';
    }
    if (next !== cur) patch.status = next;

    const flags = (map[k] && map[k].flags) || {};
    const bounced = !!(eng.bounced || eng.complained);
    const unsub = !!eng.unsubscribed;
    if ((bounced && !flags.bounced) || (unsub && !flags.unsub)) {
      patch.flags = { ...flags, bounced: flags.bounced || bounced, unsub: flags.unsub || unsub };
    }
    if (Object.keys(patch).length) patches[k] = patch;
  });
  writeStatusBulk(patches);
}

// Full reconciliation pass. Also the healer for the tail below: if a tail
// request is lost, the next refresh brings the state back in line.
async function syncServerState(leads) {
  let rows = [];
  let cursor = null;
  try {
    const res = await fetch(apiUrl(readCfg(), '/api/leads'));
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    rows = data.leads || [];
    cursor = data.cursor != null ? String(data.cursor) : null;
  } catch { return null; }
  const byEmail = writeBackendLeadState(rows);
  promoteFromBackend((leads && leads.length) ? leads : readLeads(), byEmail);
  return cursor;
}

// ── Event tail — GET /api/events/since ────────────────────────────
// Cursor-based, so near-real-time costs one small request every few seconds
// instead of a full table read. Starting with no cursor deliberately skips all
// history and begins tailing from "now"; /api/leads supplies the backlog.
function applyTailEvents(events) {
  const map = { ...readBackendLeadState() };
  let touched = false;

  (events || []).forEach((ev) => {
    const email = lc(ev.email);
    if (!email) return;
    // An event for a lead we've never seen (a fresh public-site capture):
    // stub it in so it surfaces immediately. The next full refresh fills in
    // name / org / role.
    let row = map[email];
    if (!row) {
      row = normalizeBackendRow({ id: ev.lead_id, email, created_at: ev.created_at, role: 'Website lead' });
    } else {
      row = { ...row, engagement: { ...row.engagement }, sentEvents: row.sentEvents.slice() };
    }

    const at = toMs(ev.created_at);
    const type = String(ev.type || '');
    const eng = row.engagement;

    if (type === 'sent') {
      const exists = ev.resend_id && row.sentEvents.some((m) => m.resendId === ev.resend_id);
      if (!exists) {
        row.sentEvents = [normalizeSentEvent({
          resend_id: ev.resend_id || null,
          subject: (ev.meta && ev.meta.subject) || '',
          body: (ev.meta && ev.meta.body) || '',
          step: (ev.meta && ev.meta.step) || '',
          source: (ev.meta && ev.meta.source) || 'sequence',
          created_at: ev.created_at,
        }), ...row.sentEvents];
      }
    } else if (type === 'delivered' || type === 'opened' || type === 'clicked' || type === 'bounced' || type === 'complained') {
      if (type === 'delivered') eng.delivered++;
      if (type === 'opened') eng.opened++;
      if (type === 'clicked') { eng.clicked++; row.clicks = (row.clicks || 0) + 1; }
      if (type === 'bounced') eng.bounced = true;
      if (type === 'complained') eng.complained = true;
      // Correlate to the message by Resend id — that's the only thing tying a
      // webhook back to the send it belongs to.
      row.sentEvents = row.sentEvents.map((m) => {
        if (!ev.resend_id || m.resendId !== ev.resend_id) return m;
        const nat = { ...m.at, [type]: at || Date.now() };
        return { ...m, at: nat, status: deriveMsgStatus(nat) };
      });
    } else if (type === 'replied') {
      row.repliedAt = ev.created_at;
    } else if (type === 'unsubscribed') {
      eng.unsubscribed = true;
    } else {
      return; // 'enrolled' and friends carry no display state
    }

    if (at > (eng.lastEventAt || 0)) eng.lastEventAt = at;
    map[email] = row;
    touched = true;
  });

  if (touched) {
    publishBackendLeadState(map);
    promoteFromBackend(readLeads(), map);
  }
  return touched;
}

// Resolves to the next cursor, or { unsupported:true } on a backend that
// hasn't shipped the endpoint yet. Throws on a real failure so the caller can
// count it toward the backoff.
async function fetchEventTail(cursor) {
  const res = await fetch(apiUrl(readCfg(), '/api/events/since', { cursor: cursor || '', limit: 200 }));
  if (res.status === 404) return { unsupported: true };
  if (!res.ok) throw new Error('tail ' + res.status);
  const data = await res.json().catch(() => ({}));
  // No cursor yet = the priming call. Take its cursor, discard any payload.
  if (cursor) applyTailEvents(data.events || []);
  return { cursor: data.cursor != null ? String(data.cursor) : cursor };
}

// Wipe every FahCel lead on the shared backend. Tenant-scoped — other tenants untouched.
async function deleteAllServerLeads() {
  const res = await fetch(apiUrl(readCfg(), '/api/leads'), {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE_ALL_LEADS', tenant: TENANT }),
  });
  if (!res.ok) throw new Error('Backend responded ' + res.status);
  publishBackendLeadState({});
  return res.json().catch(() => ({}));
}

const PROXY_SNIPPET = `// The deployed /backend already provides this at POST /api/send.
// It holds RESEND_API_KEY server-side and forwards to Resend.
// Just paste your backend URL above — the endpoint is <backend>/api/send.`;

// ── Pipeline stages (ordered) + suppression flags layered on top ──
const STATUSES = [
  { id:'new',       label:'New',            dot:'var(--amber)', bg:'rgba(200,137,18,0.15)',  fg:'#8f6410' },
  { id:'sequenced', label:'Sequenced',      dot:'#5a6374', bg:'rgba(90,99,116,0.16)', fg:'#41485a' },
  { id:'engaged',   label:'Clicked',        dot:'#1E2A5A', bg:'rgba(30,42,90,0.10)',    fg:'#1E2A5A' },
  { id:'replied',   label:'Replied',        solid:'#1E2A5A', fg:'#fff' },
  { id:'demo',      label:'Demo Scheduled', solid:'#c88912', fg:'#0B1220' },
  { id:'offer',     label:'Proposal Sent',  solid:'#15616f', fg:'#fff' },
  { id:'won',       label:'Won',            solid:'#2E6B4E', fg:'#fff' },
  { id:'lost',      label:'Lost',           solid:'#b3402c', fg:'#fff' },
];
const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

const STATUS_KEY = 'fahcel_status_v1';
function readStatusMap() {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}'); } catch { return {}; }
}
const statusSubs = new Set();
function writeStatus(k, patch) {
  const all = readStatusMap();
  all[k] = { ...(all[k] || {}), ...patch };
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(all)); } catch {}
  statusSubs.forEach((fn) => fn(all));
}
// One write + one notify for a whole sync pass — a per-lead writeStatus would
// re-render the table once per promoted lead.
function writeStatusBulk(patches) {
  const keys = Object.keys(patches || {});
  if (!keys.length) return;
  const all = readStatusMap();
  keys.forEach((k) => { all[k] = { ...(all[k] || {}), ...patches[k] }; });
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(all)); } catch {}
  statusSubs.forEach((fn) => fn(all));
}
function useStatusMap() {
  const [map, setMap] = useState(readStatusMap);
  useEffect(() => {
    const fn = (m) => setMap({ ...m });
    statusSubs.add(fn);
    return () => statusSubs.delete(fn);
  }, []);
  return map;
}
// Falls back to the lead's own stage, then 'new'.
const statusOf = (map, c) => (map[keyFor(c)] && map[keyFor(c)].status) || c.status || 'new';
const flagsOf  = (map, c) => (map[keyFor(c)] && map[keyFor(c)].flags) || {};

// Click-through is the qualification trigger — a real human action.
// Every outbound email carries a live reason to click; a click promotes the lead to Clicked.
const CLICK_ASSETS = [
  { id:'demo',      label:'Live tracking demo',          url:'https://fahcel.eu/demo' },
  { id:'audit',     label:'Sample inspection report (PDF)', url:'https://fahcel.eu/sample-inspection-report.pdf' },
];
const CLICK_BY_ID = Object.fromEntries(CLICK_ASSETS.map((a) => [a.id, a]));
const STAGE_INDEX = Object.fromEntries(STATUSES.map((s, i) => [s.id, i]));
const clicksOf   = (map, c) => (map[keyFor(c)] && map[keyFor(c)].clicks) || {};
// Count only assets we still offer — a retired asset can linger in a stored toggle map.
const clickCount = (map, c) => CLICK_ASSETS.filter((a) => clicksOf(map, c)[a.id]).length;
function toggleClick(map, c, assetId) {
  const cur = clicksOf(map, c);
  const next = { ...cur, [assetId]: !cur[assetId] };
  const patch = { clicks: next };
  if (Object.values(next).some(Boolean) && STAGE_INDEX[statusOf(map, c)] < STAGE_INDEX['engaged']) patch.status = 'engaged';
  writeStatus(keyFor(c), patch);
}

function timeAgo(ts) {
  if (!ts) return '—';
  const d = Math.floor((Date.now()-ts)/86400000);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day ago';
  if (d < 30) return d + ' days ago';
  return Math.floor(d/30) + ' mo ago';
}

// ─────────────────────────────────────────────────────────────────
function Diamond({ size=9, color='var(--amber)' }) {
  return <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" style={{flexShrink:0}}><rect x="5" y="0" width="7.07" height="7.07" transform="rotate(45 5 0)" fill={color}/></svg>;
}

function Sidebar({ active, setActive }) {
  const items = [
    { id:'overview', label:'Overview' },
    { id:'pipeline', label:'Pipeline' },
  ];
  return (
    <aside className="sidebar" style={{ width: 240, borderRight:'1px solid var(--warm-200)', background:'var(--porcelain)', display:'flex', flexDirection:'column', position:'sticky', top:0, height:'100vh' }}>
      <a href="/" style={{ display:'flex', alignItems:'center', gap:10, padding:'20px 24px', textDecoration:'none', color:'var(--graphite)', borderBottom:'1px solid var(--warm-200)' }}>
        <img src="assets/fahcel-logo.jpg" alt="FahCel" style={{ width:26, height:26, borderRadius:6, objectFit:'contain' }} />
        <span className="serif" style={{ fontSize:19 }}>FahCel</span>
      </a>
      <div className="mono" style={{ fontSize:9, letterSpacing:'0.16em', color:'var(--warm-500)', padding:'20px 24px 12px' }}>SALES CRM</div>
      <nav style={{ display:'flex', flexDirection:'column', padding:'0 12px', gap:2 }}>
        {items.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} style={{
            textAlign:'left', padding:'12px 12px', background: active===it.id ? 'var(--graphite)' : 'transparent',
            color: active===it.id ? 'var(--porcelain)' : 'var(--slate-800)', fontSize:14, fontWeight:500,
            transition:'all .15s ease', display:'flex', alignItems:'center', gap:10,
          }}>
            {active===it.id && <Diamond size={7}/>}
            <span style={{ marginLeft: active===it.id ? 0 : 17 }}>{it.label}</span>
          </button>
        ))}
      </nav>
      <div style={{ marginTop:'auto', padding:24, borderTop:'1px solid var(--warm-200)' }}>
        <a href="/" className="ds-btn" style={{ display:'block', textAlign:'center', background:'var(--amber)', color:'var(--graphite)', padding:'12px', fontSize:12, fontWeight:600, letterSpacing:'0.05em', textDecoration:'none' }}>VIEW PUBLIC PAGE →</a>
      </div>
    </aside>
  );
}

function StatCard({ label, value, sub, accent, bar }) {
  return (
    <div className="card stat-card" style={{ padding:'24px 26px', display:'flex', flexDirection:'column', gap: 4 }}>
      <div className="mono" style={{ fontSize:10, letterSpacing:'0.13em', color:'var(--warm-500)', textTransform:'uppercase', marginBottom: 10 }}>{label}</div>
      <div className="serif" style={{ fontSize: 44, lineHeight:1, color: accent || 'var(--graphite)' }}>{value}</div>
      {bar != null && (
        <div style={{ height:5, background:'var(--warm-200)', marginTop:14, position:'relative' }}>
          <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${Math.min(100,bar)}%`, background: accent || 'var(--graphite)', transition:'width .6s cubic-bezier(.2,.7,.2,1)' }}/>
        </div>
      )}
      {sub && <div className="mono" style={{ fontSize:11, color:'var(--warm-500)', letterSpacing:'0.05em', marginTop: bar!=null ? 10 : 6 }}>{sub}</div>}
    </div>
  );
}

// ── Cumulative leads over time ──
function LeadsChart({ leads }) {
  const sorted = [...leads].sort((a,b)=>a.ts-b.ts);
  const pts = sorted.map((c,i) => ({ ts:c.ts, n: i+1 }));
  const W=720, H=200, pad=8;
  const maxY = Math.max(5, leads.length);
  const minT = pts.length ? pts[0].ts : Date.now();
  const maxT = Date.now();
  const span = Math.max(1, maxT-minT);
  const x = (t)=> pad + ((t-minT)/span)*(W-2*pad);
  const y = (s)=> H-pad - (s/maxY)*(H-2*pad);
  const line = pts.map((p,i)=>`${i===0?'M':'L'}${x(p.ts).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${x(pts[pts.length-1].ts).toFixed(1)},${H-pad} L${x(pts[0].ts).toFixed(1)},${H-pad} Z` : '';
  return (
    <div className="card" style={{ padding:'26px 28px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 22 }}>
        <div className="mono" style={{ fontSize:10, letterSpacing:'0.13em', color:'var(--warm-500)' }}>PIPELINE GROWTH · CUMULATIVE LEADS</div>
        <div className="mono" style={{ fontSize:11, color:'var(--amber-deep)' }}>{leads.length} TOTAL</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto', display:'block' }} preserveAspectRatio="none">
        {[0.25,0.5,0.75,1].map((g,i)=>(
          <line key={i} x1={pad} y1={y(maxY*g)} x2={W-pad} y2={y(maxY*g)} stroke="var(--warm-200)" strokeWidth="1"/>
        ))}
        {area && <path d={area} fill="rgba(200,137,18,0.10)"/>}
        {line && <path d={line} fill="none" stroke="var(--graphite)" strokeWidth="2" strokeLinejoin="round"/>}
        {pts.map((p,i)=>(<circle key={i} cx={x(p.ts)} cy={y(p.n)} r="3" fill="var(--graphite)"/>))}
      </svg>
      <div className="mono" style={{ display:'flex', justifyContent:'space-between', marginTop: 12, fontSize:10, color:'var(--warm-500)' }}>
        <span>FIRST LEAD</span><span>TODAY</span>
      </div>
    </div>
  );
}

// ── Pipeline by stage (count breakdown) ──
function StageBreakdown({ leads, map }) {
  const counts = useMemo(()=>{
    const m = Object.fromEntries(STATUSES.map((s)=>[s.id,0]));
    leads.forEach((c)=>{ const s = statusOf(map,c); m[s] = (m[s]||0)+1; });
    return m;
  }, [leads, map]);
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="card" style={{ padding:'26px 28px' }}>
      <div className="mono" style={{ fontSize:10, letterSpacing:'0.13em', color:'var(--warm-500)', marginBottom: 22 }}>LEADS BY STAGE</div>
      <div style={{ display:'flex', flexDirection:'column', gap: 14 }}>
        {STATUSES.map((s)=>{
          const n = counts[s.id] || 0;
          const c = s.solid || s.dot;
          return (
            <div key={s.id}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 6, fontSize: 13, alignItems:'center', gap:8 }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:c, flexShrink:0 }}/>{s.label}
                </span>
                <span className="mono" style={{ color:'var(--warm-500)' }}>{n}</span>
              </div>
              <div style={{ height:6, background:'var(--warm-200)' }}>
                <div style={{ height:'100%', width:`${(n/max)*100}%`, background:c, transition:'width .5s ease' }}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Overview({ leads, map, totals }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 22 }}>
      <div className="ds-grid-4" style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Total leads" value={totals.total} accent="var(--amber)" sub={`${totals.newCount} new this month`} />
        <StatCard label="In conversation" value={totals.talking} sub="replied · demo · proposal" />
        <StatCard label="Demos scheduled" value={totals.demos} accent="var(--amber)" sub="booked walkthroughs" />
        <StatCard label="Won clients" value={totals.won} accent="var(--teal)" sub={`${totals.lost} lost · ${totals.winRate}% win rate`} />
      </div>

      <div className="ds-grid-2-main" style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap: 16 }}>
        <LeadsChart leads={leads} />
        <StageBreakdown leads={leads} map={map} />
      </div>

      <RecentTable leads={leads.slice(0,6)} title="Latest leads" />
    </div>
  );
}

function RolePill({ role }) {
  return <span className="pill pill-grey">{role}</span>;
}

function StatusPill({ id }) {
  const s = STATUS_BY_ID[id] || STATUS_BY_ID.new;
  const style = s.solid ? { background:s.solid, color:s.fg } : { background:s.bg, color:s.fg };
  return (
    <span className="pill" style={style}>
      {!s.solid && <span style={{ width:6, height:6, borderRadius:'50%', background:s.dot, flexShrink:0 }}/>}
      {s.label}
    </span>
  );
}

function FlagPill({ kind }) {
  const m = { bounced:{ label:'Bounced', c:'var(--red)' }, unsub:{ label:'Unsubscribed', c:'var(--warm-500)' } };
  const f = m[kind];
  return <span className="pill" style={{ background:'transparent', color:f.c, border:`1px solid ${f.c}` }}>{f.label}</span>;
}

// ── Per-email delivery status ─────────────────────────────────────
// Reuses the existing .pill classes; bounced / complained get the outlined
// red treatment FlagPill already uses for suppression.
const MSG_STATUS_META = {
  sent:       { label:'Sent',       cls:'pill-grey' },
  delivered:  { label:'Delivered',  cls:'pill-grey' },
  opened:     { label:'Opened',     cls:'pill-teal' },
  clicked:    { label:'Clicked',    cls:'pill-amber' },
  bounced:    { label:'Bounced',    red:true },
  complained: { label:'Complained', red:true },
};

function MsgStatusChip({ status }) {
  const m = MSG_STATUS_META[status] || MSG_STATUS_META.sent;
  if (m.red) return <span className="pill" style={{ background:'transparent', color:'var(--red)', border:'1px solid var(--red)' }}>{m.label}</span>;
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}

// When the furthest status was reached — shown next to the send time.
function statusAt(msg) {
  return (msg.at && msg.at[msg.status]) || 0;
}
function clockOf(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
  catch { return ''; }
}

// The backend's copy of a send and the local record of the same send are the
// same email. Prefer the backend one — it's the copy carrying live status.
// Match on Resend id when we have it, else subject within a 60s window.
function mergeHistory(backendEvents, localItems) {
  const out = (backendEvents || []).map((m) => ({ ...m, origin:'backend' }));
  const seenIds = new Set(out.map((m) => m.resendId).filter(Boolean));
  (localItems || []).forEach((l) => {
    const at = l.at || 0;
    if (l.resendId && seenIds.has(l.resendId)) return;
    const dup = out.some((m) => m.subject && m.subject === l.subject && Math.abs(m.createdAt - at) <= 60000);
    if (dup) return;
    out.push({
      resendId: l.resendId || '', subject: l.subject || '', body: '',
      step: l.template || '', source: 'manual', createdAt: at,
      at: { sent: at }, status: 'sent', origin: 'local',
    });
  });
  return out.sort((a,b) => b.createdAt - a.createdAt);
}

// Expandable per-email history for one lead.
function SentLog({ history }) {
  const [open, setOpen] = useState(null);
  if (!history.length) return null;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {history.map((m, i) => {
        const k = m.resendId || `${m.subject}|${m.createdAt}|${i}`;
        const isOpen = open === k;
        const reached = statusAt(m);
        return (
          <div key={k} style={{ border:'1px solid var(--warm-200)', background:'var(--porcelain)' }}>
            <button onClick={() => setOpen(isOpen ? null : k)} style={{
              width:'100%', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
              padding:'10px 13px', background:'transparent', border:'none', textAlign:'left',
            }}>
              <MsgStatusChip status={m.status} />
              <span style={{ fontSize:13, color:'var(--graphite)', flex:1, minWidth:120 }}>{m.subject || '(no subject)'}</span>
              <span className="mono" style={{ fontSize:10, color:'var(--warm-500)' }}>
                {clockOf(m.createdAt)}
                {/* Only worth a second stamp when it reads differently — most
                    deliveries land in the same minute as the send. */}
                {reached && clockOf(reached) !== clockOf(m.createdAt) ? ` → ${clockOf(reached)}` : ''}
              </span>
              <span className="mono" style={{ fontSize:10, color:'var(--warm-500)' }}>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div style={{ borderTop:'1px solid var(--warm-200)', padding:'12px 13px' }}>
                <div className="mono" style={{ fontSize:10, color:'var(--warm-500)', marginBottom:8, display:'flex', gap:14, flexWrap:'wrap' }}>
                  <span>{m.source === 'manual' ? 'MANUAL SEND' : 'SEQUENCE'}{m.step ? ` · ${m.step}` : ''}</span>
                  {m.origin === 'local' && <span>LOCAL RECORD · awaiting backend</span>}
                </div>
                <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom: m.body ? 12 : 0 }}>
                  {['sent','delivered','opened','clicked','bounced','complained']
                    .filter((t) => m.at && m.at[t])
                    .map((t) => (
                      <span key={t} className="mono" style={{ fontSize:10, color:'var(--warm-500)' }}>
                        {(MSG_STATUS_META[t] || {}).label}: <b style={{ color:'var(--slate-800)' }}>{clockOf(m.at[t])}</b>
                      </span>
                    ))}
                </div>
                {m.body && <div style={{ fontSize:12, lineHeight:1.55, color:'var(--slate-800)', whiteSpace:'pre-wrap', maxHeight:220, overflowY:'auto' }}>{m.body}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Collapsed row summary — the latest message's status, not just a count.
function SentPreview({ history }) {
  if (!history.length) return null;
  const latest = history[0];
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
      <MsgStatusChip status={latest.status} />
      {history.length > 1 && <span className="mono" style={{ fontSize:10, color:'var(--warm-500)' }}>×{history.length}</span>}
    </span>
  );
}

function StatusCell({ map, c, row }) {
  const f = flagsOf(map, c);
  const eng = (row && row.engagement) || {};
  // Real link clicks recorded by the backend win over the manual prototype
  // toggles; fall back to those when the backend knows nothing yet.
  const clicked = eng.clicked || row && row.clicks || 0;
  const n = clicked || clickCount(map, c);
  const opened = eng.opened || 0;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
      <StatusPill id={statusOf(map, c)} />
      {opened > 0 && <span className="pill pill-teal">👁 {opened} open{opened>1?'s':''}</span>}
      {n > 0 && <span className="pill" style={{ background:'rgba(200,137,18,0.16)', color:'var(--amber-deep)' }}>↗ {n} click{n>1?'s':''}</span>}
      {(f.bounced || eng.bounced || eng.complained) && <FlagPill kind="bounced" />}
      {(f.unsub || eng.unsubscribed) && <FlagPill kind="unsub" />}
    </div>
  );
}

// ── Compose & send panel (expands inside a lead row) ──
const TEMPLATES = [
  {
    id: 'welcome',
    label: 'Intro & next steps',
    subject: (c) => `${c.name.split(' ')[0]}, your FahCel cold-chain walkthrough`,
    body: (c) =>
`Hi ${c.name.split(' ')[0]},

Thanks for your interest in FahCel${c.org && c.org!=='—' ? ` for ${c.org}` : ''}. We turn every temperature-logger reading into a tamper-evident record, so you can prove your cold chain held — from the dock to the shelf.

Here's how a ${CRM.demoLength} walkthrough usually goes:
1. We pull one of your real routes (or a sample) into the live tracker.
2. You watch a chain get verified — and see exactly where a break would surface.
3. We map it to your HACCP / audit requirements.

${c.message ? `On what you shared:\n"${c.message}"\n\nI'd love to pick that up properly — ` : ''}A few things worth two minutes — each link is live:
• See the live tracking demo: ${CLICK_BY_ID.demo.url}
• A sample signed inspection report (PDF): ${CLICK_BY_ID.audit.url}

When's a good time for a short call?

Warm regards,
The FahCel team`
  },
  {
    id: 'proposal',
    label: 'Send proposal',
    subject: (c) => `Your FahCel proposal${c.org && c.org!=='—' ? ` — ${c.org}` : ''}`,
    body: (c) =>
`Hi ${c.name.split(' ')[0]},

Good to move this forward. Attached is a proposal covering FahCel coverage for ${c.org && c.org!=='—' ? c.org : 'your operation'} — loggers, the verification dashboard, and inspection-ready exports.

Once you've had a look, I can walk through any line before we set a start date.

Best,
The FahCel team`
  },
  {
    id: 'followup',
    label: 'Gentle follow-up',
    subject: (c) => `Quick follow-up on FahCel`,
    body: (c) =>
`Hi ${c.name.split(' ')[0]},

Just circling back on cold-chain proof for ${c.org && c.org!=='—' ? c.org : 'your shipments'}.

${c.message ? `You mentioned: "${c.message}" — happy to dig into that whenever suits.` : 'Happy to answer anything before we set up a walkthrough.'}

The two things operators find most convincing, if you've a minute:
• A sample signed inspection report (PDF): ${CLICK_BY_ID.audit.url}
• The live tracking demo: ${CLICK_BY_ID.demo.url}

Best,
The FahCel team`
  },
];

function ComposePanel({ c, sent, onSent, row, history }) {
  const templates = TEMPLATES;
  const [tplId, setTplId] = useState(templates[0].id);
  const tpl = templates.find((t) => t.id === tplId) || templates[0];
  const [subject, setSubject] = useState(() => tpl.subject(c));
  const [body, setBody] = useState(() => tpl.body(c));
  const [justSent, setJustSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const cfg = useCfg();
  const resendMode = cfg.mode === 'proxy' || cfg.mode === 'direct';

  useEffect(() => {
    setSubject(tpl.subject(c));
    setBody(tpl.body(c));
  }, [tplId]);

  const sentInfo = sent[keyFor(c)];
  const map = useStatusMap();
  const st = statusOf(map, c);
  const flags = flagsOf(map, c);
  const clicks = clicksOf(map, c);
  const suppressed = !!(flags.bounced || flags.unsub);

  async function send() {
    setErr('');
    if (resendMode) {
      setSending(true);
      try {
        const r = await sendEmail(cfg, { to: c.email, subject, text: body });
        onSent(c, { subject, template: tpl.label, resendId: (r && r.id) || '' });
        setJustSent(true);
        setTimeout(() => setJustSent(false), 2600);
      } catch (e) {
        const m = String((e && e.message) || e);
        setErr(m === 'not-configured'
          ? 'Add your backend URL (or From address + key) in Email settings first.'
          : m + (m.includes('Failed to fetch') ? ' — likely CORS. Use backend mode.' : ''));
      } finally {
        setSending(false);
      }
      return;
    }
    // mailto fallback — opens the operator's mail client pre-filled
    const url = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    onSent(c, { subject, template: tpl.label });
    setJustSent(true);
    setTimeout(() => setJustSent(false), 2600);
  }

  const labelStyle = { display:'block', fontFamily:'JetBrains Mono, monospace', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--warm-500)', marginBottom:7 };
  const inputStyle = { width:'100%', background:'var(--porcelain)', border:'1px solid var(--warm-200)', padding:'11px 13px', fontSize:14, color:'var(--graphite)', fontFamily:'inherit' };

  return (
    <div style={{ background:'var(--porcelain-2)', border:'1px solid var(--warm-200)', borderLeft:'3px solid var(--amber)', padding:'24px 26px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:10, marginBottom:20 }}>
        <div className="mono" style={{ fontSize:10, letterSpacing:'0.14em', color:'var(--warm-500)' }}>
          COMPOSE → {c.email}
        </div>
        {(history && history.length)
          ? <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              <MsgStatusChip status={history[0].status} />
              <span className="mono" style={{ fontSize:10, color:'var(--warm-500)' }}>
                LAST SENT {timeAgo(history[0].createdAt).toUpperCase()} · ×{history.length}
              </span>
            </span>
          : <span className="pill pill-grey">Not contacted yet</span>}
      </div>

      {/* Lead stage + suppression */}
      <div style={{ display:'flex', gap:26, flexWrap:'wrap', alignItems:'flex-end', marginBottom:20, paddingBottom:20, borderBottom:'1px solid var(--warm-200)' }}>
        <div>
          <label style={labelStyle}>Stage</label>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <select value={st} onChange={(e) => writeStatus(keyFor(c), { status:e.target.value })}
              style={{ ...inputStyle, width:'auto', paddingRight:34, cursor:'pointer' }}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <StatusPill id={st} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Suppression</label>
          <div style={{ display:'flex', gap:8 }}>
            {[['bounced','Bounced','var(--red)'],['unsub','Unsubscribed','var(--warm-500)']].map(([key,lbl,col]) => {
              const on = !!flags[key];
              return (
                <button key={key} onClick={() => writeStatus(keyFor(c), { flags:{ ...flags, [key]: !on } })} style={{
                  display:'inline-flex', alignItems:'center', gap:7, padding:'9px 13px', fontFamily:'JetBrains Mono, monospace',
                  fontSize:11, letterSpacing:'0.04em', transition:'all .15s ease',
                  border:`1px solid ${on ? col : 'var(--warm-200)'}`,
                  background: on ? col : 'var(--porcelain)', color: on ? '#fff' : 'var(--slate-800)',
                }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background: on ? '#fff' : col }}/>
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Engagement — click-through is the qualification trigger, not opens */}
      <div style={{ marginBottom:20, paddingBottom:20, borderBottom:'1px solid var(--warm-200)' }}>
        <label style={{ ...labelStyle, marginBottom:9 }}>
          Engagement · link clicks
          <span style={{ textTransform:'none', letterSpacing:0, color:'var(--warm-500)', marginLeft:8 }}>a click — not an open — marks a lead Clicked</span>
        </label>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {CLICK_ASSETS.map((a) => {
            const on = !!clicks[a.id];
            return (
              <button key={a.id} disabled={!sentInfo} onClick={() => toggleClick(map, c, a.id)} style={{
                display:'inline-flex', alignItems:'center', gap:7, padding:'9px 13px', fontFamily:'JetBrains Mono, monospace',
                fontSize:11, letterSpacing:'0.04em', transition:'all .15s ease',
                border:`1px solid ${on ? 'var(--amber)' : 'var(--warm-200)'}`,
                background: on ? 'rgba(200,137,18,0.16)' : 'var(--porcelain)', color: on ? 'var(--amber-deep)' : 'var(--slate-800)',
                cursor: sentInfo ? 'pointer' : 'not-allowed', opacity: sentInfo ? 1 : 0.5,
              }}>
                <span>↗</span>{a.label}{on && <span style={{ marginLeft:2 }}>✓</span>}
              </button>
            );
          })}
        </div>
        <div className="mono" style={{ fontSize:10, color:'var(--warm-500)', marginTop:9, lineHeight:1.5 }}>
          {sentInfo
            ? 'Prototype: tap to log a click. In production, link-tracking webhooks set these automatically and auto-promote the lead.'
            : 'No clicks yet — send an email first. Clicks are tracked from the links in mail you\u2019ve sent.'}
        </div>
      </div>

      {/* Email history — live delivery status per message */}
      {history && history.length > 0 && (
        <div style={{ marginBottom:20, paddingBottom:20, borderBottom:'1px solid var(--warm-200)' }}>
          <label style={{ ...labelStyle, marginBottom:9 }}>
            Email history
            <span style={{ textTransform:'none', letterSpacing:0, color:'var(--warm-500)', marginLeft:8 }}>
              status updates live — no reload needed
            </span>
          </label>
          <SentLog history={history} />
        </div>
      )}

      {/* Their submitted note, quoted for reference */}
      {c.message && (
        <div style={{ borderLeft:'2px solid var(--warm-200)', paddingLeft:14, marginBottom:20 }}>
          <div className="mono" style={{ fontSize:9, letterSpacing:'0.12em', color:'var(--warm-500)', marginBottom:6 }}>THEIR NOTE</div>
          <div style={{ fontSize:13, fontStyle:'italic', color:'var(--slate-800)', lineHeight:1.5 }}>"{c.message}"</div>
        </div>
      )}

      {/* Template quick-starts */}
      <div style={{ marginBottom:18 }}>
        <label style={labelStyle}>Template</label>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {templates.map((t) => (
            <button key={t.id} onClick={() => setTplId(t.id)} style={{
              padding:'8px 14px', fontSize:12, fontWeight:500,
              border:`1px solid ${tplId===t.id ? 'var(--graphite)' : 'var(--warm-200)'}`,
              background: tplId===t.id ? 'var(--graphite)' : 'var(--porcelain)',
              color: tplId===t.id ? 'var(--porcelain)' : 'var(--slate-800)',
              transition:'all .15s ease',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom:16 }}>
        <label style={labelStyle}>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={labelStyle}>Message — personalize before sending</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12}
          style={{ ...inputStyle, resize:'vertical', lineHeight:1.55, fontFamily:'inherit' }} />
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
        <button className="ds-btn" onClick={send} disabled={sending || suppressed} style={{
          background: (suppressed || sending) ? 'var(--warm-200)' : 'var(--amber)', color: (suppressed || sending) ? 'var(--warm-500)' : 'var(--graphite)', padding:'13px 22px',
          fontSize:13, fontWeight:600, letterSpacing:'0.04em', border:'none',
        }}>
          {sending ? 'SENDING…' : (sentInfo ? 'RESEND →' : 'SEND →')}
        </button>
        {suppressed && <span className="mono" style={{ fontSize:12, color:'var(--red)' }}>⚠ {flags.unsub ? 'Unsubscribed' : 'Bounced'} — sending suppressed</span>}
        {err && <span className="mono" style={{ fontSize:12, color:'var(--red)', maxWidth:320, lineHeight:1.5 }}>⚠ {err} <button onClick={() => setSettingsOpen(true)} style={{ background:'transparent', border:'none', color:'var(--amber-deep)', textDecoration:'underline', padding:0, fontSize:12 }}>Settings</button></span>}
        {justSent && <span className="mono" style={{ fontSize:12, color:'var(--teal)' }}>✓ {resendMode ? 'Sent via Resend' : 'Opened in your mail client'}</span>}
        <span className="mono" style={{ fontSize:10, color:'var(--warm-500)', marginLeft:'auto', maxWidth:320, lineHeight:1.5, textAlign:'right' }}>
          {resendMode
            ? <>Sends directly via Resend ({cfg.mode === 'proxy' ? 'backend' : 'direct key'}). <button onClick={() => setSettingsOpen(true)} style={{ background:'transparent', border:'none', color:'var(--amber-deep)', textDecoration:'underline', padding:0, fontSize:10 }}>Change</button></>
            : <>Prototype: opens your email app pre-filled. <button onClick={() => setSettingsOpen(true)} style={{ background:'transparent', border:'none', color:'var(--amber-deep)', textDecoration:'underline', padding:0, fontSize:10 }}>Connect backend</button></>}
        </span>
      </div>
    </div>
  );
}

function RecentTable({ leads, title, compose }) {
  const [openKey, setOpenKey] = useState(null);
  const [sent, setSent] = useState(() => readSent());
  const map = useStatusMap();
  const backend = useBackendLeadState();
  const onSent = (c, mail) => setSent(recordSent(c, mail));
  const cols = compose ? 5 : 4;
  return (
    <div className="card table-scroll">
      <div style={{ padding:'20px 24px 4px' }}>
        <div className="mono" style={{ fontSize:10, letterSpacing:'0.13em', color:'var(--warm-500)' }}>{title.toUpperCase()}</div>
      </div>
      <table>
        <thead><tr><th>Lead</th><th>Type</th><th>When</th><th>Status</th>{compose && <th></th>}</tr></thead>
        <tbody>
          {leads.length === 0 && (
            <tr>
              <td colSpan={cols} style={{ padding:'40px 24px', textAlign:'center' }}>
                <div className="mono" style={{ fontSize:12, color:'var(--warm-500)', letterSpacing:'0.06em', lineHeight:1.7 }}>
                  NO LEADS YET<br/>
                  <span style={{ color:'var(--warm-500)' }}>Requests submitted on the public page appear here in real time.</span>
                </div>
              </td>
            </tr>
          )}
          {leads.map((c,i)=>{
            const k = keyFor(c);
            const isOpen = openKey === k;
            const sentInfo = sent[k];
            const row = backend[lc(c.email)];
            const history = mergeHistory(row && row.sentEvents, sentInfo && sentInfo.items);
            return (
              <React.Fragment key={k+i}>
                <tr style={ compose ? { cursor:'pointer', background: isOpen ? 'var(--porcelain-2)' : 'transparent' } : undefined }
                    onClick={ compose ? () => setOpenKey(isOpen ? null : k) : undefined }>
                  <td>
                    <div style={{ fontWeight:500 }}>{c.name}</div>
                    <div className="mono" style={{ fontSize:11, color:'var(--warm-500)', marginTop:2 }}>{c.org && c.org!=='—' ? c.org : c.email}</div>
                  </td>
                  <td><RolePill role={c.role}/></td>
                  <td className="mono" style={{ fontSize:12, color:'var(--warm-500)' }}>{timeAgo(c.ts)}</td>
                  <td><StatusCell map={map} c={c} row={row} /></td>
                  {compose && (
                    <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                      <span className="mono" style={{ fontSize:13, fontWeight:600, color: isOpen ? 'var(--amber-deep)' : 'var(--graphite)', display:'inline-flex', alignItems:'center', gap:7 }}>
                        {!isOpen && <SentPreview history={history} />}
                        {isOpen ? 'Close ✕' : (history.length ? 'Resend ✎' : 'Compose ✎')}
                      </span>
                    </td>
                  )}
                </tr>
                {compose && isOpen && (
                  <tr>
                    <td colSpan={cols} style={{ padding:0 }}>
                      <div style={{ padding:'4px 24px 22px' }}>
                        <ComposePanel c={c} sent={sent} onSent={onSent} row={row} history={history} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pipeline({ leads }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const map = useStatusMap();
  const counts = useMemo(() => {
    const c = { all: leads.length, suppressed: 0 };
    STATUSES.forEach((s) => { c[s.id] = 0; });
    leads.forEach((cm) => {
      c[statusOf(map, cm)] = (c[statusOf(map, cm)] || 0) + 1;
      const f = flagsOf(map, cm); if (f.bounced || f.unsub) c.suppressed++;
    });
    return c;
  }, [leads, map]);
  const filtered = leads.filter((c) => {
    if (q && !(`${c.name} ${c.org} ${c.email}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (filter === 'all') return true;
    if (filter === 'suppressed') { const f = flagsOf(map, c); return !!(f.bounced || f.unsub); }
    return statusOf(map, c) === filter;
  });
  const chips = [{ id:'all', label:'All' }, ...STATUSES, { id:'suppressed', label:'Suppressed' }];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: 16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', gap: 16, flexWrap:'wrap', alignItems:'center' }}>
        <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search name, company, email…" style={{ background:'var(--porcelain)', border:'1px solid var(--warm-200)', padding:'10px 14px', fontSize:14, width: 280 }} />
        <div className="mono" style={{ fontSize:12, color:'var(--warm-500)' }}>{filtered.length} OF {leads.length} LEADS</div>
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {chips.map((s) => {
          const active = filter === s.id;
          const dot = s.id === 'suppressed' ? 'var(--red)' : (STATUS_BY_ID[s.id] && (STATUS_BY_ID[s.id].solid || STATUS_BY_ID[s.id].dot));
          return (
            <button key={s.id} onClick={()=>setFilter(s.id)} style={{
              display:'inline-flex', alignItems:'center', gap:7, padding:'7px 12px', fontFamily:'JetBrains Mono, monospace',
              fontSize:11, letterSpacing:'0.04em', transition:'all .15s ease',
              border:`1px solid ${active?'var(--graphite)':'var(--warm-200)'}`,
              background: active?'var(--graphite)':'var(--porcelain)', color: active?'var(--porcelain)':'var(--slate-800)',
            }}>
              {dot && <span style={{ width:7, height:7, borderRadius:'50%', background:dot, flexShrink:0 }}/>}
              {s.label}
              <b style={{ color: active?'var(--porcelain)':'var(--warm-500)', fontWeight:600 }}>{counts[s.id] || 0}</b>
            </button>
          );
        })}
      </div>
      <RecentTable leads={filtered} title={`Client register · ${leads.length} leads`} compose />
      <div className="mono" style={{ fontSize:11, color:'var(--warm-500)', letterSpacing:'0.04em', lineHeight:1.6 }}>
        Click any row to compose a personalized message. Templates pre-fill from the lead's name, company and the note they left — edit freely before sending. Open a row to set its stage or flag a bounce / unsubscribe. A green dot marks leads you've already contacted.
      </div>
    </div>
  );
}

// ── Email delivery settings modal ─────────────────────────────────
function SettingsModal() {
  const open = useSettingsOpen();
  const saved = useCfg();
  const [draft, setDraft] = useState(saved);
  const [showSnippet, setShowSnippet] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeMsg, setWipeMsg] = useState('');
  useEffect(() => { if (open) setDraft(readCfg()); }, [open]);
  if (!open) return null;

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const label = { display:'block', fontFamily:'JetBrains Mono, monospace', fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--warm-500)', marginBottom:7 };
  const input = { width:'100%', background:'var(--porcelain)', border:'1px solid var(--warm-200)', padding:'11px 13px', fontSize:14, color:'var(--graphite)', fontFamily:'inherit' };
  const modes = [['mailto','Mail client'],['proxy','Resend · backend'],['direct','Resend · direct key']];

  function save() { writeCfg(draft); setSettingsOpen(false); }

  async function wipe() {
    if (!window.confirm('Delete ALL FahCel leads on the shared backend? This cannot be undone. Other tenants (e.g. Dr. Fry) are unaffected.')) return;
    setWipeMsg(''); setWiping(true);
    try { await deleteAllServerLeads(); setWipeMsg('✓ All FahCel leads deleted on the backend.'); }
    catch (e) { setWipeMsg('⚠ ' + String((e && e.message) || e)); }
    finally { setWiping(false); }
  }

  return (
    <div onClick={() => setSettingsOpen(false)} style={{ position:'fixed', inset:0, zIndex:100, background:'rgba(11,18,32,0.45)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'6vh 20px', overflowY:'auto' }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width:'100%', maxWidth:600, padding:'30px 32px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
          <div>
            <div className="mono" style={{ fontSize:10, letterSpacing:'0.14em', color:'var(--warm-500)', marginBottom:6 }}>EMAIL DELIVERY</div>
            <h2 className="serif" style={{ fontSize:26, lineHeight:1 }}>Connect the backend</h2>
          </div>
          <button onClick={() => setSettingsOpen(false)} className="mono" style={{ fontSize:13, color:'var(--warm-500)', background:'transparent', border:'none', padding:4 }}>Close ✕</button>
        </div>
        <p style={{ fontSize:13, lineHeight:1.6, color:'var(--slate-800)', marginBottom:22, maxWidth:520 }}>
          The dashboard is already wired to the FahCel sequencer — leads, email history and live delivery status sync on their own, on any browser, with nothing to configure. The field below is only for pointing this dashboard at a different backend.
        </p>

        <div style={{ marginBottom:18 }}>
          <label style={label}>Sequencing backend URL</label>
          <input value={draft.backendUrl} onChange={set('backendUrl')} placeholder="https://your-fahcel-backend.vercel.app" style={input} />
          <div className="mono" style={{ fontSize:11, color:'var(--warm-500)', lineHeight:1.5, marginTop:9 }}>
            Optional override. Leave blank to use the deployed sequencer at <b style={{ color:'var(--slate-800)' }}>{BACKEND}</b> — reconciled from <b style={{ color:'var(--slate-800)' }}>GET /api/leads</b> every 45s and tailed from <b style={{ color:'var(--slate-800)' }}>GET /api/events/since</b> every 8s.
          </div>
        </div>

        <label style={label}>Delivery mode</label>
        <div className="seg" style={{ marginBottom:22 }}>
          {modes.map(([id, lbl]) => (
            <button key={id} className={draft.mode === id ? 'active' : ''} onClick={() => setDraft((d) => ({ ...d, mode:id }))}>{lbl}</button>
          ))}
        </div>

        {draft.mode !== 'mailto' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1.2fr', gap:16, marginBottom:18 }}>
            <div>
              <label style={label}>From name</label>
              <input value={draft.fromName} onChange={set('fromName')} placeholder="FahCel" style={input} />
            </div>
            <div>
              <label style={label}>From email · verified subdomain</label>
              <input value={draft.fromEmail} onChange={set('fromEmail')} placeholder="sales@fahcel.eu" style={input} />
            </div>
          </div>
        )}

        {draft.mode !== 'mailto' && (
          <div style={{ marginBottom:18 }}>
            <label style={label}>Reply-To · your real inbox</label>
            <input value={draft.replyTo} onChange={set('replyTo')} placeholder="sales@fahcel.eu" style={input} />
            <div className="mono" style={{ fontSize:11, color:'var(--warm-500)', lineHeight:1.5, marginTop:9 }}>
              Send from your <b style={{ color:'var(--slate-800)' }}>sending subdomain</b> to protect domain reputation; replies land in <b style={{ color:'var(--slate-800)' }}>{draft.replyTo || 'sales@fahcel.eu'}</b>.
            </div>
          </div>
        )}

        {draft.mode === 'proxy' && (
          <div style={{ marginBottom:18 }}>
            <label style={label}>Send endpoint · optional override</label>
            <input value={draft.endpoint} onChange={set('endpoint')} placeholder="defaults to <backend URL>/api/send" style={input} />
            <button onClick={() => setShowSnippet((s) => !s)} className="mono" style={{ fontSize:11, color:'var(--amber-deep)', background:'transparent', border:'none', padding:'10px 0 0' }}>
              {showSnippet ? '▾ Hide' : '▸ Show'} notes
            </button>
            {showSnippet && (
              <pre className="mono" style={{ fontSize:11, lineHeight:1.5, background:'var(--porcelain-2)', border:'1px solid var(--warm-200)', padding:14, marginTop:10, overflowX:'auto', whiteSpace:'pre-wrap' }}>{PROXY_SNIPPET}</pre>
            )}
          </div>
        )}

        {draft.mode === 'direct' && (
          <div style={{ marginBottom:18 }}>
            <label style={label}>Resend API key</label>
            <input value={draft.apiKey} onChange={set('apiKey')} type="password" placeholder="re_xxxxxxxx" autoComplete="off" style={input} />
            <div className="mono" style={{ fontSize:11, color:'var(--red)', lineHeight:1.5, marginTop:9, display:'flex', gap:8 }}>
              <span>⚠</span>
              <span>Prototype only. The key is stored in this browser and exposed to anyone with the dashboard open, and Resend may block the request via CORS. Use backend mode for anything real.</span>
            </div>
          </div>
        )}

        {draft.mode === 'mailto' && (
          <p className="mono" style={{ fontSize:12, color:'var(--warm-500)', lineHeight:1.6, marginBottom:18 }}>
            Send opens your own email client pre-filled — nothing leaves the dashboard automatically. Switch to backend mode to send directly.
          </p>
        )}

        <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:6 }}>
          <button className="ds-btn" onClick={save} style={{ background:'var(--amber)', color:'var(--graphite)', padding:'12px 22px', fontSize:13, fontWeight:600, letterSpacing:'0.04em' }}>SAVE</button>
          <span className="mono" style={{ fontSize:11, color: cfgConnected(draft) || draft.mode==='mailto' ? 'var(--teal)' : 'var(--warm-500)' }}>
            {draft.mode === 'mailto' ? 'Mail-client mode' : cfgConnected(draft) ? '✓ Ready to send via Resend' : 'Fill in the fields above to connect'}
          </span>
        </div>

        <div style={{ marginTop:26, paddingTop:20, borderTop:'1px solid var(--warm-200)' }}>
          <label style={label}>Danger zone</label>
          <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
            <button onClick={wipe} disabled={wiping} style={{ background:'transparent', border:'1px solid var(--red)', color:'var(--red)', padding:'10px 16px', fontSize:12, fontWeight:600, letterSpacing:'0.04em', fontFamily:'JetBrains Mono, monospace', cursor: wiping ? 'not-allowed' : 'pointer' }}>
              {wiping ? 'DELETING…' : 'DELETE ALL FAHCEL LEADS'}
            </button>
            {wipeMsg && <span className="mono" style={{ fontSize:11, color: wipeMsg[0]==='✓' ? 'var(--teal)' : 'var(--red)', maxWidth:320, lineHeight:1.5 }}>{wipeMsg}</span>}
          </div>
          <div className="mono" style={{ fontSize:10, color:'var(--warm-500)', lineHeight:1.5, marginTop:9 }}>
            Removes every FahCel lead from the shared backend (<b style={{ color:'var(--slate-800)' }}>tenant={TENANT}</b>). Other tenants are never touched.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
function App() {
  const [active, setActive] = useState('overview');
  const [leads, setLeads] = useState(()=>readLeads());
  const map = useStatusMap();
  const cfg = useCfg();

  useEffect(()=>{
    const reload = ()=> setLeads(readLeads());
    window.addEventListener('focus', reload);
    window.addEventListener('storage', reload);
    // Backend-only leads enter the pipeline through readLeads(), so a change to
    // the mirror has to re-derive the list.
    backendSubs.add(reload);
    return ()=>{
      window.removeEventListener('focus', reload);
      window.removeEventListener('storage', reload);
      backendSubs.delete(reload);
    };
  }, []);

  // Live status. A full /api/leads reconciliation every 45s, plus a cheap
  // cursor tail every 8s — the tail is what moves a chip within seconds, the
  // full poll is the healer when a tail request is lost.
  const base = backendBase(cfg);
  useEffect(()=>{
    let alive = true, tailOn = true, cursor = null, fails = 0, tailTimer = null;
    const hidden = ()=> typeof document !== 'undefined' && document.visibilityState === 'hidden';

    // Nothing here may reject: an unreachable backend must leave the dashboard
    // rendering from localStorage with a clean console.
    const full = async ()=>{
      if (!alive) return;
      try {
        const c = await syncServerState(readLeads());
        if (alive && c && !cursor) cursor = c;
      } catch {}
    };

    const schedule = (ms)=>{
      clearTimeout(tailTimer);
      if (!alive || !tailOn) return;
      tailTimer = setTimeout(tail, ms);
    };

    const tail = async ()=>{
      if (!alive || !tailOn) return;
      // Paused while the tab is hidden; the wake handler fires one immediately.
      if (hidden()) { schedule(8000); return; }
      try {
        const r = await fetchEventTail(cursor);
        if (!alive) return;
        if (r.unsupported) { tailOn = false; return; }  // endpoint not deployed
        cursor = r.cursor;
        fails = 0;
        schedule(8000);
      } catch {
        if (!alive) return;
        fails++;
        schedule(fails >= 3 ? 30000 : 8000);
      }
    };

    full();
    const fullIv = setInterval(full, 45000);
    schedule(0);

    const onWake = ()=>{ if (!hidden()) { full(); schedule(0); } };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return ()=>{
      alive = false;
      clearInterval(fullIv);
      clearTimeout(tailTimer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [base]);

  const totals = useMemo(()=>{
    const monthAgo = Date.now() - 30*86400000;
    let talking=0, demos=0, won=0, lost=0, newCount=0;
    leads.forEach((c)=>{
      const s = statusOf(map, c);
      if (['replied','demo','offer'].includes(s)) talking++;
      if (s==='demo') demos++;
      if (s==='won') won++;
      if (s==='lost') lost++;
      if (s==='new' && c.ts>=monthAgo) newCount++;
    });
    const closed = won+lost;
    return { total: leads.length, talking, demos, won, lost, newCount, winRate: closed ? Math.round((won/closed)*100) : 0 };
  }, [leads, map]);

  const titles = { overview:'Overview', pipeline:'Pipeline' };

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      <Sidebar active={active} setActive={setActive} />
      <main style={{ flex:1, minWidth:0 }}>
        <header className="main-pad" style={{ padding:'24px 36px', borderBottom:'1px solid var(--warm-200)', background:'var(--porcelain)', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:20 }}>
          <div>
            <div className="mono" style={{ fontSize:10, letterSpacing:'0.14em', color:'var(--warm-500)', marginBottom:6 }}>CLIENT PIPELINE · DASHBOARD</div>
            <h1 className="serif" style={{ fontSize: 30, lineHeight:1 }}>{titles[active]}</h1>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 22 }}>
            <button onClick={() => setSettingsOpen(true)} className="mono" title="Email delivery settings" style={{
              display:'inline-flex', alignItems:'center', gap:8, padding:'8px 13px', fontSize:11, letterSpacing:'0.06em',
              border:'1px solid var(--warm-200)', background:'var(--porcelain)', color:'var(--slate-800)',
            }}>
              <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background:'var(--teal)' }}/>
              {cfgConnected(cfg) ? 'RESEND + BACKEND' : 'BACKEND CONNECTED'}
            </button>
            <div style={{ width:1, height:34, background:'var(--warm-200)' }}/>
            <div style={{ textAlign:'right' }}>
              <div className="mono" style={{ fontSize:10, color:'var(--warm-500)', letterSpacing:'0.1em' }}>IN PIPELINE</div>
              <div className="mono" style={{ fontSize:13, color:'var(--graphite)', marginTop:3 }}>{totals.total - totals.won - totals.lost} ACTIVE LEADS</div>
            </div>
            <div style={{ width:1, height:34, background:'var(--warm-200)' }}/>
            <div style={{ textAlign:'right' }}>
              <div className="mono" style={{ fontSize:10, color:'var(--warm-500)', letterSpacing:'0.1em' }}>WON</div>
              <div className="serif" style={{ fontSize:22, color:'var(--amber-deep)' }}>{totals.won}</div>
            </div>
          </div>
        </header>
        <div className="main-pad" style={{ padding:'28px 36px 60px' }}>
          {active==='overview' && <Overview leads={leads} map={map} totals={totals} />}
          {active==='pipeline' && <Pipeline leads={leads} />}
        </div>
      </main>
      <SettingsModal />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
