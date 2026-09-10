# Regular ChatGPT text and Live Voice for practice

Verified against official documentation on **2026-09-09**. No account-specific
UI acceptance has been performed. This is separate from Desktop/Codex Voice.

## Capability comparison

| Need | Regular text ChatGPT | Regular Chat Live Voice |
| --- | --- | --- |
| Public GitHub guide or public bank page | Web retrieval is a candidate; verify actual content and version. | Web search is supported; verify the retrieved version, not just a search snippet. |
| Private GitHub guide | The GitHub app reads authorized repositories, including documentation; availability varies. | Connected apps/plugins are currently unsupported. |
| Authenticated bank API | A configured integration is required. Pro supports read/fetch MCP in developer mode on web. | No documented arbitrary authenticated REST/MCP route. |
| Custom GPT API actions | Supported configurations use OpenAPI and authentication. Actions are unavailable in the Pro **model mode**, distinct from the Pro subscription. | Compatibility with regular Live is not established. |
| Uploaded bank file | File upload and document analysis are supported subject to limits. | Manual supported-file attachment is account-dependent; Live cannot retrieve Library files. |
| Pasted snapshot | Supported text context. | Text in the same chat is supported. |
| Background stopwatch | No reviewed documentation guarantees an automatic clock or continuous counter. | Background conversation does not establish a background timer. |

Sources: [ChatGPT Voice](https://help.openai.com/en/articles/20001274),
[GitHub app](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt),
[developer-mode MCP](https://help.openai.com/en/articles/12584461),
[GPT actions](https://help.openai.com/en/articles/9442513),
[file uploads](https://help.openai.com/en/articles/8555545-file-uploads-faq),
[ChatGPT Search](https://help.openai.com/en/articles/9237897).

Regular text can therefore prepare the guide and a fresh snapshot before the
user switches to Live in the same chat. This is a design inference from the
documented components; the account must demonstrate that Live can read that
context. Text can refresh a connected bank between sessions. Live must not
claim to refresh it through an unavailable integration.

Web search does not imply access to the user's browser cookies, a private
repository, arbitrary authorization headers, or a current private REST result.
A public guide can be on GitHub; personal question progress remains an
owner-private snapshot. Neither a repository URL nor an API URL proves that
ChatGPT read it. Require a version and selected question readback.

## Usage distinction

The current Voice help page lists unlimited GPT-Live-1 for the $200 Pro tier in
regular Chat Live. Desktop Voice has its own allowance, and tasks started via
Voice consume Codex usage. This supports trying regular Chat for ongoing
practice, but does not imply unlimited use of every ChatGPT tool or model.
Account terms and availability must be checked when this guide is reused.
Sources: [Chat Voice limits](https://help.openai.com/en/articles/20001274),
[Desktop Voice](https://learn.chatgpt.com/docs/features/voice).

## Approximate timer

No continuously running process is needed to calculate elapsed intervals.
Start records a boundary; Pause closes it; Resume opens another; Finish closes
the last. Status reports the state and accumulated time when evidence exists.
For example, user-reported 10:00 Start, 10:18 Pause, 10:25 Resume and 10:42 Finish
yield about 35 active minutes, with seven paused minutes excluded.

Use an actually available clock tool or user-supplied times, at minute
resolution if desired. A configured read-only text integration can be designed
to return server time; this is not a universal ChatGPT clock. If times are
unavailable, preserve the command state and accept a single approximate total
at Finish. Do not infer a clock from “start,” word count, or remembered pacing.
Scheduled Tasks are separate and do not support Voice chats; they are not a
substitute for this timer. [Tasks](https://help.openai.com/en/articles/10291617-tasks-in-chatgpt)

## Transcript and export

Voice transcripts are explicitly non-verbatim and may omit or alter speech.
They appear in chat history after Voice; Live responses also appear as text.
Copy available transcript text and distinguish it from a generated summary.
[Voice transcript limits](https://help.openai.com/en/articles/20001274)

Pro account exports contain chat history and can take up to seven days; the
download link expires after 24 hours. Exported conversation JSON files are
documented, but a stable timestamp schema or measured active duration is not.
Treat account export as an optional source, not the daily workflow's dependency.
[Export data](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpthistory-and-data),
[conversation files](https://help.openai.com/en/articles/9106926)

Memory is synthesized personal context, not a documented exhaustive transcript
ledger. Save each Finish packet, then aggregate supplied packets at day end.
Never promise a full-day transcript across chats from memory alone.
[Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)

## Account acceptance still required

Use a synthetic question and no private data for the first check:

1. Confirm regular Chat Live rather than paired Desktop/Codex Voice.
2. In text, read the guide and snapshot; repeat their exact version and one
   question's ID/status. For private GitHub/MCP, verify the authorized connector.
3. Switch to Live and repeat an interior snapshot value. Test an attachment
   separately if it will replace pasted text.
4. Say Start, Pause, Resume, Status and Finish. Verify state transitions and
   honest timestamp/estimate handling, without demanding second accuracy.
5. End Voice and export in text. Compare selected turns, question ID, estimate,
   gaps and packet keys with the supplied source.
6. Repeat the export and verify stable keys. Provide two packets for the
   day-end aggregation, ensuring missing sessions are not invented.

Older search snippets claimed specific custom-GPT Voice restrictions that were
absent from the current opened article. They were not treated as current proof.
The schemas and importer requirements live in the
[backfill contract](../contracts/chatgpt-practice-backfill.md).
