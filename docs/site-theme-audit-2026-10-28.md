# Website palette audit — 28 October 2026

Status: released to `https://nocap.rest` on 28 October 2026 after the user approved deployment.
Cloudflare Pages deployment: `https://3864a7fe.nocap-web.pages.dev`.
Production entry: `/assets/index-qL69fa8a.js`; stylesheet: `/assets/index-h3Py0n5o.css`.
The production bundle does not include the local demo theme initializer.

## Findings and implementation

The old theme rules excluded Light and several components retained fixed navy,
blue, mint or white surfaces. Switching the page background therefore did not
switch banners, labels, buttons and feedback panels consistently.

`public/site-theme.css` now owns the three palettes. `src/AppTheme.css` consumes
those tokens in all modes, including Light, and overrides independently loaded
component styles with sufficient specificity. Avoid adding new literal UI colors
to components; use the semantic `--site-*` tokens.

| Mode | Page | Panel | Primary text | Secondary text | Accent / action |
| --- | --- | --- | --- | --- | --- |
| Light | `#fdfcf8` | `#ffffff` | `#20252a` | `#5b646b` | `#252d33` |
| Dark green | `#111b19` | `#1a2723` | `#e6eee8` | `#afbeb3` | `#8bd4b3` |
| Sage | `#edf2e8` | `#f9fbf5` | `#24372b` | `#4c6252` | `#2d6246` |

Coverage includes navigation, banners, book-card text, account and Pro controls,
login/import dialogs, forms, announcements, feedback states, research controls,
folder-map branches, administration tables/charts, reading toolbars and note,
search and speech panels. Startup/recovery UI and the static legal pages share
the same saved appearance. Decorative canvas waves use the active accent.
Banner and chip star positions, page layout and interaction behavior are retained.

The privacy page permits its exact hashed appearance bootstrap under its CSP;
same-origin styles/fonts are allowed. Its legal content was not rewritten.

## Intentional boundaries

- Cover images, photos, original PDF/image document pixels and saved drawings
  remain unchanged. There is no global grayscale or color filter.
- Reading-paper presets and highlight/drawing colors retain their document
  meaning; surrounding reader controls follow the website palette.
- Google-rendered sign-in controls retain the provider's internal presentation.
- Vietnamese uses Be Vietnam Pro; English uses Plus Jakarta Sans. Content language
  remains independent of interface language, including combining marks.

## Verification

- Full test suite: 96 files / 934 tests passed.
- Theme, typography and preference regression checks: 29 tests passed; final
  contrast/cascade checks also run separately after the final CSS adjustments.
- Contrast tests require at least 4.5:1 for ordinary, muted and accent text on main
  surfaces, primary buttons and paired informational/success/warning/error states.
- Actual CSS cascade fixtures cover catalog/library cards, map-node labels,
  banners, notices, dialogs, Pro controls and lazy administration CSS.
- Browser checks covered Light/Dark/Sage catalog colors, account/appearance,
  home, memory, statistics, login/import dialogs, dark legal-page CSP and reader
  note/speech controls. Sage was also inspected at a 390 px mobile viewport.
- Authenticated administration workflows were not changed or exercised by this
  appearance audit; their color cascade is covered by the DOM fixtures.
- Build, lint and whitespace checks completed. A worker-start timeout during a
  parallel follow-up test run was resolved by running the focused checks with a
  single thread; it was not treated as a passing result.

## Local demos

The three staged copies share the same production build. A preview-only startup
script seeds the existing appearance preference separately on each local origin;
no demo-only behavior is added to the product source.

- Light: `http://127.0.0.1:5181/explore`
- Dark green: `http://127.0.0.1:5182/explore`
- Sage: `http://127.0.0.1:5183/explore`

Artifacts, logs, startup script and screenshots are under
`D:/du an/NoCap-demo-assets/theme-demos-2026-10-28/`.

## Release verification

The production HTML, shared palettes, service worker, entry script and stylesheet
were fetched from nocap.rest and verified byte-for-byte against the reviewed build.
All returned HTTP 200. Browser checks verified all three palettes, the translated
home eyebrow, removal of the vertical ornament, separate Vietnamese/English font
families and an empty error log. Existing PWA state updated successfully on reload.
Release logs, hashes and browser evidence are in
`D:/du an/NoCap-demo-assets/theme-release-2026-10-28/`.
