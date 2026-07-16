# EIOS — Setup on a locked-down work laptop

**Goal:** get real reasoning running on *your own* email, with **no admin ticket** and
**no policy violation**, for a few dollars.

---

## Read this first — the honest constraints

| | |
|---|---|
| **What needs admin** | Reading your mailbox via **Microsoft Graph** (needs an Entra ID app registration + *tenant-wide admin consent*). This is a project, not an afternoon. |
| **What does NOT need admin** | **Exporting your own mail and feeding EIOS the file.** You already have every right to read your inbox. Nothing new is granted to anyone. This is what you do manually each morning — automated. |
| **The rule of thumb** | If you wouldn't paste it into your internal AI tool by hand, don't feed it to EIOS — because that is exactly what EIOS does on your behalf. |

**Before you start:** confirm your internal AI gateway is approved for work content.
It almost certainly is — that's what it's for. EIOS redacts account numbers, cards, PAN,
Aadhaar, UPI IDs, phones and emails **before** anything leaves your machine, but that's a
safety net, not a licence.

---

## Step 0 — Can you run Node? (2 minutes)

```bash
node --version    # need v20+
```

| Result | Do this |
|---|---|
| ✅ `v20`/`v22` | Skip to Step 1. |
| ❌ not found | **Portable Node — no admin, no installer:** download the **Windows Binary (.zip)** from nodejs.org, extract to `C:\Users\<you>\node`, then `set PATH=C:\Users\<you>\node;%PATH%`. Runs from a folder. |
| ❌ can't download | Ask a colleague for the zip, or use a dev VM. |

**If `npm install` fails behind the proxy:**
```bash
npm config set registry https://your-internal-artifactory/api/npm/npm-remote/
npm config set proxy http://your-proxy:8080
npm config set https-proxy http://your-proxy:8080
```
Most banks run an internal npm mirror. Ask the platform team for the URL — that's a
question, not a permission request.

---

## Step 1 — Install & configure

```bash
cd eios-prototype
npm run install:all
cp .env.example .env
```

Edit `.env`:

```bash
EIOS_LLM_BASE_URL=https://your-internal-ai-gateway/v1   # ask your AI/platform team
EIOS_LLM_API_KEY=your-key
EIOS_LLM_SMALL_MODEL=gpt-4o-mini    # whatever cheap model they expose
EIOS_LLM_FRONTIER_MODEL=gpt-4o      # whatever good model they expose
EIOS_LLM_BUDGET_USD=50              # hard stop. EIOS refuses to spend past this.
```

> **Any OpenAI-compatible endpoint works** — internal gateway, Azure OpenAI, OpenRouter,
> LM Studio, or Ollama. That covers ~95% of internal tools.

**Free/offline option** (no cost, no network, weaker results):
```bash
# ollama pull phi3:mini
EIOS_LLM_BASE_URL=http://localhost:11434/v1
EIOS_LLM_SMALL_MODEL=phi3:mini
```

Start it:
```bash
npm run dev     # → http://localhost:5180
```

Check reasoning is live:
```bash
curl http://localhost:4180/api/llm/status -H 'x-eios-user: u-dc'
# "configured": true, "note": "Real reasoning enabled."
```
If `configured: false`, EIOS runs on rules only **and says so** — it won't pretend.

---

## Step 2 — Export your own mail

**Outlook (desktop) → CSV** *(easiest)*
File → Open & Export → Import/Export → **Export to a file** → **Comma Separated Values** →
pick a folder (start with something small, ~50 mails) → save as `inbox.csv`.

**Outlook (web) → JSON**
Or hand-build a JSON array — any shape with these keys works:
```json
[{"from":"noc@bank.in","subject":"P1: UPI switch failing","date":"2026-07-16T06:05:00Z","body":"UPI down since 06:01..."}]
```

Also supported: `.eml` (single message — drag one out of Outlook) and `.mbox`.

---

## Step 3 — Dry run first (costs nothing)

**Always do this before spending a rupee.** It proves the export parses:

```bash
curl -X POST "http://localhost:4180/api/ingest/email?filename=inbox.csv&dryRun=true" \
  -H 'content-type: text/plain' -H 'x-eios-user: u-dc' \
  --data-binary @inbox.csv
```

You get: how many parsed, the estimated cost, and a 3-email sample. **No model call.**

---

## Step 4 — Real triage

```bash
curl -X POST "http://localhost:4180/api/ingest/email?filename=inbox.csv&limit=50" \
  -H 'content-type: text/plain' -H 'x-eios-user: u-dc' \
  --data-binary @inbox.csv
```

You get back, per email: priority · summary · suggested action · who to delegate to ·
**what PII was redacted** · cost. Plus the only number that matters:

```
50 emails → 4 need you (92% filtered out)
minutes saved: 92    cost: $0.008
budget remaining: $49.99 of $50
```

Then open **http://localhost:5180** → Command Center. **The priority queue is now your
actual inbox**, triaged.

---

## Step 5 — Judge it honestly

This is the whole point. Go through the triage output and ask:

1. **Did it miss anything that needed me?** ← the only unforgivable failure
2. **Did it escalate junk?** (false escalation)
3. **Would I have delegated the same way?**

Then record your verdict so the platform can measure itself:
```bash
curl -X POST http://localhost:4180/api/attention/<item-id>/feedback \
  -H 'content-type: application/json' -H 'x-eios-user: u-dc' \
  -d '{"neededExecutive":true}'

curl http://localhost:4180/api/platform/scorecard -H 'x-eios-user: u-dc'
```

**If it's good** → you now have evidence for the admin conversation.
**If it's bad** → you learned that for $0.01 instead of a six-month programme.

---

## Watch your $50

```bash
curl http://localhost:4180/api/llm/cost -H 'x-eios-user: u-dc'
```

Shows spend, remaining, cost per call, spend by purpose, and **how many more emails your
credit buys**.

**Why $50 goes far:** the small model does the 300 daily triage calls (~$0.05/day); the
frontier model is spent only on the ~3 things that reach you.

| Approach | 300 emails/day | $50 lasts |
|---|---|---|
| Everything on frontier | ~$1.12/day | ~6 weeks |
| **Routed (EIOS default)** | **~$0.05/day** | **~2.5 years** |

EIOS **hard stops** at the budget. It will refuse to call rather than surprise you.

---

## Deploying properly (later)

```bash
docker compose up --build     # → http://localhost:4180 (UI + API, one container)
```

The volume matters: without `eios-data`, the event log dies with the container and the
organization forgets.

> **Note:** EIOS is meant to run **24/7** — its premise is a heartbeat observing overnight.
> A laptop that sleeps at 7pm isn't an operating system for an organization. Laptop is
> right for *evaluating*; a server is right for *using*. And it is **single-instance only**
> today (`docs/ARCHITECTURE.md` FM8 — no locking).

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `configured: false` | `.env` not loaded — run from `eios-prototype/`, restart after editing |
| `LLM 401` | Wrong key, or your gateway wants a custom header → `EIOS_LLM_HEADERS={"x-api-key":"..."}` |
| `LLM 404` | Base URL needs `/v1` (or, for Azure, the full deployment path) |
| `Could not parse any email` | Try `?filename=x.csv` explicitly, or convert to the JSON shape above |
| `budget exhausted` | Raise `EIOS_LLM_BUDGET_USD` or restart to reset the ledger (it's in-memory) |
| Everything marked `critical` | Your model is too weak for triage — try the frontier model for a run and compare |

---

## What this does NOT do yet

Being straight with you:

- **No live Microsoft integration.** Graph/DevOps/ServiceNow connectors are typed and
  wired but return nothing without credentials + admin consent. Everything on the Pulse
  screen is **simulated** — the UI says `liveSources: 0` for exactly this reason.
- **Email triage is the only real workflow.** It's the biggest one (12.5 hrs/week), but
  it's one.
- **The knowledge fabric resets on restart** (`FM6`). The event log persists; memory doesn't.
- **The 90% workload figure is a vision target, never measured.** The scorecard reports
  attention precision as `NOT MEASURABLE` until you feed it feedback. Use Step 5 to find
  the real number.
