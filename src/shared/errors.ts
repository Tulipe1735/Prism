export class ConfigError extends Error {
  override name = "ConfigError";
}

export class ModelOutputError extends Error {
  override name = "ModelOutputError";
}

export class InvalidActionError extends Error {
  override name = "InvalidActionError";
}
