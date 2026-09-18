# AI Production Incident Commander

An incident-response command center for production engineering. It watches telemetry, opens the incident, correlates the likely change, estimates blast radius, recommends a corrective action, and writes the postmortem from the timeline.

This is not a chatbot bolted onto a dashboard. It is a **platform**: an incident gateway feeds an orchestrator, which fans work out to specialized agents instead of one giant model.

```
                    ┌──────────────────────┐
                    │   Incident Gateway   │
                    │   (alerts in)        │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Incident Orchestrator│
                    └──────────┬───────────┘
                               ↓
        ┌──────────────────────┼──────────────────────┐
        ↓                      ↓                      ↓
   Detection Agent       Investigation Agent    Communication Agent
     Alerts/Logs/DB           Timeline/Git            Engineers
     Infra/Deploy/Cloud       Metrics/Logs            Management
                                                      Customers
                               │
                               ↓
                        Memory Agent (RAG)
                     Closed incidents · RCA
                     Playbooks · Outcomes
                               │
                               ↓
                        Root Cause Agent
                               ↓
                        Blast Radius Agent
                               ↓
                        Remediation Agent
                      Playbook · risk · policy
                               ↓
                  ┌────────────────────────┐
                  │   Security Gateway     │
                  │ Identity · Policy · Risk│
                  └────────────┬───────────┘
                               ↓
                           Execute?
                               ↓
                        Verification Agent
                               ↓
                         Postmortem Agent
                               ↓
                      Learn / Incident Memory
```

Wave 1 (detect / investigate / comms / memory) runs in parallel. Wave 2 is serial: cause → blast radius → remediation → **security gateway** → verification → postmortem → learn.

The Security Gateway is egress. Agents recommend; they do not hold production credentials. Identity, policy, and risk must all pass before `Execute?` is yes.

Low-risk automatic playbooks (restart, scale) may be executed by the agent. High-risk and every SEV-1 mutate wait on a commander. After the change lands, **verify → resolve → postmortem → learn** runs without another click.

```
rollback:                   risk medium    approval required
restart:                    risk low       approval automatic
delete_database:            risk critical  approval prohibited
production_secret_access:   risk critical  approval prohibited
```

MCP tools (`spinnaker.rollback`, `postgres.drop_database`, `vault.read_production_secret`) and the agent runtime (no shell, no raw prod API, no secrets in prompts) are enforced here. INC-4821 rollback stays **Execute? No** until a commander approves on the human-in-the-loop card.

Every incident is a **state machine**, not an LLM loop. Agents resume from checkpoints; they do not re-run from scratch.

```
DETECTED → TRIAGING → INVESTIGATING → ROOT_CAUSE_IDENTIFIED
  → REMEDIATION_PENDING → REMEDIATING → VERIFYING → RESOLVED → POSTMORTEM

INVESTIGATING --insufficient data--> NEED_HUMAN_INPUT → ESCALATED
```

Numeric guards (75% confidence, 15m investigation window, change-landed, recovered metrics) advance the machine. Humans gate only **high-risk** `REMEDIATION_PENDING → REMEDIATING`. Low-risk automatic playbooks auto-execute. `VERIFYING → RESOLVED` is autonomous once error rate is back under baseline.

| Incident | Seeded state | Why |
| --- | --- | --- |
| `INC-4821` | `REMEDIATION_PENDING` | 91% on Payments v2.8.14. Waiting on commander rollback. |
| `INC-4818` | `NEED_HUMAN_INPUT` | 64% after 15m. Tax-engine traces missing. |
| `INC-4812` | `POSTMORTEM` | Closed yesterday. Compiled from timeline. |

## What you get on first load

The simulator is frozen to **14 Sep 2026, 11:08 UTC**, twenty-six minutes into a real-shaped SEV-1:

| Field | Value |
| --- | --- |
| Incident | `INC-4821` |
| Severity | SEV-1 |
| Impact | ~27% of API requests failing |
| Affected | Payments, Checkout (Auth collateral, not the blast) |
| Started | 10:42 UTC |
| Likely cause | Deployment `v2.8.14` |
| Confidence | ~91% |
| Blast radius | 18,423 NA premium users · US + Canada |
| Recommended | Roll back `v2.8.14` |

The story underneath: Payments `v2.8.14` moved Postgres checkout onto the payment-intent hot path. Cluster `pg-payments-main` ran out of slots. Auth failed as collateral because it shares that cluster.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Command center — fleet deltas, open incidents, service map, detection stream.
2. Open `INC-4821` — war room opens on the **human-in-the-loop** card (18,423 users · 12.4% · +340% · Rollback v2.8.14). Approve or reject there. Agent boards and the Security Gateway sit below.
3. Confirm **Approve Rollback**. The Security Gateway licenses Execute? only after that click. Machine `REMEDIATION_PENDING → REMEDIATING → VERIFYING` as the change lands.
4. **Resolve incident** is optional. After rollback lands, verification watches recovery and the commander **auto-resolves** when error rate is back under baseline → `RESOLVED → POSTMORTEM`. The post-incident agent collects evidence, builds the timeline, names the cause and contributing factors, writes the postmortem, and writes the closed incident into memory. INC-4821 card: Payments API outage · pool exhaustion from v2.8.14 · 4 minutes after deployment · rollback to v2.8.13 · 18,423 users · 17 minutes.
5. Open `INC-4818` to walk the failure path: attach evidence (`NEED_HUMAN_INPUT → INVESTIGATING`) or escalate.

Simulation time advances 15 seconds every 2 real seconds so recovery is visible without waiting on a real bake.

## How the commander reasons

Telemetry in this repo is simulated so the product runs without Datadog, PagerDuty, or GitHub tokens. The platform is not. Events enter through the **Incident Gateway** (`POST /api/gateway` or `POST /api/actions`). The **Incident Orchestrator** then:

1. **Detection** — consumes monitoring alerts, application logs, error tracking, infra metrics, deploys, database metrics, and cloud events. Classifies **incident vs noisy alert**, then assigns SEV, confidence, patient, and start time. INC-4821 opened on `payments-api` `http_5xx_rate` 12.4% vs 0.3% baseline (+4033%) as a SEV-1 at 94% starting 10:42.
2. **Investigation** — builds a timed event graph (deploy 10:31 → DB CPU 10:35 → latency 10:39 → HTTP 500 10:42 → complaints 10:44) and names a **causal chain** (deploy → new query → pool exhaustion → timeout → 500 → payment failures). Not an LLM asked "what caused this?"
3. **Communication** — drafts **three audience copies from the same facts**. Engineers get SEV and the deploy. Management gets ~18K users and pending rollback. Customers get that payments are affected — not v2.8.14, not 500s. Same incident, different communication.
4. **Root cause** — consumes a structured evidence pack (deploys, logs, metrics, traces, git, infra), not raw context. The RCA engine scores candidates; a constrained narrator may only interpolate those rows. It cannot invent causality. INC-4821: v2.8.14 91% · DB overload 78% · network 12% · external API 6%.
5. **Incident memory** — operational RAG over closed incidents. Current incident → memory index → similar incidents → previous RCA → previous remediation → previous outcome. Retrieval is TF-IDF cosine on patient, mechanism, and change — not an LLM asked if this looks familiar. INC-4821: *This incident resembles INC-3921 from three months ago. That incident was caused by connection pool exhaustion after a database query change.*
6. **Blast radius** — walks topology from the patient. Answers **what is actually affected**, not a page-everyone guess. INC-4821: Payments → Checkout → Mobile App → premium users → 18,423. Authentication, Profile, and Notifications are quiet. US + Canada; EU and APAC are not.
7. **Remediation** — ranks a playbook catalog (rollback, restart, scale, flag, cache, failover, disable endpoint), scores **risk**, and proposes. Low-risk automatic actions may execute through the Security Gateway. SEV-1 does not.
8. **Security Gateway** — Identity · Policy · Risk → **Execute?** Agent Security, AI API Gateway, Policy & Risk, Agent Runtime, and MCP allowlists meet here. `delete_database` and `production_secret_access` are prohibited. Rollback is medium / human-required. Restart is low / automatic only when the playbook selects it.
9. **Human in the loop** — commander card with impact, root cause, recommended action, and live timeline. Approve Rollback is the only path that turns Execute? to yes on INC-4821.
10. **Verification** — watches recovery after the change lands. When error rate is back under baseline, the machine declares RESOLVED.
11. **Postmortem** — after `RESOLVED`, the agent runs Collect evidence → Generate timeline → Determine root cause → Identify contributing factors → Generate postmortem → Create corrective actions. It compiles from the engines above; it does not ask an LLM to invent a write-up. INC-4821 actions stay unchecked: pool monitoring, deploy canary, query performance test, automated rollback threshold, connection saturation alert.

12. **Evals** — synthetic incidents plus a replay of INC-4821 / 4818 / 4812, scored against ground truth. Detection (TPR, FPR, latency), RCA (accuracy, evidence, false attribution), remediation (correct / unsafe / rollback), agent behavior (hallucination, tool misuse, policy, unauthorized). The commander is tested; scores are not invented.

15. **Autonomous Incident Commander** — the closed loop. INCIDENT → DETECT → TRIAGE → INVESTIGATE → RCA → POLICY CHECK → low-risk auto-execute **or** high-risk human approval → VERIFY → RESOLVE → POSTMORTEM → LEARN. INC-4821 stays on the high-risk fork until Maya approves rollback. INC-4812 already walked the low-risk fork: SEV-3 scale, agent executed, verified, resolved, learned. After a licensed execute, the rest of the loop does not wait on another click.

16. **Production stack** — the commander is a control plane, not a Next.js-only demo. Recommended: Flutter / React → FastAPI → LangGraph / custom state machine → LLM Gateway → Policy & Risk → Tool Gateway → logs, metrics, git, cloud. Storage: PostgreSQL, Redis, vector DB, object storage. Observe with OpenTelemetry, Prometheus, Grafana. This repo is the React / custom-machine / in-memory cut of that diagram (`GET /api/stack`).

Swap `src/lib/seed.ts` for adapters against your metrics, CD, and log store. Keep `src/lib/engine/*` and `src/lib/platform/*`.

## Layout

```
src/lib/platform/   gateway, security, orchestrator, agents, incident state machine, stack
src/lib/engine/     detect, correlate, rca, memory, blast radius, remediate, comms, human-loop, recommend, postmortem, evals, autonomy
src/lib/store.ts    live world + SSE
src/app/api/        state, stream, gateway, actions, reset, postmortems, evals, security, stack
src/app/            command center, war room, postmortem
```

## Stack

This repo is a single-process simulator: Next.js 16, React 19, TypeScript, Tailwind v4. No database.

The production cut of the same commander:

```
Frontend
   Flutter / React
       ↓
Backend
   Python / FastAPI
       ↓
Agent Orchestrator
   LangGraph / custom state machine
       ↓
LLM Gateway
       ↓
Policy & Risk Engine
       ↓
Tool Gateway
       ↓
┌────────┬────────┬────────┬────────┐
│ Logs   │ Metrics│ Git    │ Cloud  │
└────────┴────────┴────────┴────────┘
```

| Lane | Production | This process |
| --- | --- | --- |
| Frontend | Flutter / React | React 19 command center |
| Backend | FastAPI | Next.js `/api/*` |
| Orchestrator | LangGraph / custom machine | Custom incident machine + checkpoints |
| LLM Gateway | LLM Gateway | Constrained engines · secret redaction |
| Policy & Risk | Policy engine | Security Gateway · Execute? |
| Tools | Tool Gateway | MCP allowlist |
| Sources | Logs, metrics, git, cloud | Simulated ingest |
| Storage | PostgreSQL, Redis, vector DB, object storage | `globalThis.__icc` |
| Observe | OpenTelemetry, Prometheus, Grafana | War-room charts |

Keep `src/lib/engine/*` and `src/lib/platform/*` when you swap the process.
