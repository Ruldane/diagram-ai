import type { ChatEngineId, LocalChatEngineId } from "./protocol";

/**
 * What a person agrees to before the assistant drives a CLI they have
 * installed. One constant, read by the dialog (to show it) and by the server
 * (to require the matching header), so the two cannot drift. Bump the version
 * when the wording changes: everyone is asked again.
 */
export const BRIDGE_TERMS_VERSION = 1;

/** Sent with each request to a local CLI engine, as `<engine>:<version>`. */
export const BRIDGE_ACK_HEADER = "x-diagram-ai-bridge-ack";

export const bridgeAck = (engine: ChatEngineId): string => `${engine}:${BRIDGE_TERMS_VERSION}`;

export interface BridgeTerms {
  title: string;
  /** Short statements, shown as a list. */
  points: string[];
  confirm: string;
}

const COMMON = [
  "This starts the program that is already installed on this computer, the way you would start it yourself, and lets it use this diagram's tools.",
  "Diagram AI never reads, copies or stores your login. It only asks the program whether you are signed in.",
  "It is for your own use, on this computer, while you are sitting at it. Do not share your login or expose this app to other people or a network.",
];

export const BRIDGE_TERMS: Record<LocalChatEngineId, BridgeTerms> = {
  "claude-code": {
    title: "Use your Claude Code login",
    points: [
      ...COMMON,
      "Requests count against the usage allowance of your own Claude plan, the same as using Claude Code directly.",
      "Anthropic's terms say a login is personal: it must not be shared, and a consumer plan must not be used commercially. You are responsible for following the terms that apply to your plan, which can change.",
    ],
    confirm: "I understand, use Claude Code",
  },
};
