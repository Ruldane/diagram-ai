"use client";

import { useEffect, useState } from "react";

import { parseCode, type CodeParse } from "@/core/code/parse";
import type { CodeLanguage } from "@/core/code/types";

interface Parsed {
  language: CodeLanguage;
  text: string;
  result: CodeParse;
}

/**
 * Parses editor text off the typing path: after `delay` ms without a change,
 * and then when the browser is idle, so a 50 000 character paste never makes
 * a keystroke wait for the parser.
 *
 * `parsed` keeps the previous result while a new one is on its way, so the
 * preview does not flash empty; `fresh` says whether it belongs to the text
 * that is in the editor now.
 */
export function useParsedCode(language: CodeLanguage, text: string, delay: number): { parsed: CodeParse | null; fresh: boolean } {
  const [state, setState] = useState<Parsed | null>(null);

  useEffect(() => {
    let idle: number | undefined;
    // Empty text needs no waiting: the preview should clear as soon as the editor does.
    const timer = window.setTimeout(
      () => {
        const run = () => setState({ language, text, result: parseCode(language, text) });
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: 800 });
        else run();
      },
      text.trim() ? delay : 0,
    );
    return () => {
      window.clearTimeout(timer);
      if (idle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
    };
  }, [language, text, delay]);

  const fresh = state !== null && state.language === language && state.text === text;
  return { parsed: state?.result ?? null, fresh };
}
