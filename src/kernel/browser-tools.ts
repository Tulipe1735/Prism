import type { SnapshotActionKind } from "../shared/types.ts";
import type { ObservationView } from "./browser/tool.ts";
import type { Tool, ToolResult } from "./tool.ts";
import type { BrowserEngine, JsonValue } from "./types.ts";
import { BrowserTool, BrowserToolError } from "./browser/tool.ts";
import { missingArgument, readString } from "./tool-support.ts";

/**
 * The browser as the kernel's tools: one session per page, observation
 * references, validated single-step actions and durable input receipts.
 *
 * The kernel loop decides when to allow a call (04): `browser_open` and
 * `browser_act` declare a `browser-action` effect, so the
 * `browser.actionsNeedApproval` switch turns each of them into one approval.
 * Observation reads declare nothing and stay outside the scope, like file
 * reads.
 */
export interface BrowserToolsOptions {
  /** Receipts and session records; the kernel uses `<dataDir>/browser`. */
  directory: string;
  engine?: BrowserEngine;
  /** Chromium only: take over a running Chrome/Edge over CDP. */
  endpoint?: string;
  headless?: boolean;
}

export interface BrowserTools {
  tools: Tool[];
  /** Closes every open page and engine, without failing on an already-gone browser. */
  close: () => Promise<void>;
}

const ACTION_KINDS: SnapshotActionKind[] = [
  "click",
  "fill",
  "select",
  "scroll",
  "wait",
];
const SCOPES = ["local", "relations", "structural"] as const;

export function createBrowserTools(options: BrowserToolsOptions): BrowserTools {
  const browser = new BrowserTool(options);
  /** Last page URL per browser session, so an approval names a real target. */
  const pages = new Map<string, string>();

  const open: Tool = {
    name: "browser_open",
    description:
      "Opens a page in a new browser session and returns its session id. The browser runs headless and its tabs belong to the kernel.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Page to open." } },
      required: ["url"],
      additionalProperties: false,
    },
    effects: (args) => {
      const url = readString(args, "url");
      return url === undefined || url === ""
        ? []
        : [{ kind: "browser-action", action: "open", target: url }];
    },
    execute: async (args) => {
      const url = readString(args, "url");
      if (url === undefined || url === "") return missingArgument("url");
      return run(async () => {
        const opened = await browser.open({ url });
        pages.set(opened.session, opened.url);
        return opened;
      });
    },
  };

  const observe: Tool = {
    name: "browser_observe",
    description:
      "Takes a fresh observation of the page: its state, its coverage, and the targets that can be acted on. Copy the observation, evidence and target refs exactly; every action needs the refs of the latest observation.",
    parameters: {
      type: "object",
      properties: {
        session: { type: "string", description: "Browser session from browser_open." },
        scope: {
          type: "string",
          enum: [...SCOPES],
          description:
            "How much evidence to collect per target: local (default), relations or structural.",
        },
      },
      required: ["session"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const session = readString(args, "session");
      if (session === undefined || session === "") return missingArgument("session");
      const scope = readScope(args);
      if (scope === null)
        return {
          content: `"scope" must be one of ${SCOPES.join(", ")}.`,
          isError: true,
        };
      return run(async () => {
        const view = await browser.observe(session, scope);
        pages.set(session, view.page.url);
        return view;
      });
    },
  };

  const context: Tool = {
    name: "browser_context",
    description:
      "Reads one target again with more evidence: its current state, the text around it and its relations. Use it when the observation does not show enough to decide.",
    parameters: {
      type: "object",
      properties: {
        session: { type: "string", description: "Browser session from browser_open." },
        observation: {
          type: "string",
          description: "Observation the target comes from.",
        },
        target: { type: "string", description: "Target reference to read." },
        scope: {
          type: "string",
          enum: [...SCOPES],
          description: "Evidence scope; defaults to relations.",
        },
      },
      required: ["session", "observation", "target"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const session = readString(args, "session");
      if (session === undefined || session === "") return missingArgument("session");
      const observation = readString(args, "observation");
      if (observation === undefined || observation === "")
        return missingArgument("observation");
      const target = readString(args, "target");
      if (target === undefined || target === "") return missingArgument("target");
      const scope = readScope(args);
      if (scope === null)
        return {
          content: `"scope" must be one of ${SCOPES.join(", ")}.`,
          isError: true,
        };
      return run(() => browser.context(session, { observation, target, scope }));
    },
  };

  const act: Tool = {
    name: "browser_act",
    description:
      'Executes one offered action on one target: click, fill, select, scroll or wait. Pass the observation, evidence and target refs of a fresh observation, and a new request_id you choose. Read the receipt in the result: "executed" means the browser acknowledged the input, not that the task succeeded. If the outcome is unknown, ask for the receipt again with the same request_id and inspect the page before deciding what to do.',
    parameters: {
      type: "object",
      properties: {
        session: { type: "string", description: "Browser session from browser_open." },
        observation: {
          type: "string",
          description: "Observation the target comes from.",
        },
        target: { type: "string", description: "Target reference to act on." },
        evidence: { type: "string", description: "Evidence reference of that target." },
        operation: {
          type: "string",
          enum: [...ACTION_KINDS],
          description:
            "Operation to run; it must be the operation offered for the target.",
        },
        value: {
          type: "string",
          description: 'Text for "fill", including an explicit empty string.',
        },
        request_id: {
          type: "string",
          description:
            "Identifier of this decision, unique per action; repeating it returns the recorded receipt instead of running again.",
        },
      },
      required: [
        "session",
        "observation",
        "target",
        "evidence",
        "operation",
        "request_id",
      ],
      additionalProperties: false,
    },
    effects: (args) => {
      const operation = readString(args, "operation");
      if (operation === undefined || operation === "") return [];
      const session = readString(args, "session") ?? "";
      const target = readString(args, "target") ?? "";
      const page = pages.get(session);
      return [
        {
          kind: "browser-action",
          action: operation,
          target: page === undefined ? target : `${page} (${target})`,
        },
      ];
    },
    execute: async (args) => {
      const session = readString(args, "session");
      if (session === undefined || session === "") return missingArgument("session");
      const observation = readString(args, "observation");
      if (observation === undefined || observation === "")
        return missingArgument("observation");
      const target = readString(args, "target");
      if (target === undefined || target === "") return missingArgument("target");
      const evidence = readString(args, "evidence");
      if (evidence === undefined || evidence === "") return missingArgument("evidence");
      const operation = readString(args, "operation");
      if (!isActionKind(operation))
        return {
          content: `"operation" must be one of ${ACTION_KINDS.join(", ")}.`,
          isError: true,
        };
      const requestId = readString(args, "request_id");
      if (requestId === undefined || requestId === "")
        return missingArgument("request_id");
      const value = readString(args, "value");
      return run(async () => {
        const result = await browser.act(session, {
          observation,
          target,
          evidence,
          operation,
          request_id: requestId,
          ...(value === undefined ? {} : { value }),
        });
        notePage(result.post_observation, pages, session);
        return result;
      });
    },
  };

  const receipt: Tool = {
    name: "browser_receipt",
    description:
      "Reads the recorded receipt of an action by its request_id. A missing receipt never proves the action was not requested; inspect the page.",
    parameters: {
      type: "object",
      properties: {
        session: { type: "string", description: "Browser session from browser_open." },
        request_id: { type: "string", description: "Request id to look up." },
      },
      required: ["session", "request_id"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const session = readString(args, "session");
      if (session === undefined || session === "") return missingArgument("session");
      const requestId = readString(args, "request_id");
      if (requestId === undefined || requestId === "")
        return missingArgument("request_id");
      return run(async () => {
        const saved = await browser.receipt(session, requestId);
        return (
          saved ?? {
            receipt: null,
            note: `No receipt is recorded for request-id "${requestId}". A missing receipt does not prove the action was never requested; observe the page.`,
          }
        );
      });
    },
  };

  const close: Tool = {
    name: "browser_close",
    description:
      "Closes a browser session and its tab. Observations of it stop working.",
    parameters: {
      type: "object",
      properties: {
        session: { type: "string", description: "Browser session to close." },
      },
      required: ["session"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const session = readString(args, "session");
      if (session === undefined || session === "") return missingArgument("session");
      return run(async () => {
        await browser.close(session);
        pages.delete(session);
        return { closed: session };
      });
    },
  };

  return {
    tools: [open, observe, context, act, receipt, close],
    close: () => browser.closeAll(),
  };
}

/** Runs one browser call and turns failures into results the model can act on. */
async function run<T>(work: () => Promise<T>): Promise<ToolResult> {
  try {
    return { content: JSON.stringify(await work()) };
  } catch (error) {
    if (error instanceof BrowserToolError)
      return { content: `${error.code}: ${error.message}`, isError: true };
    return {
      content: `The browser call failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

function readScope(args: JsonValue): "local" | "relations" | "structural" | null {
  const scope = readString(args, "scope");
  if (scope === undefined) return "local";
  return (SCOPES as readonly string[]).includes(scope)
    ? (scope as "local" | "relations" | "structural")
    : null;
}

function isActionKind(value: string | undefined): value is SnapshotActionKind {
  return value !== undefined && (ACTION_KINDS as readonly string[]).includes(value);
}

/** Keeps the approval target of the next action pointing at the current page. */
function notePage(
  post:
    { status: "captured"; data: ObservationView } | { status: "failed" } | undefined,
  pages: Map<string, string>,
  session: string,
): void {
  if (post?.status === "captured") pages.set(session, post.data.page.url);
}
