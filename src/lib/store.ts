import { TICK_REAL_MS, TICK_SIM_MS, VIEWER_START } from "./clock";
import { investigate } from "./engine/correlate";
import { computeFleet } from "./engine/detect";
import { buildPostmortem } from "./engine/postmortem";
import { recommend } from "./engine/recommend";
import {
  applyServiceHealth,
  baseDeployments,
  buildLogs,
  buildMetrics,
  createWorld,
  type SimFlags,
} from "./seed";
import type { ActionRecord, ActionType, Incident, Postmortem, WorldState } from "./types";

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

  constructor() {
    this.world = this.rebuild();
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
    return recommend(incident, incident.investigation);
  }

  postmortem(id: string): Postmortem | null {
    const incident = this.world.incidents.find((i) => i.id === id);
    if (!incident) return null;
    return buildPostmortem(incident, this.now);
  }

  act(id: string, type: ActionType) {
    const incident = this.world.incidents.find((i) => i.id === id);
    if (!incident) throw new Error("Unknown incident");

    const rec: ActionRecord = {
      id: `act-${++this.actionSeq}`,
      type,
      label: type,
      status: "running",
      requestedAt: this.now,
      detail: "",
    };

    if (type === "rollback") {
      this.flags.rollbackAt = this.now;
      rec.label = "Rollback v2.8.14 → v2.8.13";
      rec.detail = "Spinnaker rolling Payments API to v2.8.13.";
      incident.rollbackApplied = true;
      incident.status = "responding";
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
      incident.actors = incident.actors.map((a) =>
        a.id === "a3" ? { ...a, status: "executing rollback" } : a,
      );
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
      rec.label = "Disable new-tax-engine";
      rec.detail = "Experiment stopped at 0%.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      incident.status = "monitoring";
      incident.timeline.push({
        id: rec.id,
        ts: this.now,
        kind: "respond",
        title: "Flag disabled",
        detail: rec.detail,
        actor: "commander",
      });
    } else if (type === "resolve") {
      rec.label = "Resolve incident";
      rec.detail = "Commander declared INC closed. Postmortem queued.";
      rec.status = "succeeded";
      rec.completedAt = this.now;
      incident.status = "resolved";
      incident.resolvedAt = this.now;
      this.resolved.set(incident.id, this.now);
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
    this.world = this.rebuild(incident);
    this.emit();
    return rec;
  }

  reset() {
    this.flags = {};
    this.now = VIEWER_START;
    this.extraIncidents = [];
    this.resolved.clear();
    this.world = this.rebuild();
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
    this.emit();
  }

  private rebuild(existingPrimary?: Incident): WorldState {
    const base = createWorld(this.now, this.flags);
    const seededPrimary = base.incidents.find((i) => i.id === "INC-4821")!;
    const prev = existingPrimary ?? this.world?.incidents.find((i) => i.id === "INC-4821");

    const primary: Incident = {
      ...seededPrimary,
      timeline: prev?.timeline?.length ? prev.timeline : seededPrimary.timeline,
      actions: prev?.actions ?? [],
      actors: seededPrimary.actors,
      commander: prev?.commander ?? seededPrimary.commander,
      rollbackApplied: Boolean(this.flags.rollbackAt),
      mitigationApplied: Boolean(this.flags.mitigateAt),
      resolvedAt: this.resolved.get("INC-4821"),
      status: this.resolved.has("INC-4821")
        ? "resolved"
        : seededPrimary.status,
    };

    if (this.flags.rollbackAt && !this.resolved.has("INC-4821")) {
      const lag = this.now - this.flags.rollbackAt;
      primary.status = lag > 4 * 60_000 ? "monitoring" : "responding";
    }

    primary.investigation = investigate({
      now: this.now,
      services: base.services,
      metrics: base.metrics,
      deployments: base.deployments,
      logs: base.logs,
      affectedServiceIds: primary.affectedServiceIds,
      rollbackApplied: primary.rollbackApplied,
      mitigationApplied: primary.mitigationApplied,
    });
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

    const others = base.incidents
      .filter((i) => i.id !== "INC-4821")
      .map((i) => (this.resolved.has(i.id) ? { ...i, status: "resolved" as const, resolvedAt: this.resolved.get(i.id) } : i));

    const metrics = buildMetrics(this.now, this.flags);
    const services = applyServiceHealth(base.services, metrics, this.flags);
    const fleet = computeFleet(metrics, this.now);
    fleet.failingRequestPct = metrics.at(-1)?.errorRate ?? 0;
    fleet.affectedUsers = primary.investigation.blastRadius.users;

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

    return {
      now: this.now,
      region: "us-east-1",
      onCall: base.onCall,
      services,
      metrics,
      deployments,
      logs: buildLogs(this.now, this.flags),
      incidents: [primary, ...others, ...this.extraIncidents],
      fleet,
      alerts: primary.timeline.slice(-8).reverse(),
    };
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
