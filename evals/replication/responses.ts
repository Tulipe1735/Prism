import { appendFile } from "node:fs/promises";
import { digest } from "../runners/model.ts";

/** Passive observation only. Return the original Response; never alter a request or retry. */
export function installResponseRecorder(path: string): { close: () => Promise<void> } {
  const original = globalThis.fetch;
  const pending: Promise<void>[] = [];
  let write = Promise.resolve();
  const save = (record: object): Promise<void> => {
    write = write.then(() => appendFile(path, `${JSON.stringify(record)}\n`));
    return write;
  };
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://opencode.ai/zen/go/v1/chat/completions"))
      return original(url, init);
    const headers = new Headers(init?.headers);
    const request = JSON.parse(String(init?.body));
    const identity = {
      run_id: headers.get("x-opencode-session"),
      prompt_hash: digest(JSON.stringify(request.messages)),
      requested_model: request.model,
      started_at: new Date().toISOString(),
    };
    try {
      const response = await original(url, init);
      const clone = response.clone();
      // The clone drains asynchronously; the policy receives its original response immediately.
      pending.push(
        (async () => {
          try {
            const body: any = await clone.json();
            const message = body?.choices?.[0]?.message;
            await save({
              ...identity,
              status: response.status,
              model: body.model,
              usage: body.usage ?? null,
              finish_reason: body?.choices?.[0]?.finish_reason ?? null,
              content: message?.content ?? null,
              reasoning_content: message?.reasoning_content ?? null,
              provider_error: body?.error ?? null,
            });
          } catch {
            await save({
              ...identity,
              status: response.status,
              diagnostic: "UNREADABLE_RESPONSE",
              usage: null,
            });
          }
        })(),
      );
      return response;
    } catch (error) {
      pending.push(
        save({
          ...identity,
          status: null,
          diagnostic: error instanceof Error ? error.name : "TRANSPORT_ERROR",
          usage: null,
        }),
      );
      throw error;
    }
  };
  return {
    close: async () => {
      globalThis.fetch = original;
      await Promise.all(pending);
      await write;
    },
  };
}
