# Research workspace (Web)

Open **Reading Memory → Research workspace**. Android application code is unchanged.

## Topics and source links

- Create, rename and delete topics manually. A topic is a collection of references to original highlights/notes, not an automatic summary or a copied notebook.
- Add existing notes from several books; newest membership appears first. Editing the original note does not reorder it.
- Removing membership or deleting a topic preserves original annotations and shared flashcards.
- Explicitly choose **Add to review** for each note. Topic membership alone does not generate a card. One original annotation uses the existing shared `review_items` schedule across topics.
- Review by topic is a live set. Removing its current note, disabling its card or deleting the topic removes that note from a running session, including across tabs. Removal creates no review result.
- Mark two notes as **Same idea** or **Similar** yourself. Links are symmetric and can cross topics. One link opens both sources; multiple links offer a pair chooser and a single-source option.
- Source availability is checked before opening. Saved quotes remain readable when a source is unavailable.

## Comparison

Choose **Compare two sources** in Reading Memory or the reader toolbar. Select any two available books, including the same book twice. Each pane has independent position, paging, search, contents, appearance, bookmarks, annotations and drawing notes. Linked notes seed exact navigation locators.

The selected pane receives keyboard shortcuts. On narrow screens switch sources with the tabs; both readers remain mounted. Notes have separate retained drafts per account, source and pane. Reading positions are saved, including on close and pagehide.

## Exam preparation

A topic organizes ideas without a deadline. An exam plan separately stores a subject/name, exam date and explicitly selected topic/document scope. Selected documents contribute existing annotations; no notes or cards are generated.

- **Need review / Cần ôn lại** updates the existing schedule and adds a review history event.
- **Remembered / Đã nhớ rõ** updates that same schedule and resolves the latest weak status.
- **Skip / Bỏ qua** advances the session and records navigation history only. It does not change scheduling, weakness or reviewed progress.
- Exam sessions prioritize weak cards, with repeatedly missed cards first, then other due cards.
- Progress counts unique enabled cards with a meaningful rating since plan creation. It is not a claim of mastery. Old review schedules have no reconstructed attempt history; detailed history starts with this Web version.

## Data, compatibility and rollout

New sync kinds: `knowledge_topics`, `topic_annotations`, `annotation_links`, `exam_plans`, `review_attempts`. Records remain account-scoped in the existing IndexedDB/outbox and generic backend sync tables. No D1 migration is required.

Web opts in to `GET /api/v1/sync/changes?...&webResearch=1`. The updated backend hides these kinds from legacy clients before pagination, because Android's existing parser rejects unknown kinds. Web uses a new cursor namespace (`research-v1`) to replay previously filtered rows safely.

Deploy the backend change before publishing the updated Web. The previous production backend does not accept research writes. Local QA uses disposable in-memory Worker fixtures and a separate Web port; no production data or analytics are changed.

Research tombstones are not resurrected. Re-adding a membership/link uses a fresh UUID. If a remote deletion conflicts with an offline edit, the conflict UI explains that deletion must be accepted; original source annotations are preserved and users can create a fresh topic/plan themselves.

New research features are Web-only. Existing Android notes, reading progress and shared review schedules continue to use their original schemas.
