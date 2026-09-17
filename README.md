# AI Production Incident Commander

An incident-response command center for production engineering. It watches telemetry, opens the incident, correlates the likely change, estimates blast radius, recommends a corrective action, and writes the postmortem from the timeline.

This is not a chatbot bolted onto a dashboard. Detection, investigation, and response are a closed loop over the same world model: services, deploys, metrics, logs, and people.

```
                    DETECT → INVESTIGATE → RESPOND
                                  ↓
                              COORDINATE
                                  ↓
                           RESOLVE INCIDENT
                                  ↓
                        POST-INCIDENT ANALYSIS
```

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
3. Confirm **Execute rollback v2.8.14** — watch error rate, latency, connections, and crash rate recover.
4. **Resolve incident** → post-incident analysis generated from the live timeline.

Simulation time advances 15 seconds every 2 real seconds so recovery is visible without waiting on a real bake.

## How the commander reasons

Telemetry in this repo is simulated so the product runs without Datadog, PagerDuty, or GitHub tokens. The engine is not. Given metrics, deploys, logs, and a service graph it:

1. **Detects** error / latency / pool / crash cliffs against a pre-incident baseline.
2. **Correlates** the first anomalous sample with deploys in a 30-minute window, pool-timeout log volume, and topology (who shares the database).
3. **Ranks hypotheses** (bad change, traffic, infra) with an explicit confidence.
4. **Estimates blast radius** from affected RPS and whether the node sits on the revenue path.
5. **Recommends** a corrective action (rollback) separately from mitigations (raise pool cap).
6. **Writes the postmortem** from the timeline, not from a blank template.

Swap `src/lib/seed.ts` for adapters against your metrics, CD, and log store. Keep `src/lib/engine/*`.

## Layout

```
src/lib/engine/     detect, correlate, blast radius, recommend, postmortem
src/lib/store.ts    live world + SSE
src/app/api/        state, stream, actions, reset, postmortems
src/app/            command center, war room, postmortem
```

## Stack

Next.js 16, React 19, TypeScript, Tailwind v4. Single process, no database.
