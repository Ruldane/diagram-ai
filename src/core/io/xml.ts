/**
 * A minimal, non-validating XML reader and writer.
 *
 * It understands exactly what interchange files such as draw.io need —
 * elements, attributes, character data, CDATA, comments — and is forgiving
 * about everything else: processing instructions and doctypes are skipped,
 * unclosed elements are closed at the end of the input and stray closing tags
 * are ignored. Namespaces are not interpreted (prefixes stay part of the name).
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /**
   * Character data directly inside the element: entities decoded, CDATA
   * included, children excluded. Whitespace that only indents child elements is dropped.
   */
  text: string;
}

/* ---------------------------------------------------------------- entities */

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g;
const MAX_CODE_POINT = 0x10ffff;

function codePointOf(reference: string): number {
  return reference[1] === "x" || reference[1] === "X" ? parseInt(reference.slice(2), 16) : parseInt(reference.slice(1), 10);
}

/**
 * Decodes the five XML entities and numeric character references. `extra`
 * adds named entities (HTML's `nbsp`, `mdash`…); unknown references are kept verbatim.
 */
export function decodeEntities(text: string, extra: Record<string, string> = {}): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (match, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body] ?? extra[body] ?? match;
    const code = codePointOf(body);
    return Number.isFinite(code) && code > 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : match;
  });
}

// Characters XML 1.0 cannot carry at all, even escaped.
const ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const WHITESPACE_ESCAPES: Record<string, string> = { "\n": "&#10;", "\r": "&#13;", "\t": "&#9;" };

/** Escapes text for use as XML character data or inside a quoted attribute. */
export function escapeXml(text: string): string {
  return text.replace(ILLEGAL, "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Like `escapeXml`, and also protects line breaks and tabs, which parsers would otherwise normalise to spaces. */
export function escapeXmlAttribute(text: string): string {
  return escapeXml(text).replace(/[\n\r\t]/g, (char) => WHITESPACE_ESCAPES[char]);
}

/* ------------------------------------------------------------------ parser */

const isSpace = (char: string): boolean => char === " " || char === "\n" || char === "\t" || char === "\r";
const isNameEnd = (char: string): boolean => isSpace(char) || char === ">" || char === "/" || char === "=";
const NAME_START = /[A-Za-z_:\u0080-\uffff]/;

class Scanner {
  index = 0;

  constructor(readonly input: string) {}

  get done(): boolean {
    return this.index >= this.input.length;
  }

  startsWith(token: string): boolean {
    return this.input.startsWith(token, this.index);
  }

  skipSpaces(): void {
    while (!this.done && isSpace(this.input[this.index])) this.index++;
  }

  /** Moves just past the next `token`, or to the end of the input when it never comes. */
  skipPast(token: string): void {
    const at = this.input.indexOf(token, this.index);
    this.index = at < 0 ? this.input.length : at + token.length;
  }

  readName(): string {
    const start = this.index;
    while (!this.done && !isNameEnd(this.input[this.index])) this.index++;
    return this.input.slice(start, this.index);
  }

  fail(message: string, at = this.index): never {
    const before = this.input.slice(0, at).split("\n");
    throw new Error(`Invalid XML: ${message} (line ${before.length}, column ${before[before.length - 1].length + 1}).`);
  }
}

/** `<!DOCTYPE …>` may carry an internal subset in brackets that itself contains `>`. */
function skipDeclaration(scanner: Scanner): void {
  let depth = 0;
  while (!scanner.done) {
    const char = scanner.input[scanner.index++];
    if (char === "[") depth++;
    else if (char === "]") depth--;
    else if (char === ">" && depth <= 0) return;
  }
}

function readAttributeValue(scanner: Scanner, name: string): string {
  const quote = scanner.input[scanner.index];
  if (quote !== '"' && quote !== "'") {
    // Unquoted values are not XML, but hand-edited files have them.
    const start = scanner.index;
    while (!scanner.done && !isSpace(scanner.input[scanner.index]) && scanner.input[scanner.index] !== ">") scanner.index++;
    return decodeEntities(scanner.input.slice(start, scanner.index));
  }
  const start = scanner.index + 1;
  const end = scanner.input.indexOf(quote, start);
  if (end < 0) scanner.fail(`attribute "${name}" has no closing quote`, scanner.index);
  scanner.index = end + 1;
  return decodeEntities(scanner.input.slice(start, end));
}

/** Reads `name attr="value" …>` or `… />` after the opening `<`. */
function readOpenTag(scanner: Scanner, tagStart: number): { element: XmlElement; selfClosing: boolean } {
  const element: XmlElement = { name: scanner.readName(), attrs: {}, children: [], text: "" };
  for (;;) {
    scanner.skipSpaces();
    if (scanner.done) scanner.fail(`tag <${element.name}> is never closed`, tagStart);
    if (scanner.startsWith("/>")) {
      scanner.index += 2;
      return { element, selfClosing: true };
    }
    const char = scanner.input[scanner.index];
    if (char === ">") {
      scanner.index++;
      return { element, selfClosing: false };
    }
    if (char === "/" || char === "=") {
      scanner.index++;
      continue;
    }
    const name = scanner.readName();
    scanner.skipSpaces();
    if (!scanner.startsWith("=")) {
      element.attrs[name] = "";
      continue;
    }
    scanner.index++;
    scanner.skipSpaces();
    element.attrs[name] = readAttributeValue(scanner, name);
  }
}

/**
 * Parses a document and returns its root element.
 *
 * Tolerant by design: anything before or after the root is ignored, elements
 * left open are closed implicitly and unmatched closing tags are dropped.
 * Throws a descriptive `Error` only when no element can be recovered at all or
 * a tag / attribute value runs to the end of the input.
 */
export function parseXml(source: string): XmlElement {
  const scanner = new Scanner(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  const { input } = scanner;
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;

  const appendText = (text: string): void => {
    const top = stack[stack.length - 1];
    if (top) top.text += text;
  };

  while (!scanner.done) {
    const lt = input.indexOf("<", scanner.index);
    if (lt < 0) {
      appendText(decodeEntities(input.slice(scanner.index)));
      break;
    }
    if (lt > scanner.index) appendText(decodeEntities(input.slice(scanner.index, lt)));
    scanner.index = lt;

    if (scanner.startsWith("<!--")) {
      scanner.skipPast("-->");
    } else if (scanner.startsWith("<![CDATA[")) {
      const start = lt + 9;
      const end = input.indexOf("]]>", start);
      appendText(input.slice(start, end < 0 ? input.length : end));
      scanner.index = end < 0 ? input.length : end + 3;
    } else if (scanner.startsWith("<?")) {
      scanner.skipPast("?>");
    } else if (scanner.startsWith("<!")) {
      skipDeclaration(scanner);
    } else if (scanner.startsWith("</")) {
      scanner.index += 2;
      const name = scanner.readName();
      scanner.skipPast(">");
      const depth = stack.map((element) => element.name).lastIndexOf(name);
      if (depth >= 0) stack.length = depth;
      // The document ends with its root; trailing content is not ours to interpret.
      if (root && stack.length === 0) break;
    } else if (lt + 1 >= input.length || !NAME_START.test(input[lt + 1])) {
      // A bare "<" that does not start a tag is kept as text.
      appendText("<");
      scanner.index = lt + 1;
    } else {
      scanner.index = lt + 1;
      const { element, selfClosing } = readOpenTag(scanner, lt);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else root = element;
      if (!selfClosing) stack.push(element);
      else if (!parent) break;
    }
  }

  if (!root) throw new Error("Invalid XML: no element found.");
  dropIndentation(root);
  return root;
}

/** Whitespace between child elements is formatting, not content. */
function dropIndentation(element: XmlElement): void {
  if (!element.children.length) return;
  if (!element.text.trim()) element.text = "";
  for (const child of element.children) dropIndentation(child);
}

/* ------------------------------------------------------------------- query */

/** Direct children with the given tag name. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** First direct child with the given tag name. */
export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => child.name === name);
}

/** Every descendant with the given tag name, in document order (the element itself excluded). */
export function descendantsNamed(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (current: XmlElement): void => {
    for (const child of current.children) {
      if (child.name === name) out.push(child);
      visit(child);
    }
  };
  visit(element);
  return out;
}

/** The element itself when it has the given name, otherwise its first matching descendant. */
export function findElement(element: XmlElement, name: string): XmlElement | undefined {
  if (element.name === name) return element;
  for (const child of element.children) {
    const found = findElement(child, name);
    if (found) return found;
  }
  return undefined;
}

/* -------------------------------------------------------------- serializer */

export type XmlAttributeValue = string | number | boolean | undefined;

/** Builds an element; attributes whose value is `undefined` are left out. */
export function xmlElement(
  name: string,
  attrs: Record<string, XmlAttributeValue> = {},
  children: XmlElement[] = [],
  text = "",
): XmlElement {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) out[key] = String(value);
  return { name, attrs: out, children, text };
}

export interface SerializeOptions {
  /** Indentation per level; `""` writes everything on one line. Defaults to two spaces. */
  indent?: string;
  /** Prepends `<?xml version="1.0" encoding="UTF-8"?>`. */
  declaration?: boolean;
}

/**
 * Writes an element tree as XML. Attributes keep their insertion order, so the
 * output is deterministic. Mixed content is not preserved: an element's text is
 * written before its children.
 */
export function serializeXml(element: XmlElement, options: SerializeOptions = {}): string {
  const indent = options.indent ?? "  ";
  const newline = indent ? "\n" : "";
  const lines: string[] = [];

  const write = (current: XmlElement, depth: number): void => {
    const pad = indent.repeat(depth);
    const attrs = Object.entries(current.attrs)
      .map(([key, value]) => ` ${key}="${escapeXmlAttribute(value)}"`)
      .join("");
    const open = `${pad}<${current.name}${attrs}`;
    const text = escapeXml(current.text);
    if (!current.children.length) {
      lines.push(text ? `${open}>${text}</${current.name}>` : `${open}/>`);
      return;
    }
    lines.push(`${open}>${text.trim()}`);
    for (const child of current.children) write(child, depth + 1);
    lines.push(`${pad}</${current.name}>`);
  };

  write(element, 0);
  return (options.declaration ? `<?xml version="1.0" encoding="UTF-8"?>${newline}` : "") + lines.join(newline) + newline;
}
