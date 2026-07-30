import { spawn } from "node:child_process";

const environment = { ...process.env };
const inheritedTemporaryDirectory =
  environment.TEMP ?? environment.TMP ?? environment.TMPDIR ?? "";
const usesWindowsMountFromLinux =
  process.platform === "linux" && /^\/mnt\/[a-z]\//i.test(inheritedTemporaryDirectory);

if (!environment.TMPDIR && usesWindowsMountFromLinux) {
  environment.TMPDIR = "/tmp";
}

const executable = process.platform === "win32" ? "vitest.cmd" : "vitest";
const child = spawn(executable, ["run", ...process.argv.slice(2)], {
  env: environment,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
