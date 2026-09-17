import { isClosed } from "../platform/machine";
import type { ActionType, Incident, Investigation } from "../types";

export interface Recommendation {
  primary: ActionType;
  label: string;
  detail: string;
  alternatives: { type: ActionType; label: string; detail: string }[];
}

export function recommend(incident: Incident, investigation: Investigation): Recommendation {
  const state = incident.machine?.state ?? incident.status;

  if (state === "NEED_HUMAN_INPUT") {
    return {
      primary: "provide_input",
      label: "Attach missing evidence",
      detail:
        "Confidence is below the 75% gate. The investigation agent is checkpointed and will not re-run until a human supplies traces.",
      alternatives: [
        {
          type: "escalate",
          label: "Escalate",
          detail: "Page next-level on-call. Machine → ESCALATED.",
        },
      ],
    };
  }

  if (state === "ESCALATED") {
    return {
      primary: "provide_input",
      label: "Resume with evidence",
      detail: "Escalated. Attach traces to resume INVESTIGATING from the last checkpoint.",
      alternatives: [],
    };
  }

  if (state === "REMEDIATING") {
    return {
      primary: "rollback",
      label: "Remediation in flight",
      detail: "Change is landing. The machine advances to VERIFYING when the change is live — no LLM loop.",
      alternatives: [],
    };
  }

  if (state === "VERIFYING") {
    return {
      primary: "resolve",
      label: "Resolve incident",
      detail: "Verification agent is watching recovery. Commander may declare RESOLVED.",
      alternatives: [],
    };
  }

  if (isClosed(state)) {
    return {
      primary: "resolve",
      label: "Incident resolved",
      detail: "Postmortem compiled from checkpoints and the live timeline.",
      alternatives: [],
    };
  }

  if (state === "REMEDIATION_PENDING" && incident.id === "INC-4818") {
    return {
      primary: "disable_flag",
      label: "Disable new-tax-engine",
      detail: "Playbook is ready. Corrective action is stopping the leaked experiment. Awaiting commander.",
      alternatives: [],
    };
  }

  if (state === "REMEDIATION_PENDING") {
    return {
      primary: "rollback",
      label: investigation.recommendedAction,
      detail:
        "Return Payments API to v2.8.13. Auth should recover as pool pressure drops. This is the corrective action, not a mitigation. Machine waits here until a human approves.",
      alternatives: [
        {
          type: "scale_pool",
          label: "Raise Postgres pool cap",
          detail: "Buys time. Does not remove the eager-checkout bug. Does not advance the machine.",
        },
        {
          type: "page_oncall",
          label: "Page payments on-call",
          detail: "Maya Chen is already attached as incident commander.",
        },
        {
          type: "open_channel",
          label: "Open #inc-4821",
          detail: "Stand up the coordination channel for humans and agents.",
        },
      ],
    };
  }

  return {
    primary: "rollback",
    label: investigation.recommendedAction,
    detail: "Investigation is still gathering evidence. The machine will not name a root cause below 75% confidence.",
    alternatives: [],
  };
}
