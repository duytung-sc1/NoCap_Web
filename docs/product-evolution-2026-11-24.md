# NoCap: author workspace, translation and storage proposal

## Implemented first version

`/author` is a task-focused writing space: works list → chapter editor → explicit Save draft → rights confirmation → admin review. The admin has a dedicated Author submissions section. Draft and approved editions are separate. Plain text adapts to the existing reader, including chapter search, notes and highlights. Desktop uses a chapter rail next to the writing area; mobile stacks these areas with 44px controls. Shared light/dark/sage palettes and existing self-hosted Vietnamese/English sans fonts remain in use.

Reading AI adds selected-passage translation into Vietnamese, English, Japanese, Korean, Simplified Chinese and French. No page turns trigger requests. There is a 4,000-character translation bound and a shared maximum of 10 requests/account/Vietnam calendar day across all AI modes. AI access remains an admin pilot, as previously authorized; ordinary users have not been silently enrolled. Scanned/image-only PDFs require OCR, which this release does not implement.

## Storage proposal — not enforced or advertised yet

| Plan | Term | Proposed personal cloud quota | Proposed file maximum |
|---|---|---:|---:|
| Free | — | 250 MB | 100 MB |
| Khởi đầu / Starter | 1 month | 1 GB | 250 MB |
| Tập trung / Focus | 3 months | 3 GB | 250 MB |
| Đồng hành / Companion | 6 months | 5 GB | 250 MB |
| Bền bỉ / Steady | 1 year | 10 GB | 250 MB |

Cloud limits cover uploaded private documents and backups, not browser-only files or shared public catalog books. Do not count the shared copy once for every reader. Author manuscripts are currently D1 text, with their own explicit safety bounds; they are not R2 files. Existing Pro prices remain unchanged. Storage is separate from the shared AI budget.

On expiry, preserve read/download/delete, notify the account owner and block additional uploads if over the Free quota. Do not automatically delete paid users' existing documents. Warn at 80% and 100%. Grandfather existing over-limit accounts during a clearly communicated transition. Android must receive the same server rules and usable quota errors before enforcement.

R2 Standard storage is $0.015/GB-month; 10 GB-month is an account-wide free allowance, not a per-user allowance. At full occupancy the proposed 10 GB plan represents $0.15/month in storage alone, before operations, Worker/D1 costs, taxes or AI. These are capacity guardrails, not guarantees of profit or forecasts of actual use. Official pricing checked on 2026-11-24: https://developers.cloudflare.com/r2/pricing/.

The current implementation has two private upload paths: `sync/blobs` (up to 250 MiB/file) and `cloud` backup chunks (20 MiB/chunk, 128/512 object limits). Neither enforces aggregate account bytes. Enforcement therefore needs an owner/object ledger, initial R2 usage backfill, transactional per-account upload reservations, retry idempotency, actual-length/hash validation, cleanup of expired reservations/orphans and verified deletion accounting. Account limits must cover both upload paths. Existing documents and their references must be preserved during migration.

Billing currently grants FREE/PRO and records order `plan_days`. Increasing storage by duration needs a persisted storage tier and defined effective/expiry dates. Never infer the tier from days remaining or cumulative renewal time: twelve monthly purchases must not accidentally be classified as a yearly package. Define mixed-plan renewal behavior and Google Play mapping before enforcement.

## UI/UX direction based on comparable products

These are NoCap design recommendations, not claims that the referenced products share our architecture:

- Inkstone: separate creation, work management and chapters; visible draft/review/public states. Adopt this organization, keep NoCap's palette and avoid adding Income/Promote menus without those capabilities. Official guide: https://www.webnovel.com/inkstone/help/list?id=9.
- Reedsy Studio: prioritize the writing area and chapter organization; secondary metadata stays outside the main writing flow. Official FAQ: https://reedsy.com/studio/resources/book-writing-software-faq/.
- Readwise Reader: expose lookups/translations at the selected passage so reading can continue. Its documented Quick Lookup is mobile-specific; the principle informs NoCap's own web panel, not a copied feature claim. https://docs.readwise.io/reader/guides/ghostreader/quick-lookup.

Recommended next UI pass on the existing public app:

1. Signed-in home: put Continue reading first; keep long brand/marketing content on the guest home. Show recent documents and saved ideas below it.
2. Primary navigation: Explore, Library, Memory; keep Write as a distinct workspace entry and Account/Admin secondary. Avoid progressively widening the desktop header for every new feature.
3. Library: one primary Import button, unified search/filter row and consistent covers/cards; use empty states with one concrete next action.
4. Reader: keep the passage dominant, use one secondary panel at a time for notes/search/AI, and use a bottom sheet on phones. Keep selection and source position stable.
5. Reduce decoration: one corner radius scale, one border tone, fewer card-within-card layouts, consistent spacing and typography. Keep Vietnamese content language detection independent of interface language.
6. Account: simple used/available cloud bar, visible upload size limits, plan comparison and expiry behavior; do not claim unlimited storage.

The first version does not include OCR, automatic translation of entire files, rich-text authoring, cover upload, autosave/history or a site-wide redesign. These should not be advertised as shipped functionality.
