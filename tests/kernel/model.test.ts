import type { ModelConfig } from "../../src/kernel/config.ts";
import type { ChatEvent, ChatMessage } from "../../src/kernel/model.ts";
import type { Attachment } from "../../src/kernel/session.ts";
import type { ThinkingEffort } from "../../src/kernel/types.ts";
import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { estimateContextTokens } from "../../src/kernel/compaction.ts";
import { streamChat, toModelMessages } from "../../src/kernel/model.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "prism-model-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function image(name: string, mediaType: string): Promise<Attachment> {
  const bytes = Buffer.from(PNG_BASE64, "base64");
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { id: name, name, path, size: bytes.length, mediaType };
}

function model(thinking: ThinkingEffort): ModelConfig {
  return {
    baseUrl: "https://api.deepseek.com/v1/",
    model: "deepseek-flash",
    apiKey: "sk-test",
    thinking,
  };
}

function sseResponse(chunks: unknown[]): Response {
  const frames = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(`${frames}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function delta(payload: Record<string, unknown>): unknown {
  return { choices: [{ delta: payload }] };
}

/** Runs one request and returns the body the transport sent with its events. */
async function run(
  options: { messages: ChatMessage[]; thinking: ThinkingEffort },
  chunks: unknown[],
): Promise<{ body: Record<string, unknown>; events: ChatEvent[] }> {
  let body: Record<string, unknown> = {};
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return sseResponse(chunks);
  }) as unknown as typeof fetch;
  const events: ChatEvent[] = [];
  for await (const event of streamChat({
    model: model(options.thinking),
    messages: options.messages,
    tools: [
      {
        name: "read_file",
        description: "Read one file.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    signal: new AbortController().signal,
    fetchImpl,
  }))
    events.push(event);
  return { body, events };
}

it("asks for the configured thinking effort and streams thinking apart from the answer", async () => {
  const { body, events } = await run(
    {
      thinking: "max",
      messages: [{ role: "user", content: "9.11 and 9.8, which is greater?" }],
    },
    [delta({ reasoning_content: "9.11 更大" }), delta({ content: "9.11" })],
  );

  expect(body.reasoning_effort).toBe("max");
  expect(events).toEqual([
    { type: "reasoning", text: "9.11 更大" },
    { type: "text", text: "9.11" },
  ]);
});

it("replays stored thinking on every assistant turn, with or without tool calls", async () => {
  const { body } = await run(
    {
      thinking: "high",
      messages: [
        { role: "user", content: "看看 src/app.ts" },
        { role: "assistant", content: "我先读文件", reasoning: "先确认文件存在" },
        { role: "user", content: "顺便看一下测试" },
        {
          role: "assistant",
          content: "",
          reasoning: "需要两个文件",
          toolCalls: [
            { id: "call-1", name: "read_file", arguments: '{"path":"src/app.ts"}' },
          ],
        },
        { role: "tool", content: "export {}", toolCallId: "call-1" },
      ],
    },
    [delta({ content: "done" })],
  );

  const messages = body.messages as Record<string, unknown>[];
  expect(messages[1]).toMatchObject({
    role: "assistant",
    content: "我先读文件",
    reasoning_content: "先确认文件存在",
  });
  expect(messages[3]).toMatchObject({
    role: "assistant",
    content: null,
    reasoning_content: "需要两个文件",
  });
  expect(messages[3]?.tool_calls).toHaveLength(1);
  // A message without stored thinking must not grow the field.
  expect(messages[0]).not.toHaveProperty("reasoning_content");
  expect(messages[4]).toEqual({
    role: "tool",
    tool_call_id: "call-1",
    content: "export {}",
  });
});

it("sends exact image bytes alongside text and other file metadata, preserving duplicate images", async () => {
  const first = await image("截图.png", "image/png; charset=binary");
  const second = await image("同一截图.PNG", "application/octet-stream");
  const document: Attachment = {
    id: "document",
    name: "notes.md",
    path: join(directory, "notes.md"),
    size: 12,
    mediaType: "text/markdown",
  };
  const messages = toModelMessages([
    {
      entryId: "user-1",
      role: "user",
      content: "比较这两张图",
      attachments: [first, document, second],
    },
  ]);
  const { body } = await run({ thinking: "high", messages }, [
    delta({ content: "好" }),
  ]);
  const sent = body.messages as Record<string, unknown>[];
  expect(sent[0]).toEqual({
    role: "user",
    content: [
      { type: "text", text: messages[0]?.content },
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
    ],
  });
  expect(messages[0]?.content).toContain("比较这两张图");
  expect(messages[0]?.content).toContain(document.path);
  expect(messages[0]?.content).toContain(first.path);
  expect(messages[0]?.content).toContain(second.path);
  expect(messages[0]?.content).not.toContain(PNG_BASE64);
});

it("keeps non-visual attachments and text-only requests as text", async () => {
  const messages = toModelMessages([
    { entryId: "plain", role: "user", content: "hello" },
    {
      entryId: "vector",
      role: "user",
      content: "读取矢量源码",
      attachments: [
        {
          id: "svg",
          name: "diagram.svg",
          path: join(directory, "diagram.svg"),
          size: 10,
          mediaType: "image/svg+xml",
        },
      ],
    },
  ]);
  const { body } = await run({ thinking: "high", messages }, [
    delta({ content: "好" }),
  ]);
  expect(body.messages).toEqual([
    { role: "user", content: "hello" },
    { role: "user", content: messages[1]?.content },
  ]);
  expect(messages[1]?.content).toContain("use file tools to inspect their contents");
});

it("fails before requesting the model when an attached image cannot be read", async () => {
  const attachment = await image("missing.png", "image/png");
  await rm(attachment.path);
  const fetchImpl = vi.fn<typeof fetch>();
  const request = streamChat({
    model: model("high"),
    messages: toModelMessages([
      { entryId: "user", role: "user", content: "", attachments: [attachment] },
    ]),
    signal: new AbortController().signal,
    fetchImpl,
  });
  await expect(request.next()).rejects.toThrow(
    /Could not read attached image.*missing\.png/,
  );
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("rejects image content outside user messages", async () => {
  const attachment = await image("screenshot.png", "image/png");
  await expect(
    run(
      {
        thinking: "high",
        messages: [{ role: "system", content: "", images: [attachment] }],
      },
      [],
    ),
  ).rejects.toThrow("Images can only be sent in user messages.");
});

it("counts image tokens without treating their base64 encoding as text", async () => {
  const attachment = await image("screenshot.png", "image/png");
  const messages = toModelMessages([
    { entryId: "user", role: "user", content: "看图", attachments: [attachment] },
  ]);
  const textOnly = messages.map(({ images: _images, ...message }) => message);
  expect(estimateContextTokens(messages) - estimateContextTokens(textOnly)).toBe(1_024);
  expect(estimateContextTokens(messages)).toBeLessThan(2_000);
});
