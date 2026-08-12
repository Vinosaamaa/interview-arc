import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLASSIFICATIONS = new Map([
  ["none", "none"],
  ["change note", "change-note"],
  ["adr", "adr"],
  ["architecture review", "architecture-review"],
  ["feature retrospective", "feature-retrospective"],
  ["postmortem", "postmortem"],
  ["capability dossier", "capability-dossier"],
]);

function selectedClassifications(body) {
  const selected = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*\[[xX]\]\s*(None|Change Note|ADR|Architecture Review|Feature Retrospective|Postmortem|Capability Dossier)(?:\s*[—-]\s*reason:\s*(.*))?\s*$/i);
    if (!match) continue;
    selected.push({ classification: CLASSIFICATIONS.get(match[1].toLowerCase()), reason: match[2]?.trim() ?? "" });
  }
  return selected;
}

export function validateEngineeringImpact({ body, changedFiles, recordTypes }) {
  const selected = selectedClassifications(body ?? "");
  if (selected.length !== 1) throw new Error("Select exactly one Engineering impact classification in the pull request body.");
  const choice = selected[0];
  if (choice.classification === "none") {
    if (!choice.reason || /replace|todo|n\/a|none/i.test(choice.reason) || choice.reason.length < 12) {
      throw new Error("Engineering impact `None` requires a concrete reason.");
    }
    if (recordTypes.length > 0) throw new Error("A canonical Engineering record changed, so Engineering impact cannot be `None`.");
    return { classification: "none", changedFiles };
  }
  if (recordTypes.length === 0) {
    throw new Error(`Engineering impact \`${choice.classification}\` requires a matching canonical record in this pull request.`);
  }
  const uniqueTypes = [...new Set(recordTypes)];
  if (uniqueTypes.length !== 1 || uniqueTypes[0] !== choice.classification) {
    throw new Error(`Engineering impact \`${choice.classification}\` does not match changed canonical record type(s): ${uniqueTypes.join(", ")}.`);
  }
  return { classification: choice.classification, changedFiles };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function recordTypeAt(path, head, base) {
  let markdown = "";
  for (const ref of [head, base]) {
    try {
      markdown = git(["show", `${ref}:${path}`]);
      break;
    } catch {}
  }
  const match = markdown.match(/^type:\s*(\S+)\s*$/m);
  if (!match) throw new Error(`Changed canonical Engineering record has no type: ${path}.`);
  return match[1];
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required.");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pullRequest = event.pull_request;
  if (!pullRequest?.base?.sha || !pullRequest?.head?.sha) throw new Error("Pull request base and head revisions are required.");
  const changedFiles = git(["diff", "--name-only", pullRequest.base.sha, pullRequest.head.sha]).split("\n").filter(Boolean);
  const recordPaths = changedFiles.filter((path) => path.startsWith("docs/engineering/records/") && path.endsWith(".md"));
  const result = validateEngineeringImpact({
    body: pullRequest.body ?? "",
    changedFiles,
    recordTypes: recordPaths.map((path) => recordTypeAt(path, pullRequest.head.sha, pullRequest.base.sha)),
  });
  process.stdout.write(`Engineering impact: ${result.classification}; ${result.changedFiles.length} changed file(s).\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
