"use client";

import { ChevronDown, CircleAlert, FileCode, ListPlus, RefreshCw, Replace, TriangleAlert, WandSparkles } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { matchCodeIds, planCodeApply, type CodeApplyMode, type CodePlan } from "@/core/code/apply";
import { CODE_EXAMPLES, PLACEHOLDERS } from "@/core/code/examples";
import { generateCode } from "@/core/code/generate";
import { parseCode, type CodeParse } from "@/core/code/parse";
import type { CodeLanguage, ImportKind } from "@/core/code/types";
import { isEmptyPatch } from "@/core/model/patch";
import type { Id } from "@/core/model/types";
import { Button } from "@/components/ui/button";
import { Segmented, Toggle } from "@/components/ui/fields";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

import { useDoc, useEditor, useEditorStore } from "../store/context";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { loadDraft, loadGenerated, loadLanguage, saveDraft, saveGenerated, saveLanguage } from "./drafts";
import { announce, applyCode, describePlan } from "./run-code";
import { useParsedCode } from "./use-parsed-code";

const LIVE_DELAY_MS = 600;
const TYPING_DELAY_MS = 250;
/** How soon a live apply is tried again after it was held back by a drag. */
const RETRY_MS = 400;

const LANGUAGES = [
  { value: "mermaid" as const, label: "Mermaid" },
  { value: "plantuml" as const, label: "PlantUML" },
];

const KIND_LABEL: Record<ImportKind, string> = {
  flowchart: "Flowchart",
  sequence: "Sequence diagram",
  class: "Class diagram",
  usecase: "Use case diagram",
  activity: "Activity diagram",
  component: "Component diagram",
  unknown: "",
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

type Notice = { kind: "note"; text: string } | { kind: "unsupported"; language: CodeLanguage; reason: string; example: string };

const LANGUAGE_NAME: Record<CodeLanguage, string> = { mermaid: "Mermaid", plantuml: "PlantUML" };
const OTHER: Record<CodeLanguage, CodeLanguage> = { mermaid: "plantuml", plantuml: "mermaid" };

/* ----------------------------------------------------------------- status */

function counts(parsed: CodeParse): string {
  const { nodes, connectors, participants, messages } = parsed.counts;
  if (parsed.imported.kind === "sequence") return `${plural(participants, "participant")} · ${plural(messages, "message")}`;
  return `${plural(nodes, "shape")} · ${plural(connectors, "connector")}`;
}

function Status({ parsed, fresh, preview, onJump }: { parsed: CodeParse; fresh: boolean; preview: CodePlan | null; onJump: (line: number) => void }) {
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const label = KIND_LABEL[parsed.imported.kind];
  return (
    <div className={cn("flex flex-col gap-1.5 text-[12px] transition-opacity", !fresh && "opacity-55")} aria-live="polite">
      {!parsed.empty ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-ink-2">
          {label ? <span className="font-semibold text-ink">{label}</span> : null}
          <span className="font-mono text-[11.5px] text-ink-3">{counts(parsed)}</span>
        </p>
      ) : null}
      {preview && !parsed.empty ? (
        <p className="text-ink-3">{isEmptyPatch(preview.patch) ? "The canvas already matches this text." : `Applying will ${describePlan(preview, "future")}.`}</p>
      ) : null}
      {preview && !parsed.empty && (preview.patch.comments?.set?.length ?? 0) > 0 ? (
        <p className="flex items-start gap-1.5 text-ink-2">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
          <span>
            {plural(preview.patch.comments?.set?.length ?? 0, "comment")} on shapes that are not in this text will be unpinned. They stay in the Comments tab.
          </span>
        </p>
      ) : null}

      {errors.length ? (
        <ul className="flex flex-col gap-0.5">
          {errors.slice(0, 6).map((diagnostic) => (
            <li key={`${diagnostic.line}:${diagnostic.message}`}>
              <button
                type="button"
                onClick={() => onJump(diagnostic.line)}
                className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-danger hover:bg-danger-soft"
              >
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="font-mono text-[11px]">Line {diagnostic.line}</span> <span className="break-words">{diagnostic.message}</span>
                </span>
              </button>
            </li>
          ))}
          {errors.length > 6 ? <li className="px-1.5 text-ink-3">and {errors.length - 6} more</li> : null}
        </ul>
      ) : null}

      {parsed.empty && !errors.length && parsed.warnings.length ? (
        <p className="flex items-start gap-1.5 text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span>{parsed.warnings[parsed.warnings.length - 1]}</span>
        </p>
      ) : null}

      {parsed.warnings.length && !parsed.empty ? (
        <ul className="flex flex-col gap-1">
          {parsed.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5 text-ink-2">
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

/**
 * The diagram as text. Mermaid and PlantUML are read into the same shape,
 * previewed as counts and warnings (the canvas is the real preview), and
 * applied to the canvas as one undoable step that keeps what the person
 * has already arranged.
 */
export function CodePanel() {
  const store = useEditorStore();
  const doc = useDoc();
  const diagramId = useEditor((state) => state.diagramId);
  const readOnly = useEditor((state) => state.readOnly);
  const editor = useRef<CodeEditorHandle>(null);

  const [language, setLanguageState] = useState<CodeLanguage>(
    // Mermaid unless the diagram can only be said in PlantUML (a class diagram, say).
    () => loadLanguage(diagramId) ?? (generateCode(store.getState().doc!, "mermaid").ok ? "mermaid" : generateCode(store.getState().doc!, "plantuml").ok ? "plantuml" : "mermaid"),
  );
  const [texts, setTexts] = useState<Record<CodeLanguage, string>>(() => ({
    mermaid: loadDraft(diagramId, "mermaid"),
    plantuml: loadDraft(diagramId, "plantuml"),
  }));
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [liveIssue, setLiveIssue] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [managed, setManaged] = useState<ReadonlySet<Id> | null>(null);
  /** The text last written from the canvas, per language: what "stale" is measured against. */
  const [generated, setGenerated] = useState<Record<CodeLanguage, string | null>>(() => ({
    mermaid: loadGenerated(diagramId, "mermaid"),
    plantuml: loadGenerated(diagramId, "plantuml"),
  }));

  const text = texts[language];
  const { parsed, fresh } = useParsedCode(language, text, live ? LIVE_DELAY_MS : TYPING_DELAY_MS);

  /** Refs the asynchronous live path reads, so it always sees the latest values without re-running. */
  const managedRef = useRef<ReadonlySet<Id> | null>(null);
  const appliedRef = useRef<CodeParse | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const own = useCallback((ids: ReadonlySet<Id> | null) => {
    managedRef.current = ids;
    setManaged(ids);
  }, []);

  /* Drafts survive tab switches and reloads. */
  useEffect(() => {
    saveDraft(diagramId, language, text);
  }, [diagramId, language, text]);
  useEffect(() => {
    saveLanguage(diagramId, language);
  }, [diagramId, language]);
  useEffect(() => {
    saveGenerated(diagramId, "mermaid", generated.mermaid);
    saveGenerated(diagramId, "plantuml", generated.plantuml);
  }, [diagramId, generated]);

  const setText = (value: string, forLanguage: CodeLanguage = language) => setTexts((current) => ({ ...current, [forLanguage]: value }));

  /** Replaces the editor's text, with an Undo in the toast when there was text worth keeping. */
  const replaceText = (value: string, forLanguage: CodeLanguage, message: string) => {
    const previous = texts[forLanguage];
    setLanguageState(forLanguage);
    setText(value, forLanguage);
    setNotice(null);
    if (previous.trim() && previous !== value) {
      toast(message, { action: { label: "Undo", onClick: () => setText(previous, forLanguage) } });
    }
  };

  /* ------------------------------------------------------- applying */

  const current = (): CodeParse => (fresh && parsed ? parsed : parseCode(language, text));

  /** The canvas now says what the editor's text says, so "changed since" is measured from here. */
  const markSynced = useCallback(
    (forLanguage: CodeLanguage) => {
      const written = generateCode(store.getState().doc!, forLanguage);
      if (written.ok) setGenerated((previous) => ({ ...previous, [forLanguage]: written.text }));
    },
    [store],
  );

  const run = async (mode: CodeApplyMode) => {
    if (busy || readOnly) return;
    const result = current();
    setBusy(true);
    const outcome = await applyCode(store, result, mode, {});
    setBusy(false);
    announce(outcome, mode);
    if (outcome.status === "applied" || outcome.status === "unchanged") {
      appliedRef.current = result;
      if (mode === "replace") {
        own(new Set(outcome.plan.owned));
        markSynced(language);
      }
    }
  };

  const toggleLive = (on: boolean) => {
    setLive(on);
    setLiveIssue(null);
    if (!on) return;
    // Going live must not rewrite the canvas by itself: the text on screen counts as applied until it changes.
    const snapshot = current();
    appliedRef.current = snapshot;
    own(snapshot.empty ? new Set() : new Set(matchCodeIds(store.getState().doc!, snapshot.imported).values()));
  };

  /* Live mode: when the text has settled and reads without errors, apply it. */
  useEffect(() => {
    if (!live || !parsed || !fresh || parsed.hasErrors || parsed.empty || readOnly) return;
    if (appliedRef.current === parsed) return;
    appliedRef.current = parsed;
    chain.current = chain.current.then(async () => {
      const outcome = await applyCode(store, parsed, "replace", { managed: managedRef.current ?? undefined });
      if (outcome.status === "applied" || outcome.status === "unchanged") {
        own(new Set(outcome.plan.owned));
        markSynced(parsed.language);
        setLiveIssue(null);
      } else if (outcome.status === "skipped") {
        // Held back (a drag is in progress): try the same text again shortly.
        appliedRef.current = null;
        window.setTimeout(() => setRetry((value) => value + 1), RETRY_MS);
      } else {
        setLiveIssue(outcome.reason);
      }
    });
  }, [live, parsed, fresh, readOnly, store, own, markSynced, retry]);

  /* A summary of what Apply would do, against the document as it is (deferred, so agents streaming edits do not make typing lag). */
  const shownDoc = useDeferredValue(doc);
  const preview = useMemo(() => {
    if (!parsed || !fresh || parsed.empty) return null;
    try {
      return planCodeApply(shownDoc, parsed.imported, "replace", live && managed ? { managed } : {});
    } catch {
      return null;
    }
  }, [shownDoc, parsed, fresh, live, managed]);

  /* ------------------------------------------------------ generating */

  /** What each language says about the canvas as it is now (deferred, like the preview above). */
  const generations = useMemo(() => ({ mermaid: generateCode(shownDoc, "mermaid"), plantuml: generateCode(shownDoc, "plantuml") }), [shownDoc]);
  const available = generations[language];
  const alternative = generations[OTHER[language]];
  const hasShapes = Object.keys(shownDoc.nodes).length > 0;

  /** Writes the canvas as text into the editor. `quiet` is the automatic first fill: no toast, no notice. */
  const fillFromDiagram = (quiet: boolean) => {
    const current = store.getState().doc!;
    const result = generateCode(current, language);
    if (!result.ok) {
      if (!quiet) setNotice({ kind: "unsupported", language, reason: result.reason, example: result.example });
      return;
    }
    if (quiet) setText(result.text);
    else {
      replaceText(result.text, language, `Editor text replaced with the diagram's ${LANGUAGE_NAME[language]}.`);
      setNotice({ kind: "note", text: result.note });
    }
    setGenerated((previous) => ({ ...previous, [language]: result.text }));
    // The text mirrors the canvas, so everything on it is the code's to change.
    appliedRef.current = null;
    own(new Set(Object.keys(current.nodes)));
  };
  const generate = () => fillFromDiagram(false);

  /* An empty editor shows the diagram it belongs to, so the tab opens with something to read and edit. */
  const filled = useRef(new Set<CodeLanguage>());
  useEffect(() => {
    if (filled.current.has(language) || !hasShapes || texts[language].trim() !== "") return;
    filled.current.add(language);
    fillFromDiagram(true);
    // Runs when the language or the presence of shapes changes; the other values are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, hasShapes]);

  /** The diagram says something different now than when the text was written. */
  const stale = generated[language] !== null && available.ok && available.text !== generated[language];
  const edited = generated[language] !== null && text !== generated[language];

  const examples = CODE_EXAMPLES[language];
  const marks = useMemo(
    () => (fresh && parsed ? parsed.diagnostics.map((diagnostic) => ({ line: diagnostic.line, severity: diagnostic.severity })) : []),
    [fresh, parsed],
  );
  const hasText = text.trim() !== "";
  const nothing = !hasText || (fresh && parsed?.empty === true);

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2">
        <Segmented
          label="Language"
          value={language}
          options={LANGUAGES}
          onChange={(value) => {
            setLanguageState(value);
            setNotice(null);
          }}
          className="flex-1"
        />
        <Menu
          align="end"
          trigger={
            <Button size="md" variant="secondary" className="shrink-0">
              Examples
              <ChevronDown className="size-3.5" />
            </Button>
          }
        >
          <MenuLabel>{language === "mermaid" ? "Mermaid" : "PlantUML"} examples</MenuLabel>
          {examples.map((example) => (
            <MenuItem key={example.id} icon={<FileCode />} onSelect={() => replaceText(example.code, language, `Loaded the ${example.title.toLowerCase()} example.`)}>
              {example.title}
            </MenuItem>
          ))}
        </Menu>
      </div>

      {notice ? (
        <div className="rounded-lg border border-line bg-sunken/60 p-2.5 text-[12px] text-ink-2">
          {notice.kind === "note" ? (
            <p>{notice.text}</p>
          ) : (
            <>
              <p>{notice.reason}</p>
              <pre className="my-2 overflow-x-auto rounded-md bg-raised p-2 font-mono text-[11px] leading-snug text-ink">{notice.example}</pre>
              <Button size="sm" variant="secondary" onClick={() => replaceText(notice.example, notice.language, `Loaded the ${LANGUAGE_NAME[notice.language]} example.`)}>
                Use this example
              </Button>
            </>
          )}
        </div>
      ) : null}

      {!available.ok && hasShapes ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-3">
          <span>
            {LANGUAGE_NAME[language]} cannot express this diagram.
            {alternative.ok ? ` ${LANGUAGE_NAME[OTHER[language]]} can.` : " Neither format can say all of it; Generate explains why."}
          </span>
          {alternative.ok ? (
            <button
              type="button"
              onClick={() => {
                setLanguageState(OTHER[language]);
                setNotice(null);
              }}
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Switch to {LANGUAGE_NAME[OTHER[language]]}
            </button>
          ) : null}
        </p>
      ) : null}

      {stale ? (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-line bg-sunken/60 p-2.5 text-[12px] text-ink-2">
          <RefreshCw className="mt-px size-3.5 shrink-0 text-warn" />
          <p className="min-w-0 flex-1">
            The diagram changed since this text was written{edited ? ", and so did the text. Applying it now would overwrite those changes" : ""}.
          </p>
          <Button size="sm" variant="secondary" className="shrink-0" onClick={generate}>
            Regenerate
          </Button>
        </div>
      ) : null}

      <CodeEditor
        ref={editor}
        label={`${language === "mermaid" ? "Mermaid" : "PlantUML"} source`}
        value={text}
        onChange={(value) => setText(value)}
        marks={marks}
        placeholder={PLACEHOLDERS[language]}
        onSubmit={() => void run("replace")}
        className="min-h-[180px] flex-1"
      />

      {hasText && parsed ? (
        <div className="max-h-40 overflow-y-auto">
          <Status parsed={parsed} fresh={fresh} preview={preview} onJump={(line) => editor.current?.focusLine(line)} />
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">
          Write {language === "mermaid" ? "Mermaid" : "PlantUML"} here, pick an example, or generate text from the diagram. Tab indents; Esc leaves the editor.
        </p>
      )}
      {liveIssue ? <p className="text-[12px] text-danger">Live editing paused: {liveIssue}</p> : null}

      <div className="flex flex-col gap-2 border-t border-line pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <Tip label="Apply to the canvas shortly after you stop typing, whenever the text has no errors" side="top">
            <div className="min-w-0 flex-1">
              <Toggle label="Live" checked={live} onChange={toggleLive} />
            </div>
          </Tip>
          <Tip label={`Fill the editor with the ${LANGUAGE_NAME[language]} for this diagram`} side="top">
            <Button size="sm" variant="ghost" onClick={generate} className="shrink-0">
              <WandSparkles className="size-3.5" />
              Generate from diagram
            </Button>
          </Tip>
        </div>
        <div className="flex gap-2">
          <Tip label="Add this diagram to the right of what is on the canvas" side="top">
            <Button variant="secondary" className="flex-1" disabled={nothing || busy || readOnly} onClick={() => void run("insert")}>
              <ListPlus className="size-4" />
              Insert beside
            </Button>
          </Tip>
          <Tip label="Make the canvas match this text. Shapes you moved or styled keep their place; shapes that are not in the text are removed" side="top">
            <Button variant="primary" className="flex-1" disabled={nothing || busy || readOnly} onClick={() => void run("replace")}>
              <Replace className="size-4" />
              Apply to canvas
            </Button>
          </Tip>
        </div>
        {readOnly ? <p className="text-[12px] text-ink-3">You have view access, so the canvas cannot be changed from here.</p> : null}
      </div>
    </div>
  );
}
