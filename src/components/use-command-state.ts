"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionType, WorldState } from "@/lib/types";
import type { Recommendation } from "@/lib/engine/recommend";

export interface CommandPayload {
  state: WorldState;
  recs: Record<string, Recommendation | null>;
}

export function useCommandState(initial?: CommandPayload | null) {
  const [payload, setPayload] = useState<CommandPayload | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const skipFetch = useRef(Boolean(initial));

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    if (!skipFetch.current) {
      fetch("/api/state")
        .then((r) => r.json())
        .then((data: CommandPayload) => {
          if (!cancelled) setPayload(data);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    }

    es = new EventSource("/api/stream");
    es.onmessage = (ev) => {
      try {
        setPayload(JSON.parse(ev.data) as CommandPayload);
      } catch {
        /* ignore malformed frames */
      }
    };
    es.onerror = () => {
      /* EventSource retries on its own */
    };

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  return { payload, error };
}

export async function runAction(incidentId: string, type: ActionType) {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentId, type }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "action failed");
  }
}

export async function resetWorld() {
  await fetch("/api/reset", { method: "POST" });
}

export async function rerunEvals() {
  const res = await fetch("/api/evals", { method: "POST" });
  if (!res.ok) throw new Error("evals failed");
}
