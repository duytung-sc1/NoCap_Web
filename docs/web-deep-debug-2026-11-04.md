# NoCap deep debug — 4 November 2026

## Scope and release status

Reviewed Web document lifecycles, chapter batch persistence, backup/restore, shared billing state, SePay settlement and administrator authorization. Fixes were first validated locally, then deployed on 4 November following the user's explicit deployment request. No Git commit/push, database migration, production payment, user provisioning or entitlement grant was performed. Existing unrelated worktree changes were preserved.

## Reproduced defects and fixes

### Billing and SePay

- An entitlement refresh could read FREE before a bank payment completed, then write its stale FREE snapshot over the newly settled Pro cache. A similar race could re-publish a revoked admin grant. Source selection and cache update now occur within one SQL statement.
- A new bank purchase previously extended the cached expiry even when its underlying admin grant was revoked or its Play purchase was on hold. Settlement now calculates extension from eligible live source records, while retaining supported active legacy snapshots. Duplicate-webhook guards remain intact.

Files: backend `src/billing.js`, `src/sepay.js`, new `src/entitlement-state.js`; regressions in `test/billing.test.js` and `test/sepay-concurrency.test.js`.

### Reader

- Pending EPUB initial-position work and retained epub.js events could display or publish a location after the reader closed. Retired lifecycles now stop these callbacks.
- Older asynchronous progression requests could complete over newer TOC/locator requests. Navigation generations invalidate superseded work.
- Rapid progression requests could call epub.js location indexing multiple times and append duplicate location entries. One promise is shared for each rendition.
- Replacing a parent `onLocation` callback cancelled and redrew the same PDF page. Rendering now uses the latest callback without depending on its identity.
- Replacing `onSpeechReady` invalidated an otherwise unchanged speech source. Speech publication now preserves source identity while updating the receiving callback.

Files: `src/Reader.tsx`, `src/Reader.lifecycle.test.tsx`, new `src/Reader.epubLifecycle.test.tsx`.

### Chapter imports

- The panel deleted its saved batch before validating/persisting a replacement. Failure could erase a recoverable download. Replacement is now owned by the transactional create operation.
- A synchronous IndexedDB write exception after deleting old chapter rows could commit the deletions, leaving job metadata whose completed chapters no longer existed. Failed mutations now explicitly abort and drain the transaction.
- A stale tab could replace a newer batch created elsewhere. Panel requests now compare their expected draft identity inside the transaction.
- A save completion from the previous profile could clear the current profile's busy state. Completion updates are bound to their owning controller.

Files: `src/chapterBatch.ts`, `src/ChapterImportPanel.tsx` and their tests.

### Backups

- Duplicate archive identities could silently overwrite saved notes or document bytes. Restore rejects ambiguous record/book/file identities before writing.
- Cached copies of the same book must be selected from the scope the reader actually uses: public books prefer `PUBLIC_OFFLINE`, cloud/private books prefer their account, with fallback when that copy is absent. Exports now contain one selected copy.
- Compatibility is preserved for older official v2 exports containing duplicate offline copies with identical book metadata, MIME type and bytes, even if cache timestamps differ. Conflicting copies fail validation rather than selecting arbitrary bytes.

Files: `src/backup.ts`, `src/backup.test.ts`.

## Independent review

Billing/settlement changes were reviewed separately for source eligibility, metadata, compatibility and idempotency. Archive review initially caught two regressions in the draft patch (incorrect public-cache precedence and rejection of harmless legacy duplicates); both were corrected, reproduced and rechecked before final validation.

## Final verification

- Full Web suite: **107 files, 1,022 tests passed**.
- Full backend suite: **212 tests passed**, no failures/skips.
- TypeScript, Vite/PWA build and Worker dry-run compilation passed. Scoped and full lint completed; full lint retains one non-blocking ref-cleanup advisory on the EPUB navigation-generation counter. The existing large-chunk build advisory remains.
- Live, anonymous GET checks passed for readiness, 60-book catalog and public announcements. Auth/user, admin identity/payment reporting, sync and entitlement routes all returned **401 UNAUTHORIZED** without a session. This was an access-boundary check, not live transactional testing.
- Production-build browser check at `http://127.0.0.1:5196`: opened a real public EPUB, switched notes → speech → notes and retained the unsaved Vietnamese draft, then cleared that QA draft; opened English EPUB/Vietnamese HTML comparison, opened notes and switched active source. Both panes remained visible at approximately 473 px each; the notes book changed correctly, with no alerts or recorded console errors.
- The IAB exposes no suitable native voices, so actual audio playback was not exercised there. Speech lifecycle is covered by automated tests.
- The initial dev-server check hit Vite's outdated optimized-dependency 504s after separate SSR review sessions reused its cache. The production build preview starts and runs correctly; this cache incident is not counted as a deployed product defect.

Artifacts: `D:/du an/NoCap-demo-assets/deep-debug-2026-11-04/` contains full test/build/lint logs, source hashes, anonymous live-check results, browser state and `comparison-notes.png`.

## Limits

This audit does not establish that every possible flow is defect-free. No real payment, production admin mutation, OAuth sign-in, physical Android/iPhone playback or two-device Web–Android synchronization was performed. Original PDF/image bytes and the separate Vietnamese/English sans-serif policy remain unchanged.

## Authorized release — 4 November 2026

- All 301 recorded source hashes still matched the validated sources before release. Independent release review found no blockers or new migration requirement.
- Worker deployed successfully: version `fa073006-a929-4edd-aeb0-6cbcdac29792`, replacing `3da6246c-77b5-452b-b510-6b575da9d651`.
- Pages deployed successfully: `https://e6a572b7.nocap-web.pages.dev`, production `https://nocap.rest`.
- Production serves `/assets/index-McMMzKkT.js`. Eleven published assets, including the Reader chunk, service worker, both language font families and three PDF WASM decoders, match the local build hashes. Five application routes return the new shell.
- Postdeploy Worker checks passed: public readiness/catalog/announcements 200; all five tested private/admin routes reject anonymous requests with 401. Catalog still contains 60 books.
- Published Pages import function returns 405 for GET and 403 for POST without Origin, confirming the function is present and its request boundary remains active.
- Browser first opened an older service-worker-cached shell; a normal reload loaded the new bundle. Computed styles on production confirm English uses Plus Jakarta Sans Variable and Vietnamese book text uses Be Vietnam Pro with `lang=vi`; no alerts were present. Screenshot: `production-home.png`.
- Release logs and machine-readable results remain in the artifact directory listed above. No live purchase or administrator enrollment was performed for verification.
