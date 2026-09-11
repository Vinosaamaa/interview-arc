import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Invoke the installed CLI directly: .bin shims are not executables on Windows.
export function wranglerCommand(args, root = process.cwd()) {
  const require = createRequire(join(root, "package.json"));
  const metadataPath = require.resolve("wrangler/package.json");
  const { bin } = JSON.parse(readFileSync(metadataPath, "utf8"));
  return {
    command: process.execPath,
    args: [resolve(dirname(metadataPath), typeof bin === "string" ? bin : bin.wrangler), ...args],
  };
}
