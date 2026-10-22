import type { IncomingMessage } from "node:http";
import type { Attachment } from "./session.ts";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "../shared/attachments.ts";
import { KernelError } from "./errors.ts";

const ATTACHMENT_ID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

/** File bytes stay local to the kernel, including when the renderer runs on Windows. */
export class Attachments {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async upload(
    sessionId: string,
    name: string,
    request: IncomingMessage,
  ): Promise<Attachment> {
    if (
      name === "" ||
      name === "." ||
      name === ".." ||
      /[\\/<>:"|?*]/.test(name) ||
      Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
      name.length > 240
    )
      throw new KernelError("INVALID_REQUEST", "文件名无效。");
    const id = randomUUID();
    const directory = join(this.dataDir, "attachments", sessionId, id);
    const path = join(directory, "files", name);
    await mkdir(join(directory, "files"), { recursive: true });
    try {
      const handle = await open(path, "wx");
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_ATTACHMENT_BYTES)
            throw new KernelError("INVALID_REQUEST", "单个文件不能超过 20 MB。");
          await handle.writeFile(chunk);
        }
      } finally {
        await handle.close();
      }
      const attachment: Attachment = {
        id,
        name,
        path,
        size,
        mediaType: request.headers["content-type"] ?? "application/octet-stream",
      };
      await writeFile(join(directory, "attachment.json"), JSON.stringify(attachment));
      return attachment;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async read(sessionId: string, ids: string[]): Promise<Attachment[]> {
    if (ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length)
      throw new KernelError("INVALID_REQUEST", "每条消息最多添加 10 个不同文件。");
    return Promise.all(
      ids.map(async (id) => {
        if (!ATTACHMENT_ID.test(id))
          throw new KernelError("INVALID_REQUEST", "附件标识无效。");
        const content = await readFile(
          join(this.dataDir, "attachments", sessionId, id, "attachment.json"),
          "utf8",
        ).catch(() => null);
        if (content === null)
          throw new KernelError("INVALID_REQUEST", "附件不存在，请重新添加文件。");
        return JSON.parse(content) as Attachment;
      }),
    );
  }

  async content(
    sessionId: string,
    id: string,
  ): Promise<{ attachment: Attachment; data: Uint8Array }> {
    const [attachment] = await this.read(sessionId, [id]);
    return { attachment: attachment!, data: await readFile(attachment!.path) };
  }

  removeSession(sessionId: string): Promise<void> {
    return rm(join(this.dataDir, "attachments", sessionId), {
      recursive: true,
      force: true,
    });
  }
}
