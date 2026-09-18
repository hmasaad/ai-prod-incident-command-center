import type { StackNode, StackSnapshot, StackStatus } from "@/lib/types";

export function StackBoard({
  stack,
  compact = false,
}: {
  stack: StackSnapshot;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "px-4 py-3" : "border-b border-line p-4"}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">Production stack</span>
        <span className="kicker">this process is the React / machine / in-memory cut</span>
      </div>

      <p className="text-[13px]">
        {stack.question} <span className="text-muted">{stack.answer}</span>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {stack.control.map((node, idx) => (
          <span key={node.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="mono text-[10px] text-faint">↓</span>}
            <LayerChip node={node} />
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stack.sources.map((node) => (
          <SourceCard key={node.id} node={node} />
        ))}
      </div>

      {!compact && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Lane title="Storage" nodes={stack.storage} />
          <Lane title="Observability" nodes={stack.observe} />
        </div>
      )}
    </section>
  );
}

function LayerChip({ node }: { node: StackNode }) {
  return (
    <span className={`border px-2 py-1 ${node.status === "live" ? "border-ok" : "border-line"}`}>
      <span className="text-[11px]">{node.label}</span>
      <span className="ml-1.5 mono text-[10px] text-muted">{node.recommended}</span>
      <span className={`ml-1.5 mono text-[10px] uppercase ${tone(node.status)}`}>{node.status}</span>
    </span>
  );
}

function SourceCard({ node }: { node: StackNode }) {
  return (
    <div className="border border-line px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{node.label}</span>
        <span className={`mono text-[10px] uppercase ${tone(node.status)}`}>{node.status}</span>
      </div>
      <div className="mt-1 text-[12px] font-medium">{node.recommended}</div>
      <p className="mt-1 text-[11px] leading-4 text-muted">{node.detail}</p>
    </div>
  );
}

function Lane({ title, nodes }: { title: string; nodes: StackNode[] }) {
  return (
    <div>
      <div className="kicker mb-2">{title}</div>
      <ul className="space-y-1.5">
        {nodes.map((node) => (
          <li key={node.id} className="border border-line px-2.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] font-medium">{node.label}</span>
              <span className={`mono text-[10px] uppercase ${tone(node.status)}`}>{node.status}</span>
            </div>
            <div className="mt-0.5 mono text-[11px] text-muted">
              {node.recommended} · now {node.running}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted">{node.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function tone(status: StackStatus) {
  if (status === "live") return "text-ok";
  if (status === "sim") return "text-info";
  return "text-faint";
}
