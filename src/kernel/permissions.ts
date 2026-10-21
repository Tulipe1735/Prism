import type { PermissionScope } from "./types.ts";

import type { WorkspacePath } from "./workspace-path.ts";
import { resolve } from "node:path";

import { resolveWorkspacePath } from "./workspace-path.ts";

/** Why an action leaves the scope, what it touches and what that implies. */
export interface ApprovalRequest {
  reason: string;
  target: string;
  impact: string;
}

/**
 * What one tool call does that the policy judges. Reading is never refused in
 * v1, so no read action exists; the policy judges actions rather than tool
 * names, so a new tool is covered by declaring what its calls touch.
 */
export type PermissionAction =
  | { kind: "file-write"; path: string }
  | { kind: "command"; command: string }
  | { kind: "browser-action"; action: string; target: string };

export type PermissionDecision =
  | { outcome: "allow" }
  | { outcome: "approval"; request: ApprovalRequest }
  | { outcome: "deny"; reason: string };

/** The verdict on one tool call; a refusal is text the model reads. */
export type Authorization = { allowed: true } | { allowed: false; refusal: string };

/** Settings the kernel owns for every session it serves. */
export interface PermissionSettings {
  scope: PermissionScope;
  browserActionsNeedApproval: boolean;
}

/**
 * Decides whether an action may run. The settings live on the policy, so a
 * scope the user switches mid-task applies to the next action; the workspace
 * comes from the session, because one kernel serves sessions in many
 * workspaces. Paths are compared as written: v1 has no OS sandbox and does not
 * follow symlinks.
 */
export class PermissionPolicy {
  scope: PermissionScope;
  browserActionsNeedApproval: boolean;

  constructor(settings: PermissionSettings) {
    this.scope = settings.scope;
    this.browserActionsNeedApproval = settings.browserActionsNeedApproval;
  }

  decide(action: PermissionAction, workspace: string): PermissionDecision {
    switch (action.kind) {
      case "file-write":
        return this.decideFileWrite(
          resolveWorkspacePath(workspace, action.path),
          workspace,
        );
      case "command":
        return this.scope === "read-only"
          ? { outcome: "deny", reason: "the read-only scope never runs commands" }
          : { outcome: "allow" };
      case "browser-action":
        return this.browserActionsNeedApproval
          ? {
              outcome: "approval",
              request: {
                reason: "Browser actions need approval in the settings",
                target: action.target,
                impact: `Runs the browser action "${action.action}" on ${action.target}.`,
              },
            }
          : { outcome: "allow" };
    }
  }

  /**
   * Checks every action a call declares and asks the user once for each action
   * that leaves the scope. Nothing is remembered: the next call decides again.
   * A call that holds any denied action is refused before the user is asked.
   */
  async authorizeAll(
    actions: PermissionAction[],
    input: {
      workspace: string;
      requestApproval: (request: ApprovalRequest) => Promise<boolean>;
    },
  ): Promise<Authorization> {
    const decisions = new Map<string, PermissionDecision>();
    for (const action of actions) {
      const key = JSON.stringify(action);
      if (!decisions.has(key)) decisions.set(key, this.decide(action, input.workspace));
    }
    const planned = [...decisions.values()];
    const denied = planned.find((decision) => decision.outcome === "deny");
    if (denied?.outcome === "deny")
      return {
        allowed: false,
        refusal: `Permission denied: ${denied.reason} The action was not executed; change your approach or report the limitation instead of retrying it.`,
      };

    for (const decision of planned) {
      if (decision.outcome !== "approval") continue;
      const approved = await input.requestApproval(decision.request);
      if (!approved)
        return {
          allowed: false,
          refusal: `The user refused approval, so the action was not executed: ${buildApprovalReason(decision.request)} Do not ask again; change your approach or report the limitation instead.`,
        };
    }
    return { allowed: true };
  }

  private decideFileWrite(
    target: WorkspacePath,
    workspace: string,
  ): PermissionDecision {
    if (this.scope === "read-only")
      return {
        outcome: "deny",
        reason: `the read-only scope never writes files (${target.path})`,
      };
    if (this.scope === "workspace-write" && !target.inside) {
      return {
        outcome: "approval",
        request: {
          reason: "Writes a file outside the workspace",
          target: target.path,
          impact: `Creates or overwrites ${target.path}, outside the workspace ${resolve(workspace)}.`,
        },
      };
    }
    return { outcome: "allow" };
  }
}

function buildApprovalReason(request: ApprovalRequest): string {
  return `${request.reason} (${request.target}).`;
}

/** One line for the system prompt, so the model plans inside the current scope. */
export function describeScope(scope: PermissionScope): string {
  switch (scope) {
    case "read-only":
      return "read-only: file writes and commands are refused, and approval cannot lift them; only the user can widen the scope";
    case "workspace-write":
      return "workspace-write: writes inside the workspace need no approval, every write outside it asks the user once";
    case "full-access":
      return "full-access: writes anywhere and commands run without approval";
  }
}
