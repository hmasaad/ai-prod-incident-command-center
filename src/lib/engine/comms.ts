import type {
  BlastVerdict,
  CommsUpdate,
  CommsVerdict,
  DetectionVerdict,
  Incident,
  IncidentStatus,
  RcaVerdict,
  RemediationVerdict,
} from "../types";

const QUESTION = "Same incident — who hears what?";

export interface CommsInput {
  incidentId: string;
  status: IncidentStatus;
  severity: Incident["severity"];
  detection: DetectionVerdict;
  rca: RcaVerdict;
  blast: BlastVerdict;
  remediation: RemediationVerdict;
  rollbackApplied?: boolean;
}

function approxUsers(n: number) {
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function pack(incidentId: string, updates: CommsUpdate[], answer: string): CommsVerdict {
  return { incidentId, question: QUESTION, answer, updates };
}

export function draftComms(input: CommsInput): CommsVerdict {
  if (input.incidentId === "INC-4818") return comms4818(input);
  if (input.incidentId === "INC-4812") return comms4812(input);
  return comms4821(input);
}

function comms4821(input: CommsInput): CommsVerdict {
  const users = approxUsers(input.blast.users);
  const approved = input.remediation.approved || Boolean(input.rollbackApplied);
  const closed = input.status === "RESOLVED" || input.status === "POSTMORTEM";
  const recovering = input.status === "REMEDIATING" || input.status === "VERIFYING";

  if (closed) {
    return pack("INC-4821", [
      {
        audience: "engineers",
        channel: "Slack · #inc-4821",
        body: "SEV-1 closed. Payments API 500s returned to baseline after rollback of v2.8.14. Verification complete.",
      },
      {
        audience: "management",
        channel: "Exec brief",
        body: `The production payment issue affecting approximately ${users} users is resolved. Rollback completed. Post-incident review is underway.`,
      },
      {
        audience: "customers",
        channel: "Status page",
        body: "Payments have been restored. Thank you for your patience.",
      },
    ], "Resolved copy. Engineers get the rollback. Customers only hear that payments are back.");
  }

  if (recovering || approved) {
    return pack("INC-4821", [
      {
        audience: "engineers",
        channel: "Slack · #inc-4821",
        body: "SEV-1. Payments API 500s. Rollback of v2.8.14 is in flight after commander approval. Watch pool wait and error rate.",
      },
      {
        audience: "management",
        channel: "Exec brief",
        body: `We are recovering a production payment issue affecting approximately ${users} users. Rollback is approved and in progress.`,
      },
      {
        audience: "customers",
        channel: "Status page",
        body: "We are currently experiencing an issue affecting payments. Our engineering team is working to restore service.",
      },
    ], "Rollback licensed. Customers still do not hear the version or the change.");
  }

  return pack("INC-4821", [
    {
      audience: "engineers",
      channel: "Slack · #inc-4821",
      body: "SEV-1 incident detected. Payments API experiencing elevated 500 errors. Investigation indicates deployment v2.8.14 as the likely cause.",
    },
    {
      audience: "management",
      channel: "Exec brief",
      body: `We are investigating a production payment issue affecting approximately ${users} users. The likely cause has been identified and rollback is pending approval.`,
    },
    {
      audience: "customers",
      channel: "Status page",
      body: "We are currently experiencing an issue affecting payments. Our engineering team is working to restore service.",
    },
  ], "Three audiences. Engineers get the cause. Management gets users and the pending rollback. Customers get that payments are affected — not the deploy.");
}

function comms4818(input: CommsInput): CommsVerdict {
  const users = approxUsers(input.blast.users || 2100);
  const need = input.status === "NEED_HUMAN_INPUT" || input.status === "ESCALATED";
  const approved = input.remediation.approved;
  if (approved || input.status === "RESOLVED" || input.status === "POSTMORTEM") {
    return pack("INC-4818", [
      {
        audience: "engineers",
        channel: "Slack · #inc-4818",
        body: "SEV-2. new-tax-engine experiment stopped at 0%. Checkout p95 on tax-inclusive carts recovering.",
      },
      {
        audience: "management",
        channel: "Exec brief",
        body: `Checkout issue affecting approximately ${users} users is mitigating. The experiment has been disabled.`,
      },
      {
        audience: "customers",
        channel: "Status page",
        body: "Checkout is recovering. Thank you for your patience.",
      },
    ], "Flag disabled. Customers never heard the experiment name.");
  }
  if (need) {
    return pack("INC-4818", [
      {
        audience: "engineers",
        channel: "Slack · #inc-4818",
        body: "SEV-2 incident detected. Checkout API p95 is elevated on tax-inclusive carts. Investigation is waiting on traces; new-tax-engine is the leading hypothesis.",
      },
      {
        audience: "management",
        channel: "Exec brief",
        body: `We are investigating a checkout issue affecting approximately ${users} users. Cause is not yet confirmed; engineering is gathering evidence.`,
      },
      {
        audience: "customers",
        channel: "Status page",
        body: "Some customers may see slower checkout. Our engineering team is investigating.",
      },
    ], "Same incident. Engineers hear the flag hypothesis. Customers hear slower checkout.");
  }
  return pack("INC-4818", [
    {
      audience: "engineers",
      channel: "Slack · #inc-4818",
      body: "SEV-2. Traces attached. new-tax-engine leak confirmed. Disable-flag playbook is waiting on the commander.",
    },
    {
      audience: "management",
      channel: "Exec brief",
      body: `We are investigating a checkout issue affecting approximately ${users} users. The likely cause has been identified and a flag disable is pending approval.`,
    },
    {
      audience: "customers",
      channel: "Status page",
      body: "Some customers may see slower checkout. Our engineering team is working to restore service.",
    },
  ], "Pending flag disable. Customers still do not hear the experiment name.");
}

function comms4812(input: CommsInput): CommsVerdict {
  const users = approxUsers(input.blast.users || 800);
  return pack("INC-4812", [
    {
      audience: "engineers",
      channel: "Slack · #inc-4812",
      body: "SEV-3 closed. session-redis eviction storm. Memory cap raised; login latency back to baseline.",
    },
    {
      audience: "management",
      channel: "Exec brief",
      body: `The login latency incident affecting approximately ${users} users is resolved. No hard errors. Post-incident review is complete.`,
    },
    {
      audience: "customers",
      channel: "Status page",
      body: "The earlier login slowdown has been resolved.",
    },
  ], "Closed copy. Customers never heard Redis or the memory cap.");
}
