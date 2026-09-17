# AI Production Incident Commander

An incident-response command center for production engineering. It watches telemetry, opens the incident, correlates the likely change, estimates blast radius, recommends a corrective action, and writes the postmortem from the timeline.

This is not a chatbot bolted onto a dashboard. It is a **platform**: an incident gateway feeds an orchestrator, which fans work out to specialized agents instead of one giant model.

```
                    ┌──────────────────────┐
                    │   Incident Gateway   │
                    └──────────┬───────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Incident Orchestrator│
                    └──────────┬───────────┘
                               ↓
        ┌──────────────────────┼──────────────────────┐
        ↓                      ↓                      ↓
   Detection Agent       Investigation Agent    Communication Agent
     Alerts/Logs/Errors      Logs/Traces            Slack/Teams
     Infra/Deploy/DB/Cloud
                               │
                               ↓
                        Root Cause Agent
                               ↓
                        Blast Radius Agent
                               ↓
                        Remediation Agent
                               ↓
                        Verification Agent
                               ↓
                         Postmortem Agent
```

Wave 1 (detect / investigate / comms) runs in parallel. Wave 2 is serial: cause → blast radius → remediation → verification → postmortem. Remediation is **blocked on a human** until rollback is approved.

Every incident is a **state machine**, not an LLM loop. Agents resume from checkpoints; they do not re-run from scratch.

```
DETECTED → TRIAGING → INVESTIGATING → ROOT_CAUSE_IDENTIFIED
  → REMEDIATION_PENDING → REMEDIATING → VERIFYING → RESOLVED → POSTMORTEM

INVESTIGATING --insufficient data--> NEED_HUMAN_INPUT → ESCALATED
```

Numeric guards (75% confidence, 15m investigation window, change-landed) advance the machine. Humans gate `REMEDIATION_PENDING → REMEDIATING` and `VERIFYING → RESOLVED`.

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
| Affected | Payments API, Auth API |
| Started | 10:42 UTC |
| Likely cause | Deployment `v2.8.14` |
| Confidence | ~91% |
| Blast radius | ~18,400 users |
| Recommended | Roll back `v2.8.14` |

The story underneath: Payments `v2.8.14` moved Postgres checkout onto the payment-intent hot path. Cluster `pg-payments-main` ran out of slots. Auth failed as collateral because it shares that cluster.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Command center — fleet deltas, open incidents, service map, detection stream.
2. Open `INC-4821` — war room with commander brief, hypotheses, charts (deploy marker at 10:38), coordination, logs, and git change inspection.
3. Confirm **Execute rollback v2.8.14** — machine `REMEDIATION_PENDING → REMEDIATING → VERIFYING` as the change lands. Watch error rate, latency, connections, and crash rate recover.
4. **Resolve incident** → `RESOLVED → POSTMORTEM`. Analysis is generated from checkpoints + the live timeline.
5. Open `INC-4818` to walk the failure path: attach evidence (`NEED_HUMAN_INPUT → INVESTIGATING`) or escalate.

Simulation time advances 15 seconds every 2 real seconds so recovery is visible without waiting on a real bake.

## How the commander reasons

Telemetry in this repo is simulated so the product runs without Datadog, PagerDuty, or GitHub tokens. The platform is not. Events enter through the **Incident Gateway** (`POST /api/gateway` or `POST /api/actions`). The **Incident Orchestrator** then:

1. **Detection** — consumes monitoring alerts, application logs, error tracking, infra metrics, deploys, database metrics, and cloud events. Classifies **incident vs noisy alert**, then assigns SEV, confidence, patient, and start time. INC-4821 opened on `payments-api` `http_5xx_rate` 12.4% vs 0.3% baseline (+4033%) as a SEV-1 at 94% starting 10:42.
2. **Investigation** — logs, traces, and git evidence (parallel with detection and comms).
3. **Communication** — Slack/Teams: commander, comms, page, war-room channel.
4. **Root cause** — ranks deploy vs traffic vs infra with an explicit confidence.
5. **Blast radius** — affected RPS and whether the node sits on the revenue path.
6. **Remediation** — corrective action (rollback) separately from mitigations (raise pool cap). Blocked until a human approves.
7. **Verification** — watches recovery after the change lands.
8. **Postmortem** — compiled from the live timeline after resolve.

Swap `src/lib/seed.ts` for adapters against your metrics, CD, and log store. Keep `src/lib/engine/*` and `src/lib/platform/*`.

## Layout

```
src/lib/platform/   gateway, orchestrator, agents, incident state machine
src/lib/engine/     detect, correlate, blast radius, recommend, postmortem
src/lib/store.ts    live world + SSE
src/app/api/        state, stream, gateway, actions, reset, postmortems
src/app/            command center, war room, postmortem
```

## Stack

Next.js 16, React 19, TypeScript, Tailwind v4. Single process, no database.
