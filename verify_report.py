"""Verify generated report DOCX."""
import zipfile
import os
from xml.etree import ElementTree as ET

DOC = r"c:\Users\Shashank\Desktop\archive\june end projects\voice-study-assistant\B.Tech_Major_Project_Report_Voice_Controlled_AI_Study_Assistant.docx"
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

with zipfile.ZipFile(DOC) as z:
    imgs = [n for n in z.namelist() if n.startswith("word/media/") and not n.endswith("/")]
    print(f"Images embedded: {len(imgs)}")
    for i in imgs:
        print(f"  {os.path.basename(i)} ({z.getinfo(i).file_size} bytes)")

    doc = z.read("word/document.xml")
    root = ET.fromstring(doc)
    sects = root.findall(".//w:sectPr", ns)
    print(f"\nSections: {len(sects)}")
    for i, s in enumerate(sects):
        pg = s.find("w:pgNumType", ns)
        if pg is not None:
            fmt = pg.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fmt")
            start = pg.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}start")
            print(f"  Section {i}: fmt={fmt}, start={start}")

    footers = [n for n in z.namelist() if "footer" in n and n.endswith(".xml")]
    print(f"\nFooters: {len(footers)}")
    for f in footers:
        c = z.read(f).decode("utf-8", errors="replace")
        has_page = "PAGE" in c
        print(f"  {f}: has_PAGE_field={has_page}")

    paras = root.findall(".//w:body/w:p", ns)
    captions = []
    for p in paras:
        texts = "".join(t.text or "" for t in p.findall(".//w:t", ns))
        if texts.startswith("Fig.") or texts.startswith("Table"):
            captions.append(texts[:80])
    print(f"\nCaptions found: {len(captions)}")
    for c in captions[:20]:
        print(f"  {c}")

    drawings = root.findall(".//w:drawing", ns)
    print(f"\nInline images (drawings): {len(drawings)}")

print(f"\nFile size: {os.path.getsize(DOC)/1024/1024:.2f} MB")
