# Web administration integration — 12 October 2026

## Access policy update — 21 October 2026

Reader Web administration now requires an explicit account grant in
`admin_user_principals` for every `/api/v1/admin/*` request. Membership in
`admin_principals` through Google only grants the original cookie-based dashboard;
it no longer automatically exposes administration in the reader website. Login
method, display name and Free/Pro membership do not confer administrator access.
The original dashboard keeps its existing authorization rules and data.

The Web verifies that the returned administrator identity matches the signed-in
account. Switching accounts or restoring a previously signed-out token requires
fresh verification. An authorization failure removes the admin workspace and all
menu entries immediately while permissions are checked again. Both backend and
Web changes must be released to apply this update to the live website.

The implementation and validation notes below describe the original integration.

## User flow

Sign in through the ordinary NoCap Web login (Google or an existing account
password). The backend checks whether that account is linked to an explicitly
configured `admin_principals` identity. Approved accounts see **Quản trị / Admin**
in navigation and **Mở khu vực quản trị / Open administration** in account settings.
The workspace has its own `/admin` deep link, which survives sign-in and refresh.
Ordinary accounts and guests cannot open administrative data or perform actions.

The password used solely by the separate dashboard is not an ordinary user login
password. No dashboard password or Google client secret is shipped to the website.

## Shared implementation

- Web requests `/api/v1/admin/*` with its existing Bearer session.
- The Worker maps that prefix onto the existing `adminRoutes` implementation.
- Permission, verified-email and active-account checks run on every request.
- The original Worker `/admin` and `/api/admin/*` retain their cookie login,
  origin checks and existing functionality.
- Both interfaces operate on the same D1/R2 resources and administrator identity
  list. Catalog and account changes therefore also affect the phone application.
- No Android code, new user roles, database migrations or duplicate admin accounts
  are required for this feature.

## Functions

Overview; search and paginate public books; create/edit/remove catalog entries
using server revisions; create/edit/delete categories; search users; suspend or
reactivate accounts; revoke sessions; grant/revoke administrator-issued test Pro;
inspect conflict metadata; create/edit/delete scheduled announcements; scan R2
aggregate storage in batches; inspect audit history; change administrator avatar.

Protected administrator accounts cannot be suspended or have sessions revoked
through user-management controls. Revoking test Pro preserves paid subscriptions.
Private document contents and filenames are not exposed by storage/conflict views.

Web administrative access lasts one hour after login. Mutations still require
a login within the last 15 minutes. The user can sign in again on the same `/admin`
route; reader-session persistence is unchanged. API responses bypass browser/CDN
caches. Account changes cancel browser requests and discard late responses.

## Validation

- Web: 223 tests across 39 files passed, including admin forms, revision payloads,
  Pro confirmation, R2 scan accumulation, reauthentication, denied deep links and
  late responses after logout/account departure.
- Backend: 105 tests passed on the current production baseline, including six new Web-admin tests and all original
  dashboard tests.
- Web lint and TypeScript/Vite/PWA build passed.
- Worker deployment dry-run passed.
- Real local Workerd with isolated D1/R2: 19 HTTP checks passed, covering password
  login, admin/user authorization, catalog revisions, trial Pro, storage and audit.
- No production data was changed during these checks. Local browser checks covered
  the resized users table and pointer waves. Google Sign-In with the administrator's
  real account still needs verification.

## Cursor feedback

The Web cursor leaves sparse, curved teal crests that fade over 3.4 seconds.
Rendering follows elapsed time, reuses cached canvas images, and stops after the
last wave disappears. The effect is disabled in the reader, for touch input and
reduced-motion preferences; hidden tabs discard active waves. Users table columns
have stable widths, readable metadata and compact action buttons. Long email
addresses retain their full accessible text and a tooltip while truncating visually.

## Local verification environment

QA files and database are ignored under `.deploy-backup.local/admin-qa/`.
The QA Worker listens at `http://127.0.0.1:8787` and uses isolated local resources.
Run Web with `VITE_API_BASE_URL=http://127.0.0.1:8787` on a separate browser origin
(port 5174) to avoid replacing an existing production-backed local login.

## Publication

Release the backend through its normal pull-request flow, preserving the latest
production transaction fixes and applied migrations. Deploy the merged Worker
first, then publish the Web main branch with the production API base. No additional
database migration is required by this feature.
