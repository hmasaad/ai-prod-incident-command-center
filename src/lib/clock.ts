/** Frozen narrative origin so INC-4821 starts at 10:42 UTC as specified. */
export const DAY = Date.parse("2026-09-14T00:00:00Z");
export const DEPLOY_AT = Date.parse("2026-09-14T10:38:00Z");
export const INCIDENT_AT = Date.parse("2026-09-14T10:42:00Z");
export const DETECTED_AT = Date.parse("2026-09-14T10:43:02Z");
export const INVESTIGATED_AT = Date.parse("2026-09-14T10:46:18Z");
export const TRIAGED_AT = Date.parse("2026-09-14T10:43:18Z");
export const INVESTIGATION_STARTED_AT = Date.parse("2026-09-14T10:43:40Z");
export const RCA_AT = INVESTIGATED_AT;
export const REMEDIATION_PENDING_AT = Date.parse("2026-09-14T10:46:58Z");
export const VIEWER_START = Date.parse("2026-09-14T11:08:00Z");
export const METRIC_START = Date.parse("2026-09-14T09:30:00Z");
export const METRIC_STEP = 15_000;
export const TICK_REAL_MS = 2000;
export const TICK_SIM_MS = 15_000;

export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
