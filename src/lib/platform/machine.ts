import {
  DETECTED_AT,
  INVESTIGATION_STARTED_AT,
  INVESTIGATED_AT,
  REMEDIATION_PENDING_AT,
  TRIAGED_AT,
} from "../clock";
import type {
  AgentId,
  AgentRunStatus,
  Checkpoint,
  IncidentMachine,
  IncidentStatus,
  MachineEvent,
} from "../types";

export const HAPPY_PATH: IncidentStatus[] = [
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

export const FAILURE_PATH: IncidentStatus[] = ["NEED_HUMAN_INPUT", "ESCALATED"];

export const CONFIDENCE_GATE = 0.75;

export const TRANSITIONS: Record<IncidentStatus, Partial<Record<MachineEvent, IncidentStatus>>> = {
  DETECTED: { triage: "TRIAGING" },
  TRIAGING: { begin_investigation: "INVESTIGATING" },
  INVESTIGATING: {
    evidence_sufficient: "ROOT_CAUSE_IDENTIFIED",
    insufficient_data: "NEED_HUMAN_INPUT",
  },
  NEED_HUMAN_INPUT: {
    human_input: "INVESTIGATING",
    escalate: "ESCALATED",
  },
  ESCALATED: { human_input: "INVESTIGATING" },
  ROOT_CAUSE_IDENTIFIED: { playbook_ready: "REMEDIATION_PENDING" },
  REMEDIATION_PENDING: { approve_remediation: "REMEDIATING" },
  REMEDIATING: { change_landed: "VERIFYING" },
  VERIFYING: { declare_resolved: "RESOLVED" },
  RESOLVED: { postmortem_ready: "POSTMORTEM" },
  POSTMORTEM: {},
};

export interface MachineFacts {
  now: number;
  confidence: number;
  investigatingForMs: number;
  changeLanded: boolean;
  metricsRecovered: boolean;
  postmortemReady: boolean;
}

let cpSeq = 0;

export function isClosed(state: IncidentStatus) {
  return state === "RESOLVED" || state === "POSTMORTEM";
}

export function can(machine: IncidentMachine, event: MachineEvent) {
  return Boolean(TRANSITIONS[machine.state][event]);
}

export function apply(
  machine: IncidentMachine,
  event: MachineEvent,
  at: number,
  reason: string,
  agentId?: AgentId,
): IncidentMachine {
  const to = TRANSITIONS[machine.state][event];
  if (!to) {
    throw new Error(`Illegal transition ${machine.state} --${event}-->`);
  }
  cpSeq += 1;
  const checkpoint: Checkpoint = {
    id: `cp-${cpSeq}`,
    at,
    state: to,
    event,
    agentId,
    note: reason,
  };
  return {
    ...machine,
    state: to,
    enteredAt: at,
    history: [...machine.history, { at, event, from: machine.state, to, reason }],
    checkpoints: [...machine.checkpoints, checkpoint],
  };
}

export function tryApply(
  machine: IncidentMachine,
  event: MachineEvent,
  at: number,
  reason: string,
  agentId?: AgentId,
) {
  if (!can(machine, event)) return machine;
  return apply(machine, event, at, reason, agentId);
}

/** Advance on facts until stable. Never calls an LLM — guards are numeric. */
export function autoAdvance(machine: IncidentMachine, facts: MachineFacts): IncidentMachine {
  let current = machine;
  for (let i = 0; i < 8; i++) {
    const before = current.state;
    if (current.state === "DETECTED") {
      current = tryApply(current, "triage", facts.now, "Severity assigned from error cliff.", "detection");
    } else if (current.state === "TRIAGING") {
      current = tryApply(current, "begin_investigation", facts.now, "Triage complete. Opening investigation.", "investigation");
    } else if (current.state === "INVESTIGATING" && facts.confidence >= CONFIDENCE_GATE) {
      current = tryApply(
        current,
        "evidence_sufficient",
        facts.now,
        `Confidence ${(facts.confidence * 100).toFixed(0)}% ≥ ${CONFIDENCE_GATE * 100}% gate. Root cause may be named.`,
        "root-cause",
      );
    } else if (
      current.state === "INVESTIGATING" &&
      facts.confidence < CONFIDENCE_GATE &&
      facts.investigatingForMs >= 15 * 60_000
    ) {
      current = tryApply(
        current,
        "insufficient_data",
        facts.now,
        `Confidence ${(facts.confidence * 100).toFixed(0)}% below gate after 15m. Need human input.`,
        "investigation",
      );
    } else if (current.state === "ROOT_CAUSE_IDENTIFIED") {
      current = tryApply(current, "playbook_ready", facts.now, "Blast named. Playbook selected. Policy check.", "blast-radius");
    } else if (current.state === "REMEDIATING" && facts.changeLanded) {
      current = tryApply(current, "change_landed", facts.now, "Change is live. Verification agent owns recovery.", "verification");
    } else if (current.state === "VERIFYING" && facts.metricsRecovered) {
      current = tryApply(
        current,
        "declare_resolved",
        facts.now,
        "Error rate back under baseline. Autonomous commander declared RESOLVED.",
        "verification",
      );
    } else if (current.state === "RESOLVED" && facts.postmortemReady) {
      current = tryApply(current, "postmortem_ready", facts.now, "Postmortem compiled from checkpoints + timeline.", "postmortem");
    }
    if (current.state === before) break;
  }
  return current;
}

export function latestCheckpoint(machine: IncidentMachine, agentId: AgentId) {
  return [...machine.checkpoints].reverse().find((c) => c.agentId === agentId);
}

export function agentPhase(state: IncidentStatus, id: AgentId): AgentRunStatus {
  const order: Record<AgentId, IncidentStatus[]> = {
    detection: ["DETECTED", "TRIAGING", "INVESTIGATING", "NEED_HUMAN_INPUT", "ESCALATED", "ROOT_CAUSE_IDENTIFIED", "REMEDIATION_PENDING", "REMEDIATING", "VERIFYING", "RESOLVED", "POSTMORTEM"],
    investigation: ["INVESTIGATING", "NEED_HUMAN_INPUT", "ESCALATED", "ROOT_CAUSE_IDENTIFIED", "REMEDIATION_PENDING", "REMEDIATING", "VERIFYING", "RESOLVED", "POSTMORTEM"],
    communication: ["TRIAGING", "INVESTIGATING", "NEED_HUMAN_INPUT", "ESCALATED", "ROOT_CAUSE_IDENTIFIED", "REMEDIATION_PENDING", "REMEDIATING", "VERIFYING", "RESOLVED", "POSTMORTEM"],
    memory: ["DETECTED", "TRIAGING", "INVESTIGATING", "NEED_HUMAN_INPUT", "ESCALATED", "ROOT_CAUSE_IDENTIFIED", "REMEDIATION_PENDING", "REMEDIATING", "VERIFYING", "RESOLVED", "POSTMORTEM"],
    "root-cause": ["ROOT_CAUSE_IDENTIFIED", "REMEDIATION_PENDING", "REMEDIATING", "VERIFYING", "RESOLVED", "POSTMORTEM"],
    "blast-radius": ["ROOT_CAUSE_IDENTIFIED", "REMEDIATION_PENDING", "REMEDIATING", "VERIFYING", "RESOLVED", "POSTMORTEM"],
    remediation: ["REMEDIATION_PENDING", "REMEDIATING", "VERIFYING", "RESOLVED", "POSTMORTEM"],
    verification: ["VERIFYING", "RESOLVED", "POSTMORTEM"],
    postmortem: ["RESOLVED", "POSTMORTEM"],
  };
  const live: Partial<Record<IncidentStatus, Partial<Record<AgentId, AgentRunStatus>>>> = {
    DETECTED: { detection: "running" },
    TRIAGING: { detection: "complete", communication: "running", memory: "running" },
    INVESTIGATING: { investigation: "running", communication: "running", memory: "running" },
    NEED_HUMAN_INPUT: { investigation: "blocked", communication: "running" },
    ESCALATED: { investigation: "blocked", communication: "complete" },
    REMEDIATION_PENDING: { remediation: "blocked" },
    REMEDIATING: { remediation: "running" },
    VERIFYING: { verification: "running" },
    RESOLVED: { postmortem: "running" },
    POSTMORTEM: { postmortem: "complete" },
  };
  const explicit = live[state]?.[id];
  if (explicit) return explicit;
  if (!order[id].includes(state)) return "idle";
  const idx = order[id].indexOf(state);
  if (idx === 0 && (state === "DETECTED" || state === "INVESTIGATING" || state === "REMEDIATING" || state === "VERIFYING")) {
    return "running";
  }
  return "complete";
}

function walk(
  steps: { event: MachineEvent; to: IncidentStatus; at: number; reason: string; agentId?: AgentId }[],
  humanEvidence = false,
): IncidentMachine {
  let machine: IncidentMachine = {
    state: "DETECTED",
    enteredAt: steps[0]?.at ?? DETECTED_AT,
    history: [],
    checkpoints: [
      {
        id: "cp-open",
        at: steps[0]?.at ?? DETECTED_AT,
        state: "DETECTED",
        event: "triage",
        agentId: "detection",
        note: "Incident opened from the detection agent.",
      },
    ],
    humanEvidence,
  };
  // Seed starts DETECTED; apply the rest.
  machine = {
    ...machine,
    checkpoints: [
      {
        id: "cp-detected",
        at: machine.enteredAt,
        state: "DETECTED",
        event: "triage",
        agentId: "detection",
        note: "Error cliff crossed the SEV page. Machine entered DETECTED.",
      },
    ],
  };
  for (const step of steps) {
    machine = apply(machine, step.event, step.at, step.reason, step.agentId);
  }
  return machine;
}

export function seedMachine(id: string): IncidentMachine {
  if (id === "INC-4818") {
    return walk(
      [
        { event: "triage", to: "TRIAGING", at: Date.parse("2026-09-14T08:16:40Z"), reason: "SEV-2 checkout latency. EU tax carts only.", agentId: "detection" },
        { event: "begin_investigation", to: "INVESTIGATING", at: Date.parse("2026-09-14T08:17:10Z"), reason: "Investigation agent attached.", agentId: "investigation" },
        { event: "insufficient_data", to: "NEED_HUMAN_INPUT", at: Date.parse("2026-09-14T08:32:00Z"), reason: "64% confidence. Tax-engine traces are missing. Need human input.", agentId: "investigation" },
      ],
      false,
    );
  }
  if (id === "INC-4812") {
    return walk([
      { event: "triage", to: "TRIAGING", at: Date.parse("2026-09-13T19:04:00Z"), reason: "SEV-3 Redis evictions.", agentId: "detection" },
      { event: "begin_investigation", to: "INVESTIGATING", at: Date.parse("2026-09-13T19:05:00Z"), reason: "Memory cap suspected.", agentId: "investigation" },
      { event: "evidence_sufficient", to: "ROOT_CAUSE_IDENTIFIED", at: Date.parse("2026-09-13T19:12:00Z"), reason: "86% on Redis memory cap.", agentId: "root-cause" },
      { event: "playbook_ready", to: "REMEDIATION_PENDING", at: Date.parse("2026-09-13T19:12:30Z"), reason: "Scale Redis.", agentId: "remediation" },
      { event: "approve_remediation", to: "REMEDIATING", at: Date.parse("2026-09-13T19:18:00Z"), reason: "Policy automatic · SEV-3 · LOW. Agent auto-executed scale Redis.", agentId: "remediation" },
      { event: "change_landed", to: "VERIFYING", at: Date.parse("2026-09-13T19:28:00Z"), reason: "Evictions stopped.", agentId: "verification" },
      { event: "declare_resolved", to: "RESOLVED", at: Date.parse("2026-09-13T19:41:00Z"), reason: "Verification recovered. Autonomous commander declared RESOLVED.", agentId: "verification" },
      { event: "postmortem_ready", to: "POSTMORTEM", at: Date.parse("2026-09-13T19:44:00Z"), reason: "Postmortem from timeline.", agentId: "postmortem" },
    ]);
  }
  return walk([
    { event: "triage", to: "TRIAGING", at: TRIAGED_AT, reason: "Actual incident, not noise. SEV-1 · 94% · Payments API · started 10:42.", agentId: "detection" },
    { event: "begin_investigation", to: "INVESTIGATING", at: INVESTIGATION_STARTED_AT, reason: "Causal chain: deploy → new query → pool → timeout → 500 → payments.", agentId: "investigation" },
    { event: "evidence_sufficient", to: "ROOT_CAUSE_IDENTIFIED", at: INVESTIGATED_AT, reason: "RCA engine: v2.8.14 91%. DB overload 78% contributing. Network 12% and external API 6% disconfirmed.", agentId: "root-cause" },
    { event: "playbook_ready", to: "REMEDIATION_PENDING", at: REMEDIATION_PENDING_AT, reason: "Blast: 18,423 NA premium · Payments + Checkout. Auth/Profile/Notify quiet. Rollback awaiting commander.", agentId: "blast-radius" },
  ]);
}

export function seedMachines() {
  return new Map<string, IncidentMachine>([
    ["INC-4821", seedMachine("INC-4821")],
    ["INC-4818", seedMachine("INC-4818")],
    ["INC-4812", seedMachine("INC-4812")],
  ]);
}
