import type {
  ActionType,
  Deployment,
  DetectionVerdict,
  Incident,
  LogEvent,
  MetricSample,
  Service,
} from "../types";
import type { Investigation } from "../types";

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
  lastHumanAction?: ActionType;
}

export interface AgentOutput {
  status: import("../types").AgentRunStatus;
  summary: string;
}
