# Three spaces in one NoCap account

## Remove header workspace switcher — 2026-11-25

At the owner's request, the Discover / Read / Write switcher has been removed from the application header at all widths. Its unused component, styles and dedicated component test were removed. The shared workspace stylesheet is now imported directly by App so the sidebar's push layout, synchronized motion fix and contextual navigation remain loaded. Sidebar destinations, phone bottom navigation, existing routes and author/reader workflows are preserved.

Released as Pages `2fc7f188`, main script `/assets/index-DvchZol-.js` and stylesheet `/assets/index-DP0NoaYf.css`. The deployed browser confirmed the switcher is absent in expanded and collapsed desktop layouts; mobile navigation still reaches Author Studio. Browser error logs were empty, and six live route/asset HTTP checks returned 200 with matching assets. Backend and production data were unchanged.

The seven relevant existing navigation/landing/sidebar/reader checks passed (106 unrelated cases skipped). Production build and lint passed with the same five existing non-blocking warnings. Browser checks against the compiled production preview covered the expanded 1920px header, collapsed sidebar, phone navigation at 390px, Author Studio access and desktop sidebar navigation. Evidence: `D:/du an/NoCap-private-release/header-workspace-removal-2026-11-25/`.

## Sidebar seam correction — 2026-11-25

The supplied 10-second desktop recording shows a light vertical strip during collapse, particularly near 0.5 seconds. Inspection confirmed that the sidebar transform used 200ms while the main area's margin/width used 220ms. The uncovered application shell also retained a hard-coded light-gray background in dark mode.

Released as Pages `8be16dba` with main script `/assets/index-q7KgoN0h.js` and stylesheet `/assets/index-R5NZdQZK.css`. Post-deployment sampling confirmed matching 220ms durations, matching dark backgrounds and no positive gap during collapse (edge difference under 0.01 CSS pixels). Browser error logs were empty; six live route/asset checks passed. No backend deployment was needed.

Desktop transform, margin and width now share the same 220ms easing token. The shell uses the current theme background, including during fractional-pixel rounding. Reduced-motion preferences still disable the transition, and the phone drawer retains its existing overlay behavior. No route, text, account or document behavior changed.

Production build/lint passed with the same existing warnings. Eight relevant existing landing/sidebar/navigation/reader regressions passed (106 unrelated cases intentionally skipped). Browser QA sampled actual screenshots and DOM edge positions while opening, closing and reversing the toggle at 1280px and 1920px. The sampled edges differed by at most 0.011 CSS pixels, with no positive gap. Light/dark shell colors matched the page; a 390px phone retained overlay, Escape, focus/inert and scroll restoration. Evidence is under `D:/du an/NoCap-private-release/sidebar-seam-2026-11-24/` (named for the date investigation began). The original recording and derived source images remain private because the recording contains account information.

## Landing sign-in entry follow-up

The owner requested that Open NoCap appear only after signing in. The landing header now shows Sign In to guests, including the readable label on mobile, and Open NoCap to authenticated users. Open NoCap goes directly to the existing Library workspace. Existing public discovery actions and routes are preserved. The landing regression covers both session states; all 110 App lifecycle tests passed, production build/lint passed with the same five existing warnings, and 360/390px guest header/login-dialog checks passed in both locales. No authentication, backend or account permissions changed. Evidence: `D:/du an/NoCap-private-release/landing-auth-entry-2026-11-24/`.

Released as Pages `b4e1dc35`, main script `/assets/index-Dh-0inTz.js`. Production Home/Explore and the deployment URL returned 200 with the matching asset; the deployed guest header showed Sign In and no Open NoCap, with no browser errors.

## Desktop push sidebar follow-up

The owner's clarified behavior is now implemented across the existing workspace routes: keep current menu destinations; default to expanded desktop navigation; use an overlay drawer on phones. At viewport widths of 1101px and above the fixed sidebar is 264px wide, with the main area explicitly reduced by the same amount. Collapsing restores the main area's width without dimming or disabling its content. The hamburger is at the start of the header, before the brand. The desktop expansion choice survives workspace navigation for the current application session, but is not stored across reloads. At 1100px and below the separate mobile/tablet drawer starts closed, traps focus, closes on Escape or navigation, and restores scrolling/focus on exit. Crossing the breakpoint clears the temporary drawer without overwriting the desktop preference.

Release: Pages `b3e9a8db`, main script `/assets/index-C6LYUuxb.js`, stylesheet `/assets/index-D3VylxGP.css`. All 1,151 frontend tests passed in 124 files; production build and lint passed (five pre-existing non-blocking lint warnings). Seven production route/asset checks returned 200 with the new bundle. A fresh deployed browser confirmed desktop push/collapse, phone overlay and clean landing return without console errors. Backend, production accounts and catalog were unchanged.

Landing still mounts no workspace menu or application navigation. Full-screen reading, book detail, comparison/review overlays and author focus mode retain the full viewport; leaving them restores the desktop preference. Existing authentication and admin grants are unchanged. No author drafts, books or production account data were modified for this change.

Expanded desktop book grids now wrap to the available content width. At narrower desktop widths the redundant header space switcher is hidden; its destinations remain in the sidebar. The admin workspace's own navigation also wraps into rows at those widths so it does not squeeze payment filters between two sidebars. Mobile bottom navigation and existing localized labels remain unchanged. Menu/content transitions respect reduced-motion preferences.

Browser checks covered 360/390px phones, 1024px tablet, 1101/1280/1440px laptops and 1920px desktop; both interface locales; light/dark themes; expanded/collapsed geometry; drawer focus/Escape; route changes; responsive breakpoint cleanup; and a real public EPUB opened full width and returned to Explore. Authenticated author focus/return and admin payment layout were additionally checked against the real Worker with isolated in-memory D1/R2 fixtures, without connecting production accounts or data. QA images and release evidence are in `D:/du an/NoCap-private-release/workspace-push-2026-11-24/`. Full-suite results are recorded in that release's JSON/logs. One pre-existing comparison-reader mock test raced its initial location effect under concurrent load; it now waits for the actual readiness publication before simulating a scroll, matching its neighboring regression. No comparison-reader production behavior was changed.

Landing/workspace separation follow-up: `/` retains the original branded landing, but does not mount the application drawer, hamburger, workspace switcher, context navigation or mobile application bottom bar. Its header has Open NoCap for authenticated users, entering `/library`; guests see Sign In. Public discovery remains available through the existing landing actions. Once inside the existing application routes, the switcher, drawer and responsive application navigation remain available. Returning to landing, including browser Back while the drawer is open, releases the body scroll/focus lock and removes the overlay. This pass does not create a separate deployment, require login for public browsing, change account permissions, or replace the original landing design.

The owner supplied the public/reader/author architecture on 2026-11-24. This pass implements the navigation foundation and author status filters, rather than adding placeholders for features that do not exist.

| Space | Current routes | Navigation behavior |
|---|---|---|
| Public Space / Khám phá | `/`, `/explore`, public book detail overlays | Home and Explore context links |
| Reader Space / Không gian đọc | `/library`, `/library/map`, `/memory`, `/stats`, existing reader overlays | Library, Memory and reading analytics context links |
| Author Studio / Sáng tác | `/author` | Works list, draft/review/published status filters and the existing chapter editor/review flow |
| Shared utilities | `/account`, `/admin` | Account avatar and grouped menu; admin entry still requires the actual server grant |

The desktop header switches spaces. Phones use Discover/Read/Write/More in the bottom bar. Secondary destinations follow the selected space. A grouped drawer keeps all supported destinations accessible at desktop and mobile widths; opening it preserves existing focus trap, Escape and inert behavior. Returning to the works overview warns before discarding an unsaved manuscript. Existing URLs, private libraries, document contents and authorization are preserved.

Shared foundation tokens in `public/site-theme.css` define 4/8/12/16/24/32px spacing, 6/10/16px radii and 44px controls. This pass applies them to the workspace controls and author filters. This is not a claim that every older component has already been migrated to the design system. The mint/navy/neutral palettes and self-hosted Be Vietnam Pro/Plus Jakarta Sans are retained.

## Reference research

- BookFusion: central personal library, organization and reading progress. https://www.bookfusion.com/
- Readwise Reader: focus on the document, highlighting and notes. https://readwise.io/read and https://docs.readwise.io/reader/guides/ghostreader/quick-lookup.
- Raindrop.io: collections, tags, filters and view choices. https://raindrop.io/.
- Open Library: public browse/search, subjects and book details. https://openlibrary.org/.
- Medium: dedicated draft/editor/publishing flow. https://help.medium.com/hc/en-us/articles/225168768-Writing-and-publishing-your-first-story and https://help.medium.com/hc/en-us/articles/213904978-How-to-submit-a-story-to-a-publication.
- Reedsy Studio: chapter sidebar and a writing-first interface. https://reedsy.com/studio/.
- Substack: separate draft and published post management; dashboard information should reflect actual measured activity. Its official dashboard announcement is historical (2023), not proof of the current authenticated UI. https://on.substack.com/p/dashboard.
- Wattpad was included in the owner's reference list. Its public page was requested; an authenticated writer flow was not inspected, so no undocumented functionality is inferred from it. https://www.wattpad.com/.

Research uses the official sites, not the mismatched illustrative image links in the supplied outline. No new third-party accounts, content publication or user-data uploads were needed.

## Next stages, not shipped by this pass

1. Signed-in home with Continue reading before long marketing content; refine Explore hierarchy and book cards.
2. Unify library search/filter/import and reduce nested decorative containers.
3. Refine reader notes/knowledge/review into one consistent reading workflow.
4. Author public profiles, rich formatting, cover upload, autosave/revision history and reader interaction need their own backend/permission work.
5. User research and moderated usability testing with real volunteers. No interviews or feedback are fabricated in this pass.

The storage proposal remains separate and unenforced. AI remains the admin pilot with a shared maximum of ten requests/day, including selected-passage translation. No analytics, subscribers, author income or engagement metrics are invented for the new spaces.

## Validation

The complete frontend suite passed 1,143 tests in 124 files. Existing admin visibility assertions were updated to reflect one grouped administration entry instead of two repeated entries. Lint reported only the four existing unrelated warnings; production build passed. Browser checks covered 1440px desktop and 390px mobile, grouped menu/focus/Escape, space switching, author overview return, all four author filters without horizontal scrolling, light/dark themes, both interface locales and Vietnamese content rendered with Be Vietnam Pro in English UI. Private local sample books are clearly marked as test data and were not published to the production catalog. Screenshots are under `D:/du an/NoCap-private-release/workspace-ui-2026-11-24/`.

Released to production Pages deployment `bc4992c8` with main asset `/assets/index-BoTETX5K.js`. Home, Explore, Library, Author and Admin shells returned 200 with the matching asset. The shared design tokens and workspace switcher are present in the live build; API health returned 200 and anonymous draft access remained 401. The backend was unchanged from the author/translation release. Detailed release references and QA results are in `D:/du an/NoCap-private-release/workspace-ui-2026-11-24/release.json`.
