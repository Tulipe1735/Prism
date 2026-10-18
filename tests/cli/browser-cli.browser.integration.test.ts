import type { BrowserConnection } from "../../src/browser/connect.ts";
import type { TargetEvidence } from "../../src/browser/evidence.ts";
import type { PublicState } from "../../src/browser/state.ts";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";

interface Target extends TargetEvidence {
  ref: string;
  operation: string;
  option_value?: string;
  option_label?: string;
}
interface View {
  session: string;
  observation: string;
  evidence: string;
  targets: Target[];
  state: PublicState;
}
interface Reply {
  ok: boolean;
  data: any;
  error?: { code: string };
}
const browserUrl = process.env.PRISM_IT_BROWSER_URL ?? "http://127.0.0.1:9333";
const entry = resolve(process.env.PRISM_CLI_TEST_ENTRY ?? "src/interfaces/cli.ts");

describe.runIf(process.env.PRISM_EVAL_CHROME === "1")(
  "external-agent browser CLI (no model calls)",
  () => {
    let directory: string;
    let url: string;
    let connection: BrowserConnection;
    const openedSessions: string[] = [];
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Prism CLI contract test</title>
      <section><h2 id="group">Alpha</h2><article><p>Plan</p><button onclick="window.clicks++; document.querySelector('[role=status]').textContent='Clicks '+window.clicks">Choose</button></article></section>
      <section><h2 id="noise">Unrelated</h2><p>Other area</p></section>
      <form><label>Name <input id="name"></label><label>Region <select id="region"><option value="eu">Europe</option><option value="us">America</option></select></label></form>
      <label>Accept <input id="accept" type="checkbox"></label>
      <button disabled>Locked</button><input aria-label="Read only" readonly value="Read">
      <label>Single <select id="single"><option value="">Only</option></select></label>
      <button role="tab" aria-selected="false" onclick="this.setAttribute('aria-selected','true')">Details tab</button>
      <details><summary>Disclosure</summary><p>Details</p></details>
      <input type="password" aria-label="Private password" value="password-secret">
      <input type="file" aria-label="Private file"><input type="hidden" value="hidden-secret">
      <button hidden>Hidden control</button><button aria-hidden="true">Inaccessible</button>
      <button aria-label="Public name"><span aria-hidden="true">secret-name</span>Public</button>
      <p role="status">Ready</p><p role="alert">Review required</p>
      <div style="height:1800px"></div><button>Offscreen control</button><script>window.clicks=0</script>`);
    });
    async function cli(args: string[], input?: string): Promise<Reply> {
      const runtime = entry.endsWith(".ts")
        ? ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"]
        : [];
      return new Promise((resolveReply, reject) => {
        const child = execFile(
          process.execPath,
          [...runtime, entry, ...args, "--state-dir", directory],
          {
            timeout: 40_000,
            maxBuffer: 2_000_000,
            env: { ...process.env, TYPESAFE_API_KEY: "", TEXT_MODEL_API_KEY: "" },
          },
          (error, stdout, stderr) => {
            try {
              const reply = JSON.parse(stdout.trim()) as Reply;
              resolveReply(reply);
            } catch {
              reject(
                new Error(`${error?.message ?? "Invalid reply"}\n${stdout}\n${stderr}`),
              );
            }
          },
        );
        if (input !== undefined) child.stdin!.end(input);
      });
    }
    async function inspect(expression: string) {
      const targets = await connection.client.send("Target.getTargets");
      const target = targets.targetInfos.find(
        (item: { url: string }) => item.url === url,
      );
      if (!target) throw new Error("Owned test tab not found");
      const attached = await connection.client.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      try {
        const response = await connection.client.send(
          "Runtime.evaluate",
          { expression, returnByValue: true },
          attached.sessionId,
        );
        if (response.exceptionDetails)
          throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
      } finally {
        await connection.client.send("Target.detachFromTarget", {
          sessionId: attached.sessionId,
        });
      }
    }
    async function openSession(): Promise<string> {
      const reply = await cli([
        "session",
        "open",
        "--url",
        url,
        "--browser-url",
        browserUrl,
      ]);
      expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
      openedSessions.push(reply.data.session);
      return reply.data.session;
    }
    async function observe(session: string, scope = "local"): Promise<View> {
      const reply = await cli(["observe", "--session", session, "--scope", scope]);
      expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
      return reply.data;
    }
    function action(
      view: View,
      target: Target,
      request: string,
      evidence = view.evidence,
      value?: string,
    ) {
      return {
        command: "act",
        session: view.session,
        observation: view.observation,
        target: target.ref,
        evidence,
        operation: target.operation,
        request_id: request,
        ...(value !== undefined ? { value } : {}),
      };
    }
    async function act(command: object) {
      return cli(["act", "--stdin"], JSON.stringify(command));
    }

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "prism-cli-browser-"));
      await new Promise<void>((resolveListen) =>
        server.listen(0, "127.0.0.1", resolveListen),
      );
      const address = server.address() as { port: number };
      url = `http://127.0.0.1:${address.port}/`;
      connection = await connectBrowser(parseBrowserUrl(browserUrl));
    });
    afterEach(async () => {
      for (const session of openedSessions.splice(0))
        await cli(["session", "close", "--session", session]);
    });
    afterAll(async () => {
      if (directory) await cli(["daemon", "stop"]).catch(() => {});
      await connection?.close();
      const closing = new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      server.closeAllConnections();
      await closing;
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it("runs fill/select/click across short-lived commands and deduplicates concurrent input", async () => {
      const session = await openSession();
      let view = await observe(session);
      let target = view.targets.find((item) => item.operation === "fill")!;
      expect(
        (await act(action(view, target, "fill1", view.evidence, "Ada"))).data.receipt
          .outcome,
      ).toBe("executed");
      expect(await inspect("document.querySelector('#name').value")).toBe("Ada");
      const expired = await act(action(view, target, "expired", view.evidence, "Bad"));
      expect(expired.error?.code).toBe("OBSERVATION_EXPIRED");
      view = await observe(session);
      target = view.targets.find(
        (item) => item.operation === "select" && item.option_value === "us",
      )!;
      expect(target).toBeDefined();
      expect((await act(action(view, target, "select1"))).data.receipt.outcome).toBe(
        "executed",
      );
      expect(await inspect("document.querySelector('#region').value")).toBe("us");
      view = await observe(session, "structural");
      expect(
        view.targets.find((item) => item.operation === "select")?.state.value,
      ).toBe("us");
      target = view.targets.find(
        (item) => item.operation === "click" && item.description === 'button "Choose"',
      )!;
      const command = action(view, target, "click1");
      const replies = await Promise.all([act(command), act(command)]);
      expect(replies.every((reply) => reply.data.receipt.outcome === "executed")).toBe(
        true,
      );
      expect(replies.map((reply) => reply.data.replayed).sort()).toEqual([false, true]);
      expect(await inspect("window.clicks")).toBe(1);
      view = await observe(session);
      target = view.targets.find((item) => item.operation === "wait")!;
      expect((await act(action(view, target, "wait1"))).data.receipt.code).toBe(
        "WAIT_COMPLETED",
      );
      view = await observe(session);
      target = view.targets.find((item) => item.operation === "scroll")!;
      expect((await act(action(view, target, "scroll1"))).data.receipt.outcome).toBe(
        "executed",
      );
      await observe(session); // Uses the executor's post-input settling policy.
      await expect
        .poll(() => inspect("window.scrollY"), { timeout: 2000 })
        .toBeGreaterThan(0);
      expect((await cli(["session", "close", "--session", session])).ok).toBe(true);
      expect(
        (await cli(["receipt", "--session", session, "--request-id", "click1"])).data
          .receipt.outcome,
      ).toBe("executed");
    });

    it("reads result controls and messages without granting state-only input authority", async () => {
      const session = await openSession();
      const view = await observe(session);
      expect(view.state).toMatchObject({
        source: "dom",
        coverage: { scope: "viewport", truncated: false },
      });
      expect(view.state.controls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Accept", role: "checkbox", checked: false }),
          expect.objectContaining({ name: "Locked", disabled: true }),
          expect.objectContaining({ name: "Read only", readonly: true, value: "Read" }),
          expect.objectContaining({
            name: "Single",
            value: "",
            selected_options: [{ value: "", label: "Only" }],
          }),
          expect.objectContaining({ name: "Details tab", selected: false }),
          expect.objectContaining({ name: "Disclosure", expanded: false }),
        ]),
      );
      expect(view.state.messages).toEqual(
        expect.arrayContaining([
          { role: "status", text: "Ready" },
          { role: "alert", text: "Review required" },
        ]),
      );
      expect(view).not.toHaveProperty("page.status");
      expect(
        view.targets.some(
          (target) =>
            target.description.includes("Locked") ||
            target.description.includes("Single"),
        ),
      ).toBe(false);
      for (const name of [
        "Private password",
        "Private file",
        "Hidden control",
        "Inaccessible",
        "Offscreen control",
        "secret-name",
        "password-secret",
        "hidden-secret",
      ])
        expect(JSON.stringify(view.state)).not.toContain(name);
      const refused = await act({
        command: "act",
        session,
        observation: view.observation,
        evidence: view.evidence,
        target: "state:Locked",
        operation: "click",
        request_id: "state-only",
      });
      expect(refused.error?.code).toBe("TARGET_NOT_OFFERED");
      expect(refused.data.receipt.outcome).toBe("not_executed");
      expect(refused.data).not.toHaveProperty("post_observation");
    });

    it("verifies checkbox and empty field effects using current post-observation refs", async () => {
      const session = await openSession();
      let view = await observe(session);
      let target = view.targets.find(
        (item) => item.description === 'checkbox "Accept"',
      )!;
      expect(target.state.checked).toBe(false);
      let reply = await act(action(view, target, "check"));
      expect(reply.data.post_observation.status).toBe("captured");
      view = reply.data.post_observation.data;
      expect(
        view.state.controls.find((control) => control.name === "Accept")?.checked,
      ).toBe(true);
      expect(await inspect("document.querySelector('#accept').checked")).toBe(true);
      target = view.targets.find((item) => item.description === 'checkbox "Accept"')!;
      expect(target.state.checked).toBe(true);
      reply = await act(action(view, target, "uncheck"));
      view = reply.data.post_observation.data;
      expect(
        view.state.controls.find((control) => control.name === "Accept")?.checked,
      ).toBe(false);
      target = view.targets.find(
        (item) => item.operation === "fill" && item.description === 'textbox "Name"',
      )!;
      reply = await act(action(view, target, "type", view.evidence, "Ada"));
      view = reply.data.post_observation.data;
      target = view.targets.find(
        (item) => item.operation === "fill" && item.description === 'textbox "Name"',
      )!;
      expect(target.state.value).toBe("Ada");
      reply = await act(action(view, target, "clear", view.evidence, ""));
      expect(
        reply.data.post_observation.data.state.controls.find(
          (control: { name: string }) => control.name === "Name",
        )?.value,
      ).toBe("");
      expect(await inspect("document.querySelector('#name').value")).toBe("");
      const replay = await act(action(view, target, "clear", view.evidence, ""));
      expect(replay.data.replayed).toBe(true);
      expect(replay.data).not.toHaveProperty("post_observation");
    });

    it("shares visible image names and multiline values between targets and result state", async () => {
      const session = await openSession();
      await inspect(
        `document.body.innerHTML = ${JSON.stringify(`<button id="confirm"><img width="20" height="20" alt="Confirm" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20'/%3E%3C/svg%3E"><span hidden>Secret</span></button><div role="textbox" contenteditable="true" aria-label="Message"><div>Line1</div><div>Line2</div></div>`)}`,
      );
      let view = await observe(session);
      const image = view.state.controls.find((control) => control.name === "Confirm")!;
      const { name, role, ...imageState } = image;
      expect(
        view.targets.find(
          (target) => target.description === `${role} ${JSON.stringify(name)}`,
        )?.state,
      ).toEqual(imageState);
      expect(JSON.stringify(view.targets)).not.toContain("Secret");
      let editor = view.targets.find((target) => target.operation === "fill")!;
      expect(editor.description).toBe('textbox "Message"');
      expect(editor.state.value).toBe("Line1\nLine2");
      expect(
        view.state.controls.find((control) => control.name === "Message")?.value,
      ).toBe(editor.state.value);
      const reply = await act(
        action(view, editor, "multiline", view.evidence, "First\nSecond"),
      );
      expect(reply.data.receipt.outcome).toBe("executed");
      view = reply.data.post_observation.data;
      editor = view.targets.find((target) => target.operation === "fill")!;
      expect(editor.state.value).toBe("First\nSecond");
      expect(
        view.state.controls.find((control) => control.name === "Message")?.value,
      ).toBe(editor.state.value);
      await inspect("document.querySelector('#confirm').disabled=true");
      view = await observe(session);
      expect(
        view.state.controls.find((control) => control.name === "Confirm")?.disabled,
      ).toBe(true);
      expect(
        view.targets.some((target) => target.description === 'button "Confirm"'),
      ).toBe(false);
    });

    it("rejects a non-first selected option change using the shared complete selection state", async () => {
      const session = await openSession();
      await inspect(
        `document.body.innerHTML = ${JSON.stringify('<label>Regions <select id="regions" multiple><option value="a" selected>Alpha</option><option value="b" selected>Beta</option><option value="c">Gamma → More</option></select></label>')}`,
      );
      let view = await observe(session);
      let target = view.targets.find((item) => item.option_value === "c")!;
      expect(target.description).toBe('combobox "Regions"');
      expect(target.option_label).toBe("Gamma → More");
      const {
        name: _name,
        role: _role,
        ...state
      } = view.state.controls.find((control) => control.name === "Regions")!;
      expect(target.state).toEqual(state);
      expect(target.state.selected_options).toEqual([
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ]);
      await inspect("document.querySelector('#regions').options[1].selected=false");
      let reply = await act(action(view, target, "changed-selection"));
      expect(reply.data.receipt.outcome).toBe("not_executed");
      expect(reply.error?.code).toBe("EVIDENCE_CHANGED");
      expect(
        await inspect(
          "[...document.querySelector('#regions').selectedOptions].map(option=>option.value)",
        ),
      ).toEqual(["a"]);
      view = await observe(session);
      target = view.targets.find((item) => item.option_value === "c")!;
      reply = await act(action(view, target, "current-selection"));
      expect(reply.data.receipt.outcome).toBe("executed");
      expect(
        reply.data.post_observation.data.state.controls.find(
          (control: { name: string }) => control.name === "Regions",
        ).selected_options,
      ).toEqual([{ value: "c", label: "Gamma → More" }]);
    });

    it("refuses select input when the shared selection state is truncated", async () => {
      const session = await openSession();
      await inspect(
        "document.body.innerHTML='<label>Many <select multiple>'+Array.from({length:52},(_,i)=>'<option value='+i+(i<51?' selected':'')+'>Item '+i+'</option>').join('')+'</select></label>'",
      );
      const view = await observe(session);
      const target = view.targets.find((item) => item.option_value === "51")!;
      expect(target.state.selected_options).toHaveLength(50);
      expect(target.state.truncated).toBe(true);
      const reply = await act(action(view, target, "incomplete-selection"));
      expect(reply.error?.code).toBe("EVIDENCE_TRUNCATED");
      expect(reply.data.receipt.outcome).toBe("not_executed");
      expect(
        await inspect("document.querySelector('select').selectedOptions.length"),
      ).toBe(51);
    });

    it("exposes selected, expanded and mixed state and rejects state changes before input", async () => {
      const session = await openSession();
      let view = await observe(session);
      let target = view.targets.find(
        (item) => item.description === 'tab "Details tab"',
      )!;
      let reply = await act(action(view, target, "tab"));
      view = reply.data.post_observation.data;
      expect(
        view.targets.find((item) => item.description === 'tab "Details tab"')?.state
          .selected,
      ).toBe(true);
      target = view.targets.find((item) => item.description === 'button "Disclosure"')!;
      reply = await act(action(view, target, "expand"));
      view = reply.data.post_observation.data;
      expect(
        view.targets.find((item) => item.description === 'button "Disclosure"')?.state
          .expanded,
      ).toBe(true);
      await inspect("document.querySelector('#accept').indeterminate=true");
      view = await observe(session);
      target = view.targets.find((item) => item.description === 'checkbox "Accept"')!;
      expect(target.state.checked).toBe("mixed");
      expect(
        view.state.controls.find((control) => control.name === "Accept")?.checked,
      ).toBe("mixed");
      await inspect("document.querySelector('#accept').indeterminate=false");
      reply = await act(action(view, target, "stale-mixed"));
      expect(reply.data.receipt.outcome).toBe("not_executed");
      expect(reply.error?.code).toBe("EVIDENCE_CHANGED");
      expect(await inspect("document.querySelector('#accept').checked")).toBe(false);
    });

    it("reports state omissions and clipped values explicitly", async () => {
      const session = await openSession();
      await inspect(
        "document.body.innerHTML='<input aria-label=Long value='+JSON.stringify('x'.repeat(2100))+'>'+Array.from({length:260},(_,i)=>'<button style=position:fixed;left:0;top:40px>Item '+i+'</button>').join('')",
      );
      const view = await observe(session);
      expect(view.state.coverage).toMatchObject({
        controls: { total: 261, returned: 250, omitted: 11 },
        truncated: true,
      });
      const value = view.state.controls.find((control) => control.name === "Long");
      expect(value?.value).toHaveLength(2000);
      expect(value?.truncated).toBe(true);
      expect(view.state.controls).toHaveLength(250);
    });

    it("refuses changed relation evidence on a fresh target but tolerates unrelated page changes", async () => {
      const session = await openSession();
      let view = await observe(session);
      let target = view.targets.find((item) => item.operation === "click")!;
      expect(target.context.local).toBe("Plan");
      const context = await cli([
        "context",
        "--session",
        session,
        "--observation",
        view.observation,
        "--target",
        target.ref,
        "--scope",
        "relations",
      ]);
      expect(
        context.data.relations.map((item: { text: string }) => item.text),
      ).toContain("Alpha");
      await inspect("document.querySelector('#group').textContent='Beta'");
      const reply = await act(
        action(view, target, "stale-relation", context.data.evidence),
      );
      expect(reply).toMatchObject({
        ok: false,
        error: { code: "EVIDENCE_CHANGED" },
        data: { receipt: { outcome: "not_executed" } },
      });
      expect(await inspect("window.clicks")).toBe(0);
      view = await observe(session, "relations");
      target = view.targets.find((item) => item.operation === "click")!;
      expect(target.relations!.map((item) => item.text)).toContain("Beta");
      await inspect("document.querySelector('#noise').textContent='Updated elsewhere'");
      expect(
        (await act(action(view, target, "fresh-relation"))).data.receipt.outcome,
      ).toBe("executed");
      expect(await inspect("window.clicks")).toBe(1);
      view = await observe(session);
      target = view.targets.find((item) => item.operation === "click")!;
      await inspect("document.querySelector('#group').textContent='Gamma'");
      expect(
        (await act(action(view, target, "local-does-not-bind-group"))).data.receipt
          .outcome,
      ).toBe("executed");
      expect(await inspect("window.clicks")).toBe(2);
      await cli(["session", "close", "--session", session]);
    });

    it("expires old refs on re-observation and keeps receipts readable after broker shutdown", async () => {
      const session = await openSession();
      const old = await observe(session);
      let latest = await observe(session);
      expect(
        (
          await act(
            action(
              old,
              old.targets.find((item) => item.operation === "click")!,
              "old-view",
            ),
          )
        ).error?.code,
      ).toBe("OBSERVATION_EXPIRED");
      await inspect(
        "document.querySelector('button').replaceWith(document.querySelector('button').cloneNode(true))",
      );
      expect(
        (
          await act(
            action(
              latest,
              latest.targets.find((item) => item.operation === "click")!,
              "replaced-node",
            ),
          )
        ).error?.code,
      ).toBe("TARGET_CHANGED");
      expect(await inspect("window.clicks")).toBe(0);
      latest = await observe(session);
      expect(
        (
          await act(
            action(
              latest,
              latest.targets.find((item) => item.operation === "click")!,
              "durable",
            ),
          )
        ).data.receipt.outcome,
      ).toBe("executed");
      expect((await cli(["daemon", "stop"])).ok).toBe(true);
      const reply = await cli([
        "receipt",
        "--session",
        session,
        "--request-id",
        "durable",
      ]);
      expect(reply.data.receipt.outcome).toBe("executed");
      const targets = await connection.client.send("Target.getTargets");
      expect(
        targets.targetInfos.filter((item: { url: string }) => item.url === url),
      ).toHaveLength(0);
    });
  },
);
