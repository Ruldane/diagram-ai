/**
 * A deliberately tiny Markdown subset for assistant replies: paragraphs,
 * headings, bullet and numbered lists, fenced code, and **bold**, *italic*
 * and `code` inside text. Output is data, rendered as React elements, so
 * nothing from the model is ever interpreted as HTML.
 */

export type Inline = { type: "text" | "bold" | "italic" | "code"; text: string };

export type Block =
  | { type: "paragraph"; inline: Inline[] }
  | { type: "heading"; inline: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; text: string };

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^\s*][^*\n]*\*)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) out.push({ type: "code", text: part.slice(1, -1) });
    else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) out.push({ type: "bold", text: part.slice(2, -2) });
    else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) out.push({ type: "italic", text: part.slice(1, -1) });
    else out.push({ type: "text", text: part });
  }
  return out;
}

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", inline: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      endParagraph();
      endList();
      const code: string[] = [];
      // An unclosed fence is normal while a reply is still streaming.
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    if (!line.trim()) {
      endParagraph();
      endList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({ type: "heading", inline: parseInline(heading[1].trim()) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      endParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) endList();
      list ??= { ordered, items: [] };
      list.items.push(item[1].trim());
      continue;
    }

    // An indented line right after a list item continues that item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    endList();
    paragraph.push(line.trim());
  }

  endParagraph();
  endList();
  return blocks;
}
