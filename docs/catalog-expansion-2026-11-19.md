# Public-domain catalog expansion — 19 November 2026

This release adds forty distinct original-English classics to the sixty existing public books. `catalog-additions-2026-11-19.json` records the exact catalog metadata and public asset hashes. Source EPUBs and unmodified original cover images are stored in NoCap R2 before catalog publication; existing titles, IDs, private documents, notes and reading positions are preserved.

## Provenance

Each book is an individually downloaded compatible Standard Ebooks edition. Source texts are identified by the publisher as U.S. public domain; the publisher dedicates its own editorial contributions under CC0 1.0. Original credits and license statements remain embedded. This is not a blanket worldwide copyright guarantee. The selected original-English authors are long deceased, and named cover artists were screened conservatively; ambiguous cover editions were excluded. Smithsonian CC0 evidence resolves the anonymous Frederick Douglass portrait.

- [Publisher rights policy](https://standardebooks.org/about/standard-ebooks-and-the-public-domain)
- [Smithsonian portrait license](https://www.si.edu/object/npg_NPG.74.45)

## Reader defect fixed during validation

Continuous EPUB layout can shrink an adjacent iframe before epub.js receives its asynchronous scroll event. The browser already applies part or all of the resulting scroll movement; the old counter then applies the full height delta again, drifting into the previous chapter and trimming the requested one. `synchronizeEpubScroll` now compensates only the remaining delta on the current rendition. Ordinary scrolling and source files remain unchanged. Seven regressions cover full and partial browser compensation, growth, opposite movement and horizontal scrolling.

## Validation and recovery

- All forty originals pass ZIP CRC, EPUB package/spine, manifest/link/fragment/navigation XML and substantial-text validation.
- Real ReaderPane rendering: forty books on desktop/English UI and forty on phone/Vietnamese UI; first, middle and last substantial spine documents are checked by their visible geometry and language-specific fonts.
- Eight existing books were retested with the same reader; Vietnamese retains Be Vietnam Pro inside English UI.
- Both EPUB and cover asset bytes are downloaded back and checked by SHA-256 before inserting catalog records.
- Publication uses add-only inserts guarded against duplicate IDs. The public catalog is checked for exactly one hundred distinct books, forty exact additions and sixty unchanged existing records. Exact-row rollback statements and the pre-change catalog snapshot are retained locally. No user data is modified.
- Post-publication verification checks the real public download endpoints and production reader.

## Added books

| Title | Author | Edition |
|---|---|---|
| Great Expectations | Charles Dickens | [Source](https://standardebooks.org/ebooks/charles-dickens/great-expectations) |
| Oliver Twist | Charles Dickens | [Source](https://standardebooks.org/ebooks/charles-dickens/oliver-twist) |
| David Copperfield | Charles Dickens | [Source](https://standardebooks.org/ebooks/charles-dickens/david-copperfield) |
| A Christmas Carol | Charles Dickens | [Source](https://standardebooks.org/ebooks/charles-dickens/a-christmas-carol) |
| Wuthering Heights | Emily Brontë | [Source](https://standardebooks.org/ebooks/emily-bronte/wuthering-heights) |
| Emma | Jane Austen | [Source](https://standardebooks.org/ebooks/jane-austen/emma) |
| Persuasion | Jane Austen | [Source](https://standardebooks.org/ebooks/jane-austen/persuasion) |
| Mansfield Park | Jane Austen | [Source](https://standardebooks.org/ebooks/jane-austen/mansfield-park) |
| Northanger Abbey | Jane Austen | [Source](https://standardebooks.org/ebooks/jane-austen/northanger-abbey) |
| The Picture of Dorian Gray | Oscar Wilde | [Source](https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray) |
| Gulliver’s Travels | Jonathan Swift | [Source](https://standardebooks.org/ebooks/jonathan-swift/gullivers-travels) |
| The Life and Adventures of Robinson Crusoe | Daniel Defoe | [Source](https://standardebooks.org/ebooks/daniel-defoe/the-life-and-adventures-of-robinson-crusoe) |
| The Adventures of Tom Sawyer | Mark Twain | [Source](https://standardebooks.org/ebooks/mark-twain/the-adventures-of-tom-sawyer) |
| The Call of the Wild | Jack London | [Source](https://standardebooks.org/ebooks/jack-london/the-call-of-the-wild) |
| White Fang | Jack London | [Source](https://standardebooks.org/ebooks/jack-london/white-fang) |
| The Secret Garden | Frances Hodgson Burnett | [Source](https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden) |
| Anne of Green Gables | L. M. Montgomery | [Source](https://standardebooks.org/ebooks/l-m-montgomery/anne-of-green-gables) |
| The Wonderful Wizard of Oz | L. Frank Baum | [Source](https://standardebooks.org/ebooks/l-frank-baum/the-wonderful-wizard-of-oz) |
| The Time Machine | H. G. Wells | [Source](https://standardebooks.org/ebooks/h-g-wells/the-time-machine) |
| The Invisible Man | H. G. Wells | [Source](https://standardebooks.org/ebooks/h-g-wells/the-invisible-man) |
| The Island of Doctor Moreau | H. G. Wells | [Source](https://standardebooks.org/ebooks/h-g-wells/the-island-of-doctor-moreau) |
| Black Beauty | Anna Sewell | [Source](https://standardebooks.org/ebooks/anna-sewell/black-beauty) |
| Tess of the d’Urbervilles | Thomas Hardy | [Source](https://standardebooks.org/ebooks/thomas-hardy/tess-of-the-durbervilles) |
| Far from the Madding Crowd | Thomas Hardy | [Source](https://standardebooks.org/ebooks/thomas-hardy/far-from-the-madding-crowd) |
| The Scarlet Letter | Nathaniel Hawthorne | [Source](https://standardebooks.org/ebooks/nathaniel-hawthorne/the-scarlet-letter) |
| Walden | Henry David Thoreau | [Source](https://standardebooks.org/ebooks/henry-david-thoreau/walden) |
| Up from Slavery | Booker T. Washington | [Source](https://standardebooks.org/ebooks/booker-t-washington/up-from-slavery) |
| Narrative of the Life of Frederick Douglass | Frederick Douglass | [Source](https://standardebooks.org/ebooks/frederick-douglass/narrative-of-the-life-of-frederick-douglass) |
| The Woman in White | Wilkie Collins | [Source](https://standardebooks.org/ebooks/wilkie-collins/the-woman-in-white) |
| The Moonstone | Wilkie Collins | [Source](https://standardebooks.org/ebooks/wilkie-collins/the-moonstone) |
| A Study in Scarlet | Arthur Conan Doyle | [Source](https://standardebooks.org/ebooks/arthur-conan-doyle/a-study-in-scarlet) |
| The Sign of the Four | Arthur Conan Doyle | [Source](https://standardebooks.org/ebooks/arthur-conan-doyle/the-sign-of-the-four) |
| The Lost World | Arthur Conan Doyle | [Source](https://standardebooks.org/ebooks/arthur-conan-doyle/the-lost-world) |
| King Solomon’s Mines | H. Rider Haggard | [Source](https://standardebooks.org/ebooks/h-rider-haggard/king-solomons-mines) |
| She | H. Rider Haggard | [Source](https://standardebooks.org/ebooks/h-rider-haggard/she) |
| The Jungle Book | Rudyard Kipling | [Source](https://standardebooks.org/ebooks/rudyard-kipling/the-jungle-book) |
| Kim | Rudyard Kipling | [Source](https://standardebooks.org/ebooks/rudyard-kipling/kim) |
| Hard Times | Charles Dickens | [Source](https://standardebooks.org/ebooks/charles-dickens/hard-times) |
| Bleak House | Charles Dickens | [Source](https://standardebooks.org/ebooks/charles-dickens/bleak-house) |
| The Red Badge of Courage | Stephen Crane | [Source](https://standardebooks.org/ebooks/stephen-crane/the-red-badge-of-courage) |
