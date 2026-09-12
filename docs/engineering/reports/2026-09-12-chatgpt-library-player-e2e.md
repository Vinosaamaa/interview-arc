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
| Attach HTML, TXT, MD, PDF and image in ChatGPT; ask Arc to save them | Real file picker supplies attachments, tool confirms originals, website lists the same files | Pending actual host |
| Upload separate files through website; ask ChatGPT to find/read them | Same owner library, full fragments retrieved, exact code/details retained | Pending actual host |
| Read a source longer than one fragment | All fragment indices and source hash checked; no summary substituted | Pending actual host |
| Read an image and a PDF diagram/scanned page | Assistant identifies synthetic visual details using actual image/page output; missing support is explicit | Pending actual host |
| Ask for an activity based on a source | Question is created/reused, activity appears in Today, exact source links survive reread | Pending actual host |
| Upload a changed version and retry an interrupted upload | Earlier original remains; exact retry avoids duplicate resources | Pending actual host |
| Ask ChatGPT to prepare a one-hour lecture and open its player | Script saved, real widget renders in the conversation, generation controls invoke the configured speech provider | Pending actual host/provider |
| Play prepared speech for 60 minutes in the ChatGPT conversation | Measured listening duration, uninterrupted playback across all parts, no next-message prompts or navigation to Arc | Pending actual host/provider |
| Pause, close/reopen player and seek | Confirmed saved position resumes; expired media access refreshes | Pending actual host |
| Repeat on mobile, including app background and screen lock | Record each actual outcome separately; desktop success does not imply mobile success | Pending physical device |

For any failure, record the visible symptom, tool result where available,
whether it belongs to Arc or the host, and the exact retest. Do not sign off
based on a tool call alone: verify the resulting library entry, planned activity
or audible player state in the user's interface.

An authenticated production connector read currently succeeds. The new feature
tools still require release before their actual-host tests can pass. No real
ChatGPT feature test has yet been recorded as passed in this report.
