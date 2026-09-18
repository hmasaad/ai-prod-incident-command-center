import type {
  ActionType,
  IncidentStatus,
  RemediationOption,
  RemediationStage,
  RemediationVerdict,
  RiskLevel,
} from "../types";

const QUESTION = "What should we do — and may the agent execute it?";

export interface RemediateInput {
  incidentId: string;
  status: IncidentStatus;
  rollbackApplied?: boolean;
  mitigationApplied?: boolean;
  rejected?: boolean;
}

function stagesFor(status: IncidentStatus, approved: boolean): RemediationStage[] {
  const order: RemediationStage["id"][] = [
    "recommend",
    "risk",
    "policy",
    "approval",
    "execution",
    "verification",
  ];
  const labels: Record<RemediationStage["id"], string> = {
    recommend: "AI recommendation",
    risk: "Risk evaluation",
    policy: "Policy engine",
    approval: "Human approval",
    execution: "Execution",
    verification: "Verification",
  };
  let active: RemediationStage["id"] = "approval";
  if (status === "REMEDIATING") active = "execution";
  else if (status === "VERIFYING" || status === "RESOLVED" || status === "POSTMORTEM") active = "verification";
  else if (status === "NEED_HUMAN_INPUT" || status === "ESCALATED" || status === "INVESTIGATING") active = "recommend";
  else if (approved) active = "execution";

  const activeIdx = order.indexOf(active);
  return order.map((id, idx) => ({
    id,
    label: labels[id],
    status: idx < activeIdx ? "complete" : idx === activeIdx ? "active" : "queued",
  }));
}

/**
 * Policy engine. SEV-1 production mutates require a human.
 * Low-risk automatic playbooks may be executed by the agent through the Security Gateway.
 */
export function analyzeRemediation(input: RemediateInput): RemediationVerdict {
  if (input.incidentId === "INC-4818") return remediate4818(input);
  if (input.incidentId === "INC-4812") return remediate4812(input);
  if (input.incidentId === "INC-4821") return remediate4821(input);
  return remediateUnknown(input);
}

function remediate4821(input: RemediateInput): RemediationVerdict {
  const approved = Boolean(input.rollbackApplied);
  const rejected = Boolean(input.rejected) && !approved;
  const catalog: RemediationOption[] = [
    {
      id: "rollback",
      kind: "rollback",
      label: "Rollback v2.8.14",
      selected: true,
      risk: "MEDIUM",
      expectedImpact: "Temporary deployment rollback",
      policy: "human_required",
      policyLabel: "Human approval required",
      reason: "Reverses the eager-checkout change. Corrective action. Policy will not auto-execute SEV-1.",
    },
    {
      id: "restart",
      kind: "restart",
      label: "Restart service",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Brief additional outage; pool exhaustion returns on the next intent.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Restarts do not remove the v2.8.14 query. Engine will not propose it.",
    },
    {
      id: "scale",
      kind: "scale",
      label: "Scale infrastructure",
      selected: false,
      risk: "LOW",
      expectedImpact: "Raise Postgres pool cap. Buys time only.",
      policy: "mitigation_only",
      policyLabel: "Mitigation only",
      reason: "Does not remove the bug. May run as mitigation; does not advance the machine.",
    },
    {
      id: "flag",
      kind: "disable_flag",
      label: "Disable feature flag",
      selected: false,
      risk: "LOW",
      expectedImpact: "No flag on the payments hot path.",
      policy: "forbidden",
      policyLabel: "Not applicable",
      reason: "v2.8.14 is a baked deploy, not a flag. Wrong lever.",
    },
    {
      id: "cache",
      kind: "clear_cache",
      label: "Clear cache",
      selected: false,
      risk: "LOW",
      expectedImpact: "No cache-backed cause.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "RCA did not select a cache candidate. Engine will not invent one.",
    },
    {
      id: "failover",
      kind: "failover_db",
      label: "Failover database",
      selected: false,
      risk: "HIGH",
      expectedImpact: "AZ move; same pool code follows the traffic.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Not an AZ failure. Failover would copy exhaustion to the replica.",
    },
    {
      id: "endpoint",
      kind: "disable_endpoint",
      label: "Disable problematic endpoint",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Authorize path goes dark. Larger blast.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Would take checkout offline. Rollback is the smaller change.",
    },
  ];

  const selected = catalog[0];
  const answer = approved
    ? "Commander approved. Execution is in Spinnaker. The agent did not auto-run the change."
    : rejected
      ? "Commander rejected. Machine stays REMEDIATION_PENDING. The agent still will not execute."
      : "Policy engine requires a human. Rollback v2.8.14 is the licensed corrective action — not auto-executed.";

  return {
    incidentId: "INC-4821",
    question: QUESTION,
    answer,
    recommendation: selected.label,
    risk: selected.risk,
    expectedImpact: selected.expectedImpact,
    policy: selected.policyLabel,
    actionType: "rollback",
    approveLabel: "Approve Rollback",
    stages: stagesFor(input.status, approved),
    catalog,
    approved,
    rejected,
  };
}

function remediate4818(input: RemediateInput): RemediationVerdict {
  const approved = Boolean(input.rollbackApplied || (input.mitigationApplied && input.status !== "NEED_HUMAN_INPUT"));
  const pending = input.status === "REMEDIATION_PENDING" || input.status === "REMEDIATING" || input.status === "VERIFYING" || input.status === "RESOLVED" || input.status === "POSTMORTEM";
  const catalog: RemediationOption[] = [
    {
      id: "flag",
      kind: "disable_flag",
      label: "Disable new-tax-engine",
      selected: true,
      risk: "MEDIUM",
      expectedImpact: "Experiment to 0%. EU tax-inclusive carts recover.",
      policy: "human_required",
      policyLabel: "Human approval required",
      reason: pending ? "Licensed after traces complete the pack." : "Playbook is queued. Engine will not execute while traces are missing.",
    },
    {
      id: "rollback",
      kind: "rollback",
      label: "Rollback checkout v7.3.0",
      selected: false,
      risk: "HIGH",
      expectedImpact: "9h-old deploy; flag default is already off.",
      policy: "forbidden",
      policyLabel: "Not the lever",
      reason: "The leak is the experiment, not the bake.",
    },
    {
      id: "restart",
      kind: "restart",
      label: "Restart service",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Flag leak returns on the next cart.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Does not stop the experiment.",
    },
    {
      id: "scale",
      kind: "scale",
      label: "Scale infrastructure",
      selected: false,
      risk: "LOW",
      expectedImpact: "Checkout DB already nominal.",
      policy: "forbidden",
      policyLabel: "Not applicable",
      reason: "Not a capacity incident.",
    },
    {
      id: "cache",
      kind: "clear_cache",
      label: "Clear cache",
      selected: false,
      risk: "LOW",
      expectedImpact: "No cache cause.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Traces (once attached) point at the flag.",
    },
    {
      id: "failover",
      kind: "failover_db",
      label: "Failover database",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Wrong data plane.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Checkout DB is not the patient.",
    },
    {
      id: "endpoint",
      kind: "disable_endpoint",
      label: "Disable problematic endpoint",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Would take EU checkout dark.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Disable the flag, not the route.",
    },
  ];
  const selected = catalog[0];
  return {
    incidentId: "INC-4818",
    question: QUESTION,
    answer: pending
      ? approved
        ? "Commander disabled the flag. Agent did not auto-execute."
        : "Policy requires a human to disable new-tax-engine. Not auto-executed."
      : "Playbook is queued until traces land. Engine will not execute a change from 64%.",
    recommendation: selected.label,
    risk: selected.risk,
    expectedImpact: selected.expectedImpact,
    policy: selected.policyLabel,
    actionType: "disable_flag",
    approveLabel: "Approve disable flag",
    stages: stagesFor(input.status, approved),
    catalog,
    approved,
    rejected: Boolean(input.rejected) && !approved,
  };
}

function remediate4812(input: RemediateInput): RemediationVerdict {
  const catalog: RemediationOption[] = [
    {
      id: "scale",
      kind: "scale",
      label: "Scale Redis",
      selected: true,
      risk: "LOW",
      expectedImpact: "Memory cap raised. Evictions stopped.",
      policy: "mitigation_only",
      policyLabel: "Automatic — low risk",
      reason: "SEV-3 capacity. Agent auto-executed. Not a SEV-1 mutate.",
    },
    {
      id: "rollback",
      kind: "rollback",
      label: "Rollback Auth v4.1.2",
      selected: false,
      risk: "MEDIUM",
      expectedImpact: "Would drop TTL jitter that was part of the fix.",
      policy: "forbidden",
      policyLabel: "Not selected",
      reason: "Scale + jitter was the playbook. Closed.",
    },
    {
      id: "restart",
      kind: "restart",
      label: "Restart service",
      selected: false,
      risk: "MEDIUM",
      expectedImpact: "Evictions return.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Memory cap was the cause.",
    },
    {
      id: "flag",
      kind: "disable_flag",
      label: "Disable feature flag",
      selected: false,
      risk: "LOW",
      expectedImpact: "No flag.",
      policy: "forbidden",
      policyLabel: "Not applicable",
      reason: "Key-size change, not a flag.",
    },
    {
      id: "cache",
      kind: "clear_cache",
      label: "Clear cache",
      selected: false,
      risk: "LOW",
      expectedImpact: "Would flush sessions.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Would enlarge the blast.",
    },
    {
      id: "failover",
      kind: "failover_db",
      label: "Failover database",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Postgres not in the path.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "session-redis was the patient.",
    },
    {
      id: "endpoint",
      kind: "disable_endpoint",
      label: "Disable problematic endpoint",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Would take login dark.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Latency only; no hard errors.",
    },
  ];
  const approved =
    input.status === "REMEDIATING" ||
    input.status === "VERIFYING" ||
    input.status === "RESOLVED" ||
    input.status === "POSTMORTEM" ||
    Boolean(input.mitigationApplied);
  return {
    incidentId: "INC-4812",
    question: QUESTION,
    answer: approved
      ? "Scale Redis was automatic. Agent executed. Incident is in POSTMORTEM."
      : "SEV-3 · LOW · automatic. Agent may execute without a commander.",
    recommendation: "Scale Redis",
    risk: "LOW",
    expectedImpact: "Memory cap raised. Evictions stopped.",
    policy: "Automatic — low risk",
    actionType: "scale_pool",
    approveLabel: "Approve",
    stages: stagesFor(input.status, approved),
    catalog,
    approved,
    rejected: false,
  };
}

function remediateUnknown(input: RemediateInput): RemediationVerdict {
  const catalog: RemediationOption[] = [
    {
      id: "hold",
      kind: "scale",
      label: "Hold — no licensed corrective action",
      selected: true,
      risk: "LOW",
      expectedImpact: "Do not mutate production without a pack.",
      policy: "human_required",
      policyLabel: "Human approval required",
      reason: "Unknown incident. Engine will not propose rollback of v2.8.14 or any SEV-1 mutate.",
    },
    {
      id: "rollback",
      kind: "rollback",
      label: "Rollback",
      selected: false,
      risk: "HIGH",
      expectedImpact: "No bake bound to this id.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "Would copy INC-4821's playbook onto the wrong patient.",
    },
    {
      id: "restart",
      kind: "restart",
      label: "Restart service",
      selected: false,
      risk: "HIGH",
      expectedImpact: "Unlicensed.",
      policy: "forbidden",
      policyLabel: "Forbidden as corrective",
      reason: "No evidence that a restart is the lever.",
    },
  ];
  return {
    incidentId: input.incidentId,
    question: QUESTION,
    answer: "No licensed playbook. The agent will not execute.",
    recommendation: catalog[0].label,
    risk: "LOW",
    expectedImpact: catalog[0].expectedImpact,
    policy: catalog[0].policyLabel,
    actionType: "page_oncall",
    approveLabel: "Hold",
    stages: stagesFor(input.status, false),
    catalog,
    approved: false,
    rejected: false,
  };
}

export function riskTone(risk: RiskLevel): string {
  if (risk === "CRITICAL" || risk === "HIGH") return "text-sev1";
  if (risk === "MEDIUM") return "text-sev2";
  return "text-ok";
}

export function toRecommendationAction(verdict: RemediationVerdict): ActionType {
  return verdict.actionType;
}
