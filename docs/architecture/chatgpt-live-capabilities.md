# Regular ChatGPT practice: text and Live access

Fresh assessment: **2026-09-09**. Account acceptance: **not performed**.
Evidence is official documentation and repository inspection, not access to
the user's ChatGPT account or private practice state.

## Decision and usage

Load the [guide](../agents/chatgpt-practice-prompt.md) and selected bank rows in
regular text ChatGPT; continue in text or switch to Live in the same chat.
Return to text for the full export. Pasted rows make practice possible today;
an integration is optional.

The current Voice help page lists unlimited GPT-Live-1 for **$200/month Pro**
in Chat on web/iOS/Android. Desktop Voice uses a separate allowance, and tasks
it starts consume Codex usage. Use ordinary Chat for this workflow; the plan
does not make every tool, model or API unlimited.
[Chat Voice](https://help.openai.com/en/articles/20001274),
[Desktop Voice](https://learn.chatgpt.com/docs/features/voice)

## Access assessment

| Source/route | Regular text ChatGPT | Regular Chat Live |
| --- | --- | --- |
| Public GitHub guide/bank | Web retrieval is a candidate; verify actual content and revision. | Web search is supported; actual file retrieval must still succeed. |
| Private GitHub | Authorized GitHub app can retrieve permitted documentation; standard-chat availability varies by account/surface. | Connected apps/plugins are explicitly unsupported; prepare permitted content in text. |
| Authenticated Arc website/REST URL | A URL is not a login. Requires an available authenticated tool or user-supplied content. | No documented arbitrary authenticated REST route; web search does not establish one. |
| Custom Model Context Protocol (MCP) app | Pro developer mode on web supports read/fetch; configure and test server/authentication first. | Apps are unsupported; a text integration does not become callable in Live. |
| Custom GPT API action | Requires OpenAPI and configured authentication, using a supported non-Pro **model mode**, distinct from the Pro subscription. | Current opened Live documentation does not establish custom-action support; not selected as a workaround. |
| Uploaded file | Supported files can supply a bank/export, subject to limits. | Manual supported attachments vary by account; Library retrieval is unavailable. |
| Pasted text | Direct context for guide, selected rows and prior exports. | Text in the same chat is supported; verify selected rows after switching. |

Sources: [Search](https://help.openai.com/en/articles/9237897),
[GitHub](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt),
[MCP developer mode](https://help.openai.com/en/articles/12584461),
[GPT actions](https://help.openai.com/en/articles/9442513),
[files](https://help.openai.com/en/articles/8555545-file-uploads-faq),
[Live features](https://help.openai.com/en/articles/20001274).

The same-chat preparation workflow is an inference from documented components.
Pro MCP read/fetch is not proof that this account connected Interview Arc.
General app write support does not establish Pro custom-MCP writes. A GPT
action is a separately configured integration, not a request enabled by pasting
an API URL. Do not paste credentials/cookies into chat to simulate access.

Current help-page variants and older search snippets disagree about custom-GPT
Voice restrictions. The directly opened current Live page did not establish
that route; its availability remains unverified here.

## What this repository supplies

The three `practice/*/bank/questions.json` files contain catalogs with IDs,
URLs and available prompts. Their `updatedAt` values describe the files, not
today's personal attempts/reviews. Current records belong to owner-private
D1/R2 under the [existing contract](../contracts/owner-private-practice-records.md).

`app/api/content-index/route.ts` is behind the website Access gate;
`app/api/state/route.ts` resolves an owner; `app/api/practice-record/route.ts`
is an owner-scoped GET. `mcp-worker/` also exists. These are application
interfaces, not evidence of ChatGPT compatibility.

PR #454 implements an authenticated **Past → ChatGPT practice** bank download
and preview/apply importer under `/api/chatgpt-practice`. After deployment,
download the private JSON bank, attach it in text ChatGPT alongside the guide,
and switch to Live in the same chat. This file handoff is the default approach;
it does not depend on a Live REST call. Refresh the file after backfill or when
current status matters. GitHub catalogs remain a metadata-only fallback.
The account's text-to-Live context handoff still needs an account test.

## Timing

No reviewed ordinary Chat/Live documentation establishes a persistent
stopwatch, model-visible monotonic clock, automatic pause accounting or reliable
spontaneous time-up interruption. This is an evidence limit, not a claim that
the application has no internal timing mechanisms.

Keep Start/Pause/Resume/Finish as logical commands. With actual boundaries,
exclude pauses: 10:00 Start, 10:18 Pause, 10:25 Resume, 10:42 Finish gives about
35 active minutes. Otherwise accept one rough total at Finish, or unknown.
No repeated timestamp demands or pacing-based guesses are needed.

Background conversations keep audio interaction active; that does not prove
an exposed stopwatch. Scheduled Tasks explicitly exclude Voice chats.
[Background behavior](https://help.openai.com/en/articles/20001274),
[Scheduled Tasks](https://help.openai.com/en/articles/10291617-tasks-in-chatgpt)

## Transcript and export

Live transcripts can differ from speech. Preserve available text and identify
gaps. Regular text exports preserve supplied messages/code but still flag
context truncation. A generated recap is never recovered raw dialogue.
Save each Finish packet and aggregate supplied packets at day end; no promise
of unsupplied chat or audio recovery is justified.
[Transcript behavior](https://help.openai.com/en/articles/20001274)

Account export is an optional recovery source, can take up to seven days and
includes chat history. It is not a required daily Finish step, nor evidence of
a stable per-turn timestamp format or active-minute total.
[Account export](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpthistory-and-data)

## Small account acceptance check

With synthetic data: load guide/bank in text and verify an ID/prompt; switch
to Live and verify it again; Start, Pause, Resume and Finish with a rough total.
End Voice, export in text and compare source turns, speakers, gaps and time
basis. Repeat export to check stable identities; aggregate two supplied sessions.
Test private GitHub, MCP and manual attachment separately only when selecting
those routes. This PR has not run that account test.
