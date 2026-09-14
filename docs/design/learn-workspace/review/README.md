# Learn UI review

Interactive HTML proposal for issues #407 and #486. Approved by the user for implementation on 2026-09-14. This HTML remains the design reference; production behavior is implemented in the shared React readers.

Follow the existing workspace shell and Interview Arc design system. Materials, Library, Today, Courses, lesson reading, Homework, History, the lecture player, and separate Live Chat Controls share the established visual language.

## Required responsive behavior

- Mobile: verify 360 × 800 and 390 × 844, touch targets, bottom navigation, and index/reader switching.
- 720p: verify 1280 × 720, usable navigation and controls within the shorter viewport.
- 1080p: verify 1920 × 1080 with aligned hero, context rail and reader.
- 4K: verify 3840 × 2160, centered bounded reading width and readable typography without stretching paragraphs across the display.
- All sizes: no horizontal page overflow, overlapping text, clipped controls, or inaccessible content.
- Material reader: Contents at the top; expandable complete timestamped transcript; full-screen reading, search, and Close that returns to the reader.

Use illustrative content only in the mock. Production must preserve the full original transcript and distinguish summaries from original source text. YouTube captions should be imported as timestamped text, not converted to PDF.

The mock currently demonstrates all nine destinations and the full-screen transcript interaction. Production Today freshness and PDF loading repairs remain separate implementation work.
