import zipfile
from xml.etree import ElementTree as ET

REF = r"c:\Users\Shashank\Desktop\archive\june end projects\SmartAgri project B24AI185.docx"
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

with zipfile.ZipFile(REF) as z:
    root = ET.fromstring(z.read("word/document.xml"))

paras = root.findall(".//w:body/w:p", ns)
for i, p in enumerate(paras[30:120]):
    texts = []
    for t in p.findall(".//w:t", ns):
        if t.text:
            texts.append(t.text)
    line = "".join(texts)
    tabs = len(p.findall(".//w:tab", ns))
    pPr = p.find("w:pPr", ns)
    style = ""
    if pPr is not None:
        ps = pPr.find("w:pStyle", ns)
        if ps is not None:
            style = ps.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
    if line.strip() or tabs:
        print(f"{i+30:4d} style={style:4s} tabs={tabs} | {line[:100]}")
