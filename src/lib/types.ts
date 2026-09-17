export type Severity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
export type IncidentStatus =
  | "DETECTED"
  | "TRIAGING"
  | "INVESTIGATING"
  | "ROOT_CAUSE_IDENTIFIED"
  | "REMEDIATION_PENDING"
  | "REMEDIATING"
  | "VERIFYING"
  | "RESOLVED"
  | "POSTMORTEM"
  | "NEED_HUMAN_INPUT"
  | "ESCALATED";
export type ServiceHealth = "healthy" | "degraded" | "outage";
export type ServiceLayer = "edge" | "gateway" | "api" | "data" | "async";
export type HypothesisKind = "deploy" | "config" | "dependency" | "traffic" | "infra";
export type ActionType =
  | "rollback"
  | "scale_pool"
  | "page_oncall"
  | "open_channel"
  | "disable_flag"
  | "resolve"
  | "provide_input"
  | "escalate";
export type ActionStatus = "pending" | "running" | "succeeded" | "failed";
export type ActorKind = "human" | "agent" | "service";
export type LogLevel = "info" | "warn" | "error" | "fatal";

export interface Service {
  id: string;
  name: string;
  layer: ServiceLayer;
  health: ServiceHealth;
  errorRate: number;
  latencyP95: number;
  rps: number;
  owners: string[];
  dependsOn: string[];
  version: string;
}

export interface MetricSample {
  ts: number;
  errorRate: number;
  latencyP95: number;
  dbConnections: number;
  crashRate: number;
  http500Index: number;
  rps: number;
}

export interface FleetSnapshot {
  http500DeltaPct: number;
  latencyDeltaPct: number;
  dbConnDeltaPct: number;
  crashDeltaPct: number;
  failingRequestPct: number;
  affectedUsers: number;
}

export type DetectionSource =
  | "alerts"
  | "logs"
  | "errors"
  | "infra"
  | "deploy"
  | "database"
  | "cloud";

/** One monitoring sample the detection agent consumed — not an LLM prompt. */
export interface DetectionSample {
  service: string;
  metric: string;
  current: string;
  baseline: string;
  increase: string;
}

export interface DetectionSignal {
  source: DetectionSource;
  label: string;
  firing: boolean;
  sample?: DetectionSample;
  detail: string;
}

export interface DetectionVerdict {
  incidentId: string;
  verdict: "incident" | "noisy";
  question: string;
  answer: string;
  severity: Severity;
  confidence: number;
  affected: string[];
  startedAt: number;
  lead: DetectionSample;
  signals: DetectionSignal[];
}

export interface Deployment {
  id: string;
  serviceId: string;
  version: string;
  previousVersion: string;
  startedAt: number;
  completedAt: number;
  status: "success" | "rolled_back" | "in_progress" | "rolling_back";
  commit: string;
  author: string;
  message: string;
  files: string[];
}

export interface LogEvent {
  id: string;
  ts: number;
  serviceId: string;
  level: LogLevel;
  message: string;
  traceId?: string;
}

export interface TimelineEvent {
  id: string;
  ts: number;
  kind: "detect" | "investigate" | "respond" | "coordinate" | "resolve" | "note";
  title: string;
  detail: string;
  actor?: string;
}

export interface Hypothesis {
  id: string;
  kind: HypothesisKind;
  title: string;
  confidence: number;
  rationale: string;
}

export interface Correlation {
  id: string;
  left: string;
  right: string;
  strength: number;
  note: string;
}

export interface Evidence {
  id: string;
  source: "metrics" | "logs" | "deploy" | "git" | "topology";
  title: string;
  detail: string;
  ts?: number;
}

export interface BlastRadius {
  users: number;
  services: string[];
  revenuePath: boolean;
  regions: string[];
  description: string;
}

export interface Investigation {
  summary: string;
  hypotheses: Hypothesis[];
  selectedHypothesisId: string;
  correlations: Correlation[];
  blastRadius: BlastRadius;
  evidence: Evidence[];
  confidence: number;
  likelyCause: string;
  recommendedAction: string;
}

export interface Actor {
  id: string;
  kind: ActorKind;
  name: string;
  role: string;
  status: string;
}

export interface ActionRecord {
  id: string;
  type: ActionType;
  label: string;
  status: ActionStatus;
  requestedAt: number;
  completedAt?: number;
  detail: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  startedAt: number;
  detectedAt: number;
  resolvedAt?: number;
  affectedServiceIds: string[];
  impact: string;
  commander?: string;
  timeline: TimelineEvent[];
  investigation: Investigation;
  actors: Actor[];
  actions: ActionRecord[];
  mitigationApplied: boolean;
  rollbackApplied: boolean;
  machine: IncidentMachine;
  detection: DetectionVerdict;
  brief: {
    summary: string;
    impact: string;
    users: number;
    confidence: number;
    likelyCause: string;
  };
}

export interface Postmortem {
  incidentId: string;
  title: string;
  severity: Severity;
  durationMin: number;
  summary: string;
  impact: string;
  timeline: TimelineEvent[];
  rootCause: string;
  detection: string;
  response: string;
  wentWell: string[];
  wentPoorly: string[];
  actionItems: { owner: string; item: string }[];
}

export type AgentId =
  | "detection"
  | "investigation"
  | "communication"
  | "root-cause"
  | "blast-radius"
  | "remediation"
  | "verification"
  | "postmortem";

export type MachineEvent =
  | "triage"
  | "begin_investigation"
  | "evidence_sufficient"
  | "insufficient_data"
  | "human_input"
  | "escalate"
  | "playbook_ready"
  | "approve_remediation"
  | "change_landed"
  | "declare_resolved"
  | "postmortem_ready";

export interface TransitionRecord {
  at: number;
  event: MachineEvent;
  from: IncidentStatus;
  to: IncidentStatus;
  reason: string;
}

export interface Checkpoint {
  id: string;
  at: number;
  state: IncidentStatus;
  event: MachineEvent;
  agentId?: AgentId;
  note: string;
}

export interface IncidentMachine {
  state: IncidentStatus;
  enteredAt: number;
  history: TransitionRecord[];
  checkpoints: Checkpoint[];
  humanEvidence: boolean;
}

export type AgentRunStatus = "idle" | "running" | "complete" | "blocked" | "skipped";

export interface AgentRun {
  id: AgentId;
  name: string;
  role: string;
  consumes: string;
  status: AgentRunStatus;
  summary: string;
}

export interface GatewayEvent {
  id: string;
  ts: number;
  source: "alerts" | "metrics" | "deploy" | "human" | "slack" | "logs" | "errors" | "cloud" | "database";
  title: string;
  detail: string;
}

export interface PipelineSnapshot {
  incidentId: string;
  activeStage: AgentId | "gateway" | "orchestrator";
  gateway: { title: string; summary: string };
  orchestrator: { title: string; summary: string };
  agents: AgentRun[];
  ingest: GatewayEvent[];
  detection: DetectionVerdict | null;
}

export interface WorldState {
  now: number;
  region: string;
  onCall: { primary: string; comms: string };
  services: Service[];
  metrics: MetricSample[];
  deployments: Deployment[];
  logs: LogEvent[];
  incidents: Incident[];
  fleet: FleetSnapshot;
  alerts: TimelineEvent[];
  pipeline: PipelineSnapshot | null;
}
