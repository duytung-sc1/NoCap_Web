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

The component uses the existing theme palette, language-based sans typography, normal keyboard-accessible buttons and wrapping category pills with 44-pixel minimum targets. The heading and short context share a line where space permits. The full source explanation is available through the button's hover tooltip and accessible description without reserving a large card row. Vietnamese source titles retain Be Vietnam Pro in the accessible markup even in an English interface.

Focused tests cover scoring and sparse catalogs, idle sessions, profile isolation, reset handling, input immutability, mixed-language rendering, source explanations, Home recommendations, clearing incompatible Explore filters and immediate profile-switch hiding. Browser validation uses fresh guest contexts and non-sensitive public book history on the local app; it does not modify production user records.

The production build and TypeScript check pass; lint has no errors and four pre-existing warnings. All 1,121 tests in 119 files pass, including 15 engine tests, five component tests and four new application integration cases. Browser evidence is retained in `D:/du an/NoCap-demo-assets/reading-recommendations-2026-11-20/`, with the distinction between a real reader-progress flow and explicitly seeded local UI cases recorded in the results.

Local browser validation passes 19/19 cases: an actual mobile Hound of the Baskervilles reading session saves about 45% progress and automatically produces a Mystery suggestion on returning Home; 18 additional UI cases cover 360/768/1366 pixels, both interface languages and all three existing themes. The UI cases seed only a fresh guest browser's IndexedDB with clearly identified QA reading records. There are no horizontal overflows or JavaScript errors; all suggestion targets exceed 44 pixels and Vietnamese source titles retain their own font in English UI. Selecting a genre clears incompatible search/category filters in every case.

Released to <https://nocap.rest> from commit `1adfef9986a5e5f07c54828a3a64f813d13aff3d` (deployment <https://f30bf600.nocap-web.pages.dev>). The live entry `/assets/index-CDh4rNKD.js` matches the tested build by SHA-256. Post-deployment verification passes 7/7 cases on that exact entry: the actual mobile reading-to-genre flow and six guest UI cases spanning mobile Vietnamese/desktop English and all three themes. No browser errors or clipping are found. Test history remains in fresh, unauthenticated browser storage; no production account data is changed.

The compact presentation replaces the large two-line cards with wrapping category pills. All nine existing component/filter-integration checks pass, as do the build, TypeScript and lint checks. A fresh 19-case local browser run repeats the actual reading flow and the full viewport/language/theme matrix. At 360 pixels, the representative three Vietnamese genres fit on one row; the section is 70.5 pixels high and every button remains 44 pixels high. Filter behavior, accessible source explanations and content-language fonts are preserved.
