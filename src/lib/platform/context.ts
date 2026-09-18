import type {
  ActionType,
  BlastVerdict,
  Deployment,
  DetectionVerdict,
  Incident,
  Investigation,
  LogEvent,
  MetricSample,
  RcaVerdict,
  RemediationVerdict,
  CommsVerdict,
  MemoryVerdict,
  Postmortem,
  Service,
} from "../types";

export interface AgentContext {
  now: number;
  incident: Incident;
  services: Service[];
  metrics: MetricSample[];
  deployments: Deployment[];
  logs: LogEvent[];
  onCall: { primary: string; comms: string };
  analysis: Investigation;
  detection: DetectionVerdict;
  rca: RcaVerdict;
  blast: BlastVerdict;
  remediation: RemediationVerdict;
  comms: CommsVerdict;
  postmortem: Postmortem;
  memory: MemoryVerdict;
  lastHumanAction?: ActionType;
}

export interface AgentOutput {
  status: import("../types").AgentRunStatus;
  summary: string;
}
