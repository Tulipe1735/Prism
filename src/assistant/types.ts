export type Role = "intelligence" | "qa";
export type Effort = "normal" | "deep";
export type TaskStatus =
  | "queued"
  | "running"
  | "waiting-device"
  | "awaiting-confirmation"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type SourceKind =
  "notion" | "file" | "gmail" | "github" | "arxiv" | "web" | "course";

export interface Document {
  id: string;
  source: SourceKind;
  title: string;
  url: string;
  content: string;
  version?: string;
  updatedAt: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Citation {
  documentId: string;
  title: string;
  url: string;
  locator: string;
  excerpt: string;
  version?: string;
}

export interface MemoryEntry {
  id: string;
  kind:
    | "progress"
    | "question"
    | "preference"
    | "correction"
    | "experience"
    | "reading"
    | "course";
  text: string;
  status: "confirmed" | "tentative";
  sourceTaskId?: string;
  sourceDocumentIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  id?: string;
  message: string;
  role?: Role;
  effort?: Effort;
  conversationId?: string;
  source?: string;
  confirmedMemoryIds?: string[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens?: number;
}

export interface TaskEvent {
  at: string;
  kind: string;
  message: string;
}

export interface TaskRecord {
  id: string;
  message: string;
  role: Role;
  effort: Effort;
  conversationId: string;
  source: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  deadlineAt?: string;
  answer: string;
  citations: Citation[];
  events: TaskEvent[];
  usage: Usage;
  costCny: number;
  error?: string;
  artifacts?: string[];
  messages?: ModelMessage[];
  confirmedMemoryIds?: string[];
}

export interface Delivery {
  key: string;
  body: string;
  sourceDocumentIds?: string[];
  canonicalIds?: string[];
  status: "pending" | "sent" | "unknown" | "failed" | "silent";
  createdAt: string;
  updatedAt: string;
  providerId?: string;
  error?: string;
}

export interface Budget {
  month: string;
  limitCny: number;
  infrastructureCny: number;
  spentCny: number;
  reservedCny: number;
  availableCny: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ModelReply {
  message: ModelMessage;
  usage: Usage;
  finishReason?: string;
}

export interface Model {
  complete: (
    messages: ModelMessage[],
    tools: ToolDefinition[],
    options: { signal: AbortSignal; maxOutputTokens: number },
  ) => Promise<ModelReply>;
}

export interface ToolContext {
  taskId: string;
  role: Role;
  signal: AbortSignal;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

export interface LocalJob {
  id: string;
  taskId: string;
  command: Record<string, unknown>;
  status: "pending" | "claimed" | "completed" | "unknown" | "failed";
  workerId?: string;
  result?: unknown;
  deadlineAt?: string;
  createdAt: string;
  updatedAt: string;
}
