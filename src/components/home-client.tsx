"use client";

import { CommandCenter } from "@/components/command-center";
import { useCommandState, type CommandPayload } from "@/components/use-command-state";

export function HomeClient({ initial }: { initial: CommandPayload }) {
  const { payload, error } = useCommandState(initial);
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <p className="kicker">{error}</p>
      </div>
    );
  }
  return <CommandCenter state={(payload ?? initial).state} />;
}
