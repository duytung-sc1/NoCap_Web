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
4. Download, pause, continue pending chapters, or retry failed chapters.
5. Add the generated EPUB to the library. Saving an incomplete selection requires
   an explicit confirmation and includes only the successfully downloaded chapters.

Completed chapter content is committed to a separate IndexedDB database before
the progress counter advances. There is one resumable draft per NoCap profile in
that browser. Closing the dialog or tab stops work; reopening the source picker
offers to restore the saved draft. This is a browser queue, not a server job that
continues while the browser is closed. Browser storage eviction can remove drafts.

## Bounds and source support

- At most 500 selected chapters per batch and 50 MiB of extracted HTML.
- Generic discovery: at most 40 contents pages and 10,000 distinct chapter links.
- Each HTML response: at most 8 MiB; each network request: at most 180 seconds.
- Two concurrent chapter downloads, a delay between requests, and an automatic
  stop after repeated failures. Failed chapters remain available for a manual retry.
- Generic discovery reads static HTML, inspects real same-origin chapter links,
  and follows recognized pagination links for the same contents page.
- Site-specific adapters may use a website's public chapter-index data when its
  pagination is not represented by links. They do not execute remote scripts.
- SSTruyen's supported adapter reads its public chapter index with validated
  novel IDs, slugs and chapter routes, capped at 1 MiB per metadata response.
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

Tests cover a 1,200-entry catalog, middle-range selection, pagination, source
validation, pause/resume, failed-only retry, profile isolation, replacement races,
EPUB ordering, safe serialization and import dialog lifecycle.

Live verification used the supplied SSTruyen story `tuc-menh-chi-hoan`: 1,182
entries were discovered. Chapter-number range 501–700 contains 199 entries
because the source index omits number 671; selecting positions 501–700 instead
contains 200 entries. Chapters 501 and 502 were downloaded, paused/resumed,
packaged and parsed by NoCap's EPUB text extractor. The full story was not
downloaded for verification.
