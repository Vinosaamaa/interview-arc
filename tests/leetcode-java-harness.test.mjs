import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runner = path.join(repoRoot, "scripts", "leetcode-java-harness.mjs");

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), "interview-arc-java-harness-test-"));
  const source = path.join(root, "0001-example.java");
  await writeFile(source, "class Solution {}\n");
  return { root, source, env: { ...process.env, INTERVIEW_ARC_HARNESS_ROOT: path.join(root, "state") } };
}

function cli(args, env) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function prepareHarness({ activityId, signature, source, env }) {
  const result = cli([
    "prepare",
    "--activity-id", activityId,
    "--signature", signature,
    "--source", source,
  ], env);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function readyHarness({
  activityId,
  signature,
  sourceContent,
  sourceFileName = "Solution.java",
  mainClass = "HarnessMain",
  harnessFiles,
  quickCases,
  fullCases,
  runTimeoutMs = 2_000,
}) {
  const context = await sandbox();
  await writeFile(context.source, sourceContent);
  const prepared = prepareHarness({ activityId, signature, source: context.source, env: context.env });
  for (const [file, content] of Object.entries(harnessFiles)) {
    await writeFile(path.join(prepared.stagingDirectory, file), content);
  }
  await writeFile(path.join(prepared.stagingDirectory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    activityId,
    generationId: prepared.generationId,
    signatureHash: prepared.signatureHash,
    sourceFileName,
    mainClass,
    harnessFiles: Object.keys(harnessFiles),
    quickCases,
    fullCases,
    runTimeoutMs,
  }, null, 2)}\n`);
  const published = cli(["publish", "--activity-id", activityId, "--generation-id", prepared.generationId], context.env);
  assert.equal(published.status, 0, published.stderr);
  return { ...context, prepared };
}

test("prepare reserves one deterministic activity/signature generation and returns both stable run commands", async () => {
  const { source, env } = await sandbox();
  const args = [
    "prepare",
    "--activity-id", "activity-two-sum",
    "--signature", "0001|two-sum|int[] twoSum(int[],int)",
    "--source", source,
  ];

  const first = cli(args, env);
  assert.equal(first.status, 0, first.stderr);
  const prepared = JSON.parse(first.stdout);
  assert.equal(prepared.status, "preparing");
  assert.equal(prepared.created, true);
  assert.match(prepared.quickCommand, / run .*--activity-id activity-two-sum .*--generation-id /);
  assert.match(prepared.fullCommand, /--full$/);
  assert.match(prepared.publishCommand, / publish .*--activity-id activity-two-sum .*--generation-id /);
  assert.match(prepared.failureCommand, / fail .*--reason /);
  assert.equal(typeof prepared.deadlineAt, "number");

  const second = cli(args, env);
  assert.equal(second.status, 0, second.stderr);
  const reused = JSON.parse(second.stdout);
  assert.equal(reused.created, false);
  assert.equal(reused.generationId, prepared.generationId);
  assert.equal(reused.stagingDirectory, prepared.stagingDirectory);

  const status = JSON.parse(await readFile(prepared.statusFile, "utf8"));
  assert.equal(status.status, "preparing");
  assert.equal(status.activityId, "activity-two-sum");
});

test("run reports preparing without compiling partial staging files", async () => {
  const { source, env } = await sandbox();
  const prepared = JSON.parse(cli([
    "prepare",
    "--activity-id", "activity-preparing",
    "--signature", "0001|two-sum|int[] twoSum(int[],int)",
    "--source", source,
  ], env).stdout);
  await writeFile(path.join(prepared.stagingDirectory, "HarnessMain.java"), "this is partial");

  const result = cli([
    "run",
    "--activity-id", "activity-preparing",
    "--generation-id", prepared.generationId,
  ], env);

  assert.equal(result.status, 75);
  assert.match(result.stderr, /Test harness is still preparing; run this command again shortly\./);
  assert.doesNotMatch(result.stderr, /javac|compilation failed/i);
});

test("publish atomically exposes a ready ordinary-array harness and Quick tests the latest source", async () => {
  const { source, env } = await sandbox();
  await writeFile(source, [
    "class Solution {",
    "  int sum(int[] values) {",
    "    int total = 0;",
    "    for (int value : values) total += value;",
    "    return total;",
    "  }",
    "}",
    "",
  ].join("\n"));
  const prepared = prepareHarness({
    activityId: "activity-array-sum",
    signature: "array-sum|int sum(int[])",
    source,
    env,
  });
  await writeFile(path.join(prepared.stagingDirectory, "HarnessMain.java"), [
    "public class HarnessMain {",
    "  static void report(String name, String input, int expected, int actual) {",
    "    System.out.println(\"{\\\"type\\\":\\\"case\\\",\\\"name\\\":\\\"\" + name + \"\\\",\\\"input\\\":\\\"\" + input + \"\\\",\\\"expected\\\":\\\"\" + expected + \"\\\",\\\"actual\\\":\\\"\" + actual + \"\\\",\\\"passed\\\":\" + (expected == actual) + \"}\");",
    "  }",
    "  public static void main(String[] args) {",
    "    Solution solution = new Solution();",
    "    report(\"visible-example\", \"[1,2,3]\", 6, solution.sum(new int[]{1,2,3}));",
    "    if (args.length > 0 && args[0].equals(\"full\")) report(\"empty-boundary\", \"[]\", 0, solution.sum(new int[]{}));",
    "  }",
    "}",
    "",
  ].join("\n"));
  await writeFile(path.join(prepared.stagingDirectory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    activityId: "activity-array-sum",
    generationId: prepared.generationId,
    signatureHash: prepared.signatureHash,
    sourceFileName: "Solution.java",
    mainClass: "HarnessMain",
    harnessFiles: ["HarnessMain.java"],
    quickCases: ["visible-example"],
    fullCases: ["visible-example", "empty-boundary"],
    runTimeoutMs: 2_000,
  }, null, 2)}\n`);

  const publish = cli([
    "publish",
    "--activity-id", "activity-array-sum",
    "--generation-id", prepared.generationId,
  ], env);
  assert.equal(publish.status, 0, publish.stderr);
  assert.equal(JSON.parse(publish.stdout).status, "ready");

  const quick = cli([
    "run",
    "--activity-id", "activity-array-sum",
    "--generation-id", prepared.generationId,
  ], env);
  assert.equal(quick.status, 0, `${quick.stdout}\n${quick.stderr}`);
  assert.match(quick.stdout, /Suite: Quick/);
  assert.match(quick.stdout, /PASS visible-example \| input=\[1,2,3\] \| expected=6 \| actual=6/);
  assert.match(quick.stdout, /Locally verified: Quick suite passed 1\/1 tests\./);
  assert.doesNotMatch(quick.stdout, /empty-boundary/);
});

test("--full runs a strict Quick superset and repeated invocations compile the latest saved source", async () => {
  const sourceContent = [
    "class Solution {",
    "  String reverse(String value) { return new StringBuilder(value).reverse().toString(); }",
    "}",
    "",
  ].join("\n");
  const harnessContent = [
    "public class HarnessMain {",
    "  static void report(String name, String input, String expected, String actual) {",
    "    boolean passed = expected.equals(actual);",
    "    System.out.println(\"{\\\"type\\\":\\\"case\\\",\\\"name\\\":\\\"\" + name + \"\\\",\\\"input\\\":\\\"\" + input + \"\\\",\\\"expected\\\":\\\"\" + expected + \"\\\",\\\"actual\\\":\\\"\" + actual + \"\\\",\\\"passed\\\":\" + passed + \"}\");",
    "  }",
    "  public static void main(String[] args) {",
    "    Solution solution = new Solution();",
    "    report(\"visible-example\", \"arc\", \"cra\", solution.reverse(\"arc\"));",
    "    if (args[0].equals(\"full\")) report(\"empty-string\", \"empty\", \"\", solution.reverse(\"\"));",
    "  }",
    "}",
    "",
  ].join("\n");
  const { source, env, prepared } = await readyHarness({
    activityId: "activity-reverse-string",
    signature: "reverse-string|String reverse(String)",
    sourceContent,
    harnessFiles: { "HarnessMain.java": harnessContent },
    quickCases: ["visible-example"],
    fullCases: ["visible-example", "empty-string"],
  });

  const full = cli(["run", "--activity-id", "activity-reverse-string", "--generation-id", prepared.generationId, "--full"], env);
  assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
  assert.match(full.stdout, /Suite: Full local/);
  assert.match(full.stdout, /PASS visible-example/);
  assert.match(full.stdout, /PASS empty-string/);
  assert.match(full.stdout, /Locally verified: Full local suite passed 2\/2 tests\./);
  assert.match(full.stdout, /not a LeetCode Accepted verdict/);

  const edited = sourceContent.replace(".reverse().toString()", ".toString()");
  await writeFile(source, edited);
  const rerun = cli(["run", "--activity-id", "activity-reverse-string", "--generation-id", prepared.generationId], env);
  assert.equal(rerun.status, 1);
  assert.match(rerun.stdout, /FAIL visible-example .* expected=cra .* actual=arc/);
  assert.equal(await readFile(source, "utf8"), edited);
});

test("a sub-agent-unavailable failure becomes a persistent actionable runner state", async () => {
  const { source, env } = await sandbox();
  const prepared = prepareHarness({
    activityId: "activity-helper-unavailable",
    signature: "helper-unavailable|int solve(int)",
    source,
    env,
  });
  const marked = cli([
    "fail",
    "--activity-id", "activity-helper-unavailable",
    "--generation-id", prepared.generationId,
    "--reason", "Codex sub-agent delegation is unavailable in this client.",
  ], env);
  assert.equal(marked.status, 0, marked.stderr);

  const run = cli(["run", "--activity-id", "activity-helper-unavailable", "--generation-id", prepared.generationId], env);
  assert.equal(run.status, 69);
  assert.match(run.stderr, /Harness preparation failed: Codex sub-agent delegation is unavailable in this client\./);
  assert.match(run.stderr, /Ask the specialist to repair this activity's harness preparation/);

  const reused = prepareHarness({
    activityId: "activity-helper-unavailable",
    signature: "helper-unavailable|int solve(int)",
    source,
    env,
  });
  assert.equal(reused.created, false);
  assert.equal(reused.generationId, prepared.generationId);
  assert.equal(reused.status, "failed");
});

test("a failed generation can be repaired and published without reserving a second generation", async () => {
  const { source, env } = await sandbox();
  await writeFile(source, "class Solution { int solve(int value) { return value + 1; } }\n");
  const prepared = prepareHarness({
    activityId: "activity-helper-repair",
    signature: "helper-repair|int solve(int)",
    source,
    env,
  });
  const failed = cli([
    "fail",
    "--activity-id", "activity-helper-repair",
    "--generation-id", prepared.generationId,
    "--reason", "The original helper stopped before publication.",
  ], env);
  assert.equal(failed.status, 0, failed.stderr);

  await writeFile(path.join(prepared.stagingDirectory, "HarnessMain.java"), [
    "public class HarnessMain {",
    "  public static void main(String[] args) {",
    "    int actual = new Solution().solve(1);",
    "    System.out.println(\"{\\\"type\\\":\\\"case\\\",\\\"name\\\":\\\"repair-smoke\\\",\\\"input\\\":\\\"1\\\",\\\"expected\\\":\\\"2\\\",\\\"actual\\\":\\\"\" + actual + \"\\\",\\\"passed\\\":\" + (actual == 2) + \"}\");",
    "    if (args[0].equals(\"full\")) System.out.println(\"{\\\"type\\\":\\\"case\\\",\\\"name\\\":\\\"repair-boundary\\\",\\\"input\\\":\\\"-1\\\",\\\"expected\\\":\\\"0\\\",\\\"actual\\\":\\\"0\\\",\\\"passed\\\":true}\");",
    "  }",
    "}",
    "",
  ].join("\n"));
  await writeFile(path.join(prepared.stagingDirectory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    activityId: "activity-helper-repair",
    generationId: prepared.generationId,
    signatureHash: prepared.signatureHash,
    sourceFileName: "Solution.java",
    mainClass: "HarnessMain",
    harnessFiles: ["HarnessMain.java"],
    quickCases: ["repair-smoke"],
    fullCases: ["repair-smoke", "repair-boundary"],
    runTimeoutMs: 2_000,
  })}\n`);

  const publish = cli(["publish", "--activity-id", "activity-helper-repair", "--generation-id", prepared.generationId], env);
  assert.equal(publish.status, 0, publish.stderr);
  assert.equal(JSON.parse(publish.stdout).generationId, prepared.generationId);
  const rerunPrepare = prepareHarness({
    activityId: "activity-helper-repair",
    signature: "helper-repair|int solve(int)",
    source,
    env,
  });
  assert.equal(rerunPrepare.created, false);
  assert.equal(rerunPrepare.status, "ready");
});

test("a verified starter-signature change invalidates the old stable command without deleting the source", async () => {
  const { source, env } = await sandbox();
  const originalSource = "class Solution { int solve(int value) { return value; } }\n";
  await writeFile(source, originalSource);
  const first = prepareHarness({
    activityId: "activity-signature-change",
    signature: "problem|int solve(int)",
    source,
    env,
  });
  const second = prepareHarness({
    activityId: "activity-signature-change",
    signature: "problem|long solve(long)",
    source,
    env,
  });
  assert.notEqual(second.generationId, first.generationId);
  assert.equal(second.created, true);

  const stale = cli(["run", "--activity-id", "activity-signature-change", "--generation-id", first.generationId], env);
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /stale because the verified problem signature changed/i);
  assert.equal(JSON.parse(await readFile(first.statusFile, "utf8")).status, "stale");
  assert.equal(await readFile(source, "utf8"), originalSource);
});

test("preparing state expires into a persistent timed-out status with repair guidance", async () => {
  const { source, env } = await sandbox();
  const result = cli([
    "prepare",
    "--activity-id", "activity-preparation-timeout",
    "--signature", "timeout|int solve(int)",
    "--source", source,
    "--preparation-timeout-ms", "50",
  ], env);
  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(result.stdout);
  await new Promise((resolve) => setTimeout(resolve, 80));

  const run = cli(["run", "--activity-id", "activity-preparation-timeout", "--generation-id", prepared.generationId], env);
  assert.equal(run.status, 75);
  assert.match(run.stderr, /Harness preparation timed out/);
  assert.match(run.stderr, /Ask the specialist to repair/);
  assert.equal(JSON.parse(await readFile(prepared.statusFile, "utf8")).status, "timed_out");
});

test("custom public Codec and supplied TreeNode compile from correctly named temporary copies", async () => {
  const sourceContent = [
    "import java.util.*;",
    "public class Codec {",
    "  public String serialize(TreeNode root) {",
    "    if (root == null) return \"#\";",
    "    return root.val + \",\" + serialize(root.left) + \",\" + serialize(root.right);",
    "  }",
    "  public TreeNode deserialize(String data) {",
    "    return decode(new ArrayDeque<>(Arrays.asList(data.split(\",\"))));",
    "  }",
    "  private TreeNode decode(Deque<String> values) {",
    "    String value = values.removeFirst();",
    "    if (value.equals(\"#\")) return null;",
    "    TreeNode node = new TreeNode(Integer.parseInt(value));",
    "    node.left = decode(values); node.right = decode(values); return node;",
    "  }",
    "}",
    "",
  ].join("\n");
  const treeNode = "class TreeNode { int val; TreeNode left, right; TreeNode(int value) { val = value; } }\n";
  const harness = [
    "public class HarnessMain {",
    "  static void check(String name, String input, String expected, String actual) {",
    "    boolean passed = expected.equals(actual);",
    "    System.out.println(\"{\\\"type\\\":\\\"case\\\",\\\"name\\\":\\\"\" + name + \"\\\",\\\"input\\\":\\\"\" + input + \"\\\",\\\"expected\\\":\\\"\" + expected + \"\\\",\\\"actual\\\":\\\"\" + actual + \"\\\",\\\"passed\\\":\" + passed + \"}\");",
    "  }",
    "  public static void main(String[] args) {",
    "    Codec codec = new Codec();",
    "    TreeNode root = new TreeNode(12); root.left = new TreeNode(-7);",
    "    String encoded = codec.serialize(root);",
    "    check(\"visible-round-trip\", \"[12,-7,null]\", encoded, codec.serialize(codec.deserialize(encoded)));",
    "    if (args[0].equals(\"full\")) {",
    "      check(\"null-root\", \"null\", \"#\", codec.serialize(codec.deserialize(\"#\")));",
    "      check(\"negative-multidigit\", \"[-123]\", \"-123,#,#\", codec.serialize(codec.deserialize(\"-123,#,#\")));",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const { env, prepared } = await readyHarness({
    activityId: "activity-codec-tree",
    signature: "0297|Codec.serialize(TreeNode);Codec.deserialize(String)|TreeNode",
    sourceContent,
    sourceFileName: "Codec.java",
    harnessFiles: { "TreeNode.java": treeNode, "HarnessMain.java": harness },
    quickCases: ["visible-round-trip"],
    fullCases: ["visible-round-trip", "null-root", "negative-multidigit"],
  });
  const full = cli(["run", "--activity-id", "activity-codec-tree", "--generation-id", prepared.generationId, "--full"], env);
  assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
  assert.match(full.stdout, /PASS visible-round-trip/);
  assert.match(full.stdout, /PASS null-root/);
  assert.match(full.stdout, /PASS negative-multidigit/);
  assert.match(full.stdout, /passed 3\/3 tests/);
});

test("supplied ListNode scaffolding compiles only inside the temporary workspace", async () => {
  const sourceContent = [
    "class Solution {",
    "  ListNode reverse(ListNode head) {",
    "    ListNode previous = null;",
    "    while (head != null) {",
    "      ListNode next = head.next; head.next = previous; previous = head; head = next;",
    "    }",
    "    return previous;",
    "  }",
    "}",
    "",
  ].join("\n");
  const listNode = "class ListNode { int val; ListNode next; ListNode(int value) { val = value; } }\n";
  const harness = [
    "public class HarnessMain {",
    "  static String text(ListNode node) { StringBuilder out = new StringBuilder(); while (node != null) { if (out.length() > 0) out.append(','); out.append(node.val); node = node.next; } return out.toString(); }",
    "  static void report(String name, String input, String expected, String actual) {",
    "    System.out.println(\"{\\\"type\\\":\\\"case\\\",\\\"name\\\":\\\"\" + name + \"\\\",\\\"input\\\":\\\"\" + input + \"\\\",\\\"expected\\\":\\\"\" + expected + \"\\\",\\\"actual\\\":\\\"\" + actual + \"\\\",\\\"passed\\\":\" + expected.equals(actual) + \"}\");",
    "  }",
    "  public static void main(String[] args) {",
    "    ListNode one = new ListNode(1); one.next = new ListNode(2);",
    "    report(\"two-node-list\", \"1,2\", \"2,1\", text(new Solution().reverse(one)));",
    "    if (args[0].equals(\"full\")) report(\"null-list\", \"null\", \"\", text(new Solution().reverse(null)));",
    "  }",
    "}",
    "",
  ].join("\n");
  const { env, prepared } = await readyHarness({
    activityId: "activity-list-helper",
    signature: "reverse-list|ListNode reverse(ListNode)|ListNode",
    sourceContent,
    harnessFiles: { "ListNode.java": listNode, "HarnessMain.java": harness },
    quickCases: ["two-node-list"],
    fullCases: ["two-node-list", "null-list"],
  });

  const full = cli(["run", "--activity-id", "activity-list-helper", "--generation-id", prepared.generationId, "--full"], env);
  assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
  assert.match(full.stdout, /PASS two-node-list/);
  assert.match(full.stdout, /PASS null-list/);
});

test("Full supports order-insensitive, property, and reproducible seeded differential comparisons", async () => {
  const sourceContent = [
    "import java.util.*;",
    "class Solution {",
    "  int[] unique(int[] values) {",
    "    LinkedHashSet<Integer> seen = new LinkedHashSet<>();",
    "    for (int value : values) seen.add(value);",
    "    return seen.stream().mapToInt(Integer::intValue).toArray();",
    "  }",
    "}",
    "",
  ].join("\n");
  const harness = [
    "import java.util.*;",
    "public class HarnessMain {",
    "  static void report(String name, String input, String expected, String actual, boolean passed) {",
    "    System.out.println(\"{\\\"type\\\":\\\"case\\\",\\\"name\\\":\\\"\" + name + \"\\\",\\\"input\\\":\\\"\" + input + \"\\\",\\\"expected\\\":\\\"\" + expected + \"\\\",\\\"actual\\\":\\\"\" + actual + \"\\\",\\\"passed\\\":\" + passed + \"}\");",
    "  }",
    "  static int[] sorted(int[] values) { int[] copy = values.clone(); Arrays.sort(copy); return copy; }",
    "  public static void main(String[] args) {",
    "    Solution solution = new Solution();",
    "    int[] visible = solution.unique(new int[]{1,2,1});",
    "    report(\"deterministic-equality\", \"[1,2,1]\", \"[1, 2]\", Arrays.toString(visible), Arrays.equals(visible, new int[]{1,2}));",
    "    if (args[0].equals(\"full\")) {",
    "      int[] unordered = solution.unique(new int[]{3,1,3,2});",
    "      report(\"order-insensitive\", \"[3,1,3,2]\", \"set [1, 2, 3]\", Arrays.toString(unordered), Arrays.equals(sorted(unordered), new int[]{1,2,3}));",
    "      boolean property = unordered.length == 3 && Arrays.stream(unordered).distinct().count() == unordered.length;",
    "      report(\"unique-property\", \"[3,1,3,2]\", \"all outputs distinct and length 3\", \"length=\" + unordered.length, property);",
    "      Random random = new Random(130L); boolean differential = true;",
    "      for (int run = 0; run < 40; run++) {",
    "        int length = random.nextInt(8); int[] input = new int[length];",
    "        for (int index = 0; index < length; index++) input[index] = random.nextInt(9) - 4;",
    "        int[] actual = sorted(solution.unique(input));",
    "        int[] expected = Arrays.stream(input).distinct().sorted().toArray();",
    "        if (!Arrays.equals(expected, actual)) { differential = false; break; }",
    "      }",
    "      report(\"differential-seed-130\", \"seed=130, cases=40\", \"all match TreeSet-equivalent oracle\", \"deterministic run completed\", differential);",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const { env, prepared } = await readyHarness({
    activityId: "activity-comparators",
    signature: "unique-values|int[] unique(int[])",
    sourceContent,
    harnessFiles: { "HarnessMain.java": harness },
    quickCases: ["deterministic-equality"],
    fullCases: ["deterministic-equality", "order-insensitive", "unique-property", "differential-seed-130"],
  });
  const args = ["run", "--activity-id", "activity-comparators", "--generation-id", prepared.generationId, "--full"];
  const first = cli(args, env);
  const second = cli(args, env);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(second.stdout, first.stdout);
  for (const name of ["deterministic-equality", "order-insensitive", "unique-property", "differential-seed-130"]) {
    assert.match(first.stdout, new RegExp(`PASS ${name}`));
  }
  assert.match(first.stdout, /seed=130, cases=40/);
});

test("compilation failures are concise, nonzero, and leave the evolving source unchanged", async () => {
  const invalidSource = "class Solution { int solve( { return 1; } }\n";
  const harness = "public class HarnessMain { public static void main(String[] args) {} }\n";
  const { source, env, prepared } = await readyHarness({
    activityId: "activity-compile-failure",
    signature: "compile-failure|int solve()",
    sourceContent: invalidSource,
    harnessFiles: { "HarnessMain.java": harness },
    quickCases: ["compile-gate"],
    fullCases: ["compile-gate", "full-never-runs"],
  });
  const result = cli(["run", "--activity-id", "activity-compile-failure", "--generation-id", prepared.generationId], env);
  assert.equal(result.status, 65);
  assert.match(result.stderr, /Compilation failed:/);
  assert.match(result.stderr, /Solution\.java/);
  assert.equal(await readFile(source, "utf8"), invalidSource);
});

test("runtime exceptions return nonzero with the selected suite and actionable failure", async () => {
  const { env, prepared } = await readyHarness({
    activityId: "activity-runtime-failure",
    signature: "runtime-failure|int solve()",
    sourceContent: "class Solution { int solve() { return 1; } }\n",
    harnessFiles: {
      "HarnessMain.java": "public class HarnessMain { public static void main(String[] args) { throw new IllegalStateException(\"fixture boom\"); } }\n",
    },
    quickCases: ["runtime-gate"],
    fullCases: ["runtime-gate", "full-never-runs"],
  });
  const result = cli(["run", "--activity-id", "activity-runtime-failure", "--generation-id", prepared.generationId], env);
  assert.equal(result.status, 70);
  assert.match(result.stdout, /Suite: Quick/);
  assert.match(result.stderr, /Runtime failed with exit 1/);
  assert.match(result.stderr, /fixture boom/);
});

test("guarded runaway execution times out with a distinct nonzero status", async () => {
  const { env, prepared } = await readyHarness({
    activityId: "activity-runtime-timeout",
    signature: "runtime-timeout|int solve()",
    sourceContent: "class Solution { int solve() { return 1; } }\n",
    harnessFiles: {
      "HarnessMain.java": "public class HarnessMain { public static void main(String[] args) { while (true) { } } }\n",
    },
    quickCases: ["timeout-gate"],
    fullCases: ["timeout-gate", "full-never-runs"],
    runTimeoutMs: 100,
  });
  const result = cli(["run", "--activity-id", "activity-runtime-timeout", "--generation-id", prepared.generationId], env);
  assert.equal(result.status, 124);
  assert.match(result.stderr, /Runtime timed out after 100ms/);
});

test("publication rejects incomplete or non-superset staging and never exposes partial Java files", async () => {
  const { source, env } = await sandbox();
  const prepared = prepareHarness({
    activityId: "activity-invalid-publication",
    signature: "invalid-publication|int solve()",
    source,
    env,
  });
  await writeFile(path.join(prepared.stagingDirectory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    activityId: "activity-invalid-publication",
    generationId: prepared.generationId,
    signatureHash: prepared.signatureHash,
    sourceFileName: "Solution.java",
    mainClass: "HarnessMain",
    harnessFiles: ["HarnessMain.java"],
    quickCases: ["same-case"],
    fullCases: ["same-case"],
    runTimeoutMs: 2_000,
  })}\n`);

  const publish = cli(["publish", "--activity-id", "activity-invalid-publication", "--generation-id", prepared.generationId], env);
  assert.equal(publish.status, 2);
  assert.match(publish.stderr, /strict superset of Quick/);
  assert.equal(JSON.parse(await readFile(prepared.statusFile, "utf8")).status, "preparing");

  const run = cli(["run", "--activity-id", "activity-invalid-publication", "--generation-id", prepared.generationId], env);
  assert.equal(run.status, 75);
  assert.match(run.stderr, /still preparing/);
});

test("publication requires Full to preserve Quick case order before adding cases", async () => {
  const { source, env } = await sandbox();
  const prepared = prepareHarness({
    activityId: "activity-invalid-order",
    signature: "invalid-order|int solve()",
    source,
    env,
  });
  await writeFile(path.join(prepared.stagingDirectory, "HarnessMain.java"), "public class HarnessMain {}\n");
  await writeFile(path.join(prepared.stagingDirectory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    activityId: "activity-invalid-order",
    generationId: prepared.generationId,
    signatureHash: prepared.signatureHash,
    sourceFileName: "Solution.java",
    mainClass: "HarnessMain",
    harnessFiles: ["HarnessMain.java"],
    quickCases: ["visible-a", "smoke-b"],
    fullCases: ["smoke-b", "visible-a", "boundary-c"],
    runTimeoutMs: 2_000,
  })}\n`);

  const publish = cli(["publish", "--activity-id", "activity-invalid-order", "--generation-id", prepared.generationId], env);
  assert.equal(publish.status, 2);
  assert.match(publish.stderr, /preserve Quick case order/);
});

test("future LeetCode specialists receive the complete nonblocking harness contract", async () => {
  const [guide, harnessContract, durableContract, logContract, workflow] = await Promise.all([
    readFile(new URL("../practice/leetcode/AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/leetcode-java-harness.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/durable-practice-publishing.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/leetcode-log.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  ]);

  assert.match(guide, /leetcode-java-harness\.md/);
  for (const statement of [
    /exactly one Codex\s+sub-agent per activity and verified problem signature/i,
    /nvim.*Quick.*--full/is,
    /preparing.*ready.*failed.*stale.*timed.?out/is,
    /latest saved.*Java source/i,
    /atomically/i,
    /never send a proactive.*ready/i,
    /raw.*harness.*D1.*transcript/is,
    /Locally verified.*Accepted.*verdict/is,
  ]) assert.match(guide, statement);

  for (const phrase of [
    "Deterministic activity state",
    "Sub-agent publication protocol",
    "Quick suite",
    "Full local suite",
    "Harness JSON-lines protocol",
    "public-class filename",
    "temporary compilation workspace",
  ]) assert.match(harnessContract, new RegExp(phrase, "i"));
  assert.match(durableContract, /raw\s+runner commands.*preparation status.*compiler\s+plumbing/is);
  assert.match(logContract, /local harness conclusion/i);
  assert.match(workflow, /actions\/setup-java@v4/);
  assert.match(workflow, /java-version: ['"]17['"]/);
});
