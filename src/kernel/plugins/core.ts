import type { Context } from "cordis";
import type { KernelOptions } from "../kernel.ts";
import { Approvals } from "../approvals.ts";
import { Attachments } from "../attachments.ts";
import { streamChat } from "../model.ts";
import { PermissionPolicy } from "../permissions.ts";
import { SessionStore } from "../session-store.ts";
import { WorkspaceTerminals } from "../terminal.ts";
import { ToolRegistry } from "../tools.ts";

export const configuration = {
  name: "configuration",
  apply(ctx: Context, options: KernelOptions) {
    ctx.provide("config", options.config);
  },
};

export const sessions = {
  name: "sessions",
  inject: ["config"],
  apply(ctx: Context) {
    ctx.provide("sessions", new SessionStore(ctx.config.dataDir));
  },
};

export const attachments = {
  name: "attachments",
  inject: ["config"],
  apply(ctx: Context) {
    ctx.provide("attachments", new Attachments(ctx.config.dataDir));
  },
};

export const terminals = {
  name: "terminals",
  apply(ctx: Context) {
    const service = new WorkspaceTerminals();
    ctx.effect(function* () {
      yield ctx.provide("terminals", service);
      yield () => service.close();
    });
  },
};

export const permissions = {
  name: "permissions",
  inject: ["config"],
  apply(ctx: Context, options: KernelOptions) {
    ctx.provide(
      "permissions",
      new PermissionPolicy({
        scope: options.scope ?? ctx.config.permissions.scope,
        browserActionsNeedApproval:
          options.browserActionsNeedApproval ?? ctx.config.browser.actionsNeedApproval,
      }),
    );
  },
};

export const approvals = {
  name: "approvals",
  apply(ctx: Context) {
    const service = new Approvals((event) => ctx.emit("prism/event", event));
    ctx.effect(function* () {
      yield ctx.provide("approvals", service);
      yield () => service.refuse();
    });
  },
};

export const model = {
  name: "model",
  inject: ["config"],
  apply(ctx: Context) {
    ctx.provide("model", {
      stream: (options) => streamChat({ ...options, model: ctx.config.model }),
    });
  },
};

export const tools = {
  name: "tools",
  apply(ctx: Context) {
    const registry = new ToolRegistry();
    ctx.effect(function* () {
      yield ctx.provide("tools", registry);
      yield () => registry.close();
    });
  },
};
