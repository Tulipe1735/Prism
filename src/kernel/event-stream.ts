import type { ServerResponse } from "node:http";
import type { KernelEvent } from "./events.ts";
import { randomUUID } from "node:crypto";

/** Bounded in-memory replay; a new process or expired cursor requests a snapshot. */
export class EventJournal {
  private readonly epoch = randomUUID();
  private sequence = 0;
  private readonly capacity: number;
  private readonly frames: { id: string; event: KernelEvent }[] = [];

  constructor(capacity = 512) {
    this.capacity = capacity;
  }

  publish(event: KernelEvent): string {
    const frame = { id: `${this.epoch}:${++this.sequence}`, event };
    this.frames.push(frame);
    if (this.frames.length > this.capacity) this.frames.shift();
    return this.encode(frame.id, event);
  }

  resume(response: ServerResponse, cursor?: string): void {
    if (cursor === undefined) return;
    const index = this.frames.findIndex((frame) => frame.id === cursor);
    if (index === -1) {
      response.write(
        this.encode(`${this.epoch}:${this.sequence}`, { type: "stream.reset" }),
      );
      return;
    }
    for (const frame of this.frames.slice(index + 1))
      response.write(this.encode(frame.id, frame.event));
  }

  private encode(id: string, event: KernelEvent): string {
    return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }
}
