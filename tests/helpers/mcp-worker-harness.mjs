import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export function availableMcpPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error
        ? reject(error)
        : resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

export function runMcpCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)));
  });
}

export function sanitizeMcpWorkerDiagnostic(value, sensitivePaths = []) {
  let sanitized = String(value ?? "");
  const replacements = [
    ...sensitivePaths.map((path) => [path, "<local-path>"]),
    [homedir(), "~"],
  ]
    .filter(([path]) => typeof path === "string" && path.length > 0)
    .sort(([left], [right]) => right.length - left.length);

  for (const [path, replacement] of replacements) {
    sanitized = sanitized.replaceAll(path, replacement);
  }

  return sanitized
    .replace(/\bauthorization\s*[:=]\s*[^\r\n]+/giu, "Authorization=<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <redacted>")
    .replace(/\b(password|secret|token)\s*[:=]\s*\S+/giu, "$1=<redacted>")
    .trim();
}

export function startMcpWorker({ wrangler, config, persistence, project, port }) {
  const child = spawn(wrangler, [
    "dev",
    "--local",
    "--persist-to",
    persistence,
    "--config",
    config,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
  ], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnosticTail = "";
  const append = (chunk) => {
    diagnosticTail = `${diagnosticTail}${chunk}`.slice(-16_384);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.once("error", (error) => append(`\nWorker spawn error: ${error.stack ?? error.message}\n`));
  return {
    child,
    readDiagnosticTail: () => sanitizeMcpWorkerDiagnostic(
      diagnosticTail,
      [project, persistence, config],
    ),
  };
}

export async function stopMcpWorker(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

function startupError(message, readDiagnosticTail) {
  const diagnosticTail = readDiagnosticTail?.();
  return new Error(`${message}\nWrangler diagnostics:\n${diagnosticTail || "<no output captured>"}`);
}

export async function waitForMcpWorker(baseUrl, child, readDiagnosticTail) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw startupError(
        `Local MCP Worker exited ${child.exitCode} before startup.`,
        readDiagnosticTail,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/mcp`);
      if (response.status === 401 || response.status === 405) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw startupError("Local MCP Worker did not start.", readDiagnosticTail);
}

export async function connectMcpClient(baseUrl, token, name) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}
