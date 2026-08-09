import { createServer } from "node:net";

const MCP_INTEGRATION_LOCK_HOST = "127.0.0.1";
const MCP_INTEGRATION_LOCK_PORT = 41731;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function acquireMcpIntegrationLock() {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const server = createServer();
    const acquired = await new Promise((resolve, reject) => {
      server.once("error", (error) => {
        if (error?.code === "EADDRINUSE") resolve(false);
        else reject(error);
      });
      server.listen({
        host: MCP_INTEGRATION_LOCK_HOST,
        port: MCP_INTEGRATION_LOCK_PORT,
        exclusive: true,
      }, () => resolve(true));
    });
    if (acquired) {
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      };
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the local MCP integration lock.");
}
