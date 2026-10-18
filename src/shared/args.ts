/** A port from a command-line option; `0` (the default) means "pick a free one". */
export function parsePort(value: string | undefined, option = "--port"): number {
  if (value === undefined) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(
      `${option} must be an integer between 0 and 65535, received ${value}`,
    );
  return port;
}
