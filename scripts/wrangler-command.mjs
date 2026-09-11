import { createRequire } from "node:module";
import { join } from "node:path";

// Invoke the installed CLI directly: .bin shims are not executables on Windows.
export function wranglerCommand(args, root = process.cwd()) {
  const require = createRequire(join(root, "package.json"));
  return {
    command: process.execPath,
    args: [require.resolve("wrangler/bin/wrangler.js"), ...args],
  };
}
