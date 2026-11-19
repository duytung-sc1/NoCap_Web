# Importing a range of story chapters

The Web import dialog has a **From story contents** source. It discovers real
chapter links, previews a selected range, downloads chapters through the existing
public HTTPS proxy, and creates one EPUB with EPUB 3 navigation and an NCX table
of contents for the existing readers. The Android application is unchanged.

## User flow

1. Open Import File → From story contents and enter a public contents URL.
2. Inspect the discovered list and the first/last selected chapter titles.
3. Select a range and a library title. If the source provides reliable, unique
   chapter numbers, ranges can follow those numbers; otherwise select positions
   in the contents list. Missing chapter numbers do not create invented links.
4. Optionally choose **Preview chapter content**. This reads only the first two
   selected chapters, displays a bounded plain-text opening, and creates no draft
   or library item. Changing the source, range or profile cancels the preview.
5. Download, pause, continue pending chapters, or retry failed chapters.
6. Add the generated EPUB to the library. Saving an incomplete selection requires
   an explicit confirmation and includes only the successfully downloaded chapters.

Completed chapter content is committed to a separate IndexedDB database before
the progress counter advances. There is one resumable draft per NoCap profile in
that browser. Closing the dialog or tab stops work; reopening the source picker
offers to restore the saved draft. This is a browser queue, not a server job that
continues while the browser is closed. Browser storage eviction can remove drafts.

## Bounds and source support

- At most 500 selected chapters per batch and 50 MiB of extracted HTML.
- Discovery: at most 80 contents pages and 10,000 distinct chapter links.
- Each HTML response: at most 8 MiB; each network request: at most 180 seconds.
- Two concurrent chapter downloads, a delay between requests, and an automatic
  stop after repeated failures. Failed chapters remain available for a manual retry.
- Generic discovery reads delivered HTML, inspects real same-origin chapter links,
  and follows recognized pagination links for the same contents page. Recognized
  React suspense fragments can be restored as inert markup without executing scripts.
- Site-specific adapters may use a website's public chapter-index data when its
  pagination is not represented by links. They do not execute remote scripts.
- SSTruyen's supported adapter reads its public chapter index with validated
  novel IDs, slugs and chapter routes, capped at 1 MiB per metadata response.
- TruyenDich's adapter cross-checks the delivered chapter links against its public
  streamed catalog data and follows the catalog routes used by that site's UI.
- **Source check** reports chapters received, pages read, and a verified, unverified
  or partial list. Only a known source's matching expected count is verified;
  a generic scan never claims that every chapter in a story was found.
- Partial lists retain usable chapters and distinguish page/count/size limits,
  failed pages, unsupported pagination and inconsistent source metadata. Explicit
  sign-in, access-denied, missing-page and rate-limit responses have separate messages.
- Content previews share a 30-second budget, show at most 1,000 characters per
  opening and stop further source requests on authentication, blocking or rate limits.
- Every network request uses the existing HTTPS/DNS/redirect validation. User
  credentials, cookies and referrers are not forwarded to the source.
- Login-only sources, CAPTCHA responses, and unrecognized client-side pagination
  are not supported automatically. The preview must not imply a complete list
  when discovery is interrupted or capped.

## Storage and export

Drafts are scoped by `profile`; an old request cannot overwrite a replacement
draft or recreate a discarded draft. Web Locks prevent concurrent runs from two
tabs where available; database transactions also protect completed results.

Source query parameters are retained only where needed for private local chapter
requests. Library attribution and EPUB source links strip these parameters.
EPUB generation re-sanitizes the saved content, excludes active/remote resources,
escapes metadata and removes characters forbidden by XML 1.0. The EPUB mimetype
entry is first and uncompressed. A failed library save retains the chapter draft.
Generated EPUBs include separate Be Vietnam Pro and Plus Jakarta Sans font files,
their licenses and a local stylesheet for sans-serif Vietnamese/English text,
including navigation and mixed-language passages. Font loading uses only bundled
application assets and can be cancelled. A font error leaves downloaded chapters
intact so export can be retried; original PDF/image documents are unaffected.

Tests cover a 1,200-entry catalog, middle-range selection, pagination, source
validation, pause/resume, failed-only retry, profile isolation, replacement races,
EPUB ordering, safe serialization and import dialog lifecycle.

Live verification used the supplied SSTruyen story `tuc-menh-chi-hoan`: 1,182
entries were discovered. Chapter-number range 501–700 contains 199 entries
because the source index omits number 671; selecting positions 501–700 instead
contains 200 entries. Chapters 501 and 502 were downloaded, paused/resumed,
packaged and parsed by NoCap's EPUB text extractor. The full story was not
downloaded for verification.

On 2026-10-27, the supplied TruyenDich URL ending in `/co-chan-nhan/trang-5`
yielded 2,429 chapters across 49 catalog pages. The UI selected numbers 201–400
as 200 chapters and successfully previewed chapters 201 and 202. Deployment
verification checked the same two samples through the public HTTPS proxy; the
full 200-chapter selection was not downloaded. Automated coverage includes
streamed markup, static and paginated catalogs, source-access failures, honest
completeness diagnostics, cancellation races and separate Vietnamese/English fonts.
