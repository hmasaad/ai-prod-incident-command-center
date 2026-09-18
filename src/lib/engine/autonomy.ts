import type {
  AutonomyBranch,
  AutonomyLoop,
  AutonomyNode,
  AutonomyNodeStatus,
  AutonomyReport,
  AutonomyStageId,
  Incident,
  IncidentStatus,
  RemediationVerdict,
  SecurityVerdict,
  Severity,
} from "../types";
import { isClosed } from "../platform/machine";
import { actionToIntent, authorize, mayExecute, REMEDIATION_AGENT } from "../platform/security";

/**
 * Autonomous incident commander: the closed loop.
 *
 * INCIDENT → DETECT → TRIAGE → INVESTIGATE → RCA → POLICY CHECK
 *   → Low Risk Auto Execute | High Risk Human Approval
 *   → VERIFY → RESOLVE → POSTMORTEM → LEARN
 *
 * Policy licenses execute. SEV-1 never auto-runs a production mutate.
 */

const ST = {
  complete: "complete",
  active: "active",
  queued: "queued",
  skipped: "skipped",
} as const satisfies Record<string, AutonomyNodeStatus>;

export function shouldAutoExecute(input: {
  severity: Severity;
  status: IncidentStatus;
  remediation: RemediationVerdict;
  decision: SecurityVerdict;
}): boolean {
  if (input.severity === "SEV-1") return false;
  if (input.status !== "REMEDIATION_PENDING") return false;
  if (input.remediation.approved || input.remediation.rejected) return false;
  return mayExecute(input.decision) && input.decision.principal.kind === "agent";
}

export function shouldAutoResolve(input: {
  status: IncidentStatus;
  recovered: boolean;
}): boolean {
  return input.status === "VERIFYING" && input.recovered;
}

export function probeAgentExecute(now: number, incident: Pick<Incident, "severity" | "status" | "remediation">) {
  const decision = authorize({
    now,
    intent: actionToIntent(incident.remediation.actionType),
    principal: REMEDIATION_AGENT,
    remediation: incident.remediation,
  });
  return {
    decision,
    auto: shouldAutoExecute({
      severity: incident.severity,
      status: incident.status,
      remediation: incident.remediation,
      decision,
    }),
  };
}

export function buildAutonomyLoop(input: {
  incident: Incident;
  learned: boolean;
  now: number;
}): AutonomyLoop {
  const { incident, learned } = input;
  const state = incident.machine?.state ?? incident.status;
  const rca = incident.rca?.confidence ?? incident.investigation.confidence;
  const probe = probeAgentExecute(input.now, incident);
  const branch = branchFor(incident, probe.decision, probe.auto);
  const past = pastOf(state);

  const spine: AutonomyNode[] = [
    node("incident", "INCIDENT", ST.complete, "Opened. Machine owns the rest of the loop."),
    node("detect", "DETECT", mark(past, "DETECTED", state === "DETECTED"), incident.detection?.answer ?? "Classify incident vs noise."),
    node("triage", "TRIAGE", mark(past, "TRIAGING", state === "TRIAGING"), `${incident.severity} assigned.`),
    node(
      "investigate",
      "INVESTIGATE",
      investigateStatus(state, past),
      state === "NEED_HUMAN_INPUT" || state === "ESCALATED"
        ? "Checkpointed. Confidence below the 75% gate."
        : `${incident.investigation.beats.length}-beat timeline.`,
    ),
    node(
      "rca",
      "RCA",
      mark(past, "ROOT_CAUSE_IDENTIFIED", state === "ROOT_CAUSE_IDENTIFIED"),
      `${Math.round(rca * 100)}% · engine-bound.`,
    ),
    node(
      "policy",
      "POLICY CHECK",
      mark(past, "REMEDIATION_PENDING", state === "REMEDIATION_PENDING"),
      `${incident.remediation.risk} · ${incident.remediation.policy}.`,
    ),
  ];

  const executing = past.has("REMEDIATING") || state === "REMEDIATING";
  const low: AutonomyNode = node(
    "auto_execute",
    "Low Risk · Auto Execute",
    forkStatus(branch, "low_risk", executing, state === "REMEDIATION_PENDING" && branch === "low_risk"),
    branch === "low_risk"
      ? executing
        ? `${incident.remediation.recommendation} · agent executed.`
        : `${incident.remediation.recommendation} · policy automatic.`
      : "Not this incident. High-risk playbook.",
  );
  const high: AutonomyNode = node(
    "human_approval",
    "High Risk · Human Approval",
    forkStatus(branch, "high_risk", executing, state === "REMEDIATION_PENDING" && branch === "high_risk"),
    branch === "high_risk"
      ? executing
        ? "Commander licensed the change. Agent did not auto-run."
        : "SEV-1 / required. Waiting on the commander."
      : "Not this incident. Low-risk playbook.",
  );

  const tail: AutonomyNode[] = [
    node(
      "verify",
      "VERIFY",
      state === "VERIFYING" ? ST.active : past.has("VERIFYING") || isClosed(state) ? ST.complete : ST.queued,
      state === "VERIFYING" ? "Watching recovery metrics." : "Change-landed owns this stage.",
    ),
    node(
      "resolve",
      "RESOLVE",
      state === "RESOLVED" ? ST.active : state === "POSTMORTEM" || past.has("RESOLVED") ? ST.complete : ST.queued,
      "Autonomous once error rate is back under baseline.",
    ),
    node(
      "postmortem",
      "POSTMORTEM",
      state === "POSTMORTEM" ? (learned ? ST.complete : ST.active) : state === "RESOLVED" ? ST.active : ST.queued,
      incident.postmortem?.ready ? incident.postmortem.title : "Compiles after RESOLVED.",
    ),
    node(
      "learn",
      "LEARN / MEMORY",
      learned ? ST.complete : state === "POSTMORTEM" ? ST.active : ST.queued,
      learned ? `${incident.id} written to incident memory.` : "Write the closed incident into the corpus.",
    ),
  ];

  const activeId =
    [...spine, low, high, ...tail].find((n) => n.status === "active")?.id ??
    (isClosed(state) ? "learn" : "incident");

  return {
    incidentId: incident.id,
    severity: incident.severity,
    branch,
    active: activeId,
    rcaConfidence: rca,
    execute: incident.remediation.approved || probe.auto,
    autonomous: branch === "low_risk" || (executing && state !== "REMEDIATION_PENDING"),
    summary: summaryFor(incident, branch, state, probe.auto, learned),
    spine,
    low,
    high,
    tail,
  };
}

export function buildAutonomyReport(incidents: Incident[], learnedIds: Set<string>, now: number): AutonomyReport {
  const loops = incidents.map((incident) =>
    buildAutonomyLoop({
      incident,
      learned: learnedIds.has(incident.id) || isClosed(incident.status),
      now,
    }),
  );
  const live = loops.find((l) => l.incidentId === "INC-4821") ?? loops[0];
  const low = loops.find((l) => l.branch === "low_risk");
  return {
    question: "Who executes — the agent or a human?",
    answer: live
      ? `${live.incidentId} is ${live.severity} · ${live.summary}${low && low.incidentId !== live.incidentId ? ` ${low.incidentId} already walked the low-risk path autonomously.` : ""}`
      : "No incident.",
    loops,
  };
}

function node(id: AutonomyStageId, label: string, status: AutonomyNodeStatus, detail: string): AutonomyNode {
  return { id, label, status, detail };
}

function pastOf(state: IncidentStatus): Set<IncidentStatus> {
  const happy: IncidentStatus[] = [
    "DETECTED",
    "TRIAGING",
    "INVESTIGATING",
    "ROOT_CAUSE_IDENTIFIED",
    "REMEDIATION_PENDING",
    "REMEDIATING",
    "VERIFYING",
    "RESOLVED",
    "POSTMORTEM",
  ];
  const idx = happy.indexOf(state);
  if (idx < 0) {
    if (state === "NEED_HUMAN_INPUT" || state === "ESCALATED") {
      return new Set(["DETECTED", "TRIAGING"]);
    }
    return new Set();
  }
  return new Set(happy.slice(0, idx));
}

function mark(past: Set<IncidentStatus>, stage: IncidentStatus, isCurrent: boolean): AutonomyNodeStatus {
  if (isCurrent) return ST.active;
  if (past.has(stage) || (stage === "POSTMORTEM" && past.has("POSTMORTEM"))) return ST.complete;
  return ST.queued;
}

function investigateStatus(state: IncidentStatus, past: Set<IncidentStatus>): AutonomyNodeStatus {
  if (state === "NEED_HUMAN_INPUT" || state === "ESCALATED" || state === "INVESTIGATING") return ST.active;
  if (past.has("INVESTIGATING") || past.has("ROOT_CAUSE_IDENTIFIED")) return ST.complete;
  return ST.queued;
}

function forkStatus(
  branch: AutonomyBranch,
  mine: "low_risk" | "high_risk",
  executing: boolean,
  waiting: boolean,
): AutonomyNodeStatus {
  if (branch !== mine && branch !== "undecided") return ST.skipped;
  if (executing && branch === mine) return ST.complete;
  if (waiting) return ST.active;
  return ST.queued;
}

function branchFor(incident: Incident, decision: SecurityVerdict, auto: boolean): AutonomyBranch {
  const state = incident.machine?.state ?? incident.status;
  if (state === "NEED_HUMAN_INPUT" || state === "ESCALATED") return "undecided";
  if (incident.severity === "SEV-1") return "high_risk";
  if (auto) return "low_risk";
  if (decision.approval === "automatic") return "low_risk";
  if (incident.remediation.approved && incident.remediation.risk === "LOW") {
    return "low_risk";
  }
  return "high_risk";
}

function summaryFor(
  incident: Incident,
  branch: AutonomyBranch,
  state: IncidentStatus,
  auto: boolean,
  learned: boolean,
): string {
  if (state === "NEED_HUMAN_INPUT" || state === "ESCALATED") {
    return "Investigation blocked. Policy check has not run.";
  }
  if (state === "REMEDIATION_PENDING" && branch === "high_risk") {
    return "Policy check held. High-risk path — human approval required.";
  }
  if (state === "REMEDIATION_PENDING" && auto) {
    return "Policy check passed. Low-risk path — agent will auto-execute.";
  }
  if (state === "REMEDIATING") return "Executing. Verification starts when the change lands.";
  if (state === "VERIFYING") return "Verifying recovery. Resolve is autonomous once metrics recover.";
  if (state === "RESOLVED") return "Resolved. Postmortem compiling.";
  if (state === "POSTMORTEM") {
    return learned
      ? "Loop closed. Postmortem compiled. Incident written to memory."
      : "Postmortem compiled. Learning into memory.";
  }
  return `${incident.severity} · ${branch.replace("_", " ")}.`;
}
