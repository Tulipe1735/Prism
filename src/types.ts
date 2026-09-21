export type SnapshotActionKind = "click" | "fill" | "select" | "scroll" | "wait";

export interface SnapshotAction {
  id: string;
  kind: SnapshotActionKind;
  node?: number;
  role?: string;
  label: string;
  value?: string;
  current_value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  delta?: number;
  rect?: { x: number; y: number; w: number; h: number };
}

export interface Snapshot {
  url: string;
  title: string;
  w: number;
  h: number;
  text: string;
  scroll: { y: number; height: number };
  actions: SnapshotAction[];
  marker: unknown;
  page_key: unknown;
  guards: Record<string, unknown>;
  omitted_actions: number;
}

export interface BrowserElement {
  index: string;
  label: string;
  role?: string;
  value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  operations: string[];
  options?: Array<{ index: string; label: string; value: string }>;
}

export interface ActionSpace {
  elements: BrowserElement[];
  targets: Record<string, Record<string, SnapshotAction>>;
  controls: Record<string, SnapshotAction>;
}

export interface HistoryEntry {
  step: number;
  action: string;
  kind: SnapshotActionKind;
  choice: string;
  probability: number;
  confidence: number;
  latency_ms: number;
  text: string | null;
  text_helper: string | null;
  text_latency_ms: number;
  operation: string;
  target: string | null;
  page_changed: boolean | null;
  url: string;
  usage: Record<string, unknown>;
  executed_ms: number;
  elapsed_ms: number;
}

export interface Decision {
  choice: string;
  operation: string;
  target: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  operationProbabilities: Record<string, number>;
  targetProbabilities: Record<string, number>;
  targetConfidence: number | null;
  rawAnswers: unknown;
  model: string;
  usage: Record<string, unknown>;
  latencyMs: number;
  request: unknown;
}

export interface ModelUsage {
  model: string;
  usage: Record<string, unknown>;
  latencyMs: number;
}

export type TaskStatus = "done" | "blocked" | "unverified" | "failed";
