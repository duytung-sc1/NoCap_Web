# NoCap Web

NoCap’s browser client, developed alongside the Android app. Production:
https://ntlab.id.vn (Cloudflare Pages). The frontend uses the existing NoCap
Cloudflare Worker and does not deploy the backend or Android application.

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

Deployment uploads `dist` to the `nocap-web` Pages project. It does not commit
or push Git changes. Custom-domain caching must respect the response headers,
especially for HTML and `sw.js`, so installed clients can receive updates.
Authenticated API requests bypass service-worker caching and use `no-store`.
No admin credentials or payment-confirmation secrets belong in this bundle.

## Navigation and documents

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
- **Download file** saves the original document to the device. It is not an
  offline-mode toggle. Previously opened/imported content may remain in browser
  storage, but that storage can be cleared or evicted and is not a backup.

## Reading Memory and plans

| Feature | Free | Pro |
| --- | --- | --- |
| Reading, bookmarks, highlights, note editing/deletion | Yes | Yes |
| Markdown export | Yes | Yes |
| Manually add an individual note to the review schedule | Yes | Yes |
| Basic scheduled review | Yes | Yes |
| Automatically generate review cards from saved notes | No | Yes |
| PDF/Anki note export and quick review | No | Android only; not yet implemented on Web |

The policy follows Android `EntitlementPolicy` and `ReadingMemoryScreen`:
Markdown/basic review are free; automatic card generation is
`ADVANCED_READING_MEMORY`. Web checks the server entitlement before automatic
creation. It must belong to the current account, have an accepted status, remain
unexpired and have been verified within 24 hours. SePay monthly/yearly plans
are quoted by the backend; only the backend confirms payment.

Reading Memory edits preserve the annotation identity, quotation and locator.
Deleting an annotation tombstones its linked review cards as well. Account
changes remain in the automatic sync queue; local-only files stay local.

## Other behavior

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

## Boundaries

- This client is not a replacement for Android’s PDF/Anki export or quick-review
  modes. Advanced features need an active server-verified Pro entitlement.
- EPUB CFI from epub.js can differ from Readium on Android. Chapter/progression
  fallbacks are supported, but visual positions should be checked on both clients.
- Local `/dev-book/:id` proxies bounded catalog downloads for development.
  Production downloads use the backend’s document route.
- Browser sessions and cached files are scoped to the origin and account. Files
  under localhost or a temporary tunnel do not automatically appear on production.
