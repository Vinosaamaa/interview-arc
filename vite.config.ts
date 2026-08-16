import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";
import { installLocalPreviewGuards } from "./scripts/stabilize-local-preview.mjs";

// Vinext installs a process crash backstop at import time. Replace it after
// that import so a binary inspector JSON parse cannot kill `vinext dev`.
installLocalPreviewGuards();

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      // Bind IPv4 localhost so http://127.0.0.1:3000 works. Vite's default is
      // IPv6-only [::1], which makes the IPv4 address look "down".
      host: "127.0.0.1",
      port: 3000,
      strictPort: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      // Bindings (ASSETS, IMAGES, DB) are read from the discovered
      // Wrangler config. Local development deliberately omits Cloudflare
      // Access because localhost cannot receive an Access JWT; production
      // builds and deploys continue to use the protected `wrangler.jsonc`.
      cloudflare({
        configPath: command === "serve" ? "wrangler.dev.jsonc" : "wrangler.jsonc",
        // Miniflare's inspector proxy does `fetch(workerd/json).then(r => r.json())`
        // without a catch. Workerd sometimes returns binary bytes, vinext rethrows,
        // and the preview dies. Local UI work does not need that inspector.
        ...(command === "serve" ? { inspectorPort: false } : {}),
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
    ],
  };
});
