# Reading-based genre suggestions

Home and Explore can suggest up to three existing catalog genres, with a real source-book title explaining each suggestion. Selecting a genre opens Explore, clears a stale search, applies that category and restores the normal shelf/organization/sort filters. The existing Home recommendation shelf now selects available unread books from those matching genres, interleaved to avoid filling the shelf with only one genre.

The calculation runs locally over existing records for the active profile. It does not contact an AI provider, create new tracking records, inspect document text or infer personal traits. Existing synchronization continues to handle reading records as before. Suggestions are hidden while a different profile is loading, and records from other profiles are ignored explicitly.

## Reading signals and limits

- At least 5% saved reading progress, or a saved session with at least five seconds and a positive progress change of at least 1%.
- Duration alone is insufficient: legacy session duration measures elapsed time and can include an idle tab. Opening a cover or favoriting a book alone is not treated as genre evidence.
- Each distinct book contributes once, using its strongest available signal. Completed books have more weight; category ties have a stable ID order. These are simple matching heuristics, not proof that someone finished or understood a book.
- Only explicit, known genre metadata is used. Imported documents without reliable catalog categories do not produce invented genre classifications.
- Deleted/reset progress and older pre-reset sessions are excluded. A book explicitly reset to unread can become a candidate again.
- A genre is suggested only when it has an available public unread book. Already-opened books are excluded from the new-book shelf; Continue Reading is unchanged.
- Without suitable history, the Home shelf is labeled “Explore books” and shows a neutral selection. The feature does not display a fictional affinity percentage or claim AI analysis.

## UI and validation

The component uses the existing theme palette, language-based sans typography, normal keyboard-accessible buttons, 44-pixel minimum targets and a wrapping mobile grid. Vietnamese book titles retain Be Vietnam Pro even in an English interface. A source title remains available to assistive technology when its visual preview is limited to two lines.

Focused tests cover scoring and sparse catalogs, idle sessions, profile isolation, reset handling, input immutability, mixed-language rendering, source explanations, Home recommendations, clearing incompatible Explore filters and immediate profile-switch hiding. Browser validation uses fresh guest contexts and non-sensitive public book history on the local app; it does not modify production user records.

The production build and TypeScript check pass; lint has no errors and four pre-existing warnings. All 1,121 tests in 119 files pass, including 15 engine tests, five component tests and four new application integration cases. Browser evidence is retained in `D:/du an/NoCap-demo-assets/reading-recommendations-2026-11-20/`, with the distinction between a real reader-progress flow and explicitly seeded local UI cases recorded in the results.

Local browser validation passes 19/19 cases: an actual mobile Hound of the Baskervilles reading session saves about 45% progress and automatically produces a Mystery suggestion on returning Home; 18 additional UI cases cover 360/768/1366 pixels, both interface languages and all three existing themes. The UI cases seed only a fresh guest browser's IndexedDB with clearly identified QA reading records. There are no horizontal overflows or JavaScript errors; all suggestion targets exceed 44 pixels and Vietnamese source titles retain their own font in English UI. Selecting a genre clears incompatible search/category filters in every case.
