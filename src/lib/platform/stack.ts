import type { GatewayEvent, StackNode, StackSnapshot, StackStatus } from "../types";

/**
 * Production stack the commander is built toward.
 * This process is the React / custom-machine / in-memory cut of that diagram.
 */
export function buildStack(input: {
  execute: boolean;
  machine: string;
  ingest: GatewayEvent[];
}): StackSnapshot {
  const last = input.ingest[0];

  const control: StackNode[] = [
    node(
      "frontend",
      "Frontend",
      "Flutter / React",
      "React 19 · Next.js 16",
      "live",
      "Command center and war room. Same product surface a Flutter client would call.",
    ),
    node(
      "backend",
      "Backend",
      "Python / FastAPI",
      "Next.js App Router",
      "live",
      "/api/state · /api/stream · /api/gateway · /api/actions. Swap the routes for FastAPI; keep the engines.",
    ),
    node(
      "orchestrator",
      "Agent Orchestrator",
      "LangGraph / custom state machine",
      "Custom incident machine",
      "live",
      `Machine ${input.machine}. Agents resume from checkpoints. LangGraph is the production graph over the same states.`,
    ),
    node(
      "llm_gateway",
      "LLM Gateway",
      "LLM Gateway",
      "Constrained engines",
      "sim",
      "No raw model on the hot path. RCA narrator interpolates scored rows. AI API Gateway redacts secrets before any model context.",
    ),
    node(
      "policy",
      "Policy & Risk Engine",
      "Policy & Risk Engine",
      "Security Gateway",
      "live",
      input.execute
        ? "Identity · Policy · Risk passed. Execute? yes."
        : "Identity · Policy · Risk. INC-4821 rollback is held — Execute? no.",
    ),
    node(
      "tool_gateway",
      "Tool Gateway",
      "Tool Gateway",
      "MCP allowlist",
      "live",
      "spinnaker.rollback requires a human. postgres.drop_database and vault.read are prohibited. No shell, no raw prod API.",
    ),
  ];

  const sources: StackNode[] = [
    node(
      "logs",
      "Logs",
      "Log store",
      "Simulated log stream",
      "sim",
      "Application logs · PoolCheckoutTimeout · worker fatals.",
    ),
    node(
      "metrics",
      "Metrics",
      "Metrics store",
      "Simulated time series",
      "sim",
      last ? `Last ingest: ${last.source} · ${last.title}.` : "HTTP 500 · p95 · DB connections · crash rate.",
    ),
    node(
      "git",
      "Git",
      "Git / CD",
      "Simulated deploys + diffs",
      "sim",
      "v2.8.14 a1f3c2d · src/db/pool.ts on the payment-intent path.",
    ),
    node(
      "cloud",
      "Cloud",
      "Cloud health",
      "Simulated cloud events",
      "sim",
      "us-east-1 quiet. Not an AZ or control-plane outage.",
    ),
  ];

  const storage: StackNode[] = [
    node("postgres", "PostgreSQL", "PostgreSQL", "In-process world", "target", "Incidents, machines, checkpoints, postmortems. Durable source of truth."),
    node("redis", "Redis", "Redis", "globalThis.__icc", "target", "Live world, SSE fan-out, tick clock. This process holds it in memory."),
    node("vector", "Vector DB", "Vector DB", "TF-IDF memory corpus", "target", "Operational RAG over closed incidents. Swap cosine-over-tokens for embeddings."),
    node("objects", "Object Storage", "Object Storage", "In-memory evidence pack", "target", "Timelines, diffs, postmortem artifacts, eval fixtures."),
  ];

  const observe: StackNode[] = [
    node("otel", "OpenTelemetry", "OpenTelemetry", "Incident Gateway ingest", "target", "Traces and agent spans for detect → RCA → remediate."),
    node("prometheus", "Prometheus", "Prometheus", "Fleet deltas on the command center", "target", "Commander SLIs: detection latency, auto-execute rate, policy denials."),
    node("grafana", "Grafana", "Grafana", "War-room charts", "target", "Error rate, p95, pool, crash. Production dashboards sit beside this room."),
  ];

  return {
    question: "What does this run on when it is not a simulator?",
    answer:
      "React over a FastAPI-shaped control plane, a checkpointed incident machine (LangGraph in production), an LLM gateway that never sees secrets, then Policy & Risk, then a tool gateway into logs, metrics, git, and cloud. Storage is Postgres · Redis · vector · objects. Observe with OpenTelemetry · Prometheus · Grafana.",
    control,
    sources,
    storage,
    observe,
  };
}

function node(
  id: StackNode["id"],
  label: string,
  recommended: string,
  running: string,
  status: StackStatus,
  detail: string,
): StackNode {
  return { id, label, recommended, running, status, detail };
}
