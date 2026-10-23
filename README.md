# NoCap Web

NoCap’s browser client, developed alongside the Android app. Production:
https://nocap.rest (Cloudflare Pages). The frontend uses the existing NoCap
Cloudflare Worker for accounts, storage and sync. Public HTTPS imports use a
same-origin Pages Function; deploying the web does not deploy the backend or Android application.

## Run locally

Requires Node.js 22+.

```powershell
cd "D:\du an\nocap-web"
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The default API is
`https://nocap-ebook-api.buiminhhien001.workers.dev`. For a QA backend, set
`VITE_API_BASE_URL` in an untracked `.env.local`.

The initial HTML shows a loading screen before JavaScript or fonts arrive. If
startup takes over 12 seconds or the application module fails, it offers a
manual page reload. A root error boundary also handles application render
failures. Recovery does not clear browser storage or reload automatically;
it cannot repair an unavailable network connection.

```powershell
npm test
npm run lint
npm run build
```

## Deploy

```powershell
npx wrangler login
npm run deploy
```

Deployment uploads `dist` and `functions/` to the `nocap-web` Pages project. It does not commit
or push Git changes. Custom-domain caching must respect the response headers,
especially for HTML and `sw.js`, so installed clients can receive updates.
Authenticated API requests bypass service-worker caching and use `no-store`.
No admin credentials or payment-confirmation secrets belong in this bundle.

Administrator accounts can use `/admin` after ordinary Web sign-in. The server
checks the existing administrator identity list; regular users cannot use its
APIs. This workspace reuses the backend dashboard operations and shared D1/R2
data. The separate backend dashboard remains available for app administration.
See [Web administration integration](docs/web-admin-integration-2026-10-12.md)
for the authentication contract, available functions and validation.

The sign-in form accepts an email address or an owner-provisioned administrator
login name. Registration and password recovery still use email addresses.
Administrator login names belong to the existing account; passwords, recovery
email and reader data are preserved. The backend enforces a one-hour privileged
session and a 15-minute cooldown after five failed password attempts shared
across that administrator's name and email. Apply backend migration `0016` and
deploy its authentication update before releasing this sign-in form.

The sign-in and registration forms expose **Remember me** (on by default to
preserve existing behavior). A remembered login stays in this browser until the
server-issued session expires; turning it off keeps the token in tab storage
only, including across reloads. Profile refreshes and edits preserve that choice.
The preference itself is a boolean; passwords are never written to browser
storage. Standard username/current-password autocomplete remains available to
the browser's password manager. Administrator sessions still expire after one
hour regardless of the choice. This is a Web-only change, with no backend or
database migration.

In **Administration → Users & Pro → Transaction history**, administrators can
view a selected account's SePay payment orders, amounts, plan durations, effective
statuses, payment/expiry times and transaction references. History is read-only,
paginated and filterable by status; it uses a server-authorized, uncached admin
API. Expired pending orders are displayed as expired without changing billing
records. Admin trial grants are shown separately and are never counted as paid
transactions. This view covers SePay orders, not Google Play purchase history or
unmatched bank transfers; **Audit log** remains the record of admin actions.

**Announcements** published by administrators appear below the Web navigation
for guests and signed-in readers. Only enabled notices within their start/end
schedule are displayed; the admin list distinguishes scheduled, live, expired
and disabled notices. The browser refreshes visible notices every minute, on
focus/return online, and immediately after a successful announcement save or
delete in that tab. Each message is plain text and can be dismissed for the
current tab session; an edited revision is shown again. Announcement failures
do not block loading or reading books. This uses the existing public Worker
endpoint and does not require a backend migration.

## Navigation and documents

**Account → Appearance** provides Light, Dark and Soft green website themes,
including a compact switch in the header. The preference stays in this browser,
works for guests, follows changes in other tabs, and is applied before the app
loads to avoid a bright startup flash. Storage failures leave it usable for the
current visit. Site appearance does not overwrite book-page colors or Android
reading settings; those remain separate reading preferences.

- `/`, `/explore`, `/library`, `/memory`, `/stats`, `/account`.
- `/books/:id` opens book details; `/read/:id` opens the reader. Browser history
  and direct links use the same routes.
- `/privacy` and `/terms` serve the public legal pages.
- Read EPUB, PDF, CBZ, DOCX, HTML, TXT/Markdown, JPG, PNG and WebP.
- PDF includes selectable text, highlight rectangles, page resume, and outline
  destinations resolved from named/explicit references, including nested entries.
  A heading without a valid destination never navigates to a guessed page.
- Import files into the current guest/account profile. Signed-in imports upload
  to private R2 storage. Guest files stay in the current browser.
- **Import document → From HTTPS link** downloads a public document or extracts
  readable article text from HTML, then uses the same file import/storage path.
  EPUB, PDF, CBZ, DOCX, TXT/Markdown, HTML, JPG, PNG and WebP are supported.
  The feature is free, supports progress and cancellation, and allows 250 MB
  files (8 MB maximum for HTML article extraction). Authentication-only pages,
  private-network destinations and HTTPS-to-HTTP redirects are rejected.
  Signed URL query parameters are used only for the download, not synced as
  source metadata. Remote cookies/headers are never forwarded.
- **Download file** saves the original document to the device. It is not an
  offline-mode toggle. Previously opened/imported content may remain in browser
  storage, but that storage can be cleared or evicted and is not a backup.

## Library folders (Web)

The personal Library offers **Normal** and **Tree** views over the same nested
folders. Create, rename and move folders; move documents individually or in
batches of up to 1,000, including back to the Library root. Breadcrumbs, an Up
button and Expand/Collapse all support deep navigation. Search and existing
filters find matching documents across folder paths. The view choice stays in
this browser; folders and document locations sync per account across Web devices.

Each document has one folder location. Tags and Collections remain independent
and keep their existing many-to-many memberships. Deleting a folder moves its
immediate documents and child folders to its parent, preserving files, reading
positions and notes. Backups include the hierarchy; restoring a previously
deleted folder uses a fresh identity to preserve server deletion semantics.
Guest folders remain local. Existing Android clients retain ordinary books and
collections but do not receive the new Web folder records.

Deploy the Worker folder-sync update before this Web build. Both `webResearch=1`
and `webLibrary=1` are requested by the new Web feed; a new local cursor namespace
replays existing account records once so older clients cannot skip folder rows.
No D1 migration is required. See [folder data and preservation](docs/library-folders.md).

## Account settings

On desktop Web (above 900 px), `/account` uses a settings sidebar with Profile,
NoCap Pro and Reading preferences panels. The existing rename, sign-out,
account-deletion confirmation, checkout and saved reading preferences are reused.
Switching panels preserves the selected billing period and an active checkout.
Phone-width Web retains the original banner and card layout. The Android app
is not changed by this redesign.

## Handwritten reading notes (Web)

Open a document, choose **Notes → Draw**, and sketch beside the text using a
mouse, stylus or touch. The optional expanded workspace keeps the same drawing;
Escape closes that workspace without leaving the reader. Tools include four
ink colors, three pen widths, a whole-stroke eraser, undo/redo and grid paper.
Switching between Type and Draw preserves both the caption and the drawing.

New-note drafts are saved in this browser per account/document and restored
when the book is reopened. **Save note** commits the vector drawing with its
source locator into the existing annotation store and sync queue. Local-only
documents remain local. Saved drawings can be viewed/edited in the reader and
Reading Memory, shown on the back of review cards, and included in Pro PDF
exports. This adds a Web side notebook; it does not draw ink over document pages
or add handwriting UI to Android.

Drawings use a bounded, validated data-only format (1,000 × 700 coordinates,
96 strokes / 1,800 simplified points / 20,000 JSON characters). The complete
annotation must fit the existing 32,768-character sync payload. Reaching a limit
shows a message and preserves the previous drawing instead of truncating it.

## Read aloud and voice samples (Web)

Reading a current section or selected passage uses the browser's speech service.
Local device voices are the default. Users can explicitly allow browser-provided
Google/Microsoft online voices; those providers may receive the text being read.
The option resets to off when the read-aloud panel is closed and reopened.
Voice availability depends on the browser and operating system.

The panel also offers a fixed official Google Cloud audio sample for the Vietnamese
female voice **Achernar**. The sample is requested from Google only when the user
presses its play button. It sends no book text, selection or notes to Google and
requires no API key. It is separate from browser online voices and does not make
Achernar available for reading the current book. No Google Cloud text-to-speech
API integration is added.

## Reading Memory and plans

| Feature | Free | Pro |
| --- | --- | --- |
| Reading, bookmarks, highlights, note editing/deletion | Yes | Yes |
| Handwritten notes beside the reader (Web) | Yes | Yes |
| Manually add an individual note to the review schedule | Yes | Yes |
| Basic scheduled review | Yes | Yes |
| Stealth Reading (Excel, VS Code, office-document disguises) on Web | No | Yes |
| Automatically generate review cards from saved notes | No | Yes |
| PDF note export | No | Yes, on Web and Android |
| Anki note export and quick review | No | Android only; not yet implemented on Web |

The policy follows Android `EntitlementPolicy` and `ReadingMemoryScreen`:
Basic review is free; automatic card generation is
`ADVANCED_READING_MEMORY`, and PDF note export is `KNOWLEDGE_EXPORT`.
Web checks the server entitlement before PDF export, automatic
creation and every Stealth Reading entry point (book cards, details, settings,
reader toolbar and F2). Stealth access ends when the account or entitlement
expires; normal reading remains available. It must belong to the current account, have an accepted status, remain
unexpired and have been verified within 24 hours. SePay monthly/yearly plans
are quoted by the backend; only the backend confirms payment.

Reading Memory exports a searchable PDF grouped by book, with highlights, notes,
bookmark snippets and chapter labels. Existing Markdown in notes becomes actual
PDF typography, headings, lists and tables; formatting delimiters are not printed.
Be Vietnam Pro regular/bold/italic/bold-italic fonts are
embedded for Vietnamese text. The generator and fonts load only when exporting;
notes and generated PDFs remain on the device. Account changes or expired Pro
access prevent a pending download. Markdown note export was removed from Web.
Markdown document imports and original-format document downloads are unaffected.
PDF generation uses [pdfmake's client API](https://pdfmake.github.io/docs/0.3/getting-started/client-side/methods/).
The full TTF fonts come from [Google Fonts' Be Vietnam Pro source](https://github.com/google/fonts/tree/main/ofl/bevietnampro)
under the existing `public/font-licenses/be-vietnam-pro.txt` license.

Reading Memory edits preserve the annotation identity, quotation and locator.
Deleting an annotation tombstones its linked review cards as well. Account
changes remain in the automatic sync queue; local-only files stay local.

## Stealth Reading controls

The Excel, VS Code and Word views have no visible NoCap control bar. Open
settings with **F1**, the Excel/Word **View** menu, or VS Code's **Manage** gear.
All controls, including panic and exit, are also available there without a keyboard.

The Excel view follows the desktop Home ribbon layout: alphabetic column
headers, a frozen field-label row, a selected-cell outline, name box/formula
bar, sheet tabs and a separate status/zoom bar. Enter an existing cell address
(for example, `C25`) in the name box to jump to that reading row. Filtering
preserves original worksheet row numbers and the underlying book position.
Font, size, bold/italic/underline, alignment, text wrapping, copy, find and
50–200% zoom work locally. The remaining spreadsheet tools and sheet names
are visual disguises, not a spreadsheet editor; they never change the book.
Narrow windows can scroll the ribbon and use the bottom horizontal scrollbar.
Visual reference: [Microsoft's Excel formatting ribbon](https://support.microsoft.com/en-us/excel/format-text-in-cells).

| Shortcut | Action |
| --- | --- |
| F2 | Enter Stealth (Pro required) / return to normal reading |
| F10 or Alt+F | Toggle real fullscreen, hiding browser tabs and address bar |
| F12 or Alt+P | Replace book content with work data / resume reading |
| Alt+1 / Alt+2 / Alt+3 | Excel / VS Code / Word |
| Up / Down / Space / J / K | Move one row |
| Page Up / Page Down | Move 15 rows |
| Alt+A | Toggle automatic row advancement |
| Alt+Left / Alt+Right | Decrease / increase seconds per row (2–20; default 6) |
| Alt+Up / Alt+Down | Increase / decrease text size (10–16px; default 12) |
| Alt+[ / Alt+] | Decrease / increase opacity (10–100%; default 100%) |
| F1 | Open / close settings and shortcut help |
| Escape | Leave fullscreen; then dismiss settings/filter/panic; otherwise Home |

Fullscreen requires a user action and browser support. When denied, settings
offer F11 as a browser fallback; normal reading still works. Closing Stealth or
revoking Pro exits only fullscreen owned by this view. Navigation shortcuts do
not interfere with typing, selecting a font size, or Ctrl/Cmd browser shortcuts.
Auto-advance pauses while settings or panic mode are open. Panic mode closes
settings and restores full opacity without changing the saved reading position.

## Other behavior

Reading comparison uses one shared toolbar for contents, search, notes,
bookmarks and appearance. Clicking, focusing or scrolling either document
selects its context without intercepting the first interaction. The current
tool stays open while switching sources; each document retains its own notes,
drafts, search query, appearance and position. Explicit search/Ctrl+F focuses
the search box; changing documents does not take focus away from reading.
Comparison dialogs declare their UI language locally: Be Vietnam Pro for
Vietnamese controls and Plus Jakarta Sans for English controls.

On phone-width Web (760 px and below), reading comparison shows the selected
source and runs only that source's document renderer. Switching sources keeps
separate reading positions, notes, searches and downloaded bytes. The inactive
source is removed from layout so EPUB iframes cannot cover or intercept the
selected source. Wider windows keep the two-document layout.

- Email/password and Google sign-in; profile rename and account deletion.
  Google OAuth origins must include the domain used to access the web app.
- Tags/collections, per-book reader preferences, original-file downloads.
- Automatic sync of Android-compatible records, live WebSocket updates,
  cross-tab notifications and explicit conflict resolution.
- Vietnamese/English interface, including notifications and reader dialogs.
  Book content and user-authored names/notes retain their original language.
- Reading statistics distinguish total active days from the current consecutive
  streak. Yesterday’s streak remains current until today ends without reading.
- Book details do not show fabricated ratings. A real ratings system is not
  currently implemented.

## Web analytics

The administrator workspace includes **Web Analytics** with Vietnam-calendar
Today/7/30/90-day reports, distinct estimated browsers and per-tab sessions,
page views, total/average active time, feature counts, traffic sources, UTM campaigns,
coarse device groups and aggregate CSV export.
These are browser estimates, not unique people, account DAU or live online presence.
The older overview count is explicitly labelled **Enabled accounts**.

`src/webAnalytics.ts` sends allowlisted page categories and event names,
random visitor/session IDs, event IDs and active milliseconds. Optional session context
contains a public referrer hostname, normalized `utm_source`, `utm_medium` and
`utm_campaign` slugs, and a desktop/mobile/tablet/unknown device enum. It never sends
full URLs, other URL parameters, document identifiers, titles, search queries,
account IDs, tokens, or raw user-agent strings.
The API hashes identifiers with its own key, rejects unknown fields, deduplicates
events, caps elapsed time and retains approximately 90 days of event history.
No third-party analytics SDK is used. Server collection must be enabled separately;
reports show disabled/empty states honestly and do not backfill historical traffic.

Active time uses visible, focused intervals and stops after 60 seconds without
interaction. Sessions rotate after 30 minutes idle. Counts are approximate,
especially with multiple tabs, network delays, browser blocking or cleared storage.
Telemetry is best effort and offline activity is not uploaded later.

Guests and signed-in users can opt out under **Account > Web privacy**.
The collector also honors DNT/GPC, omits credentials and the HTTP Referer header, and never
records administrator page views. Android is unchanged.

Collection defaults to the supported production domains only. Set
`VITE_WEB_ANALYTICS_ENABLED=false` to disable the client. For isolated local QA,
set it to `true`, point `VITE_API_BASE_URL` at a local Worker and explicitly allow
the local page origin in the local Worker's `WEB_ANALYTICS_ORIGINS`.
Never point local telemetry at production for testing.
The backend requires migrations `0014_web_analytics.sql`, `0015_web_acquisition.sql` and the secret
`WEB_ANALYTICS_KEY` (at least 32 characters), documented in the backend README.

Attribution is fixed at session entry. Valid UTM overrides the inferred source/medium;
referrer inference recognizes common search/social hosts, otherwise uses a referral
hostname or direct/no-referrer. A same-document session after 30 minutes idle starts
without campaign attribution, as do sessions after reconnecting or returning from
the administrator area. Reload restoration is allowed only for the first session
of a document. Historical sessions remain unknown; the dashboard
shows coverage and the first context collection time. Each source/medium or campaign
table shows up to 20 groups ranked by sessions, with an explicit truncation notice;
analytics CSV includes those same groups and all device groups. Distinct browser
counts across groups are not additive. No campaign-to-payment attribution is claimed.

Example campaign link:
`https://nocap.rest/?utm_source=facebook&utm_medium=social&utm_campaign=launch-2026`.
Labels normalize case, accents and whitespace to slugs of up to 64 characters
(`a-z`, digits, hyphens, underscores); URL/email-like labels and long digit runs
are discarded. Never place personal data in campaign tags.

## Payment reporting

**Administration > Payments & Pro** reports recorded SePay orders across accounts,
with paid amounts, paid orders, distinct paying accounts, 30/365-day plan breakdowns,
daily paid amounts and complete filtered CSV export (up to 10,000 orders).
Only PAID orders contribute to paid totals; admin-granted Pro is excluded.
PAID orders are dated by payment time, other statuses by creation time, in UTC+7.
Renewal/repeat-purchase metrics are intentionally omitted. See
`docs/analytics-benchmark-2026-10-21.md` for definitions and remaining analytics gaps.

## Boundaries

- This client is not a replacement for Android’s PDF/Anki export or quick-review
  modes. Advanced features need an active server-verified Pro entitlement.
- EPUB CFI from epub.js can differ from Readium on Android. Chapter/progression
  fallbacks are supported, but visual positions should be checked on both clients.
- Local `/dev-book/:id` proxies bounded catalog downloads for development.
  Production downloads use the backend’s document route.
- `/api/import` uses the same handler in Vite dev/preview and Pages production.
  It validates DNS and each of at most five HTTPS redirects, streams a bounded
  response, and returns no-store headers. Only that route runs a Pages Function.
  See [Pages Functions](https://developers.cloudflare.com/pages/functions/get-started/)
  and [Worker streams](https://developers.cloudflare.com/workers/runtime-apis/streams/).
- Browser sessions and cached files are scoped to the origin and account. Files
  under localhost or a temporary tunnel do not automatically appear on production.
