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
  | "escalate"
  | "reject_remediation";
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
  dbCpu: number;
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

export type RcaEvidenceFamily = "deploy" | "logs" | "metrics" | "traces" | "git" | "infra";

/** One structured fact the RCA engine consumed — not raw logs dumped into a prompt. */
export interface RcaEvidenceItem {
  family: RcaEvidenceFamily;
  label: string;
  present: boolean;
  fact: string;
}

export type RcaStance = "supported" | "contributing" | "disconfirmed";

export interface RcaCandidate {
  id: string;
  candidate: string;
  probability: number;
  evidence: string;
  stance: RcaStance;
  supportingFamilies: RcaEvidenceFamily[];
}

export interface RcaVeto {
  claim: string;
  reason: string;
}

/**
 * Ranked causes from deterministic evidence analysis.
 * Narration is interpolation of these rows only — the LLM cannot invent a candidate.
 */
export interface RcaVerdict {
  incidentId: string;
  question: string;
  answer: string;
  selectedId: string;
  confidence: number;
  candidates: RcaCandidate[];
  evidencePack: RcaEvidenceItem[];
  narration: string;
  vetoed: RcaVeto[];
  bound: boolean;
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

export type BlastHopKind = "incident" | "service" | "client" | "segment" | "users";

export interface BlastHop {
  id: string;
  title: string;
  detail: string;
  kind: BlastHopKind;
}

export type BlastMark = "affected" | "unaffected";

export interface BlastSurface {
  id: string;
  name: string;
  mark: BlastMark;
  reason: string;
}

/** What is actually affected — topology fan-out, not a page-everyone guess. */
export interface BlastVerdict {
  incidentId: string;
  question: string;
  answer: string;
  users: number;
  segment: string;
  revenuePath: boolean;
  chain: BlastHop[];
  services: BlastSurface[];
  regions: BlastSurface[];
}

export type RemediationKind =
  | "rollback"
  | "restart"
  | "scale"
  | "disable_flag"
  | "clear_cache"
  | "failover_db"
  | "disable_endpoint";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PolicyDecision = "human_required" | "mitigation_only" | "forbidden";

export type RemediationStageId =
  | "recommend"
  | "risk"
  | "policy"
  | "approval"
  | "execution"
  | "verification";

export interface RemediationStage {
  id: RemediationStageId;
  label: string;
  status: "complete" | "active" | "queued";
}

export interface RemediationOption {
  id: string;
  kind: RemediationKind;
  label: string;
  selected: boolean;
  risk: RiskLevel;
  expectedImpact: string;
  policy: PolicyDecision;
  policyLabel: string;
  reason: string;
}

/** Playbook from a policy engine. The agent auto-executes only when policy licenses it. SEV-1 never auto-runs. */
export interface RemediationVerdict {
  incidentId: string;
  question: string;
  answer: string;
  recommendation: string;
  risk: RiskLevel;
  expectedImpact: string;
  policy: string;
  actionType: ActionType;
  approveLabel: string;
  stages: RemediationStage[];
  catalog: RemediationOption[];
  approved: boolean;
  rejected: boolean;
}

export interface InvestigationBeat {
  id: string;
  at: number;
  title: string;
  detail: string;
  source: "deploy" | "database" | "infra" | "alerts" | "comms" | "git" | "logs";
}

export interface CausalStep {
  id: string;
  title: string;
  detail: string;
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
  beats: InvestigationBeat[];
  causalChain: CausalStep[];
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
  remediationRejected: boolean;
  machine: IncidentMachine;
  detection: DetectionVerdict;
  rca: RcaVerdict;
  blast: BlastVerdict;
  remediation: RemediationVerdict;
  humanLoop: HumanLoopBrief;
  comms: CommsVerdict;
  postmortem: Postmortem;
  memory: MemoryVerdict;
  autonomy?: AutonomyLoop;
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
  rootCauseLine: string;
  detection: string;
  detectionLine: string;
  resolution: string;
  customerImpact: number;
  contributing: string[];
  stages: PostmortemStage[];
  response: string;
  wentWell: string[];
  wentPoorly: string[];
  actionItems: { owner: string; item: string; done: boolean }[];
  ready: boolean;
}

export type PostmortemStageId =
  | "collect_evidence"
  | "generate_timeline"
  | "determine_root_cause"
  | "identify_contributing"
  | "generate_postmortem"
  | "create_corrective_actions";

export interface PostmortemStage {
  id: PostmortemStageId;
  label: string;
  status: "complete" | "active" | "queued";
}

export type AgentId =
  | "detection"
  | "investigation"
  | "communication"
  | "memory"
  | "root-cause"
  | "blast-radius"
  | "remediation"
  | "verification"
  | "postmortem";

/** Global production policy — not an incident-specific playbook rank. */
export type PolicyApproval = "required" | "automatic" | "prohibited";

export type SecurityPrincipalKind = "human" | "agent" | "runtime" | "anonymous";

export type SecurityIntentKind =
  | "rollback"
  | "restart"
  | "scale"
  | "disable_flag"
  | "clear_cache"
  | "failover_db"
  | "disable_endpoint"
  | "delete_database"
  | "production_secret_access"
  | "page_oncall"
  | "open_channel"
  | "resolve"
  | "provide_input"
  | "escalate"
  | "reject_remediation";

export type SecurityVerdictKind = "allow" | "require_human" | "deny";

export interface SecurityPrincipal {
  id: string;
  name: string;
  kind: SecurityPrincipalKind;
  role: string;
  authenticated: boolean;
  scopes: string[];
}

export interface PolicyRule {
  id: SecurityIntentKind;
  label: string;
  risk: RiskLevel;
  approval: PolicyApproval;
  summary: string;
  featured: boolean;
}

export interface McpToolPolicy {
  tool: string;
  mapsTo: SecurityIntentKind | "read_telemetry" | "read_code";
  allow: PolicyApproval;
  detail: string;
}

export interface RuntimeGuard {
  id: string;
  layer: "agent-runtime" | "ai-api" | "mcp";
  title: string;
  detail: string;
  status: "enforced";
}

export interface SecurityLayer {
  id: "identity" | "policy" | "risk" | "mcp" | "runtime";
  title: string;
  status: "pass" | "hold" | "fail";
  summary: string;
}

export interface SecurityVerdict {
  at: number;
  intent: SecurityIntentKind;
  principal: SecurityPrincipal;
  risk: RiskLevel;
  approval: PolicyApproval;
  verdict: SecurityVerdictKind;
  execute: boolean;
  reason: string;
  overlay?: string;
}

export interface SecuritySnapshot {
  title: string;
  question: string;
  answer: string;
  execute: boolean;
  identity: SecurityPrincipal;
  layers: SecurityLayer[];
  catalog: PolicyRule[];
  mcp: McpToolPolicy[];
  runtime: RuntimeGuard[];
  held: SecurityVerdict;
  lastDecision: SecurityVerdict | null;
  probes: SecurityVerdict[];
}

export interface HumanLoopBeat {
  at: number;
  title: string;
}

/** Commander-facing HITL card — not a second RCA engine. */
export interface HumanLoopBrief {
  incidentId: string;
  severity: Severity;
  title: string;
  users: number;
  errorRate: string;
  latencyDelta: string;
  startedAt: number;
  rootCause: string;
  confidence: number;
  rootCauseDetail: string;
  recommended: string;
  expectedRecovery: string;
  risk: RiskLevel;
  approveLabel: string;
  actionType: ActionType;
  awaiting: boolean;
  timeline: HumanLoopBeat[];
}

export type CommsAudience = "engineers" | "management" | "customers";

export interface CommsUpdate {
  audience: CommsAudience;
  channel: string;
  body: string;
}

/** Same incident facts, three audiences. Internal detail does not leak to customers. */
export interface CommsVerdict {
  incidentId: string;
  question: string;
  answer: string;
  updates: CommsUpdate[];
}

export type MemoryStageId =
  | "current_incident"
  | "incident_memory"
  | "similar_incidents"
  | "previous_rca"
  | "previous_remediation"
  | "previous_outcome";

export interface MemoryStage {
  id: MemoryStageId;
  label: string;
  status: "complete" | "active" | "queued";
}

/** One closed incident stored as operational knowledge — not a chat log. */
export interface MemoryRecord {
  id: string;
  at: number;
  title: string;
  severity: Severity;
  patient: string;
  text: string;
  rca: string;
  remediation: string;
  outcome: string;
  durationMin: number;
  source: "corpus" | "live";
}

export interface MemoryHit {
  id: string;
  at: number;
  title: string;
  patient: string;
  score: number;
  overlap: string[];
  ago: string;
  rca: string;
  remediation: string;
  outcome: string;
  durationMin: number;
  source: "corpus" | "live";
}

/**
 * Operational RAG. Retrieves similar closed incidents by token overlap.
 * A constrained narrator may only interpolate the retrieved rows.
 */
export interface MemoryVerdict {
  incidentId: string;
  question: string;
  answer: string;
  query: string[];
  indexed: number;
  hits: MemoryHit[];
  selectedId: string | null;
  previousRca: string;
  previousRemediation: string;
  previousOutcome: string;
  stages: MemoryStage[];
}

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

export type EvalFamily = "detection" | "rca" | "remediation" | "agent";

export type EvalMetricId =
  | "true_positive_rate"
  | "false_positive_rate"
  | "detection_latency"
  | "root_cause_accuracy"
  | "evidence_correctness"
  | "false_attribution_rate"
  | "correct_action_rate"
  | "unsafe_action_rate"
  | "rollback_success_rate"
  | "hallucination_rate"
  | "tool_misuse"
  | "policy_violations"
  | "unauthorized_actions";

export interface EvalCase {
  id: string;
  family: EvalFamily;
  metric: EvalMetricId;
  title: string;
  fixture: string;
  pass: boolean;
  detail: string;
  observed: string;
  expected: string;
}

export interface EvalMetric {
  id: EvalMetricId;
  label: string;
  family: EvalFamily;
  value: number;
  unit: "rate" | "ms";
  n: number;
  passed: number;
}

export interface EvalGroup {
  id: EvalFamily;
  title: string;
  metrics: EvalMetric[];
  cases: EvalCase[];
}

export interface EvalReport {
  at: number;
  fixtures: number;
  cases: number;
  passed: number;
  score: number;
  groups: EvalGroup[];
  stages: { id: string; label: string; status: "complete" | "active" | "queued" }[];
}

export type AutonomyStageId =
  | "incident"
  | "detect"
  | "triage"
  | "investigate"
  | "rca"
  | "policy"
  | "auto_execute"
  | "human_approval"
  | "verify"
  | "resolve"
  | "postmortem"
  | "learn";

export type AutonomyBranch = "low_risk" | "high_risk" | "undecided";

export type AutonomyNodeStatus = "complete" | "active" | "queued" | "skipped";

export interface AutonomyNode {
  id: AutonomyStageId;
  label: string;
  status: AutonomyNodeStatus;
  detail: string;
}

export interface AutonomyLoop {
  incidentId: string;
  severity: Severity;
  branch: AutonomyBranch;
  active: AutonomyStageId;
  rcaConfidence: number;
  execute: boolean;
  autonomous: boolean;
  summary: string;
  spine: AutonomyNode[];
  low: AutonomyNode;
  high: AutonomyNode;
  tail: AutonomyNode[];
}

export interface AutonomyReport {
  question: string;
  answer: string;
  loops: AutonomyLoop[];
}

export type StackStatus = "live" | "sim" | "target";

export type StackLayerId =
  | "frontend"
  | "backend"
  | "orchestrator"
  | "llm_gateway"
  | "policy"
  | "tool_gateway"
  | "logs"
  | "metrics"
  | "git"
  | "cloud"
  | "postgres"
  | "redis"
  | "vector"
  | "objects"
  | "otel"
  | "prometheus"
  | "grafana";

export interface StackNode {
  id: StackLayerId;
  label: string;
  recommended: string;
  running: string;
  status: StackStatus;
  detail: string;
}

export interface StackSnapshot {
  question: string;
  answer: string;
  control: StackNode[];
  sources: StackNode[];
  storage: StackNode[];
  observe: StackNode[];
}

export interface PipelineSnapshot {
  incidentId: string;
  activeStage: AgentId | "gateway" | "orchestrator";
  gateway: { title: string; summary: string };
  orchestrator: { title: string; summary: string };
  agents: AgentRun[];
  ingest: GatewayEvent[];
  detection: DetectionVerdict | null;
  rca: RcaVerdict | null;
  blast: BlastVerdict | null;
  remediation: RemediationVerdict | null;
  security: SecuritySnapshot;
  comms: CommsVerdict | null;
  postmortem: Postmortem | null;
  memory: MemoryVerdict | null;
  autonomy: AutonomyLoop | null;
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
  evals: EvalReport | null;
  autonomy: AutonomyReport | null;
  stack: StackSnapshot | null;
}
