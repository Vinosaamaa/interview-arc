import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function javascriptUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return javascriptUnder(target);
      return entry.name.endsWith(".js") ? readFile(target, "utf8") : "";
    }),
  );
  return files.flat().join("\n");
}

test("the Cloudflare build contains the Interview Arc dashboard", async () => {
  const bundle = await javascriptUnder(fileURLToPath(new URL("../dist", import.meta.url)));
  assert.match(bundle, /Interview Arc/);
  assert.match(bundle, /A clean page/);
  assert.match(bundle, /No session planned yet/);
  assert.match(bundle, /Add another session/);
  assert.match(bundle, /Edit session recipe/);
  assert.match(bundle, /Shape the session you need/);
  assert.match(bundle, /SESSION COUNTDOWN/);
  assert.match(bundle, /Add one activity/);
  assert.match(bundle, /Problem banks/);
  assert.match(bundle, /YESTERDAY/);
  assert.match(bundle, /365-DAY PRACTICE MAP/);
  assert.match(bundle, /Time spent versus outcome/);
  assert.match(bundle, /Topics practiced/);
  assert.match(bundle, /PACIFIC PRACTICE RHYTHM/);
  assert.match(bundle, /SESSION LEDGER/);
  assert.match(bundle, /No activity running/);
  assert.match(bundle, /Voice stays unlinked until then/);
  assert.match(bundle, /America\/Los_Angeles/);
  assert.match(bundle, /Begin today’s work/);
  assert.match(bundle, /TODAY’S MIX/);
  assert.match(bundle, /TODAY’S LISTENING/);
  assert.match(bundle, /Previous music track/);
  assert.match(bundle, /Save MP3/);
  assert.match(bundle, /Source ↗/);
  assert.match(bundle, /Ready for journal/);
  assert.match(bundle, /Connect Interview Arc tools/);
  assert.match(bundle, /Codex practice bridge/);
  assert.match(bundle, /LeetCode Chrome companion/);
  assert.match(bundle, /Needs review/);
  assert.match(bundle, /Solved with help/);
  assert.match(bundle, /Has notes/);
  assert.match(bundle, /Pinned practice notes/);
  assert.match(bundle, /Case file contents/);
  assert.match(bundle, /Read the journey/);
  assert.match(bundle, /like a field journal/);
  assert.match(bundle, /Open reusable solution/);
  assert.match(bundle, /D1 DRAFT · NOT YET IN THE JOURNAL/);
  assert.match(bundle, /CONVERSATION TRANSCRIPT/);
  assert.match(bundle, /Your recording sits between the prompt and the answer it captures/);
  assert.doesNotMatch(bundle, /Attach your recording|Add an answer recording|Choose files/);
  assert.match(bundle, /up to two due reviews first/);
  assert.match(bundle, /Sweet September/);
  assert.match(bundle, /Forest Mist Whispers/);
  assert.match(bundle, /arrival-cozy-room-4k\.jpg/);
  assert.match(bundle, /arrival-illuminated-blossom-4k\.jpg/);
  assert.doesNotMatch(bundle, /Practice library|Story bank|All finished/);
  assert.doesNotMatch(bundle, /Test console|Submit attempt|solution\.py/);
  assert.doesNotMatch(bundle, /codex-preview|react-loading-skeleton/);
});

test("the refined analytics and composer layouts keep their intended grouping", async () => {
  const css = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/interview-arc-v2.css", import.meta.url), "utf8"),
  ]).then((stylesheets) => stylesheets.join("\n"));
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  assert.match(css, /\.journey-detail-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.session-recipe \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.minutes-field \{[^}]*display: flex;[^}]*justify-content: space-between/);
  assert.match(css, /\.activity-timer \{[^}]*height: 66px;[^}]*min-height: 66px;[^}]*max-height: 66px;[^}]*grid-template-rows: 34px 14px;/);
  assert.match(css, /\.mock-controls \{ grid-template-columns: minmax\(160px, 1fr\) auto auto auto; \}/);
  assert.match(css, /\.past-control-deck \{[^}]*grid-template-columns: minmax\(0, 1fr\) 250px;/);
  assert.match(css, /\.case-title-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.past-master-detail \{[^}]*grid-template-columns:/);
  assert.match(css, /\.library-page\.has-open-entry \.past-master-detail \{ grid-template-columns:/);
  assert.match(css, /\.banks-page\.has-open-solution \.bank-master-detail \{ grid-template-columns:/);
  assert.match(css, /@keyframes reader-pane-in/);
  assert.match(client, /className="bank-master-detail"/);
  assert.match(client, /className="past-master-detail"/);
  assert.match(client, /className="past-entry-pane"/);
  assert.match(client, /left\.type === "system_design" \? -1 : 1/);
  assert.match(client, /placeholder="Search"/);
  assert.match(client, /const \[bankTypeFilters, setBankTypeFilters\] = useState<ActivityType\[]>\(\[\]\)/);
  assert.match(client, /const \[bankAttentionFilters, setBankAttentionFilters\] = useState<BankAttentionFilter\[]>\(\[\]\)/);
  assert.match(client, /const \[bankLevelFilters, setBankLevelFilters\] = useState<Array<"easy" \| "medium" \| "hard">>\(\[\]\)/);
  assert.match(client, /const \[bankTagFilters, setBankTagFilters\] = useState<string\[]>\(\[\]\)/);
  assert.match(client, /bankTypeFilters\.includes\(filter\)/);
  assert.match(client, /bankAttentionFilters\.includes\(filter\)/);
  assert.match(client, /bankLevelFilters\.includes\(filter\)/);
  assert.match(client, /bankTagFilters\.includes\(filterKey\)/);
  assert.match(client, /compact-filter-popover attention-menu/);
  assert.match(client, /compact-filter-popover bank-attention-menu/);
  assert.match(client, /composerVisibleCount/);
  assert.match(client, /activity-picker-toolbar/);
  assert.match(client, /\['todo', 'To do'\]/);
  assert.doesNotMatch(client, /activity-picker-progress/);
  assert.match(client, /Already on Today/);
  assert.doesNotMatch(client, /The scheduled review date has arrived|Any active review plan|Completed after reviewing the approach/);
  assert.doesNotMatch(client, />Started \{formatPracticeTimestamp/);
  assert.doesNotMatch(client, /\["all", "leetcode", "system_design", "behavioral"\]/);
  assert.doesNotMatch(client, /\{\(entry\.personalNote\?\.trim\(\) \|\| entry\.pinnedNotes\?\.length\) &&/);
  assert.doesNotMatch(client, /\{\(selectedEntry\.personalNote\?\.trim\(\) \|\| selectedEntry\.pinnedNotes\?\.length\) &&/);
  assert.ok(client.indexOf("CODING LADDER") < client.indexOf("SKILL COVERAGE"));
  assert.ok(client.indexOf("SKILL COVERAGE") < client.indexOf("EFFORT MAP"));
});
