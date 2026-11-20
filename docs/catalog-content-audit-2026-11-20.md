# Public catalog content and reader audit — 20 November 2026

This audit covers all 100 public books, including the 40 additions published on 19 November. The original EPUB files, book IDs, content hashes and content versions are preserved. Guest browser contexts opt out of analytics; no private account data is used or changed.

## Source content and public delivery

- Downloaded all 100 EPUBs from the public catalog file endpoints, checking HTTP status, EPUB MIME, expected size and SHA-256: 176,047,253 bytes in total.
- Validated ZIP CRC, the EPUB container/package, 2,998 spine items, 40,082 local resource references and 26,687 fragment references.
- Inspected 3,195 text/XML/SVG resources, 1,565 raster images, 357 stylesheets and one embedded font. No corrupt images/fonts, invalid controls, replacement characters, missing local references, identity mismatches or identical whole-book text were found.
- Restored 50 failing external cover URLs using the exact original cover images embedded in those EPUBs. Uploaded images were downloaded back and checked by MIME, byte count and SHA-256 before exact-row guarded catalog updates. All 100 final cover URLs respond successfully.
- Corrected one imported MARC title artifact: `Eloisa : $b or, A series of original letters` becomes `Eloisa: Or, a Series of Original Letters`, matching the original source. Catalog comparison confirms only this title and the 50 cover URLs changed during this audit.

## Reader repairs

Two source EPUBs expose only copyright/license navigation, although their actual reading content is complete. The reader now recovers missing navigation from the publication's real contents table or existing chapter IDs, preserving useful original navigation and original source nodes/CFIs. The affected editions are `gutenberg-32155` (20 original reading entries plus two existing legal entries) and `gutenberg-55179` (54 original chapters plus the existing license entry). Invalid/external links are excluded; cancelled or slow section loads do not prevent opening a book.

Old fixed-width illustration wrappers, title boxes, poetry blocks and large inline/class-based indents could push actual content outside a phone iframe. The reader constrains those wrappers, permits long headings to wrap and limits excessive indentation on narrow pages. Wide tables scroll inside the reader rather than clipping their contents. Source text, image pixels and EPUB bytes are unchanged.

Continuous EPUB navigation had overlapping display/resize work. A panel closing on a phone could restore an old CFI after a search selection; concurrent fill/update could start a second render on the same loading iframe and leave later navigation pending. The current rendition now serializes display and destructive resize work, retains the requested destination during reflow, and shares an in-flight iframe display. Superseded locations do not overwrite the requested location; a completed destination retires so later manual scrolling/resizing preserves the new reading position. These changes are instance-scoped, without modifying library prototypes.

## Validation scope

Browser validation checks opening every book and navigating to its first, middle and last substantial content sections on desktop and phone widths. It inspects visible geometry, real text, images, horizontal clipping and content-language fonts, including Vietnamese content in an English interface. Separate application-level checks cover searching, native passage selection, saving highlights/notes/bookmarks, reload persistence and returning to the original passage on representative Vietnamese and English books. Both recovered contents lists are checked at real source anchors on both viewport sizes.

Detailed per-book evidence, pre-change snapshots, exact-row rollback statements and raw browser output are retained in `D:/du an/NoCap-demo-assets/catalog-full-audit-2026-11-19/`. Earlier failed diagnostic runs are retained separately from final runs; they must not be counted as release passes.

This is structural validation of every source resource plus sampled visual/interaction validation within every book. It is not a claim that a human proofread every page or that all possible devices, networks and future bugs are covered. Original front matter, blank separators and legal pages are retained. Two Vietnamese editions use valid external catalog covers rather than an embedded EPUB cover.

The production build and TypeScript check pass. Lint has no errors (four existing warnings). The full automated run covers 1,097 tests in 117 files: 1,096 initially pass; the mocked App Escape-origin case fails once under the combined workload, then the complete 102-test App lifecycle file passes unchanged on isolated rerun. Its Reader is mocked, and a separate bounded Escape run also passes. This transient result is retained in the raw logs rather than omitted. Eight frozen-source application feature flows and two phone manual-scroll/panel-resize cases pass without browser errors.

Frozen-source ReaderPane validation passes for all 100 books at 1366×900/English UI and all 100 at 390×844/Vietnamese UI (375-pixel content iframe). Each viewport has 397 checks: initial opening and 297 first/middle/last source-section targets. No browser errors or actual off-frame text/image clipping are found. Hash guards confirm all 150 non-test product modules remain unchanged throughout both final runs. These source-section targets include original front/legal matter in some older split editions; production TOC checks separately select authentic reading entries.

## Production result

Released source commit: `4e467ddfd90b2b980ece49e8fd2d0f3b7a0c447e`.
Production: <https://nocap.rest>. Deployment: <https://21dd3f7b.nocap-web.pages.dev>.
Every production browser case verifies `/assets/index-D_FMsQz3.js`; the deployed entry and reader chunks also match the tested build by SHA-256.

| Verification | Result |
|---|---|
| Public catalog source downloads and archive integrity | 100/100 pass |
| Final cover URLs | 100/100 pass |
| Frozen-source desktop + phone book runs | 200/200 pass; 794 checks |
| Actual production desktop + phone book runs | 200/200 pass; 800 checks |
| Production reading TOC targets | 596 correct visible destinations; 4 additional within-document reading-scroll checks |
| Production representative feature flows | 8/8 pass; 66 checks |
| Production Escape closes the reader | 5/5 desktop cases pass |
| Production manual-scroll position survives panel changes | 2/2 phone cases pass |
| Browser JavaScript errors or final width/image warnings | 0 |

The production checks select authentic reading contents entries rather than counting only successful network requests or the presence of an iframe. All previously identified failing examples and both recovered TOCs pass. No blocking reading error was found in the final checks.

The [structured result](catalog-content-audit-results-2026-11-20.json) includes each book's identity, original SHA-256 and desktop/phone reading targets. Full raw browser evidence remains in the audit directory specified above.
