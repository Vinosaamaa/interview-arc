# Coding bank sources

`questions.json` combines canonical LeetCode metadata without duplicate problem
IDs, numbers or URLs. It retains the original 350-question user-supplied TikTok
snapshot and its dated company signals.

The **NeetCode 150** tag selects all 150 questions using the bank's existing
tag/search controls. The import adds 49 missing questions and reuses 101
existing entries. Category tags follow NeetCode's taxonomy, not a claim about
official LeetCode topics. Existing metadata and company signals are preserved;
new entries have no invented acceptance rates or company signals.

`neetcode-150.json` records the complete ordered membership by category and the
pinned source revision, verified on 2026-09-11 against
[NeetCode's published metadata](https://github.com/neetcode-gh/leetcode/blob/9f104d45b1efc8c2e42b6dcc7b1216cdf8c4f80e/.problemSiteData.json)
and the [NeetCode 150 list](https://neetcode.io/practice/practice/neetcode150).
Only public question metadata and list membership are retained. Statements,
editorials, solutions and personal progress are not part of this import.
