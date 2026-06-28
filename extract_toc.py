"""Extract full TOC from reference SmartAgri docx."""
import zipfile
import re
from xml.etree import ElementTree as ET

REF = r"c:\Users\Shashank\Desktop\archive\june end projects\SmartAgri project B24AI185.docx"
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

with zipfile.ZipFile(REF) as z:
    root = ET.fromstring(z.read("word/document.xml"))

paras = root.findall(".//w:body/w:p", ns)
in_toc = False
toc_lines = []
for p in paras:
    texts = "".join(t.text or "" for t in p.findall(".//w:t", ns))
    if texts.strip() == "TABLE OF CONTENTS":
        in_toc = True
        continue
    if in_toc:
        if texts.strip() in ("LIST OF FIGURES", "PROJECT APPROVAL CERTIFICATE"):
            break
        if texts.strip():
            # check for tab leaders / page numbers
            tabs = p.findall(".//w:tab", ns)
            toc_lines.append(repr(texts))

print("TOC entries from reference (%d lines):" % len(toc_lines))
for line in toc_lines[:80]:
    print(line)

# Also find TOC field in document
doc_xml = z.read("word/document.xml").decode("utf-8", errors="replace")
if "TOC" in doc_xml:
    for m in re.finditer(r"instrText[^>]*>([^<]*TOC[^<]*)<", doc_xml):
        print("FIELD:", m.group(1))
