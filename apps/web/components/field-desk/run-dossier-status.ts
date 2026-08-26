/** Empty-state copy must distinguish an active read-only phase from a settled Run. */
export function effectAuthorityEmptyMessage(orchestrationActive: boolean): string {
  return orchestrationActive
    ? "The initial read-only evidence is still running. A bounded effect proposal will appear here after browser and workspace observation settle."
    : "No effect is awaiting authority. Decisions, consumption, and recovery stay visible in the durable log below.";
}
