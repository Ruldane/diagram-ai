import { useMemo, type ReactNode } from "react";

import { parseMarkdown, type Inline } from "./parse-markdown";

function InlineText({ inline }: { inline: Inline[] }): ReactNode {
  return inline.map((part, index) => {
    switch (part.type) {
      case "bold":
        return (
          <strong key={index} className="font-semibold text-ink">
            {part.text}
          </strong>
        );
      case "italic":
        return <em key={index}>{part.text}</em>;
      case "code":
        return (
          <code key={index} className="rounded bg-sunken px-1 py-px font-mono text-[11.5px] text-ink">
            {part.text}
          </code>
        );
      default:
        return <span key={index}>{part.text}</span>;
    }
  });
}

/** Renders the Markdown subset the assistant writes. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed break-words text-ink-2 select-text">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <p key={index} className="font-semibold text-ink">
                <InlineText inline={block.inline} />
              </p>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={index} className={block.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
                {block.items.map((item, i) => (
                  <li key={i} className="pl-0.5">
                    <InlineText inline={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre key={index} className="overflow-x-auto rounded-lg bg-sunken p-2 font-mono text-[11.5px] leading-snug text-ink">
                {block.text}
              </pre>
            );
          default:
            return (
              <p key={index} className="whitespace-pre-line">
                <InlineText inline={block.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
