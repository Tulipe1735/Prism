import { expect, it } from "vitest";
import {
  allowsWebAppUrl,
  webAppEditSchema,
  webAppOpenSchema,
} from "../../src/workbench/electron/web-app-policy.ts";

it("allows only declared HTTPS origins without embedded credentials", () => {
  const app = { origins: ["https://app.notion.com", "https://www.notion.so"] };
  for (const url of [
    "https://app.notion.com/page?q=1#section",
    "https://www.notion.so/login",
  ])
    expect(allowsWebAppUrl(app, url)).toBe(true);
  for (const url of [
    "http://app.notion.com/",
    "https://app.notion.com.evil.com/",
    "https://sub.app.notion.com/",
    "https://user@app.notion.com/",
    "https://app.notion.com:444/",
    "file:///tmp/page.html",
    "javascript:alert(1)",
    "https://example.com/",
  ])
    expect(allowsWebAppUrl(app, url), url).toBe(false);
});

it("rejects unknown open options and malformed or unbounded editing evidence", () => {
  const open = {
    plugin: "notion",
    id: "workspace",
    sessionId: "f8ab5f90-2ee0-4b8d-83cd-87b5fb0d6c82",
  };
  expect(webAppOpenSchema.safeParse(open).success).toBe(true);
  expect(
    webAppOpenSchema.safeParse({ ...open, preload: "/tmp/other.js" }).success,
  ).toBe(false);
  expect(webAppOpenSchema.safeParse({ ...open, sessionId: "missing" }).success).toBe(
    false,
  );
  const edit = {
    text: "replacement",
    guard: {
      token: "observed-token",
      url: "https://app.notion.com/page",
      content: "observed",
      selection: "observed",
    },
  };
  expect(webAppEditSchema.safeParse(edit).success).toBe(true);
  for (const guard of [
    { token: '\"] *' },
    { content: "x".repeat(200_001) },
    { selection: "x".repeat(50_001) },
    { script: "run()" },
  ])
    expect(
      webAppEditSchema.safeParse({ ...edit, guard: { ...edit.guard, ...guard } })
        .success,
    ).toBe(false);
  expect(webAppEditSchema.safeParse({ ...edit, text: "" }).success).toBe(false);
});
