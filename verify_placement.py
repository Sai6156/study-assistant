"""Verify figure placement relative to section headings."""
import zipfile
from xml.etree import ElementTree as ET

DOC = r"c:\Users\Shashank\Desktop\archive\june end projects\voice-study-assistant\B.Tech_Major_Project_Report_Voice_Controlled_AI_Study_Assistant.docx"
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

with zipfile.ZipFile(DOC) as z:
    root = ET.fromstring(z.read("word/document.xml"))

in_chapters = False
for p in root.findall(".//w:body/w:p", ns):
    texts = "".join(t.text or "" for t in p.findall(".//w:t", ns))
    has_img = p.find(".//w:drawing", ns) is not None
    if not texts.strip() and not has_img:
        continue
    if texts.startswith("CHAPTER") or texts.startswith("Fig.") or (len(texts) < 50 and texts[0:3].replace(".", "").replace(" ", "").isdigit() is False and any(texts.startswith(f"{c}.") for c in range(1, 8))):
        pass
    show = (
        texts.startswith("CHAPTER")
        or any(texts.startswith(f"{a}.") for a in ["3.1", "3.8", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.10", "5.1", "5.2", "5.3", "5.4", "5.10", "6.1", "6.2", "6.7"])
        or texts.startswith("Fig.")
        or has_img
    )
    if show:
        tag = " [IMG]" if has_img else ""
        print(f"{texts[:70]}{tag}")
