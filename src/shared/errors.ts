export class ConfigError extends Error {
  override name = "ConfigError";
}

export class ModelOutputError extends Error {
  override name = "ModelOutputError";
}

export class InvalidActionError extends Error {
  override name = "InvalidActionError";
}

/** A web target the kernel refuses to touch: not a public HTTP(S) destination. */
export class UnsafeTargetError extends Error {
  override name = "UnsafeTargetError";
}

export class WebFetchError extends Error {
  override name = "WebFetchError";
}
