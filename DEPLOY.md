# Deploying EIOS

## Your 404 — the cause

Vercel looked at the repo root, found no `package.json` and no `vercel.json`, and had
nothing to build. The app is nested at `eios-prototype/web`. `vercel.json` (now at the
root) tells it where to look.

**But fixing the 404 gets you a UI that loads and then fails every API call**, because the
backend is not there — and cannot be.

---

## Why Vercel cannot host the EIOS backend

This is not a config problem. It is architectural. Vercel functions are **serverless**:
they spin up per request and die. EIOS is the opposite of that by design.

| EIOS needs | Vercel serverless | Consequence |
|---|---|---|
| **A 4s heartbeat** (`pulse.start(4000)`) | No process between requests | The core premise — *"runs whether or not anyone is looking"* — is impossible. Nothing observes overnight. |
| **A writable disk** (`appendFileSync` → `events.jsonl`) | Read-only except `/tmp`, wiped per invocation | The durability I verified across a process kill is gone. The org forgets constantly. |
| **SSE** (`/api/pulse/stream`) | Execution time limits | The live monitor never streams. |
| **In-memory singletons** (twin, memory fabric, cost ledger) | Fresh instance per invocation | State is inconsistent or empty. |
| **One instance** (`ARCHITECTURE.md` FM8: *"Two instances, one log → undefined. No locking."*) | Multi-instance by design | Concurrent writers to one log. Undefined behaviour. |

You could contort EIOS into serverless — external Redis for state, a cron ping for the
heartbeat, polling instead of SSE, Postgres for the log. That is a rewrite, and it would
be a worse system. **The correct answer is a container that stays running.**

---

## ⚠ Before you deploy anything publicly

`authenticate()` has no login — EIOS assumes one user, which is an assumption about *who
can reach the port*. True on localhost; false on a public URL.

**I've made this fail closed.** The server now:
- **refuses every remote request** unless `EIOS_ACCESS_TOKEN` is set, and
- requires that token on every call once it is.

So an unprotected public deploy serves nobody rather than serving your memory, decisions
and mailbox to whoever finds the URL.

> This is a shared secret, not authentication. It makes a *personal* deployment safe. It
> is not an enterprise control — that is Entra ID JWT validation, and `authenticate()` is
> its seam.

**Also:** if you deploy publicly and then feed it real bank email, that email now lives on
a third-party host. Consider whether you want that at all before you want it working.

---

## Option A — Local (recommended; what SETUP.md describes)

```bash
npm run dev     # → http://localhost:5180
```
No token needed (localhost is allowed). Everything works: heartbeat, SSE, durable log.

## Option B — One container, one URL (the right deploy)

Uses the existing `Dockerfile`. The API serves the built UI, so there is one origin, no
CORS, and SSE works.

```bash
docker compose up --build     # → http://localhost:4180
```

To host it — **Render** (blueprint included), Railway, or Fly.io:

1. Render → New → **Blueprint** → point at this repo. It reads `render.yaml`.
2. It mints `EIOS_ACCESS_TOKEN` for you. Copy it.
3. Set `EIOS_LLM_BASE_URL` and `EIOS_LLM_API_KEY` in the dashboard.
4. Rebuild the web with the token baked in:
   ```bash
   VITE_ACCESS_TOKEN=<the token> npm --prefix eios-prototype/web run build
   ```

> **Free tiers sleep.** Render's free tier idles after ~15 min of no traffic. A sleeping
> EIOS is not an operating system — it stops observing, which is the whole product. Fine
> for a demo; use a paid instance for anything real.

> **Keep the persistent disk.** Without `/app/data`, every deploy wipes the event log and
> the durability guarantee becomes a lie.

## Option C — Split: UI on Vercel, backend on a container host

Only if you specifically want a Vercel link.

1. Deploy the backend (Option B). Note its URL, e.g. `https://eios.onrender.com`.
2. In Vercel → Settings → Environment Variables:
   ```
   VITE_API_URL      = https://eios.onrender.com
   VITE_ACCESS_TOKEN = <the token from Render>
   ```
3. Redeploy. **Vite inlines `VITE_*` at build time** — changing them requires a rebuild,
   not a restart.

⚠ `VITE_ACCESS_TOKEN` ships **inside the JavaScript bundle**. Anyone who opens devtools on
your Vercel URL can read it. That is acceptable for a personal demo behind an obscure URL;
it is not a secret in any real sense. If that bothers you, use Option B and don't expose
the UI separately.

---

## What "deployed" still does not mean

Unchanged by any of this (see `README.md`):

- **No live Microsoft integration.** `liveSources: 0` — the twin observes a simulation and
  says so on screen.
- **Email triage is the only real workflow**, and it runs on mail you export by hand.
- **The knowledge fabric resets on restart** (`FM6`) — the event log persists; memory does not.
- **The 90% figure is unmeasured.** The scorecard reports it as `NOT MEASURABLE`.
