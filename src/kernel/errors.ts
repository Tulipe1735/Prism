export type KernelErrorCode =
  | "INVALID_REQUEST"
  | "SESSION_NOT_FOUND"
  | "APPROVAL_NOT_FOUND"
  | "TASK_RUNNING"
  | "CREATOR_DISABLED"
  | "PLUGIN_NOT_FOUND"
  | "PLUGIN_FAILED";

/** A refused operation; the transport maps the code to an HTTP status. */
export class KernelError extends Error {
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.name = "KernelError";
    this.code = code;
  }
}
