"""Analyze reference and existing DOCX files for formatting."""
import zipfile
import re
import os
from xml.etree import ElementTree as ET

REF = r"c:\Users\Shashank\Desktop\archive\june end projects\SmartAgri project B24AI185.docx"
EXISTING = r"c:\Users\Shashank\Desktop\archive\june end projects\voice-study-assistant\B.Tech_Major_Project_Report_Voice_Controlled_AI_Study_Assistant.docx"
OUT_DIR = r"c:\Users\Shashank\Desktop\archive\june end projects\voice-study-assistant\report_assets"


def analyze_docx(path, label):
    print(f"\n===== {label} =====")
    with zipfile.ZipFile(path) as z:
        imgs = [n for n in z.namelist() if n.startswith("word/media/")]
        print(f"Images: {len(imgs)}")
        for i in imgs:
            print(f"  {i} ({z.getinfo(i).file_size} bytes)")

        for n in sorted(z.namelist()):
            if "footer" in n and n.endswith(".xml"):
                content = z.read(n).decode("utf-8", errors="replace")
                if "PAGE" in content or "pgNum" in content:
                    print(f"\nFooter {n}:")
                    print(content)

        for n in sorted(z.namelist()):
            if "header" in n and n.endswith(".xml"):
                content = z.read(n).decode("utf-8", errors="replace")
                if len(content) > 100:
                    print(f"\nHeader {n}:")
                    print(content[:600])

        # section breaks
        doc = z.read("word/document.xml").decode("utf-8", errors="replace")
        sect_count = doc.count("w:sectPr")
        print(f"\nSection breaks (sectPr): {sect_count}")

        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        root = ET.fromstring(doc)
        body = root.find("w:body", ns)
        sects = body.findall("w:sectPr", ns) if body is not None else []
        for i, s in enumerate(sects):
            pg = s.find("w:pgNumType", ns)
            if pg is not None:
                fmt = pg.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fmt")
                start = pg.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}start")
                print(f"  Section {i}: fmt={fmt}, start={start}")

        # paragraph styles sample
        paras = root.findall(".//w:body/w:p", ns)
        print(f"\nTotal paragraphs: {len(paras)}")
        style_counts = {}
        for p in paras:
            pPr = p.find("w:pPr", ns)
            if pPr is not None:
                ps = pPr.find("w:pStyle", ns)
                if ps is not None:
                    st = ps.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val")
                    style_counts[st] = style_counts.get(st, 0) + 1
        print("Style counts:", dict(sorted(style_counts.items(), key=lambda x: -x[1])[:15]))

        # find figure captions
        print("\nFigure/Table captions:")
        for i, p in enumerate(paras):
            texts = "".join(t.text or "" for t in p.findall(".//w:t", ns))
            if re.match(r"^(Fig\.|Figure|Table)\s", texts, re.I):
                safe = texts[:100].encode("ascii", "replace").decode()
                print(f"  [{i}] {safe}")

        # headings
        print("\nHeadings sample:")
        for p in paras:
            texts = "".join(t.text or "" for t in p.findall(".//w:t", ns))
            pPr = p.find("w:pPr", ns)
            if pPr is not None:
                ps = pPr.find("w:pStyle", ns)
                st = ps.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val") if ps is not None else ""
                if st and "Heading" in st and texts.strip():
                    print(f"  {st}: {texts[:80]}")


def extract_images(src, out_dir, prefix=""):
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(src) as z:
        for n in z.namelist():
            if n.startswith("word/media/"):
                data = z.read(n)
                name = os.path.basename(n)
                out = os.path.join(out_dir, prefix + name)
                with open(out, "wb") as f:
                    f.write(data)
                print(f"Extracted: {out}")


def analyze_styles(path):
    print(f"\n===== STYLES: {path} =====")
    with zipfile.ZipFile(path) as z:
        styles = z.read("word/styles.xml")
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        root = ET.fromstring(styles)
        for st in root.findall(".//w:style", ns):
            sid = st.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId")
            name_el = st.find("w:name", ns)
            name = name_el.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val") if name_el is not None else ""
            if name and any(x in name.lower() for x in ["heading", "normal", "title", "toc", "caption", "footer", "header"]):
                rPr = st.find("w:rPr", ns)
                pPr = st.find("w:pPr", ns)
                sz = rPr.find("w:sz", ns) if rPr is not None else None
                font = rPr.find("w:rFonts", ns) if rPr is not None else None
                bold = rPr.find("w:b", ns) if rPr is not None else None
                jc = pPr.find("w:jc", ns) if pPr is not None else None
                info = f"id={sid} name={name}"
                if sz is not None:
                    info += f" sz={sz.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')}"
                if font is not None:
                    info += f" font={font.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}ascii')}"
                if bold is not None:
                    info += " bold"
                if jc is not None:
                    info += f" jc={jc.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')}"
                print(info)


def analyze_sections(path):
    print(f"\n===== SECTIONS: {path} =====")
    with zipfile.ZipFile(path) as z:
        doc = z.read("word/document.xml")
        root = ET.fromstring(doc)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        for i, s in enumerate(root.findall(".//w:sectPr", ns)):
            pgSz = s.find("w:pgSz", ns)
            pgMar = s.find("w:pgMar", ns)
            pgNum = s.find("w:pgNumType", ns)
            print(f"Section {i}:")
            if pgSz is not None:
                w = pgSz.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w")
                h = pgSz.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}h")
                print(f"  page: {w}x{h} twips")
            if pgMar is not None:
                for k in ["top", "bottom", "left", "right"]:
                    v = pgMar.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}" + k)
                    if v:
                        print(f"  margin {k}: {int(v)/1440:.2f} in")
            if pgNum is not None:
                fmt = pgNum.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fmt")
                start = pgNum.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}start")
                print(f"  pgNum fmt={fmt} start={start}")


if __name__ == "__main__":
    analyze_docx(REF, "REFERENCE SmartAgri")
    analyze_styles(REF)
    analyze_sections(REF)
    analyze_docx(EXISTING, "EXISTING Study Assistant")
    extract_images(EXISTING, OUT_DIR, "ss_")
    extract_images(REF, OUT_DIR, "ref_")
