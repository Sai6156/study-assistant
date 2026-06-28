"""Estimate printed page numbers during report build (two-pass TOC)."""


def _to_roman(n: int) -> str:
    vals = [
        (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
        (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
        (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
    ]
    out = ""
    for value, numeral in vals:
        while n >= value:
            out += numeral
            n -= value
    return out


class PageEstimator:
    """Simulate pagination to assign TOC page numbers."""

    LINES_PER_PAGE = 30

    def __init__(self):
        self.lines_on_page = 0
        self.roman_page = 1
        self.arabic_page = 1
        self.mode = "roman"  # roman | arabic
        self.pages: dict[str, str] = {}
        self._pending_chapter: str | None = None

    def _display_page(self) -> str:
        if self.mode == "roman":
            return _to_roman(self.roman_page)
        return str(self.arabic_page)

    def _advance_page(self):
        if self.mode == "roman":
            self.roman_page += 1
        else:
            self.arabic_page += 1
        self.lines_on_page = 0

    def add_lines(self, n: float):
        self.lines_on_page += n
        while self.lines_on_page >= self.LINES_PER_PAGE:
            self.lines_on_page -= self.LINES_PER_PAGE
            self._advance_page()

    def page_break(self):
        if self.lines_on_page > 0.5:
            self._advance_page()
        else:
            self._advance_page()

    def new_section(self, fmt: str, start: int | None = None):
        self.page_break()
        if fmt == "decimal":
            self.mode = "arabic"
            self.arabic_page = start or 1
            self.lines_on_page = 0
        elif start == 1 and self.roman_page == 1:
            self.mode = "roman"
            self.roman_page = 1
            self.lines_on_page = 0

    def register(self, title: str):
        title = title.strip()
        if title:
            self.pages[title] = self._display_page()

    def heading(self, text: str, level: int = 1):
        if text.startswith("CHAPTER ") and level == 1:
            self._pending_chapter = text.strip()
        elif self._pending_chapter and level == 1 and text.isupper() and "CHAPTER" not in text:
            combined = f"{self._pending_chapter} – {text.title() if text == 'INTRODUCTION' else text}"
            # Match TOC labels exactly
            chapter_map = {
                ("CHAPTER 1", "INTRODUCTION"): "CHAPTER 1 – INTRODUCTION",
                ("CHAPTER 2", "LITERATURE SURVEY"): "CHAPTER 2 – LITERATURE SURVEY",
                ("CHAPTER 3", "SYSTEM ANALYSIS"): "CHAPTER 3 – SYSTEM ANALYSIS",
                ("CHAPTER 4", "DESIGN METHODOLOGY"): "CHAPTER 4 – DESIGN METHODOLOGY",
                ("CHAPTER 5", "IMPLEMENTATION"): "CHAPTER 5 – IMPLEMENTATION",
                ("CHAPTER 6", "RESULTS AND DISCUSSION"): "CHAPTER 6 – RESULTS AND DISCUSSION",
                ("CHAPTER 7", "CONCLUSION AND FUTURE SCOPE"): "CHAPTER 7 – CONCLUSION AND FUTURE SCOPE",
            }
            key = (self._pending_chapter, text)
            if key in chapter_map:
                self.register(chapter_map[key])
            self._pending_chapter = None
        else:
            self.register(text)
        self.add_lines(1.5 if level == 1 else 1.2)

    def paragraph(self, text: str, align_center: bool = False):
        chars = max(len(text), 40)
        width = 68 if not align_center else 50
        self.add_lines(max(1.0, chars / width))

    def bullet_item(self):
        self.add_lines(1.0)

    def table(self, rows: int):
        self.add_lines(1.2 + rows * 0.55)

    def figure(self, width: float = 5.8):
        self.add_lines(1.0 + (width / 6.5) * self.LINES_PER_PAGE * 0.55)

    def caption(self):
        self.add_lines(1.0)

    def blank(self):
        self.add_lines(0.5)
