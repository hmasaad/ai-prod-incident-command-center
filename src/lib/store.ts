import { TICK_REAL_MS, TICK_SIM_MS, VIEWER_START } from "./clock";
import { analyzeBlast } from "./engine/blast-radius";
import { computeFleet, detectIncident, latestMetrics } from "./engine/detect";
import { analyzeRca } from "./engine/rca";
import { analyzeRemediation } from "./engine/remediate";
import { buildHumanLoop } from "./engine/human-loop";
import { draftComms } from "./engine/comms";
import { buildPostmortem } from "./engine/postmortem";
import { documentFromIncident, recallMemory } from "./engine/memory";
import { buildAutonomyReport, probeAgentExecute } from "./engine/autonomy";
import { buildStack } from "./platform/stack";
import { runEvals } from "./engine/evals";
import { ingestAction, ingestTick, pushIngest, seedIngest } from "./platform/gateway";
import { apply, autoAdvance, can, isClosed, seedMachine, seedMachines } from "./platform/machine";
import { evaluateIncident } from "./platform/orchestrator";
import {
  COMMANDER,
  SecurityDenied,
  actionToIntent,
  authorize,
  mayExecute,
} from "./platform/security";
import {
  applyServiceHealth,
  baseDeployments,
  buildLogs,
  buildMetrics,
  createWorld,
  type SimFlags,
} from "./seed";
import type {
  ActionRecord,
  ActionType,
  AgentId,
  GatewayEvent,
  Incident,
  MachineEvent,
  MemoryRecord,
  Postmortem,
  EvalReport,
  SecurityVerdict,
  WorldState,
} from "./types";

type Listener = (state: WorldState) => void;

class IncidentStore {
  private flags: SimFlags = {};
  private now = VIEWER_START;
  private extraIncidents: Incident[] = [];
  private actionSeq = 0;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private world: WorldState;
  private resolved = new Map<string, number>();
  private ingest: GatewayEvent[] = seedIngest(VIEWER_START);
  private lastAction: ActionType | undefined;
  private lastSecurity: SecurityVerdict | null = null;
  private lastTickKind = "cliff";
  private machines = seedMachines();
  private resetting = false;
  private learned: MemoryRecord[] = [];
  private evalsReport: EvalReport | null = null;
  private autoExecuted = new Map<string, { at: number; type: ActionType }>();
  private autonomyBusy = false;

  constructor() {
    this.world = this.rebuild();
    this.driveAutonomy();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_REAL_MS);
  }

  snapshot(): WorldState {
    return this.world;
  }

  payload() {
    const state = this.world;
    const recs = Object.fromEntries(
      state.incidents.map((i) => [i.id, this.recommendation(i.id)]),
    );
    return { state, recs };
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  recommendation(id: string) {
    const incident = this.world.incidents.find((i) => i.id === id);
    if (!incident) return null;
    return this.evaluate(incident).recommendation;
  }

  postmortem(id: string): Postmortem | null {
    const incident = this.world.incidents.find((i) => i.id === id);
    if (!incident) return null;
    const pm = this.evaluate(incident).postmortem;
    return pm.ready ? pm : null;
  }

  evals(): EvalReport {
    if (!this.evalsReport) this.evalsReport = runEvals(VIEWER_START);
    return this.evalsReport;
  }

  rerunEvals(): EvalReport {
    this.evalsReport = runEvals(VIEWER_START);
    this.world = { ...this.world, evals: this.evalsReport };
    this.emit();
    return this.evalsReport;
  }

  private dispatch(id: string, event: MachineEvent, reason: string, agentId?: AgentId) {
    const current = this.machines.get(id) ?? seedMachine(id);
    if (!can(current, event)) {
      throw new Error(`Cannot ${event} from ${current.state}`);
    }
    this.machines.set(id, apply(current, event, this.now, reason, agentId));
  }

  private sync(incident: Incident): Incident {
    let machine = this.machines.get(incident.id) ?? incident.machine ?? seedMachine(incident.id);
    const confidence = machine.humanEvidence
      ? Math.max(incident.investigation.confidence, incident.rca?.confidence ?? 0, 0.82)
      : Math.max(incident.investigation.confidence, incident.rca?.confidence ?? 0);
    const auto = this.autoExecuted.get(incident.id);
    const recovered =
      incident.id === "INC-4821"
        ? Boolean(this.flags.rollbackAt && this.now >= this.flags.rollbackAt + 3 * 60_000)
        : Boolean(auto && this.now >= auto.at + 90_000);
    const before = machine.state;
    machine = autoAdvance(machine, {
      now: this.now,
      confidence,
      investigatingForMs: this.now - incident.startedAt,
      changeLanded:
        (incident.id === "INC-4821" &&
          Boolean(this.flags.rollbackAt && this.now >= this.flags.rollbackAt + 90_000)) ||
        (incident.id === "INC-4818" && Boolean(this.flags.disableFlagAt)) ||
        Boolean(auto && this.now >= auto.at + 90_000),
      metricsRecovered: recovered,
      postmortemReady:
        this.resolved.has(incident.id) ||
        machine.state === "RESOLVED" ||
        machine.state === "POSTMORTEM",
    });
    this.machines.set(incident.id, machine);
    let resolvedAt = isClosed(machine.state)
      ? (incident.resolvedAt ?? this.resolved.get(incident.id) ?? this.now)
      : incident.resolvedAt;
    if (before === "VERIFYING" && isClosed(machine.state)) {
      resolvedAt = resolvedAt ?? this.now;
      this.resolved.set(incident.id, resolvedAt);
    }
    const investigation = machine.humanEvidence
      ? {
          ...incident.investigation,
          confidence: Math.max(incident.investigation.confidence, 0.82),
        }
      : incident.investigation;
    const timeline =
      before === "VERIFYING" && isClosed(machine.state) && !incident.timeline.some((e) => e.id === `auto-resolve-${incident.id}`)
        ? [
            ...incident.timeline,
            {
              id: `auto-resolve-${incident.id}`,
              ts: this.now,
              kind: "resolve" as const,
              title: `${incident.id} resolved`,
              detail: "Verification recovered. Autonomous commander declared RESOLVED.",
              actor: "verification",
            },
          ]
        : incident.timeline;
    return { ...incident, machine, status: machine.state, resolvedAt, investigation, timeline };
  }

  private evaluate(incident: Incident) {
    return evaluateIncident({
      now: this.now,
      incident,
      services: this.world.services,
      metrics: this.world.metrics,
      deployments: this.world.deployments,
      logs: this.world.logs,
      onCall: this.world.onCall,
      ingest: this.ingest,
      lastHumanAction: this.lastAction,
      lastSecurity: this.lastSecurity,
      catalog: this.catalogFor(incident.id, this.world.incidents),
    });
  }

  private catalogFor(excludeId: string, incidents: Incident[]): MemoryRecord[] {
    const live = incidents
      .filter((i) => i.id !== excludeId && isClosed(i.status))
      .map((i) => documentFromIncident(i));
    const learned = this.learned.filter((r) => r.id !== excludeId);
    const seen = new Set<string>();
    const out: MemoryRecord[] = [];
    for (const r of [...learned, ...live]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }

  act(id: string, type: ActionType) {
    const incident = this.world.incidents.find((i) => i.id === id);
    if (!incident) throw new Error("Unknown incident");

    const decision = authorize({
      now: this.now,
      intent: actionToIntent(type),
      principal: COMMANDER,
      remediation: incident.remediation,
    });
    this.lastSecurity = decision;
    if (!mayExecute(decision)) {
      this.world = this.rebuild(incident);
      this.emit();
      throw new SecurityDenied(decision);
    }

    const rec: ActionRecord = {
      id: `act-${++this.actionSeq}`,
      type,
      label: type,
      status: "running",
      requestedAt: this.now,
      detail: "",
    };

    if (type === "rollback") {
      this.dispatch(id, "approve_remediation", "Commander approved rollback v2.8.14.", "remediation");
      this.flags.rollbackAt = this.now;
      rec.label = "Rollback v2.8.14 → v2.8.13";
      rec.detail = "Spinnaker rolling Payments API to v2.8.13. Machine → REMEDIATING.";
      incident.rollbackApplied = true;
      incident.remediationRejected = false;
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "respond",
        title: "Rollback v2.8.14 approved",
        detail: rec.detail,
        actor: "Maya Chen",
      });
      const deploy = this.world.deployments.find((d) => d.id === "dep-payments-2814");
      if (deploy) deploy.status = "rolling_back";
    } else if (type === "scale_pool") {
      this.flags.mitigateAt = this.now;
      incident.mitigationApplied = true;
      rec.label = "Raise Postgres pool cap";
      rec.detail = "max_connections 100 → 180. Mitigation only.";
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "respond",
        title: "Pool cap raised",
        detail: rec.detail,
        actor: "remediator",
      });
    } else if (type === "page_oncall") {
      rec.label = "Page payments on-call";
      rec.detail = "Priya Nair acknowledged.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "coordinate",
        title: "Payments on-call paged",
        detail: rec.detail,
        actor: "pagerduty",
      });
    } else if (type === "open_channel") {
      rec.label = "Open #inc-4821";
      rec.detail = "Slack war room opened. Humans and agents attached.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "coordinate",
        title: "#inc-4821 opened",
        detail: rec.detail,
        actor: "coordinator",
      });
    } else if (type === "disable_flag") {
      this.dispatch(id, "approve_remediation", "Commander disabled new-tax-engine.", "remediation");
      rec.label = "Disable new-tax-engine";
      rec.detail = "Experiment stopped at 0%. Machine → REMEDIATING.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      this.flags.disableFlagAt = this.now;
      incident.mitigationApplied = true;
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "respond",
        title: "Flag disabled",
        detail: rec.detail,
        actor: "commander",
      });
    } else if (type === "reject_remediation") {
      rec.label = "Reject rollback";
      rec.detail = "Commander rejected the playbook. Machine stays REMEDIATION_PENDING. Agent will not execute.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      incident.remediationRejected = true;
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "respond",
        title: "Playbook rejected",
        detail: rec.detail,
        actor: "Maya Chen",
      });
    } else if (type === "provide_input") {
      rec.label = "Attach missing evidence";
      rec.detail = "Human supplied traces. Machine resumes INVESTIGATING from checkpoint.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      const current = this.machines.get(id) ?? seedMachine(id);
      this.machines.set(id, { ...current, humanEvidence: true });
      this.dispatch(id, "human_input", rec.detail, "investigation");
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "investigate",
        title: "Human input attached",
        detail: rec.detail,
        actor: "commander",
      });
    } else if (type === "escalate") {
      rec.label = "Escalate";
      rec.detail = "Next-level on-call paged. Machine → ESCALATED.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      this.dispatch(id, "escalate", rec.detail, "communication");
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "coordinate",
        title: "Incident escalated",
        detail: rec.detail,
        actor: "pagerduty",
      });
    } else if (type === "resolve") {
      rec.label = "Resolve incident";
      rec.detail = "Commander declared INC closed. Machine → RESOLVED, postmortem queued.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      incident.resolvedAt = this.now;
      this.resolved.set(incident.id, this.now);
      this.dispatch(id, "declare_resolved", rec.detail, "verification");
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "resolve",
        title: `${incident.id} resolved`,
        detail: rec.detail,
        actor: "Maya Chen",
      });
    }

    incident.actions = [...incident.actions, rec];
    this.lastAction = type;
    this.ingest = pushIngest(this.ingest, ingestAction(this.now, type));
    this.world = this.rebuild(incident);
    if (type === "resolve") {
      const closed = this.world.incidents.find((i) => i.id === id);
      if (closed && isClosed(closed.status) && !this.learned.some((r) => r.id === id)) {
        this.learned.push(documentFromIncident(closed));
      }
    }
    this.driveAutonomy();
    this.emit();
    return rec;
  }

  reset() {
    this.flags = {};
    this.now = VIEWER_START;
    this.extraIncidents = [];
    this.resolved.clear();
    this.ingest = seedIngest(VIEWER_START);
    this.lastAction = undefined;
    this.lastSecurity = null;
    this.lastTickKind = "cliff";
    this.machines = seedMachines();
    this.learned = [];
    this.autoExecuted.clear();
    this.resetting = true;
    this.world = this.rebuild();
    this.resetting = false;
    this.driveAutonomy();
    this.emit();
  }

  private tick() {
    this.now += TICK_SIM_MS;
    if (this.flags.rollbackAt && this.now >= this.flags.rollbackAt + 90_000) {
      const deploy = this.world.deployments.find((d) => d.id === "dep-payments-2814");
      if (deploy && deploy.status === "rolling_back") {
        deploy.status = "rolled_back";
        deploy.version = "v2.8.13";
      }
    }
    this.world = this.rebuild();
    this.driveAutonomy();
    const err = latestMetrics(this.world.metrics).errorRate;
    const kind = this.flags.rollbackAt && err < 3 ? "recovery" : "cliff";
    if (kind !== this.lastTickKind) {
      this.lastTickKind = kind;
      this.ingest = pushIngest(
        this.ingest,
        ingestTick(this.now, err, Boolean(this.flags.rollbackAt)),
      );
      this.world = this.rebuild();
    }
    this.emit();
  }

  private rebuild(existing?: Incident): WorldState {
    const base = createWorld(this.now, this.flags);
    const prevById = new Map(
      this.resetting ? [] : (this.world?.incidents ?? []).map((i) => [i.id, i] as const),
    );
    if (existing) prevById.set(existing.id, existing);

    const seededPrimary = base.incidents.find((i) => i.id === "INC-4821")!;
    const prev = prevById.get("INC-4821");

    let primary: Incident = {
      ...seededPrimary,
      timeline: prev?.timeline?.length ? prev.timeline : seededPrimary.timeline,
      actions: prev?.actions ?? [],
      commander: prev?.commander ?? seededPrimary.commander,
      rollbackApplied: Boolean(this.flags.rollbackAt),
      mitigationApplied: Boolean(this.flags.mitigateAt),
      remediationRejected: Boolean(this.flags.rollbackAt) ? false : Boolean(prev?.remediationRejected),
      resolvedAt: this.resolved.get("INC-4821") ?? prev?.resolvedAt,
      machine: this.machines.get("INC-4821") ?? seededPrimary.machine,
    };
    primary.status = primary.machine.state;

    const err = base.metrics.at(-1)?.errorRate ?? 0;
    primary.impact =
      err < 2 ? "Traffic restored to baseline" : `${err.toFixed(0)}% of API requests failing`;

    if (this.flags.rollbackAt) {
      const lag = this.now - this.flags.rollbackAt;
      if (lag >= 90_000 && !primary.timeline.some((e) => e.id === "t-rollback-live")) {
        primary.timeline = [
          ...primary.timeline,
          {
            id: "t-rollback-live",
            ts: this.flags.rollbackAt + 90_000,
            kind: "respond",
            title: "v2.8.13 serving 100%",
            detail: "Pool wait collapsing. Auth collateral should clear as slots free.",
            actor: "remediator",
          },
        ];
      }
    }

    const metrics = buildMetrics(this.now, this.flags);
    const services = applyServiceHealth(base.services, metrics, this.flags);
    const deployments = baseDeployments().map((d) => {
      if (d.id === "dep-payments-2814" && this.flags.rollbackAt) {
        const done = this.now >= this.flags.rollbackAt + 90_000;
        return {
          ...d,
          status: done ? ("rolled_back" as const) : ("rolling_back" as const),
          version: done ? d.previousVersion : d.version,
        };
      }
      return d;
    });
    const logs = buildLogs(this.now, this.flags);

    primary = this.sync(primary);
    const evaluation = evaluateIncident({
      now: this.now,
      incident: primary,
      services,
      metrics,
      deployments,
      logs,
      onCall: base.onCall,
      ingest: this.ingest,
      lastHumanAction: this.lastAction,
      lastSecurity: this.lastSecurity,
      catalog: this.catalogFor(primary.id, base.incidents),
    });
    primary.investigation = evaluation.investigation;
    primary.detection = evaluation.pipeline.detection ?? primary.detection;
    primary.rca = evaluation.pipeline.rca ?? primary.rca;
    primary.blast = evaluation.pipeline.blast ?? primary.blast;
    primary.remediation = evaluation.pipeline.remediation ?? primary.remediation;
    primary.humanLoop = evaluation.humanLoop;
    primary.comms = evaluation.pipeline.comms ?? primary.comms;
    primary.postmortem = evaluation.postmortem;
    primary.memory = evaluation.memory;
    primary.actors = [
      ...seededPrimary.actors.filter((a) => a.kind !== "agent"),
      ...evaluation.agentActors,
    ];
    primary = this.sync(primary);

    const others = base.incidents
      .filter((i) => i.id !== "INC-4821")
      .map((i) => {
        const prevI = prevById.get(i.id);
        const merged: Incident = {
          ...i,
          timeline: prevI?.timeline?.length ? prevI.timeline : i.timeline,
          actions: prevI?.actions ?? i.actions,
          rollbackApplied: prevI?.rollbackApplied ?? i.rollbackApplied,
          mitigationApplied: Boolean(prevI?.mitigationApplied || this.autoExecuted.has(i.id) || i.mitigationApplied),
          remediationRejected: prevI?.remediationRejected ?? i.remediationRejected,
          resolvedAt: this.resolved.get(i.id) ?? prevI?.resolvedAt ?? i.resolvedAt,
          machine: this.machines.get(i.id) ?? i.machine,
        };
        const synced = this.sync({
          ...merged,
          detection: detectIncident({
            incidentId: i.id,
            now: this.now,
            metrics,
            logs,
            deployments,
            services,
            rollbackApplied: merged.rollbackApplied,
            closed: merged.status === "RESOLVED" || merged.status === "POSTMORTEM",
          }),
          rca: analyzeRca({
            incidentId: i.id,
            now: this.now,
            metrics,
            logs,
            deployments,
            services,
            rollbackApplied: merged.rollbackApplied,
            mitigationApplied: merged.mitigationApplied,
            humanEvidence: merged.machine?.humanEvidence,
          }),
          blast: analyzeBlast({
            incidentId: i.id,
            services,
            failingRequestPct: 0,
            rollbackApplied: merged.rollbackApplied,
          }),
          remediation: analyzeRemediation({
            incidentId: i.id,
            status: merged.machine?.state ?? merged.status,
            rollbackApplied: merged.rollbackApplied,
            mitigationApplied: merged.mitigationApplied,
            rejected: merged.remediationRejected,
          }),
        });
        const comms = draftComms({
          incidentId: synced.id,
          status: synced.status,
          severity: synced.severity,
          detection: synced.detection,
          rca: synced.rca,
          blast: synced.blast,
          remediation: synced.remediation,
          rollbackApplied: synced.rollbackApplied,
        });
        const humanLoop = buildHumanLoop(synced, metrics);
        const postmortem = buildPostmortem({ ...synced, humanLoop, comms }, this.now);
        const withPm = { ...synced, humanLoop, comms, postmortem };
        return {
          ...withPm,
          memory: recallMemory(withPm, this.now, this.catalogFor(synced.id, [primary, ...base.incidents])),
        };
      });

    const fleet = computeFleet(metrics, this.now);
    fleet.failingRequestPct = metrics.at(-1)?.errorRate ?? 0;
    fleet.affectedUsers = primary.blast?.users ?? primary.investigation.blastRadius.users;

    const incidents = [primary, ...others, ...this.extraIncidents];
    const learnedIds = new Set(this.learned.map((r) => r.id));
    const autonomy = buildAutonomyReport(incidents, learnedIds, this.now);
    const withLoop = incidents.map((i) => ({
      ...i,
      autonomy: autonomy.loops.find((l) => l.incidentId === i.id) ?? i.autonomy,
    }));
    if (evaluation.pipeline.autonomy) {
      evaluation.pipeline.autonomy = withLoop[0]?.autonomy ?? evaluation.pipeline.autonomy;
    }

    return {
      now: this.now,
      region: "us-east-1",
      onCall: base.onCall,
      services,
      metrics,
      deployments,
      logs,
      incidents: withLoop,
      fleet,
      alerts: primary.timeline.slice(-8).reverse(),
      pipeline: evaluation.pipeline,
      evals: this.evals(),
      autonomy,
      stack: buildStack({
        execute: Boolean(evaluation.pipeline.security?.execute),
        machine: primary.machine.state,
        ingest: this.ingest,
      }),
    };
  }

  private driveAutonomy() {
    if (this.resetting || this.autonomyBusy) return;
    this.autonomyBusy = true;
    try {
      let dirty = false;
      for (const inc of this.world.incidents) {
        if (this.tryAutoExecute(inc)) dirty = true;
      }
      if (dirty) this.world = this.rebuild();
      for (const inc of this.world.incidents) {
        if (isClosed(inc.status) && !this.learned.some((r) => r.id === inc.id)) {
          this.learned.push(documentFromIncident(inc));
          dirty = true;
        }
      }
      if (dirty) this.world = this.rebuild();
    } finally {
      this.autonomyBusy = false;
    }
  }

  private tryAutoExecute(incident: Incident): boolean {
    if (this.autoExecuted.has(incident.id)) return false;
    const probe = probeAgentExecute(this.now, incident);
    if (!probe.auto) return false;
    this.lastSecurity = probe.decision;
    this.dispatch(
      incident.id,
      "approve_remediation",
      `Agent auto-executed ${incident.remediation.actionType}. Policy automatic · ${incident.severity} · ${probe.decision.risk}.`,
      "remediation",
    );
    this.autoExecuted.set(incident.id, { at: this.now, type: incident.remediation.actionType });
    const type = incident.remediation.actionType;
    if (type === "rollback") this.flags.rollbackAt = this.now;
    if (type === "disable_flag") this.flags.disableFlagAt = this.now;
    if (type === "scale_pool") this.flags.mitigateAt = this.now;
    this.ingest = pushIngest(this.ingest, ingestAction(this.now, type));
    return true;
  }

  private emit() {
    for (const fn of this.listeners) fn(this.world);
  }
}

const globalStore = globalThis as typeof globalThis & { __icc?: IncidentStore };

export function getStore() {
  if (!globalStore.__icc) {
    globalStore.__icc = new IncidentStore();
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      globalStore.__icc.start();
    }
  }
  return globalStore.__icc;
}
