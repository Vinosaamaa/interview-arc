# Real ChatGPT acceptance plan: library and continuous player

Scope: issues #475 and #473. Local Workers, synthetic MCP clients and sandbox
widget tests are integration evidence. They do **not** establish acceptance in
an actual ChatGPT conversation. Keep this report tracked with the implementation.

Use one visible, named ChatGPT test conversation and synthetic redistributable
files. Record its link locally; do not publish private conversation links,
account identifiers, credentials, original user material or unredacted screenshots.
Record deployed commits and the host/browser/app version before testing.

| Actual ChatGPT scenario | Required observation | Current status |
| --- | --- | --- |
| Attach HTML, TXT, MD, PDF and image in ChatGPT; ask Arc to save them | Real file picker supplies attachments, tool confirms originals, website lists the same files | Actual host opens the uploader and selects an existing TXT through its library. Saving fails with an opaque host rejection; the failed boundary is still under investigation. Other formats remain pending. |
| Upload separate files through website; ask ChatGPT to find/read them | Same owner library, full fragments retrieved, exact code/details retained | 2026-09-12: 15 HTML originals saved; stored hashes matched local originals; actual ChatGPT found all 15 and read the first fragment of each. Complete multi-fragment reading remains a separate check. |
| Read a source longer than one fragment | All fragment indices and source hash checked; no summary substituted | Pending actual host |
| Read an image and a PDF diagram/scanned page | Assistant identifies synthetic visual details using actual image/page output; missing support is explicit | Pending actual host |
| Ask for an activity based on a source | Question is created/reused, activity appears in Today, exact source links survive reread | Pending actual host |
| Upload a changed version and retry an interrupted upload | Earlier original remains; exact retry avoids duplicate resources | Pending actual host |
| Ask ChatGPT to prepare a one-hour lecture and open its player | Script saved and the real widget renders free playback controls in the conversation | Actual ChatGPT opened the existing 43-word smoke-test player. A legacy generation attempt returned HTTP 429. Free device speech is implemented in PR #479; actual ChatGPT acceptance remains pending. |
| Play prepared speech for 60 minutes in the ChatGPT conversation | Measured listening duration, uninterrupted playback across all parts, no next-message prompts or navigation to Arc | Pending actual host/provider |
| Pause, close/reopen player and seek | Confirmed saved position resumes; expired media access refreshes | Pending actual host |
| Repeat on mobile, including app background and screen lock | Record each actual outcome separately; desktop success does not imply mobile success | Pending physical device |

For any failure, record the visible symptom, tool result where available,
whether it belongs to Arc or the host, and the exact retest. Do not sign off
based on a tool call alone: verify the resulting library entry, planned activity
or audible player state in the user's interface.

Production release d09bee22c64943bd3c234190c2ad37202c2e6fcc passed. Refreshing the
Interview Arc plugin and reloading the ChatGPT conversation exposed its tools.
Actual ChatGPT saved/listed a synthetic 43-word lecture and displayed its player.
Speech configuration was absent, so no audio was generated. The host already had
CSP disabled; strict CSP acceptance is not established by this render.

An actual attached TXT failed to reach the library because a supported host
download URL was not supplied. A later website upload test saved 15 HTML files;
ChatGPT independently discovered and read each first fragment. Stored original
hashes matched the source files. Larger original archives initially failed with
HTTP 413 before the library's handler, exposing the framework's 1 MiB multipart
server-action limit. PR #477, released from
`d1d8bc4d7ed30a126d6bc30df102b2828c7dbc13`, restored those uploads. All 15
complete-page archives are now saved with hashes matching their local archives;
each archive preserves its original HTML and companion assets. An additional
diagnostic Redis upload also completed, leaving one duplicate archive with the
same hash. It has not been deleted. These archives preserve assets; their
presence does not prove ChatGPT has visually read every embedded diagram.

Refreshing the plugin required activating Refresh with the keyboard because the
sticky header obscured the mouse target in the narrow viewport. A newly created
conversation then received the uploader tool; older conversations retained their
earlier tool inventory. The actual host's Select from ChatGPT dialog returned the
synthetic TXT selection, but saving reported only "Upload was not confirmed."
This is not a successful attachment-to-library test. The follow-up identifies
the failed file-access stage and preserves a bounded, URL-redacted host error
instead of discarding structured errors. No authentication or download allowlist
is relaxed.

Speech configuration was subsequently stored in both deployed Workers. Actual
ChatGPT confirmed the configured state and attempted the existing short section
once. The section is failed, with no ready audio. The server currently maps all
HTTP 429 responses to a generic rate-limit message. Free speech is required;
no further paid request is authorized. PR #479 implements speech on the listening
device with no PC connection. The built website and isolated iframe completed
two sections with an installed voice; website pause/resume and section selection
also passed. This is local acceptance, not proof of actual ChatGPT playback,
one-hour duration, physical mobile background playback or screen-lock continuity.


## Local integration observations

The local Workers test passes both upload adapters, exact original downloads,
PDF text and image retrieval, question creation, Today activity planning and
source links. It also passes source-backed Quick Study lesson creation, an exact
lesson-revision link and a planned Learning Session. The website browser test
passes original upload/download, full Markdown paging, saved HTML details, PDF
page rendering and desktop/390px layouts. These observations remain local
integration coverage; the actual ChatGPT rows above are still pending.

The review regression check holds an earlier search response until a later
search has rendered, then confirms the earlier response cannot replace it.
Upload-limit checks verify exact bytes at the limit, rejection and cancellation
above the limit, and hashes of file views with nonzero offsets. The revised
streaming upload path also passes the local Workers integration test.
