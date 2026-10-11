import { ConnectAgent } from "@/features/agents/ConnectAgent";

import { Section } from "./Section";
import { SECTION } from "./sections";

const CAPABILITIES: { title: string; body: string }[] = [
  {
    title: "Draw from a prompt",
    body: "Describe a system, a process or a schema. The agent picks a diagram type, adds the shapes and connectors, and you watch them appear on the canvas.",
  },
  {
    title: "Edit what you select",
    body: "Select a few shapes in the editor and ask for a change. The agent can read your current selection, so “these” means what you think it means.",
  },
  {
    title: "Read and answer comments",
    body: "Pin review notes to the canvas. Agents can list them, reply in the thread and resolve them once the change is made.",
  },
  {
    title: "Preview and export",
    body: "Ask for a rendered preview, or for a file: SVG, PNG, PDF, PowerPoint, draw.io, Mermaid or JSON.",
  },
];

/** "Connect your agent": what agents can do here, next to the setup instructions. */
export function AgentSection() {
  return (
    <Section
      id={SECTION.agents}
      index="03"
      title="Connect your agent"
      lead="Diagram AI is also an MCP server. Add it to your agent once and it works on the same diagrams, on the same canvas, as you."
    >
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <ol className="flex flex-col">
          {CAPABILITIES.map((item, index) => (
            <li key={item.title} className="flex gap-4 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
              <span aria-hidden className="w-5 shrink-0 pt-0.5 font-mono text-[11px] text-ink-4">
                {String.fromCharCode(97 + index)}
              </span>
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 max-w-[56ch] text-[13px] leading-relaxed text-ink-3">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <ConnectAgent className="min-w-0" />
      </div>
    </Section>
  );
}
