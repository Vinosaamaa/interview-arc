import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      // Bindings (ASSETS, IMAGES, DB) are read from the discovered
      // Wrangler config. Local development deliberately omits Cloudflare
      // Access because localhost cannot receive an Access JWT; production
      // builds and deploys continue to use the protected `wrangler.jsonc`.
      cloudflare({
        configPath: command === "serve" ? "wrangler.dev.jsonc" : "wrangler.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
    ],
  };
});
