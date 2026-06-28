"""
Update TOC page numbers in the generated report using Microsoft Word COM.
Reads actual printed page numbers (roman / arabic per section) and rewrites TOC lines.
"""
import os
import re
import sys

try:
    import win32com.client
except ImportError:
    print("pywin32 required: pip install pywin32")
    sys.exit(1)

from report_toc import TOC_ENTRIES

BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DOC = os.path.join(BASE, "B.Tech_Major_Project_Report_FINAL.docx")

WD_ACTIVE_END_ADJUSTED_PAGE_NUMBER = 10


def _roman(n: int) -> str:
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


def _fmt_page(page: int, use_roman: bool) -> str:
    if use_roman:
        return _roman(page)
    return str(page)


def _heading_page(doc, title: str, toc_start: int, toc_end: int) -> int | None:
    """Return adjusted page number for the first heading match outside the TOC block."""
    title = title.strip()
    if not title:
        return None
    search_titles = [title]
    if title.startswith("CHAPTER") and "–" in title:
        search_titles.append(title.split("–")[0].strip())
    best = None
    for search in search_titles:
        for para in doc.Paragraphs:
            start = para.Range.Start
            if toc_start <= start <= toc_end:
                continue
            text = para.Range.Text.strip().replace("\r", "").replace("\x07", "")
            style = para.Style.NameLocal if para.Style else ""
            if not (text.startswith(search) or text == search):
                continue
            if search.startswith("CHAPTER") or search in ("REFERENCES", "APPENDICES"):
                if not style.startswith("Heading"):
                    continue
            elif re.match(r"^\d", search):
                if not style.startswith("Heading"):
                    continue
            elif search in ("BONAFIDE CERTIFICATE", "PROJECT APPROVAL SHEET", "DECLARATION",
                            "CERTIFICATE FROM SUPERVISOR", "ACKNOWLEDGEMENT", "ABSTRACT",
                            "TABLE OF CONTENTS", "LIST OF FIGURES", "LIST OF TABLES",
                            "LIST OF ABBREVIATIONS AND ACRONYMS"):
                if not style.startswith("Heading"):
                    continue
            page = para.Range.Information(WD_ACTIVE_END_ADJUSTED_PAGE_NUMBER)
            if page and (best is None or start < best[0]):
                best = (start, int(page))
    return best[1] if best else None


def _find_toc_range(doc):
    toc_start = toc_end = None
    for para in doc.Paragraphs:
        text = para.Range.Text.strip().replace("\r", "")
        if text == "TABLE OF CONTENTS" and toc_start is None:
            toc_start = para.Range.Start
        elif toc_start and text == "LIST OF FIGURES":
            toc_end = para.Range.Start
            break
    return toc_start, toc_end


def update_toc(doc_path: str) -> str:
    doc_path = os.path.abspath(doc_path)
    if not os.path.isfile(doc_path):
        raise FileNotFoundError(doc_path)

    word = win32com.client.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    doc = word.Documents.Open(doc_path, ReadOnly=False)

    try:
        toc_start, toc_end = _find_toc_range(doc)
        if toc_start is None or toc_end is None:
            raise RuntimeError("Could not locate TABLE OF CONTENTS region")

        # Detect where arabic numbering begins (CHAPTER 1)
        chapter1_page = _heading_page(doc, "CHAPTER 1 – INTRODUCTION", toc_start, toc_end)
        if chapter1_page is None:
            chapter1_page = _heading_page(doc, "CHAPTER 1", toc_start, toc_end)

        updated = []
        for title, _old_page, indent in TOC_ENTRIES:
            if not title:
                updated.append((title, "", indent))
                continue
            page = _heading_page(doc, title, toc_start, toc_end)
            if page is None and title.startswith("CHAPTER"):
                # Try matching "CHAPTER N" only
                chap = title.split("–")[0].strip()
                page = _heading_page(doc, chap, toc_start, toc_end)
            if page is None:
                updated.append((title, _old_page, indent))
                continue
            use_roman = chapter1_page is None or page < chapter1_page
            updated.append((title, _fmt_page(page, use_roman), indent))

        # Remove existing TOC body lines (between TOC heading and LIST OF FIGURES)
        rng = doc.Range(toc_start, toc_end)
        # Keep the "TABLE OF CONTENTS" heading — delete content after it until LIST OF FIGURES
        for para in list(doc.Paragraphs):
            if para.Range.Start <= toc_start:
                continue
            if para.Range.Start >= toc_end:
                break
            para.Range.Delete()

        # Insert updated entries before LIST OF FIGURES
        insert_at = doc.Range(toc_end, toc_end)
        for title, page, indent in updated:
            if not title:
                insert_at.InsertParagraphAfter()
                continue
            p = insert_at.Paragraphs.Last
            pf = p.Range.ParagraphFormat
            pf.LeftIndent = indent * 12
            pf.LineSpacingRule = 1  # wdLineSpaceMultiple
            pf.LineSpacing = 18  # ~1.5 lines at 12pt
            # Tab stop at 6.35" with dot leaders
            pf.TabStops.Add(Position=word.CentimetersToPoints(16.1), Alignment=2, Leader=2)
            p.Range.Text = f"{title}\t{page}\r"
            for run in p.Range.Runs:
                run.Font.Name = "Times New Roman"
                run.Font.Size = 12
            insert_at = p.Range

        doc.Save()
        return doc_path
    finally:
        doc.Close()
        word.Quit()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DOC
    out = update_toc(path)
    print(f"TOC page numbers updated: {out}")
