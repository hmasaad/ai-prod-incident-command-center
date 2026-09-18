import type {
  ActionType,
  McpToolPolicy,
  PolicyApproval,
  PolicyRule,
  RemediationKind,
  RemediationVerdict,
  RuntimeGuard,
  SecurityIntentKind,
  SecurityLayer,
  SecurityPrincipal,
  SecuritySnapshot,
  SecurityVerdict,
  SecurityVerdictKind,
  Severity,
} from "../types";

/**
 * Security Gateway: Identity · Policy · Risk → Execute?
 *
 * Incident Gateway is ingress (alerts in). This is egress (mutations out).
 * Agents propose. The gateway decides. Humans approve. Nothing else reaches prod.
 */

export const COMMANDER: SecurityPrincipal = {
  id: "maya-chen",
  name: "Maya Chen",
  kind: "human",
  role: "incident_commander",
  authenticated: true,
  scopes: ["approve_remediation", "resolve", "escalate", "provide_input", "reject"],
};

export const REMEDIATION_AGENT: SecurityPrincipal = {
  id: "remediation",
  name: "Remediation Agent",
  kind: "agent",
  role: "responder",
  authenticated: true,
  scopes: ["propose_playbook"],
};

export const POLICY_CATALOG: PolicyRule[] = [
  {
    id: "rollback",
    label: "rollback",
    risk: "MEDIUM",
    approval: "required",
    summary: "Production deploy revert. SEV-1 mutates wait on a commander.",
    featured: true,
  },
  {
    id: "restart",
    label: "restart",
    risk: "LOW",
    approval: "automatic",
    summary: "Process restart. Licensed for agents only when the playbook selects it.",
    featured: true,
  },
  {
    id: "delete_database",
    label: "delete_database",
    risk: "CRITICAL",
    approval: "prohibited",
    summary: "Irreversible data-plane destroy. Never licensed — not even to a commander.",
    featured: true,
  },
  {
    id: "production_secret_access",
    label: "production_secret_access",
    risk: "CRITICAL",
    approval: "prohibited",
    summary: "Vault / env secret read. Agents cannot exfiltrate production secrets.",
    featured: true,
  },
  {
    id: "scale",
    label: "scale",
    risk: "LOW",
    approval: "automatic",
    summary: "Capacity mitigation. Does not replace a corrective action.",
    featured: false,
  },
  {
    id: "disable_flag",
    label: "disable_flag",
    risk: "MEDIUM",
    approval: "required",
    summary: "Experiment off. Human gate.",
    featured: false,
  },
  {
    id: "clear_cache",
    label: "clear_cache",
    risk: "LOW",
    approval: "automatic",
    summary: "Cache flush. Still blocked if the playbook did not select it.",
    featured: false,
  },
  {
    id: "failover_db",
    label: "failover_db",
    risk: "HIGH",
    approval: "required",
    summary: "AZ failover. Human gate; playbook may still forbid it.",
    featured: false,
  },
  {
    id: "disable_endpoint",
    label: "disable_endpoint",
    risk: "HIGH",
    approval: "required",
    summary: "Take a route dark. Human gate.",
    featured: false,
  },
  {
    id: "page_oncall",
    label: "page_oncall",
    risk: "LOW",
    approval: "automatic",
    summary: "Coordination. Agents may page.",
    featured: false,
  },
  {
    id: "open_channel",
    label: "open_channel",
    risk: "LOW",
    approval: "automatic",
    summary: "Slack war room. Agents may open the channel.",
    featured: false,
  },
  {
    id: "resolve",
    label: "resolve",
    risk: "MEDIUM",
    approval: "required",
    summary: "Declare RESOLVED. Commander only.",
    featured: false,
  },
  {
    id: "provide_input",
    label: "provide_input",
    risk: "LOW",
    approval: "required",
    summary: "Human evidence. Not a production mutate.",
    featured: false,
  },
  {
    id: "escalate",
    label: "escalate",
    risk: "MEDIUM",
    approval: "required",
    summary: "Page next-level. Commander only.",
    featured: false,
  },
  {
    id: "reject_remediation",
    label: "reject_remediation",
    risk: "LOW",
    approval: "required",
    summary: "Decline the playbook. Commander only. Does not execute anything.",
    featured: false,
  },
];

export const MCP_TOOLS: McpToolPolicy[] = [
  {
    tool: "spinnaker.rollback",
    mapsTo: "rollback",
    allow: "required",
    detail: "CD mutate. MCP will not invoke without a human-allow verdict.",
  },
  {
    tool: "k8s.restart_deployment",
    mapsTo: "restart",
    allow: "automatic",
    detail: "Licensed restart. Still denied if the incident overlay forbids it.",
  },
  {
    tool: "postgres.drop_database",
    mapsTo: "delete_database",
    allow: "prohibited",
    detail: "Not on the MCP allowlist. Tool schema is advertised as denied.",
  },
  {
    tool: "vault.read_production_secret",
    mapsTo: "production_secret_access",
    allow: "prohibited",
    detail: "Secrets never enter agent context or prompts.",
  },
  {
    tool: "datadog.query",
    mapsTo: "read_telemetry",
    allow: "automatic",
    detail: "Read-only telemetry. AI API Gateway strips credentials from the prompt.",
  },
  {
    tool: "github.get_diff",
    mapsTo: "read_code",
    allow: "automatic",
    detail: "Read-only git. No write, no secret files.",
  },
  {
    tool: "pagerduty.page",
    mapsTo: "page_oncall",
    allow: "automatic",
    detail: "Coordination page. Scoped to the incident service.",
  },
  {
    tool: "slack.post_message",
    mapsTo: "open_channel",
    allow: "automatic",
    detail: "War-room channel. No token exfil.",
  },
];

export const RUNTIME_GUARDS: RuntimeGuard[] = [
  {
    id: "no-shell",
    layer: "agent-runtime",
    title: "No shell",
    detail: "Agent runtime cannot exec, kubectl, or psql. Tools are MCP-only.",
    status: "enforced",
  },
  {
    id: "no-raw-prod-api",
    layer: "ai-api",
    title: "No raw production API",
    detail: "Model output never carries cloud credentials. Writes go through this gateway.",
    status: "enforced",
  },
  {
    id: "mcp-allowlist",
    layer: "mcp",
    title: "MCP allowlist",
    detail: "Only advertised tools exist. drop_database and vault.read are published as prohibited.",
    status: "enforced",
  },
  {
    id: "no-secret-in-prompt",
    layer: "ai-api",
    title: "No secrets in prompts",
    detail: "AI API Gateway redacts tokens, env, and vault material before the model sees context.",
    status: "enforced",
  },
];

const RANK: Record<PolicyApproval, number> = {
  automatic: 1,
  required: 2,
  prohibited: 3,
};

export class SecurityDenied extends Error {
  decision: SecurityVerdict;
  constructor(decision: SecurityVerdict) {
    super(decision.reason);
    this.name = "SecurityDenied";
    this.decision = decision;
  }
}

export function actionToIntent(type: ActionType): SecurityIntentKind {
  if (type === "scale_pool") return "scale";
  return type as SecurityIntentKind;
}

function kindToIntent(kind: RemediationKind): SecurityIntentKind {
  if (kind === "scale") return "scale";
  return kind;
}

function ruleFor(intent: SecurityIntentKind): PolicyRule {
  return POLICY_CATALOG.find((r) => r.id === intent) ?? {
    id: intent,
    label: intent,
    risk: "HIGH",
    approval: "prohibited",
    summary: "Unknown intent. Default deny.",
    featured: false,
  };
}

function overlayApproval(intent: SecurityIntentKind, remediation?: RemediationVerdict): PolicyApproval | null {
  const row = remediation?.catalog.find((c) => kindToIntent(c.kind) === intent);
  if (!row) return null;
  if (row.policy === "forbidden") return "prohibited";
  if (row.policy === "human_required") return "required";
  if (row.policy === "mitigation_only") return "automatic";
  return null;
}

function tighten(global: PolicyApproval, overlay: PolicyApproval | null): PolicyApproval {
  if (!overlay) return global;
  return RANK[overlay] >= RANK[global] ? overlay : global;
}

function humanMayApprove(principal: SecurityPrincipal, intent: SecurityIntentKind) {
  if (principal.kind !== "human" || !principal.authenticated) return false;
  if (intent === "resolve") return principal.scopes.includes("resolve");
  if (intent === "escalate") return principal.scopes.includes("escalate");
  if (intent === "provide_input") return principal.scopes.includes("provide_input");
  if (intent === "reject_remediation") return principal.scopes.includes("reject");
  return principal.scopes.includes("approve_remediation");
}

export interface AuthorizeInput {
  now: number;
  intent: SecurityIntentKind;
  principal: SecurityPrincipal;
  remediation?: RemediationVerdict;
}

export function authorize(input: AuthorizeInput): SecurityVerdict {
  const rule = ruleFor(input.intent);
  const overlay = overlayApproval(input.intent, input.remediation);
  const approval = tighten(rule.approval, overlay);
  const overlayNote = overlay && overlay !== rule.approval
    ? `Incident overlay: playbook marks this ${overlay}.`
    : undefined;

  const base = {
    at: input.now,
    intent: input.intent,
    principal: input.principal,
    risk: rule.risk,
    approval,
    overlay: overlayNote,
  };

  if (!input.principal.authenticated) {
    return finish(base, "deny", false, "Identity failed. Anonymous principals cannot reach production.");
  }

  if (approval === "prohibited") {
    return finish(
      base,
      "deny",
      false,
      overlayNote
        ? `${rule.label} is prohibited. ${overlayNote} Gateway will not execute.`
        : `${rule.label} is prohibited. Risk ${rule.risk}. Gateway will not execute — not even for a commander.`,
    );
  }

  if (approval === "automatic") {
    if (input.principal.kind === "anonymous") {
      return finish(base, "deny", false, "Identity failed.");
    }
    return finish(
      base,
      "allow",
      true,
      `${rule.label} is automatic at ${rule.risk} risk. ${input.principal.name} is licensed.`,
    );
  }

  // required
  if (humanMayApprove(input.principal, input.intent)) {
    return finish(
      base,
      "allow",
      true,
      `Policy required a human. ${input.principal.name} (${input.principal.role}) satisfied identity. Execute licensed.`,
    );
  }

  return finish(
    base,
    "require_human",
    false,
    `${rule.label} is ${rule.risk} · approval required. ${input.principal.name} may propose, not execute.`,
  );
}

function finish(
  base: Omit<SecurityVerdict, "verdict" | "execute" | "reason">,
  verdict: SecurityVerdictKind,
  execute: boolean,
  reason: string,
): SecurityVerdict {
  return { ...base, verdict, execute, reason };
}

export function mayExecute(decision: SecurityVerdict) {
  return decision.execute && decision.verdict === "allow";
}

function layersFor(held: SecurityVerdict): SecurityLayer[] {
  const identity: SecurityLayer = {
    id: "identity",
    title: "Identity",
    status: held.principal.authenticated ? "pass" : "fail",
    summary: held.principal.authenticated
      ? `${held.principal.name} · ${held.principal.role} · ${held.principal.kind}`
      : "Unauthenticated",
  };
  const policy: SecurityLayer = {
    id: "policy",
    title: "Policy",
    status: held.approval === "prohibited" ? "fail" : held.approval === "required" && !held.execute ? "hold" : "pass",
    summary: `${held.intent}: ${held.approval}${held.overlay ? ` · ${held.overlay}` : ""}`,
  };
  const risk: SecurityLayer = {
    id: "risk",
    title: "Risk",
    status: held.risk === "CRITICAL" ? "fail" : held.risk === "HIGH" || held.risk === "MEDIUM" ? "hold" : "pass",
    summary: `${held.risk} · ${held.intent}`,
  };
  const mcp: SecurityLayer = {
    id: "mcp",
    title: "MCP",
    status: held.approval === "prohibited" ? "fail" : "pass",
    summary:
      held.intent === "production_secret_access" || held.intent === "delete_database"
        ? "Tool is not on the allowlist."
        : "Tool is advertised. Invocation still waits on Execute?",
  };
  const runtime: SecurityLayer = {
    id: "runtime",
    title: "Runtime",
    status: "pass",
    summary: "No shell · no raw prod API · no secrets in prompts.",
  };
  return [identity, policy, risk, mcp, runtime];
}

export interface InspectInput {
  now: number;
  remediation: RemediationVerdict;
  recommended: SecurityIntentKind;
  severity?: Severity;
  lastDecision?: SecurityVerdict | null;
}

export function inspectSecurity(input: InspectInput): SecuritySnapshot {
  const held = authorize({
    now: input.now,
    intent: input.recommended,
    principal: REMEDIATION_AGENT,
    remediation: input.remediation,
  });

  const probes = (["rollback", "restart", "delete_database", "production_secret_access"] as const).map((intent) =>
    authorize({
      now: input.now,
      intent,
      principal: REMEDIATION_AGENT,
      remediation: input.remediation,
    }),
  );

  const sev1 = input.severity === "SEV-1";
  const agentLicensed = held.execute && !sev1;
  const execute = input.remediation.approved ? true : agentLicensed;

  const answer = input.remediation.approved
    ? "Yes — change licensed. Verify → resolve → postmortem → learn runs autonomously."
    : input.remediation.rejected
      ? "No — commander rejected. Gateway will not execute."
      : held.verdict === "deny"
        ? `No — ${held.intent} prohibited.`
        : agentLicensed
          ? "Yes — low risk, automatic. Agent may execute."
          : "No — identity is the agent. Policy requires a human. Risk is not auto-run.";

  return {
    title: "Security Gateway",
    question: "Execute?",
    answer,
    execute,
    identity: held.principal,
    layers: layersFor(held),
    catalog: POLICY_CATALOG,
    mcp: MCP_TOOLS,
    runtime: RUNTIME_GUARDS,
    held,
    lastDecision: input.lastDecision ?? null,
    probes,
  };
}
