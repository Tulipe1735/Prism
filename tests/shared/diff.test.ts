import { expect, it } from "vitest";
import { unifiedDiff } from "../../src/shared/diff.ts";

it("renders a unified diff with the hunk header, removals and additions", () => {
  const diff = unifiedDiff("one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n", {
    path: "src/app.ts",
  });
  expect(diff).toBe(
    [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "+four",
    ].join("\n"),
  );
});

it("marks a file that did not exist before the write", () => {
  const diff = unifiedDiff("", "first\nsecond\n", {
    path: "src/new.ts",
    created: true,
  });
  expect(diff).toBe(
    ["--- /dev/null", "+++ b/src/new.ts", "@@ -0,0 +1,2 @@", "+first", "+second"].join(
      "\n",
    ),
  );
});

it("reports no change as an empty diff", () => {
  expect(unifiedDiff("same\n", "same\n", { path: "a.txt" })).toBe("");
});

it("cuts a long diff at the line limit and says so", () => {
  const before = Array.from({ length: 50 }, (_value, index) => `old ${index}`).join(
    "\n",
  );
  const after = Array.from({ length: 50 }, (_value, index) => `new ${index}`).join(
    "\n",
  );
  const diff = unifiedDiff(`${before}\n`, `${after}\n`, {
    path: "big.txt",
    maxLines: 4,
  });
  expect(diff.split("\n").slice(0, 3)).toEqual([
    "--- a/big.txt",
    "+++ b/big.txt",
    "@@ -1,50 +1,50 @@",
  ]);
  expect(diff).toContain("-old 0");
  expect(diff).not.toContain("-old 49");
  expect(diff).toContain("[diff cut after 4 lines]");
});
