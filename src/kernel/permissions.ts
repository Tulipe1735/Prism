import { isAbsolute, relative, resolve } from "node:path";

import type { PermissionScope } from "./types.ts";

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
 * follow symlinks (ADR-0005).
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
        return this.decideFileWrite(resolve(workspace, action.path), workspace);
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
      default:
        return { outcome: "allow" };
    }
  }

  /**
   * Checks every action a call declares and asks the user once for each action
   * that leaves the scope. Nothing is remembered: the next call decides again.
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
    for (const decision of decisions.values()) {
      if (decision.outcome === "deny")
        return {
          allowed: false,
          refusal: `Permission denied: ${decision.reason} The action was not executed; change your approach or report the limitation instead of retrying it.`,
        };
      if (decision.outcome === "approval") {
        const reason = buildApprovalReason(decision.request);
        const approved = await input.requestApproval(decision.request);
        if (!approved)
          return {
            allowed: false,
            refusal: `The user refused approval, so the action was not executed: ${reason} Do not ask again; change your approach or report the limitation instead.`,
          };
      }
    }
    return { allowed: true };
  }

  private decideFileWrite(path: string, workspace: string): PermissionDecision {
    if (this.scope === "read-only")
      return {
        outcome: "deny",
        reason: `the read-only scope never writes files (${path})`,
      };
    if (this.scope === "workspace-write" && !isInsideWorkspace(workspace, path)) {
      return {
        outcome: "approval",
        request: {
          reason: "Writes a file outside the workspace",
          target: path,
          impact: `Creates or overwrites ${path}, outside the workspace ${resolve(workspace)}.`,
        },
      };
    }
    return { outcome: "allow" };
  }
}

function buildApprovalReason(request: ApprovalRequest): string {
  return `${request.reason} (${request.target}).`;
}

/** True when `path` is the workspace itself or sits below it. */
function isInsideWorkspace(workspace: string, path: string): boolean {
  const inner = relative(resolve(workspace), path);
  return inner === "" || (!inner.startsWith("..") && !isAbsolute(inner));
}
