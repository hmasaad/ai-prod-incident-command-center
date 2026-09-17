import type { ActionType, Incident, Investigation } from "../types";

export interface Recommendation {
  primary: ActionType;
  label: string;
  detail: string;
  alternatives: { type: ActionType; label: string; detail: string }[];
}

export function recommend(incident: Incident, investigation: Investigation): Recommendation {
  if (incident.rollbackApplied && incident.status !== "resolved") {
    return {
      primary: "resolve",
      label: "Resolve incident",
      detail: "Metrics have a recovery path. Close INC-4821 after a clean monitoring window.",
      alternatives: [],
    };
  }

  if (incident.status === "resolved") {
    return {
      primary: "resolve",
      label: "Incident resolved",
      detail: "Post-incident analysis is ready.",
      alternatives: [],
    };
  }

  return {
    primary: "rollback",
    label: investigation.recommendedAction,
    detail:
      "Return Payments API to v2.8.13. Auth should recover as pool pressure drops. This is the corrective action, not a mitigation.",
    alternatives: [
      {
        type: "scale_pool",
        label: "Raise Postgres pool cap",
        detail: "Buys time. Does not remove the eager-checkout bug.",
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
