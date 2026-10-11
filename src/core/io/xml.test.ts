import { describe, expect, it } from "vitest";

import {
  childrenNamed,
  decodeEntities,
  descendantsNamed,
  escapeXml,
  escapeXmlAttribute,
  findElement,
  firstChild,
  parseXml,
  serializeXml,
  xmlElement,
} from "./xml";

describe("parseXml", () => {
  it("reads nested elements, attributes and text", () => {
    const root = parseXml(`<a id="1"><b>hello</b><c><d x="y"/></c>tail</a>`);
    expect(root.name).toBe("a");
    expect(root.attrs).toEqual({ id: "1" });
    expect(root.children.map((child) => child.name)).toEqual(["b", "c"]);
    expect(root.children[0].text).toBe("hello");
    expect(root.children[1].children[0]).toEqual({ name: "d", attrs: { x: "y" }, children: [], text: "" });
    expect(root.text).toBe("tail");
  });

  it("handles self-closing elements with and without a space", () => {
    const root = parseXml(`<root><a/><b /><c x="1"/><d></d></root>`);
    expect(root.children.map((child) => child.name)).toEqual(["a", "b", "c", "d"]);
    expect(root.children.every((child) => child.children.length === 0)).toBe(true);
    expect(parseXml("<only/>").name).toBe("only");
  });

  it("accepts both quote styles and markup characters inside attribute values", () => {
    const root = parseXml(`<a one="it's" two='say "hi"' three = "a > b" four='x/>y' flag/>`);
    expect(root.attrs).toEqual({ one: "it's", two: 'say "hi"', three: "a > b", four: "x/>y", flag: "" });
  });

  it("decodes the XML entities and numeric references in text and attributes", () => {
    const root = parseXml(`<a v="&lt;b&gt; &amp; &quot;q&quot; &apos;s&apos; &#65;&#x42;&#x1F600;">&amp;lt; &#10;x</a>`);
    expect(root.attrs.v).toBe(`<b> & "q" 's' AB\u{1F600}`);
    expect(root.text).toBe("&lt; \nx");
  });

  it("keeps unknown or malformed references verbatim", () => {
    expect(decodeEntities("&nbsp; &bogus; & &#xZZ; &#99999999;")).toBe("&nbsp; &bogus; & &#xZZ; &#99999999;");
    expect(decodeEntities("a&nbsp;b", { nbsp: " " })).toBe("a b");
  });

  it("skips comments, processing instructions and doctypes, and keeps CDATA literally", () => {
    const root = parseXml(
      `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE note [ <!ENTITY x "y"> ]>\n<!-- top -->\n<a><!-- <ignored/> --><b><![CDATA[1 < 2 && <c/> &amp;]]></b><?pi data?></a>\n<!-- after -->`,
    );
    expect(root.name).toBe("a");
    expect(root.children).toHaveLength(1);
    expect(root.children[0].text).toBe("1 < 2 && <c/> &amp;");
  });

  it("recovers from unclosed elements and stray closing tags", () => {
    const root = parseXml(`<a><b><c>text</b></nope><d/>`);
    expect(root.name).toBe("a");
    expect(root.children.map((child) => child.name)).toEqual(["b", "d"]);
    expect(root.children[0].children[0].text).toBe("text");
  });

  it("treats a bare < as text", () => {
    expect(parseXml("<a>1 < 2</a>").text).toBe("1 < 2");
  });

  it("throws a descriptive error when nothing can be recovered", () => {
    expect(() => parseXml("")).toThrow(/no element/i);
    expect(() => parseXml("just some text")).toThrow(/no element/i);
    expect(() => parseXml(`<a>\n  <b attr="never closed>`)).toThrow(/attribute "attr".*line 2/);
    expect(() => parseXml(`<a foo="1"`)).toThrow(/<a> is never closed/);
  });
});

describe("query helpers", () => {
  const root = parseXml(`<r><x n="1"/><y><x n="2"/><z><x n="3"/></z></y><x n="4"/></r>`);

  it("finds direct children", () => {
    expect(childrenNamed(root, "x").map((x) => x.attrs.n)).toEqual(["1", "4"]);
    expect(firstChild(root, "y")?.children).toHaveLength(2);
    expect(firstChild(root, "missing")).toBeUndefined();
  });

  it("finds descendants in document order", () => {
    expect(descendantsNamed(root, "x").map((x) => x.attrs.n)).toEqual(["1", "2", "3", "4"]);
    expect(findElement(root, "z")?.children[0].attrs.n).toBe("3");
    expect(findElement(root, "r")).toBe(root);
    expect(findElement(root, "missing")).toBeUndefined();
  });
});

describe("escaping and serialising", () => {
  it("escapes the five special characters and drops characters XML cannot carry", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
    expect(escapeXml("a\u0000b\u0008c\td")).toBe("abc\td");
  });

  it("protects line breaks in attribute values", () => {
    expect(escapeXmlAttribute("a\nb\tc")).toBe("a&#10;b&#9;c");
  });

  it("builds elements, leaving undefined attributes out", () => {
    expect(xmlElement("p", { x: 1, y: undefined, on: true, s: "v" }).attrs).toEqual({ x: "1", on: "true", s: "v" });
  });

  it("writes XML that parses back to the same tree", () => {
    const tree = xmlElement("root", { title: `A "quoted" <tag> & more\nline two` }, [
      xmlElement("empty"),
      xmlElement("leaf", { n: 1 }, [], "text & <stuff>"),
      xmlElement("branch", {}, [xmlElement("twig", { deep: "yes" })]),
    ]);
    const xml = serializeXml(tree, { declaration: true });
    expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<root title="A &quot;quoted&quot; &lt;tag&gt; &amp; more&#10;line two">`)).toBe(true);
    expect(xml).toContain("  <empty/>\n");
    expect(xml).toContain("  <leaf n=\"1\">text &amp; &lt;stuff&gt;</leaf>\n");
    expect(parseXml(xml)).toEqual(tree);
    expect(serializeXml(tree, { indent: "" })).not.toContain("\n");
  });
});
