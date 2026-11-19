# Chapter-import development proposal — 28 October 2026

This is a source audit and development proposal, not a deployed implementation.

## Existing behavior verified in source

- Generic HTML catalog discovery, recognized streamed markup, SSTruyen public
  index support and a TruyenDich-specific catalog reader are implemented.
- A scan is bounded to 80 contents pages / 10,000 chapter links. The UI reports
  verified, unverified or partial discovery rather than assuming completeness.
- Selection supports one contiguous interval by reliable chapter number or by
  catalog position; the UI already reports gaps and previews the interval ends.
- Optional content preview reads at most the first two selected chapters.
- Each batch allows at most 500 chapters and 50 MiB of extracted HTML. Two workers
  download chapters with a fixed 500 ms delay between work items per worker.
- Pause/resume, durable chapter commits, failed-only manual retry and EPUB export
  already exist. There is one saved draft per profile/browser. Closing the dialog
  or tab aborts the active run; there is no server-side background job.
- Export embeds separate Vietnamese and English sans-serif fonts. Source URL,
  DNS, redirect, HTML sanitization and profile-isolation protections already exist.

## Gaps found

The worker marks most request failures as chapter errors and stops after a shared
failure threshold. It does not yet implement a retry schedule, source-wide
cooldown, or transport the upstream Retry-After value to the queue. Access-denied
and authentication failures are recognized, but are not immediate queue-wide stop
conditions in `runChapterBatch`.

Draft storage uses the profile as its primary key. It cannot retain an independent
queue of several books. URL duplicate checks apply to the new draft, rather than
to chapters imported in previously completed library items. Imported books do not
yet have a durable source/edition/chapter manifest for incremental updates.

Catalog detection and both named source readers share one discovery module.
Content extraction is generic. A long but incorrect passage or two different
URLs returning the same chapter can still require user inspection.

## Proposed delivery order

### 1. Reliable requests and source coverage

Keep source readers separately testable behind a registry selected by an exact
supported hostname and validated story/edition identity. Add sources from real
user examples, with one catalog fixture and a small live sample per source.
Retain generic discovery for ordinary public HTML.

For transient network/time-out/server failures, allow a bounded retry policy
(proposed default: at most two retries, delayed and cancellable). A 429 response
creates a source-wide cooldown; respect a valid Retry-After delay/date. An
excessive wait pauses the job with an explanation instead of holding it silently.
Authentication or explicit blocking stops the active source queue. User pause,
offline pause and source cooldown must remain distinct so reconnecting cannot
undo an explicit user pause. Keep the current low concurrency and size bounds.

For an unrecognized contents layout, offer a user-supplied list of real chapter
links as an optional fallback. Validate, deduplicate and preview those links;
this is not a mechanism for accessing blocked chapter content or guessing URLs.

Acceptance: cancellations stop pending retries; a rate-limit response prevents
new requests to that source until its cooldown expires; already stored chapters
survive; unsupported layouts have a useful next action.

### 2. Select chapters flexibly and inspect content

Add multiple intervals and optional per-chapter inclusion, for example
201–300 plus 501–550 (150 actual entries if all exist). Retain the distinction
between chapter number and list position. Selection is capped across all ranges.

Add an optional first/middle/last preview within a small explicit request budget.
After extraction, flag suspiciously short content, inconsistent titles and exact
duplicate normalized chapter bodies. Warnings need user review; a short prologue
or repeated introductory text must not be deleted automatically. Keep the raw
source title alongside the catalog title for diagnosis.

Acceptance: overlapping intervals deduplicate; omitted numbers remain omitted;
the EPUB order matches the selected source order; short legitimate chapters have
an explicit review path; duplicate warnings do not silently change the selection.

### 3. A download workspace with several saved jobs

Move the foreground queue controller outside the import dialog so minimizing it
does not stop a download. Show a small progress indicator while using other NoCap
pages. Add a dedicated list of queued, downloading, paused, failed and completed
jobs, with last activity and storage usage.

Migrate the existing single draft without discarding it. Store jobs by job ID and
index them by profile; keep ownership checks and cross-tab locking. Initially run
only one job at a time, with a global source request budget. Check storage before
large batches; an optional persistent-storage request may be denied and must not
block ordinary use. Clear completed jobs only through an explicit user action.

Acceptance: importing a second story does not replace the first draft; a reload
restores both; changing profiles never exposes another profile's drafts; quota
failure preserves successfully committed content and offers export/recovery.

### 4. Fetch newly published or not-yet-imported chapters

Attach an import manifest to completed books: source identity, edition, selected
chapter identities, successful chapters and content fingerprints where available.
Retain identity-bearing query parameters; do not conflate different chapters by
stripping every query parameter. Never merge translations/editions automatically.

On an explicit "Check new chapters" action, refresh the catalog and propose the
missing entries. Example: after 1–200, offer 201–250 when those entries exist.
In the first release, save this as a new volume associated with the same story.
Rewriting an existing EPUB can invalidate reading locations and note anchors and
requires a separate migration design. Previously edited chapters should be shown
as possible updates and require an explicit decision.

Acceptance: repeated imports do not redownload known successful entries by
default; failed/missing entries remain recoverable; existing notes and reading
positions are preserved; an edition change requires confirmation.

### Later: split a large selection into bounded volumes

Use the multi-job workspace to split a user selection into volumes, such as 1–200,
201–400 and 401–600. Each job retains the current chapter/content limits, and the
workspace also needs a total storage budget. This should follow reliable jobs and
source identity rather than merely increasing the current 500-chapter limit.

## Browser limits and references

Screen Wake Lock can help keep a visible download page awake, but does not provide
guaranteed execution after the page is hidden or closed. Background Fetch is not
widely supported; Background Sync is not a portable solution for long downloads.
For the Web release, promise durable resume and progress while the app is open.
Guaranteed closed-browser execution needs a separate server-job design.

- Retry-After semantics: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After
- Persistent storage is subject to browser approval: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- Background Fetch support and long-running task limitations: https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API
- Visible-document wake locks: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API

The SSTruyen example was inspected again via its public contents page. The search
tool could not retrieve the supplied TruyenDich page during this research; its
previous live verification remains recorded in chapter-import.md and should not
be represented as a fresh successful live test. No bulk story download was run.

## Validation plan

Use deterministic fixtures for large catalogs, retry/cooldown timing, duplicate
content, overlapping selections, schema migration, storage failure and profile /
cross-tab races. Keep live checks small (a catalog and a few chapter samples) and
separate source compatibility from queue reliability. Review desktop/mobile UI,
all three site palettes, Vietnamese combining marks and independent VI/EN fonts.
