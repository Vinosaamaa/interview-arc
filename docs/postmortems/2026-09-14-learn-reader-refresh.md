# Learn reader and Today refresh follow-up

Date: 2026-09-14. Issues: #407 and #486.

## Impact and detection

Materials and the resource library used independent page chrome. The reader lacked a full-screen source view, and a failed lazy PDF module exposed an implementation error. Learn Today could remain stale after a connected specialist saved a newer session.

## Confirmed causes

Learn fetched its projection on mount but did not subscribe to the existing owner-scoped live update channel. Learning MCP mutations omitted invalidation. Today also selected current lesson content without checking the session's pinned lesson revision. An old planned session and a newer completed session are valid simultaneous records; completion must not replace the active timer.

The reported PDF failure named a hashed JavaScript asset. A stale asset reference is a hypothesis, not a proven deployment-retention failure. A fresh built original PDF preview rendered successfully.

## Resolution

Reuse the existing Learn hero, frame, paper, typography and navigation. Keep the library inside that shell. Add top Contents, complete-source full-screen reading, search, and focus restoration. Provide retry, reload and original-file actions for PDF preview failures.

Publish content-free Learning invalidations after committed MCP and website mutations. Refetch the authoritative projection on those events, reconnect and focus. Reject older overlapping fetch responses. Return exact owner-scoped lesson revisions with sessions, and show a newer completed lesson separately from an unfinished session.

YouTube captions remain timestamped text. Connected ChatGPT read every caption part and published a separate source-backed material; the earlier PDF-backed publication was preserved. Browser caption export is a fallback when hosted retrieval cannot obtain captions, not a guarantee that every video exposes them.

## Verification and prevention

Focused reader, route, model and event tests passed. The Learning Session integration test passed with exact revisions, timers, transcript integrity and owner isolation. The built browser reader loaded the complete synthetic transcript, found its final marker and rendered an original PDF. Responsive checks cover phones and 720p, 1080p and 4K layouts.

Windows test cleanup initially obscured results with a locked D1 file. Cleanup now retries bounded temporary-file removal and releases the test lock even if removal fails.

Hosted validation and production release evidence belong in the linked PR and issue resolution after they complete. No release success is asserted by this document.
