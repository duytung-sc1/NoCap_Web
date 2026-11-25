# Mở rộng danh mục sách — 22/11/2026

Đợt này thêm **100 đầu sách public domain** vào danh mục NoCap, không trùng với 100 sách hiện có. Danh mục được chèn theo kiểu add-only: không xóa, không sửa bản ghi cũ, không đụng dữ liệu người dùng.

## Thành phần

- **20 sách tiếng Việt** dựng EPUB từ văn bản trên Wikisource tiếng Việt.
- **80 sách tiếng Anh** lấy từ Standard Ebooks (bản public domain tại Hoa Kỳ, đóng góp biên tập CC0 1.0).
- Tổng: **100 sách**; tất cả đều có trạng thái kiểm tra `PASS`.

## Nguồn và quyền

- **Wikisource tiếng Việt:** tác phẩm gốc thuộc phạm vi công cộng; bản chép/chú thích của cộng đồng Wikisource theo CC BY-SA 4.0. Mỗi EPUB có trang “Nguồn và giấy phép” kèm liên kết bản nguồn và lịch sử đóng góp.
- **Standard Ebooks:** văn bản nguồn public domain tại Hoa Kỳ; đóng góp biên tập của Standard Ebooks được phát hành theo CC0 1.0. Giấy phép và ghi công gốc được giữ trong EPUB.
- Không có sách nào được lấy từ nguồn không rõ quyền. Không sửa nội dung gốc của EPUB nguồn.

## Kiểm tra trước khi publish

- Mỗi EPUB: ZIP CRC, `mimetype`, `META-INF/container.xml`, OPF, toàn bộ spine XHTML, tối thiểu 5.000 chữ cái và ít nhất một chương có nội dung.
- Mỗi tệp có SHA-256; tên tệp R2 dùng chính hash đó.
- Bìa Việt do NoCap trình bày; bìa Standard Ebooks giữ nguyên bytes JPEG gốc.
- SQL dùng `INSERT ... ON CONFLICT(id) DO NOTHING`; không có `DELETE`/`UPDATE` trên catalog.

## Phân bố thể loại

- `biography`: 1
- `drama`: 9
- `fiction`: 44
- `history`: 15
- `mystery`: 4
- `philosophy`: 8
- `poetry`: 12
- `romance`: 1
- `sci-fi`: 5
- `science`: 1

## Danh sách 100 sách

| # | Tên sách | Tác giả | Ngôn ngữ | Nguồn | Quyền | Dung lượng EPUB |
|---:|---|---|---|---|---|---:|
| 1 | Truyền kỳ mạn lục | Nguyễn Dữ | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 186,915 B |
| 2 | Việt Nam sử lược | Trần Trọng Kim | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 622,069 B |
| 3 | Hoàng Lê nhất thống chí | Ngô gia văn phái | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 291,205 B |
| 4 | Việt Nam phong tục | Phan Kế Bính | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 412,830 B |
| 5 | Vũ trung tùy bút | Phạm Đình Hổ | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 269,325 B |
| 6 | Nam Hải dị nhân liệt truyện | Phan Kế Bính | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 231,745 B |
| 7 | Thượng kinh ký sự | Lê Hữu Trác | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 13,909 B |
| 8 | Đại Việt sử ký toàn thư | Ngô Sĩ Liên | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 155,864 B |
| 9 | Ngư Tiều y thuật vấn đáp | Nguyễn Đình Chiểu | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 84,655 B |
| 10 | Chinh phụ ngâm | Đặng Trần Côn; Đoàn Thị Điểm | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 18,413 B |
| 11 | Bình Ngô đại cáo | Nguyễn Trãi | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 11,045 B |
| 12 | Cung oán ngâm khúc | Nguyễn Gia Thiều | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 18,045 B |
| 13 | Đại Nam Quốc sử Diễn ca | Lê Ngô Cát; Phạm Đình Toái | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 46,103 B |
| 14 | Thơ Tản Đà | Tản Đà | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 68,060 B |
| 15 | Thơ văn Nguyễn Đình Chiểu | Nguyễn Đình Chiểu | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 66,950 B |
| 16 | Đời cách mạng Phan Bội Châu | Phan Bội Châu | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 85,977 B |
| 17 | Thơ Hồ Xuân Hương | Hồ Xuân Hương | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 52,908 B |
| 18 | Thơ Nguyễn Khuyến | Nguyễn Khuyến | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 46,031 B |
| 19 | Thơ Trần Tế Xương | Trần Tế Xương | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 66,178 B |
| 20 | Thơ Nguyễn Trãi | Nguyễn Trãi | vi | Wikisource tiếng Việt | PUBLIC_DOMAIN_VN | 55,328 B |
| 21 | Nicholas Nickleby | Charles Dickens | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,193,308 B |
| 22 | Little Dorrit | Charles Dickens | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,151,746 B |
| 23 | The Pickwick Papers | Charles Dickens | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,292,413 B |
| 24 | Hamlet | William Shakespeare | en | Standard Ebooks | PUBLIC_DOMAIN_US | 650,917 B |
| 25 | Macbeth | William Shakespeare | en | Standard Ebooks | PUBLIC_DOMAIN_US | 472,833 B |
| 26 | King Lear | William Shakespeare | en | Standard Ebooks | PUBLIC_DOMAIN_US | 564,032 B |
| 27 | Othello | William Shakespeare | en | Standard Ebooks | PUBLIC_DOMAIN_US | 498,207 B |
| 28 | A Midsummer Night’s Dream | William Shakespeare | en | Standard Ebooks | PUBLIC_DOMAIN_US | 564,693 B |
| 29 | The Tempest | William Shakespeare | en | Standard Ebooks | PUBLIC_DOMAIN_US | 518,483 B |
| 30 | Anna Karenina | Leo Tolstoy | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,367,410 B |
| 31 | War and Peace | Leo Tolstoy | en | Standard Ebooks | PUBLIC_DOMAIN_US | 2,424,919 B |
| 32 | The Brothers Karamazov | Fyodor Dostoevsky | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,380,253 B |
| 33 | The Idiot | Fyodor Dostoevsky | en | Standard Ebooks | PUBLIC_DOMAIN_US | 977,982 B |
| 34 | Notes from Underground | Fyodor Dostoevsky | en | Standard Ebooks | PUBLIC_DOMAIN_US | 509,006 B |
| 35 | Les Misérables | Victor Hugo | en | Standard Ebooks | PUBLIC_DOMAIN_US | 3,022,078 B |
| 36 | Notre-Dame de Paris | Victor Hugo | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,204,286 B |
| 37 | The Count of Monte Cristo | Alexandre Dumas | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,657,264 B |
| 38 | The Three Musketeers | Alexandre Dumas | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,120,749 B |
| 39 | Around the World in Eighty Days | Jules Verne | en | Standard Ebooks | PUBLIC_DOMAIN_US | 667,376 B |
| 40 | Journey to the Center of the Earth | Jules Verne | en | Standard Ebooks | PUBLIC_DOMAIN_US | 900,467 B |
| 41 | The Mysterious Island | Jules Verne | en | Standard Ebooks | PUBLIC_DOMAIN_US | 905,802 B |
| 42 | The War of the Worlds | H. G. Wells | en | Standard Ebooks | PUBLIC_DOMAIN_US | 800,633 B |
| 43 | The First Men in the Moon | H. G. Wells | en | Standard Ebooks | PUBLIC_DOMAIN_US | 512,331 B |
| 44 | Lord Jim | Joseph Conrad | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,196,118 B |
| 45 | Nostromo | Joseph Conrad | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,078,522 B |
| 46 | The Secret Agent | Joseph Conrad | en | Standard Ebooks | PUBLIC_DOMAIN_US | 752,940 B |
| 47 | A Connecticut Yankee in King Arthur’s Court | Mark Twain | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,055,464 B |
| 48 | Short Fiction | Edgar Allan Poe | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,279,657 B |
| 49 | The Memoirs of Sherlock Holmes | Arthur Conan Doyle | en | Standard Ebooks | PUBLIC_DOMAIN_US | 682,214 B |
| 50 | The Return of Sherlock Holmes | Arthur Conan Doyle | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,338,733 B |
| 51 | Villette | Charlotte Brontë | en | Standard Ebooks | PUBLIC_DOMAIN_US | 812,476 B |
| 52 | The Tenant of Wildfell Hall | Anne Brontë | en | Standard Ebooks | PUBLIC_DOMAIN_US | 898,293 B |
| 53 | Silas Marner | George Eliot | en | Standard Ebooks | PUBLIC_DOMAIN_US | 721,462 B |
| 54 | The Mill on the Floss | George Eliot | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,148,994 B |
| 55 | Jude the Obscure | Thomas Hardy | en | Standard Ebooks | PUBLIC_DOMAIN_US | 763,500 B |
| 56 | The Mayor of Casterbridge | Thomas Hardy | en | Standard Ebooks | PUBLIC_DOMAIN_US | 789,237 B |
| 57 | The Portrait of a Lady | Henry James | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,041,695 B |
| 58 | The Age of Innocence | Edith Wharton | en | Standard Ebooks | PUBLIC_DOMAIN_US | 757,098 B |
| 59 | The House of Mirth | Edith Wharton | en | Standard Ebooks | PUBLIC_DOMAIN_US | 744,492 B |
| 60 | The Great Gatsby | F. Scott Fitzgerald | en | Standard Ebooks | PUBLIC_DOMAIN_US | 442,433 B |
| 61 | The Castle | Franz Kafka | en | Standard Ebooks | PUBLIC_DOMAIN_US | 973,397 B |
| 62 | The Cherry Orchard | Anton Chekhov | en | Standard Ebooks | PUBLIC_DOMAIN_US | 730,529 B |
| 63 | Dead Souls | Nikolai Gogol | en | Standard Ebooks | PUBLIC_DOMAIN_US | 839,183 B |
| 64 | Fathers and Children | Ivan Turgenev | en | Standard Ebooks | PUBLIC_DOMAIN_US | 630,452 B |
| 65 | Madame Bovary | Gustave Flaubert | en | Standard Ebooks | PUBLIC_DOMAIN_US | 765,270 B |
| 66 | Father Goriot | Honoré de Balzac | en | Standard Ebooks | PUBLIC_DOMAIN_US | 672,935 B |
| 67 | Germinal | Émile Zola | en | Standard Ebooks | PUBLIC_DOMAIN_US | 888,323 B |
| 68 | Tartuffe | Molière | en | Standard Ebooks | PUBLIC_DOMAIN_US | 521,175 B |
| 69 | Candide | Voltaire | en | Standard Ebooks | PUBLIC_DOMAIN_US | 571,770 B |
| 70 | Don Quixote | Miguel de Cervantes Saavedra | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,564,556 B |
| 71 | The Iliad | Homer | en | Standard Ebooks | PUBLIC_DOMAIN_US | 803,922 B |
| 72 | The Aeneid | Virgil | en | Standard Ebooks | PUBLIC_DOMAIN_US | 676,561 B |
| 73 | The Divine Comedy | Dante Alighieri | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,564,660 B |
| 74 | The Importance of Being Earnest | Oscar Wilde | en | Standard Ebooks | PUBLIC_DOMAIN_US | 419,025 B |
| 75 | Dialogues | Plato | en | Standard Ebooks | PUBLIC_DOMAIN_US | 2,973,040 B |
| 76 | Nicomachean Ethics | Aristotle | en | Standard Ebooks | PUBLIC_DOMAIN_US | 873,163 B |
| 77 | The Art of War | Sun Tzu | en | Standard Ebooks | PUBLIC_DOMAIN_US | 592,769 B |
| 78 | The Prince | Niccolò Machiavelli | en | Standard Ebooks | PUBLIC_DOMAIN_US | 459,559 B |
| 79 | The Origin of Species | Charles Darwin | en | Standard Ebooks | PUBLIC_DOMAIN_US | 972,425 B |
| 80 | The Communist Manifesto | Karl Marx | en | Standard Ebooks | PUBLIC_DOMAIN_US | 654,823 B |
| 81 | Thus Spake Zarathustra | Friedrich Nietzsche | en | Standard Ebooks | PUBLIC_DOMAIN_US | 699,685 B |
| 82 | The Wealth of Nations | Adam Smith | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,354,554 B |
| 83 | On Liberty | John Stuart Mill | en | Standard Ebooks | PUBLIC_DOMAIN_US | 580,157 B |
| 84 | The Social Contract | Jean-Jacques Rousseau | en | Standard Ebooks | PUBLIC_DOMAIN_US | 612,073 B |
| 85 | Leviathan | Thomas Hobbes | en | Standard Ebooks | PUBLIC_DOMAIN_US | 998,123 B |
| 86 | Tao Te Ching | Laozi | en | Standard Ebooks | PUBLIC_DOMAIN_US | 803,245 B |
| 87 | Analects | Confucius | en | Standard Ebooks | PUBLIC_DOMAIN_US | 526,434 B |
| 88 | The Prophet | Kahlil Gibran | en | Standard Ebooks | PUBLIC_DOMAIN_US | 441,551 B |
| 89 | The Rights of Man | Thomas Paine | en | Standard Ebooks | PUBLIC_DOMAIN_US | 682,829 B |
| 90 | The Souls of Black Folk | W. E. B. Du Bois | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,298,163 B |
| 91 | The Sketchbook of Geoffrey Crayon, Gent. | Washington Irving | en | Standard Ebooks | PUBLIC_DOMAIN_US | 889,009 B |
| 92 | The Wind in the Willows | Kenneth Grahame | en | Standard Ebooks | PUBLIC_DOMAIN_US | 848,232 B |
| 93 | Twenty Years After | Alexandre Dumas | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,133,206 B |
| 94 | Resurrection | Leo Tolstoy | en | Standard Ebooks | PUBLIC_DOMAIN_US | 960,031 B |
| 95 | The Gambler | Fyodor Dostoevsky | en | Standard Ebooks | PUBLIC_DOMAIN_US | 594,857 B |
| 96 | From the Earth to the Moon | Jules Verne | en | Standard Ebooks | PUBLIC_DOMAIN_US | 661,019 B |
| 97 | Under Western Eyes | Joseph Conrad | en | Standard Ebooks | PUBLIC_DOMAIN_US | 1,029,983 B |
| 98 | Typee | Herman Melville | en | Standard Ebooks | PUBLIC_DOMAIN_US | 827,394 B |
| 99 | The Prince and the Pauper | Mark Twain | en | Standard Ebooks | PUBLIC_DOMAIN_US | 680,019 B |
| 100 | The Valley of Fear | Arthur Conan Doyle | en | Standard Ebooks | PUBLIC_DOMAIN_US | 684,350 B |

## Ghi chú vận hành

- 100 sách cũ được giữ nguyên ID, metadata và thứ tự.
- Sách mới dùng ID `ws-vi-*` và `se-*`; có thể rollback riêng theo danh sách ID trong `catalog-assets/import-2026-11-22/catalog-import.json` nếu cần.
- Không có thay đổi nào đối với tài liệu riêng tư, ghi chú, highlight hay tiến độ đọc của người dùng.
