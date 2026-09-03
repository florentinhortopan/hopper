import type { LiveColumnId } from "@attatta/shared";

/** Future chat surfaces (Teams, Slack, …) can reuse the same router. */
export type LiveChatSource = "workspace" | "teams" | "slack" | "api";

export type RoutedLiveIntent =
  | { kind: "prepare"; column: "magic" }
  | { kind: "generate"; column: "magic" }
  | { kind: "package"; column: "celtra" }
  | { kind: "keep"; column: "hopper"; cellId: string }
  | { kind: "kill"; column: "hopper"; cellId: string }
  | { kind: "brief"; column: "magic"; text: string }
  | { kind: "note"; column: LiveColumnId; text: string }
  | { kind: "unknown"; column: LiveColumnId; text: string; hint: string };

const SLASH_HINT =
  "/prepare · /generate · /keep <cell> · /kill <cell> · /package · /brief … · /note [column] …";

/**
 * Deterministic routing for slash commands + light keyword heuristics.
 * LLM routing (when configured) may refine free-text before this runs,
 * or call this as a fallback.
 */
export function routeLiveChatText(
  raw: string,
  opts?: { defaultColumn?: LiveColumnId },
): RoutedLiveIntent {
  const text = raw.trim();
  const fallback = opts?.defaultColumn ?? "hopper";
  if (!text) {
    return { kind: "unknown", column: fallback, text: "", hint: SLASH_HINT };
  }

  if (text.startsWith("/")) {
    const [cmdRaw, ...rest] = text.slice(1).split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    const arg = rest.join(" ").trim();

    if (cmd === "prepare" || cmd === "recheck") {
      return { kind: "prepare", column: "magic" };
    }
    if (cmd === "generate" || cmd === "gen") {
      return { kind: "generate", column: "magic" };
    }
    if (cmd === "package" || cmd === "pack") {
      return { kind: "package", column: "celtra" };
    }
    if ((cmd === "keep" || cmd === "kill") && arg) {
      return {
        kind: cmd,
        column: "hopper",
        cellId: arg,
      };
    }
    if (cmd === "brief" && arg) {
      return { kind: "brief", column: "magic", text: arg };
    }
    if (cmd === "note" || cmd === "magic" || cmd === "hopper" || cmd === "celtra") {
      let column: LiveColumnId = fallback;
      let body = arg;
      if (cmd === "magic" || cmd === "hopper" || cmd === "celtra") {
        column = cmd;
        body = arg;
      } else if (
        arg.startsWith("magic ") ||
        arg.startsWith("hopper ") ||
        arg.startsWith("celtra ")
      ) {
        const [col, ...bits] = arg.split(/\s+/);
        column = col as LiveColumnId;
        body = bits.join(" ").trim();
      }
      if (!body) {
        return {
          kind: "unknown",
          column,
          text,
          hint: "Add a note after /note or /magic|/hopper|/celtra",
        };
      }
      return { kind: "note", column, text: body };
    }
    return {
      kind: "unknown",
      column: fallback,
      text,
      hint: SLASH_HINT,
    };
  }

  // Free text heuristics (LLM can override upstream)
  const lower = text.toLowerCase();
  if (/\b(prepare|re-?check|import)\b/.test(lower)) {
    return { kind: "prepare", column: "magic" };
  }
  if (/\b(generate|gen\b|run comfy|fill sizes)\b/.test(lower)) {
    return { kind: "generate", column: "magic" };
  }
  if (/\b(package|celtra|export zip|download pack)\b/.test(lower)) {
    return { kind: "package", column: "celtra" };
  }
  if (/\b(brief|offer|audience|cta)\b/.test(lower)) {
    return { kind: "brief", column: "magic", text };
  }
  if (/\b(keep|kill|review|approve|reject)\b/.test(lower)) {
    return {
      kind: "note",
      column: "hopper",
      text,
    };
  }
  return { kind: "note", column: fallback, text };
}

export const LIVE_CHAT_SLASH_HINT = SLASH_HINT;
