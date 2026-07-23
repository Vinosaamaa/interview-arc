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

test("local development bypasses Access without weakening the production config", async () => {
  const [viteConfig, worker, localConfig, productionConfig] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.dev.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(viteConfig, /command === "serve" \? "wrangler\.dev\.jsonc" : "wrangler\.jsonc"/);
  assert.match(worker, /LOCAL_DEV_AUTH_BYPASS === "true" && isLocalRequest/);
  assert.match(worker, /hostname\.endsWith\("\.localhost"\)/);
  assert.match(worker, /hostname === "0\.0\.0\.0"/);
  assert.match(localConfig, /"LOCAL_DEV_AUTH_BYPASS": "true"/);
  assert.doesNotMatch(localConfig, /POLICY_AUD|TEAM_DOMAIN/);
  assert.match(productionConfig, /"POLICY_AUD"/);
  assert.match(productionConfig, /"TEAM_DOMAIN"/);
  assert.doesNotMatch(productionConfig, /LOCAL_DEV_AUTH_BYPASS/);

  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.dev, /pnpm dev:prepare/);
  assert.match(packageJson.scripts["dev:prepare"], /db:migrate:local/);
  assert.match(packageJson.scripts["dev:prepare"], /content:import:local/);
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
  assert.match(css, /grid-template-columns: 525px 1200px/);
  assert.match(css, /left: max\(calc\(50vw \+ var\(--sidebar-half\)/);
  assert.match(css, /@keyframes master-detail-in/);
  assert.match(css, /@media \(max-width: 1976px\)/);
  assert.match(css, /width: min\(525px, calc\(100vw - var\(--sidebar-size\) - 32px\)\)/);
  assert.match(client, /bank-master-detail \$\{masterPaneOpen && !readerFocusMode \? "master-pane-open" : ""\}/);
  assert.match(client, /past-master-detail \$\{masterPaneOpen && !readerFocusMode \? "master-pane-open" : ""\}/);
  assert.match(client, /function openEntrySolution\(entry: LogEntry\)/);
  assert.match(client, /sourceView: "library"/);
  assert.match(client, /function openAttemptFromSolution\(entry: LibraryEntry\)/);
  assert.match(client, /sourceView: "banks"/);
  assert.match(client, /function returnFromCrossReader\(\)/);
  assert.doesNotMatch(client, /Go forward in reader history/);
  assert.match(client, /restoreListPosition\("library"/);
  assert.match(client, /ref=\{pastListRef\}/);
  assert.match(client, /className="past-entry-pane"/);
  assert.match(client, /className={`annotation-popover selection-annotation/);
  assert.match(client, /Underline selected text and add a note/);
  assert.match(client, /Current highlight color:/);
  assert.match(client, /range\.cloneContents\(\)\.textContent/);
  assert.match(client, /highlightRangesRef = useRef\(new Map<string, Range\[\]>\(\)\)/);
  assert.match(client, /interview-arc-note-yellow/);
  assert.match(client, /Remove highlight/);
  assert.match(client, /readerGroupOpen\(groupId, group\.key !== "conversation"\)/);
  assert.match(client, /interview-arc-reader-memory-v1/);
  assert.doesNotMatch(client, /workspace-drawer-toggle/);
  assert.match(client, /master-pane-toggle icon-action/);
  assert.match(client, /navigateToPrimaryView/);
  assert.doesNotMatch(client, /startViewTransition/);
  assert.match(client, /activeActivity \? "has-focus" : railActivity \? "has-history" : "empty"/);
  assert.match(client, /readerClosing \? "reader-closing" : ""/);
  assert.match(client, /listRestoring === "library" \? "list-restoring" : ""/);
  assert.match(client, /pendingListRestoreRef\.current = \{ surface: "library", \.\.\.position \}/);
  assert.match(client, /useLayoutEffect\(\(\) => \{[\s\S]*window\.scrollTo\(\{ top: pending\.pageScrollTop/);
  assert.match(client, /pendingListRestoreRef\.current = null;\s*setListRestoring\(null\);/);
  assert.match(client, /pendingSelectedRevealRef\.current !== surface/);
  assert.match(client, /data-list-item-id=\{`library:\$\{entry\.id\}`\}/);
  assert.match(client, /data-list-item-id=\{`banks:\$\{type\}:\$\{question\.id\}`\}/);
  assert.match(client, /anchorOffset: anchor\.getBoundingClientRect\(\)\.top - referenceTop/);
  assert.match(client, /centerAnchor: true/);
  assert.match(client, /pending\.centerAnchor/);
  assert.match(client, /list\.scrollTo\(\{ top: Math\.max\(0, target\), behavior: "instant" \}\)/);
  assert.match(client, /key=\{`\$\{view\}-\$\{viewTransitionId\}`\}/);
  assert.doesNotMatch(client, /kind: "activity-result"/);
  assert.doesNotMatch(client, /Choose a result first/);
  assert.match(css, /@keyframes page-enter/);
  assert.match(css, /left: calc\(var\(--sidebar-size\) \+ \(100vw - var\(--sidebar-size\)\) \/ 2\)/);
  assert.match(css, /@media \(min-width: 1977px\)/);
  assert.match(css, /--reader-pane-width: 1200px/);
  assert.match(css, /--master-pane-width: 525px/);
  assert.doesNotMatch(css, /@keyframes page-enter-(?:forward|backward) \{[^}]*translate3d/);
  assert.match(client, /function transitionToView\(nextView: View\) \{\s*if \(nextView === view\) return;/);
  assert.doesNotMatch(css, /reader-pane-(?:enter|exit)/);
  assert.match(css, /@keyframes reader-workspace-exit/);
  assert.match(css, /@keyframes reader-workspace-enter/);
  assert.match(css, /animation: reader-workspace-enter \.2s/);
  assert.match(css, /\.past-master-detail\.reader-closing,[\s\S]*animation: reader-workspace-exit/);
  assert.doesNotMatch(client, /Loading conversation and recordings/);
  assert.doesNotMatch(css, /list-view-return/);
  assert.match(client, /answer-player-unified/);
  assert.match(client, /problem-bank-entry.*role="button" tabIndex=\{0\} aria-label=/);
  assert.match(client, /function ReaderOutline/);
  assert.match(client, /setEveryReaderGroup\(false\)/);
  assert.match(client, /setEveryReaderGroup\(true\)/);
  assert.match(css, /\.workspace-reader-scroll \.markdown-body \{ font-size: 1\.0625rem; line-height: 1\.7; \}/);
  assert.match(css, /max-width: 970px/);
  assert.match(css, /\.log-entry,\s*\.problem-bank-entry \{ min-height: 150px; \}/);
  assert.match(css, /\.library-page\.has-open-entry \.dated-log \{[^}]*grid-auto-rows: max-content;[^}]*align-content: start;/);
  assert.match(css, /\.library-page\.has-open-entry \.log-day \{[^}]*height: max-content;/);
  assert.match(css, /\.problem-bank-list \{[^}]*height: clamp\(480px,[^}]*max-height: 720px;[^}]*overflow-y: auto;/);
  assert.match(css, /\.banks-page\.has-open-solution \.problem-bank-list \{[^}]*overflow-y: auto;/);
  assert.match(client, /entry\.artifact \? "Published record" : entry\.status/);
  assert.match(css, /\.highlight-note-card\.tone-0 \{ background: #fff2f1/);
  assert.match(css, /\.long-note-inspector/);
  assert.match(client, /Open full note/);
  assert.match(client, /reader-return-action/);
  assert.match(client, /returnFromCrossReader/);
  assert.doesNotMatch(client, /moveReaderNavigation/);
  assert.match(css, /\.annotation-popover \{ position: fixed;/);
  assert.match(client, /left\.type === "system_design" \? -1 : 1/);
  assert.match(client, /placeholder="Search"/);
  assert.match(client, /const \[bankTypeFilters, setBankTypeFilters\] = useState<ActivityType\[]>\(workspaceUiMemory\.bankTypeFilters \?\? \[\]\)/);
  assert.match(client, /const \[bankAttentionFilters, setBankAttentionFilters\] = useState<BankAttentionFilter\[]>\(workspaceUiMemory\.bankAttentionFilters \?\? \[\]\)/);
  assert.match(client, /const \[bankLevelFilters, setBankLevelFilters\] = useState<Array<"easy" \| "medium" \| "hard">>\(workspaceUiMemory\.bankLevelFilters \?\? \[\]\)/);
  assert.match(client, /const \[bankTagFilters, setBankTagFilters\] = useState<string\[]>\(workspaceUiMemory\.bankTagFilters \?\? \[\]\)/);
  assert.match(client, /interview-arc-workspace-ui-v1/);
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
