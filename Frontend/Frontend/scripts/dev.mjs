import { spawn } from "node:child_process";

const apiUrl = process.env.NEXT_PUBLIC_RUNOFF_API_URL ?? "http://127.0.0.1:8000";
const frontendRoot = new URL("..", import.meta.url);
const backendRoot = new URL("../../../backend/", import.meta.url);
const children = [];

async function apiIsRunning() {
  try {
    const response = await fetch(`${apiUrl}/api/health`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  return child;
}

if (!(await apiIsRunning())) {
  launch(
    process.env.PYTHON ?? "python",
    ["server.py"],
    backendRoot,
  );
} else {
  console.log(`Runoff Debt API already available at ${apiUrl}`);
}

const next = launch(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["exec", "next", "dev"],
  frontendRoot,
);

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

next.on("exit", (code) => {
  shutdown("SIGTERM");
  process.exitCode = code ?? 0;
});
