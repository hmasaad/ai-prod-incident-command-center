import { analyzeBlast, toBlastRadius } from "../engine/blast-radius";
import { investigate } from "../engine/correlate";
import { detectIncident, latestMetrics } from "../engine/detect";
import { analyzeRca } from "../engine/rca";
import { analyzeRemediation } from "../engine/remediate";
import { buildHumanLoop } from "../engine/human-loop";
import { draftComms } from "../engine/comms";
import { inspectSecurity, actionToIntent } from "./security";
import { buildPostmortem } from "../engine/postmortem";
import { recallMemory } from "../engine/memory";
import { buildAutonomyLoop } from "../engine/autonomy";
import { recommend, type Recommendation } from "../engine/recommend";
import type {
  ActionType,
  Actor,
  Deployment,
  GatewayEvent,
  HumanLoopBrief,
  Incident,
  LogEvent,
  MemoryRecord,
  MemoryVerdict,
  MetricSample,
  PipelineSnapshot,
  Postmortem,
  SecurityVerdict,
  Service,
} from "../types";
import { activeStage, runAgents } from "./agents";

export interface EvaluateInput {
  now: number;
  incident: Incident;
  services: Service[];
  metrics: MetricSample[];
  deployments: Deployment[];
  logs: LogEvent[];
  onCall: { primary: string; comms: string };
  ingest: GatewayEvent[];
  lastHumanAction?: ActionType;
  lastSecurity?: SecurityVerdict | null;
  catalog?: MemoryRecord[];
}

export interface Evaluation {
  investigation: Incident["investigation"];
  recommendation: Recommendation;
  pipeline: PipelineSnapshot;
  agentActors: Actor[];
  postmortem: Postmortem;
  humanLoop: HumanLoopBrief;
  memory: MemoryVerdict;
}

export function evaluateIncident(input: EvaluateInput): Evaluation {
  const analysis = investigate({
    now: input.now,
    services: input.services,
    metrics: input.metrics,
    deployments: input.deployments,
    logs: input.logs,
    affectedServiceIds: input.incident.affectedServiceIds,
    rollbackApplied: input.incident.rollbackApplied,
    mitigationApplied: input.incident.mitigationApplied,
  });

  const detection = detectIncident({
    incidentId: input.incident.id,
    now: input.now,
    metrics: input.metrics,
    logs: input.logs,
    deployments: input.deployments,
    services: input.services,
    rollbackApplied: input.incident.rollbackApplied,
    closed: input.incident.status === "RESOLVED" || input.incident.status === "POSTMORTEM",
  });

  const rca = analyzeRca({
    incidentId: input.incident.id,
    now: input.now,
    metrics: input.metrics,
    logs: input.logs,
    deployments: input.deployments,
    services: input.services,
    rollbackApplied: input.incident.rollbackApplied,
    mitigationApplied: input.incident.mitigationApplied,
    humanEvidence: input.incident.machine?.humanEvidence,
  });

  const blast = analyzeBlast({
    incidentId: input.incident.id,
    services: input.services,
    failingRequestPct: latestMetrics(input.metrics).errorRate,
    rollbackApplied: input.incident.rollbackApplied,
  });
  analysis.blastRadius = toBlastRadius(blast);

  const remediation = analyzeRemediation({
    incidentId: input.incident.id,
    status: input.incident.machine?.state ?? input.incident.status,
    rollbackApplied: input.incident.rollbackApplied,
    mitigationApplied: input.incident.mitigationApplied,
    rejected: input.incident.remediationRejected,
  });

  const comms = draftComms({
    incidentId: input.incident.id,
    status: input.incident.machine?.state ?? input.incident.status,
    severity: input.incident.severity,
    detection,
    rca,
    blast,
    remediation,
    rollbackApplied: input.incident.rollbackApplied,
  });

  const rec = recommend(input.incident, analysis);
  const err = latestMetrics(input.metrics).errorRate;
  const humanLoop = buildHumanLoop({ ...input.incident, investigation: analysis, detection, rca, blast, remediation }, input.metrics);
  const postmortem = buildPostmortem(
    { ...input.incident, investigation: analysis, detection, rca, blast, remediation, humanLoop, comms },
    input.now,
  );
  const memory = recallMemory(
    { ...input.incident, investigation: analysis, detection, rca, blast, remediation, humanLoop, comms, postmortem },
    input.now,
    input.catalog ?? [],
  );
  const security = inspectSecurity({
    now: input.now,
    remediation,
    recommended: actionToIntent(remediation.actionType),
    severity: input.incident.severity,
    lastDecision: input.lastSecurity,
  });

  const agents = runAgents({
    now: input.now,
    incident: { ...input.incident, investigation: analysis, detection, rca, blast, remediation, humanLoop, comms, postmortem, memory },
    services: input.services,
    metrics: input.metrics,
    deployments: input.deployments,
    logs: input.logs,
    onCall: input.onCall,
    analysis,
    detection,
    rca,
    blast,
    remediation,
    comms,
    postmortem,
    memory,
    lastHumanAction: input.lastHumanAction,
  });

  const stage = activeStage(agents);
  const blocked = agents.find((a) => a.id === "remediation");

  const pipeline: PipelineSnapshot = {
    incidentId: input.incident.id,
    activeStage: stage,
    gateway: {
      title: "Incident Gateway",
      summary: `Normalized ${input.ingest[0]?.source ?? "metrics"} · last: ${input.ingest[0]?.title ?? "telemetry tick"} (${err.toFixed(1)}% failing).`,
    },
    orchestrator: {
      title: "Incident Orchestrator",
      summary: `Machine ${input.incident.machine.state}. Wave 1 parallel (detect · investigate · comms · memory). Wave 2 serial through ${stage}. ${
        blocked?.status === "blocked"
          ? input.incident.severity === "SEV-1"
            ? "Policy check: high-risk — waiting on commander."
            : "Policy check: playbook held."
          : "Pipeline live."
      }`,
    },
    agents,
    ingest: input.ingest,
    detection,
    rca,
    blast,
    remediation,
    security,
    comms,
    postmortem,
    memory,
    autonomy: buildAutonomyLoop({
      incident: { ...input.incident, investigation: analysis, detection, rca, blast, remediation, humanLoop, comms, postmortem, memory },
      learned: Boolean(input.incident.resolvedAt) || input.incident.status === "POSTMORTEM",
      now: input.now,
    }),
  };

  const agentActors: Actor[] = agents.map((a) => ({
    id: `agent-${a.id}`,
    kind: "agent",
    name: a.name.replace(" Agent", ""),
    role: a.role,
    status: a.summary,
  }));

  return {
    investigation: analysis,
    recommendation: rec,
    pipeline,
    agentActors,
    humanLoop,
    postmortem,
    memory,
  };
}
