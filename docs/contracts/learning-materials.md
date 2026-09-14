# Private learning materials

Learning Materials is a Learn reading collection, separate from Courses,
Lessons, practice attempts, timers and completion. Publishing means placing a
source-grounded reading page on the owner's authenticated website, never making
subscription content public.

`import_learning_source_url` saves the exact bytes returned by a public HTTPS
article/PDF URL. No credentials, cookies or redirects are followed. Workers
enforce public DNS destinations with `global_fetch_strictly_public`. A 200
response may still contain an excerpt or login screen; the assistant must read
it and identify coverage. Subscription content arrives through owner-uploaded
original files in the existing library.

YouTube descriptions are not transcripts. Use captions actually retrieved by
available browsing/transcript tools, or a supplied transcript export. Save
unchanged text with timestamps through `save_learning_source_text`, or use file
upload for the original TXT/VTT/SRT/HTML/PDF/image. Never reconstruct unavailable
captions. The official caption-download API requires video-edit permission and
is not used as a universal third-party video downloader. No local computer or
paid transcription service is part of publication.

`publish_learning_material` pins one immutable original resource and SHA-256.
ChatGPT reads every fragment and available visual evidence before writing a
detailed overview, topic explanations with source locations, and key notes.
Its complete/partial coverage claim and limitations are saved explicitly.
Publication verifies owner ownership and original bytes. It does not certify
that generated text is accurate; source locations make review possible.

D1 stores private immutable summaries and source references. Existing private
R2 holds unchanged original bytes. A stable operation ID deduplicates exact
retries; changed payloads fail closed and require a new publication identity.
No revision, edit or overwrite shortcut retargets a published source. List
pagination and full summary queries are owner-scoped. Private content never
enters Git, engineering records or public export.

Learn → Materials shows detailed notes first. The source disclosure fetches
reading fragments with the pinned SHA and never replaces earlier fragments.
Search explicitly covers loaded source parts. Original HTML runs in an opaque
sandbox with scripts, forms, network subresources and top navigation disabled;
inline styling and embedded images remain. External assets absent from a saved
page stay unavailable. Original downloads remain byte-identical. PDF/image
support depends on the browser's viewer; the download remains available.

Acceptance includes exact-byte retrieval, source identity failures, owner
isolation, changed retry conflicts, tool-to-website publication, safe original
rendering, mobile reading and real connected ChatGPT end to end.
