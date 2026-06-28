"""Extract text structure from reference DOCX."""
import zipfile
import re
from xml.etree import ElementTree as ET

REF = r"c:\Users\Shashank\Desktop\archive\june end projects\SmartAgri project B24AI185.docx"
OUT = r"c:\Users\Shashank\Desktop\archive\june end projects\voice-study-assistant\ref_text_sample.txt"

ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

with zipfile.ZipFile(REF) as z:
    doc = z.read("word/document.xml")
    root = ET.fromstring(doc)
    lines = []
    for i, p in enumerate(root.findall(".//w:body/w:p", ns)):
        texts = "".join(t.text or "" for t in p.findall(".//w:t", ns))
        pPr = p.find("w:pPr", ns)
        style = ""
        if pPr is not None:
            ps = pPr.find("w:pStyle", ns)
            if ps is not None:
                style = ps.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
        jc = ""
        if pPr is not None:
            j = pPr.find("w:jc", ns)
            if j is not None:
                jc = j.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
        if texts.strip() or "drawing" in ET.tostring(p, encoding="unicode"):
            has_img = p.find(".//w:drawing", ns) is not None
            tag = f"[{i}|s={style}|a={jc}|img={has_img}]"
            lines.append(f"{tag} {texts}")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines[:200]))
    f.write("\n\n--- MIDDLE ---\n\n")
    f.write("\n".join(lines[100:180]))
    f.write("\n\n--- CH1 START ---\n\n")
    for line in lines:
        if "CHAPTER 1" in line or "1.1 " in line:
            idx = lines.index(line)
            f.write("\n".join(lines[idx:idx+40]))
            break

print("Wrote", OUT, "total lines", len(lines))
