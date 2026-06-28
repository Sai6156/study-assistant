"""Generate Graphviz diagrams for the B.Tech Major Project Report."""
import os

os.environ["PATH"] = r"C:\Program Files\Graphviz\bin;" + os.environ.get("PATH", "")

import graphviz

BASE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(BASE, "report_assets")

FONT = "Times New Roman"
ATTRS = {
    "graph": {"fontname": FONT, "fontsize": "11", "rankdir": "TB", "bgcolor": "white", "dpi": "150"},
    "node": {"fontname": FONT, "fontsize": "10", "shape": "box", "style": "rounded,filled", "fillcolor": "#E8EAF6"},
    "edge": {"fontname": FONT, "fontsize": "9"},
}


def _render(g: graphviz.Digraph, name: str) -> str:
    os.makedirs(ASSETS, exist_ok=True)
    path = os.path.join(ASSETS, name)
    g.render(path, format="png", cleanup=True)
    return path + ".png"


def fig_architecture() -> str:
    g = graphviz.Digraph("architecture", graph_attr={**ATTRS["graph"], "rankdir": "LR"})
    g.attr("node", **ATTRS["node"])
    g.attr("edge", **ATTRS["edge"])
    g.node("client", "Client Browser\n(HTML/CSS/JS)\nWeb Speech API\nlocalStorage", fillcolor="#C5CAE9")
    g.node("vercel", "Vercel Serverless\nNode.js + Express\nJWT Auth / SSE", fillcolor="#B39DDB")
    g.node("openrouter", "OpenRouter API\nDeepSeek v3.2\nGemini TTS", fillcolor="#A5D6A7")
    g.node("storage", "Browser localStorage\nNotebooks / Sources / Chat", fillcolor="#FFF9C4")
    g.edge("client", "vercel", label="REST / SSE")
    g.edge("vercel", "openrouter", label="LLM / TTS")
    g.edge("client", "storage", label="persist")
    return _render(g, "fig_3_1_architecture")


def fig_high_level() -> str:
    g = graphviz.Digraph("high_level", graph_attr=ATTRS["graph"])
    g.attr("node", **ATTRS["node"])
    g.attr("edge", **ATTRS["edge"])
    g.node("ui", "Presentation Layer\nThree-Panel UI", fillcolor="#BBDEFB")
    g.node("api", "Application Layer\nExpress API Proxy", fillcolor="#C8E6C9")
    g.node("ai", "AI Services Layer\nOpenRouter LLM/TTS", fillcolor="#FFE0B2")
    g.edge("ui", "api")
    g.edge("api", "ai")
    return _render(g, "fig_4_1_high_level")


def fig_dfd0() -> str:
    g = graphviz.Digraph("dfd0", graph_attr={**ATTRS["graph"], "rankdir": "LR"})
    g.attr("node", shape="box", style="")
    g.node("student", "Student /\nMentor", shape="ellipse", style="filled", fillcolor="#E3F2FD")
    g.node("system", "0\nVoice-Controlled\nAI Study Assistant", shape="box", style="rounded,filled", fillcolor="#D1C4E9")
    g.node("llm", "OpenRouter\nLLM / TTS", shape="ellipse", style="filled", fillcolor="#C8E6C9")
    g.edge("student", "system", label="Queries, sources,\nvoice input")
    g.edge("system", "student", label="AI responses,\nstudio outputs")
    g.edge("system", "llm", label="API requests")
    g.edge("llm", "system", label="generated text /\naudio")
    return _render(g, "fig_4_2_dfd0")


def fig_dfd1() -> str:
    g = graphviz.Digraph("dfd1", graph_attr=ATTRS["graph"])
    g.attr("node", **ATTRS["node"])
    g.attr("edge", **ATTRS["edge"])
    g.node("user", "User", shape="ellipse", fillcolor="#E3F2FD")
    g.node("p1", "1.0\nAuthenticate", fillcolor="#E1BEE7")
    g.node("p2", "2.0\nManage Notebooks\n& Sources", fillcolor="#E1BEE7")
    g.node("p3", "3.0\nProcess Chat\n& Voice", fillcolor="#E1BEE7")
    g.node("p4", "4.0\nGenerate Studio\nOutputs", fillcolor="#E1BEE7")
    g.node("p5", "5.0\nTTS / Audio\nOverview", fillcolor="#E1BEE7")
    g.node("d1", "D1: localStorage\n(Notebooks)", shape="cylinder", fillcolor="#FFF9C4")
    g.node("d2", "D2: JWT Token\n(Client)", shape="cylinder", fillcolor="#FFF9C4")
    g.node("ext", "OpenRouter", shape="ellipse", fillcolor="#C8E6C9")
    g.edge("user", "p1")
    g.edge("p1", "d2")
    g.edge("user", "p2")
    g.edge("p2", "d1")
    g.edge("user", "p3")
    g.edge("p3", "d1")
    g.edge("p3", "ext")
    g.edge("ext", "p3")
    g.edge("user", "p4")
    g.edge("p4", "d1")
    g.edge("p4", "ext")
    g.edge("user", "p5")
    g.edge("p5", "ext")
    return _render(g, "fig_4_3_dfd1")


def fig_usecase() -> str:
    g = graphviz.Digraph("usecase", graph_attr={**ATTRS["graph"], "rankdir": "LR"})
    g.attr("node", fontname=FONT)
    g.node("sys", "Voice-Controlled\nAI Study Assistant", shape="box", style="dashed")
    actors = [("student", "Student"), ("mentor", "Mentor")]
    for aid, label in actors:
        g.node(aid, label, shape="ellipse", style="filled", fillcolor="#E3F2FD")
    cases = [
        "Sign Up / Sign In", "Upload Source", "Chat (Text/Voice)",
        "Generate Mind Map", "Generate Slides", "Audio Overview",
        "Explain / Translate", "Save Output", "Sign Out",
    ]
    for i, uc in enumerate(cases):
        uid = f"uc{i}"
        g.node(uid, uc, shape="ellipse")
        g.edge("student", uid, style="dashed")
        if uc not in ("Sign Out",):
            g.edge("mentor", uid, style="dashed")
    return _render(g, "fig_4_4_usecase")


def fig_sequence() -> str:
    g = graphviz.Digraph("sequence", graph_attr={**ATTRS["graph"], "rankdir": "LR"})
    node_attrs = {k: v for k, v in ATTRS["node"].items() if k != "shape"}
    g.attr("node", shape="box", **node_attrs)
    g.node("u", "User")
    g.node("fe", "Frontend")
    g.node("be", "Backend")
    g.node("or", "OpenRouter")
    steps = [
        ("u", "fe", "1. Type/speak query"),
        ("fe", "be", "2. POST /api/chat (SSE)"),
        ("be", "or", "3. Stream completion"),
        ("or", "be", "4. Token chunks"),
        ("be", "fe", "5. SSE tokens"),
        ("fe", "u", "6. Render + actions"),
    ]
    for a, b, label in steps:
        g.edge(a, b, label=label)
    return _render(g, "fig_4_5_sequence")


def fig_activity() -> str:
    g = graphviz.Digraph("activity", graph_attr=ATTRS["graph"])
    node_attrs = {k: v for k, v in ATTRS["node"].items() if k != "shape"}
    g.attr("node", shape="box", **node_attrs)
    g.node("start", "Start", shape="ellipse", fillcolor="#C8E6C9")
    g.node("login", "Login / Sign Up")
    g.node("nb", "Select Notebook")
    g.node("src", "Upload Sources")
    g.node("ask", "Ask Question\n(Text / Voice)")
    g.node("resp", "Stream AI Response")
    g.node("act", "Speak / Explain /\nTranslate / Podcast")
    g.node("studio", "Generate Studio\nArtifact")
    g.node("save", "Save to Panel")
    g.node("end", "End", shape="ellipse", fillcolor="#FFCDD2")
    for a, b in [
        ("start", "login"), ("login", "nb"), ("nb", "src"), ("src", "ask"),
        ("ask", "resp"), ("resp", "act"), ("act", "studio"), ("studio", "save"), ("save", "end"),
    ]:
        g.edge(a, b)
    return _render(g, "fig_4_6_activity")


def fig_er() -> str:
    g = graphviz.Digraph("er", graph_attr={**ATTRS["graph"], "rankdir": "LR"})
    g.attr("node", shape="record", fontname=FONT, fontsize="9")
    g.node("User", "{User|uid\\lemail\\lusername\\lrole\\l}")
    g.node("Notebook", "{Notebook|id\\lname\\lcreatedAt\\l}")
    g.node("Source", "{Source|id\\ltitle\\ltype\\ltext\\lenabled\\l}")
    g.node("Chat", "{Chat|id\\lname\\l}")
    g.node("Message", "{Message|role\\lcontent\\lid\\l}")
    g.node("Studio", "{StudioOutput|id\\ltype\\ltitle\\ldata\\l}")
    g.edge("User", "Notebook", label="1:N")
    g.edge("Notebook", "Source", label="1:N")
    g.edge("Notebook", "Chat", label="1:N")
    g.edge("Chat", "Message", label="1:N")
    g.edge("Notebook", "Studio", label="1:N")
    return _render(g, "fig_4_7_er")


def fig_flowchart() -> str:
    g = graphviz.Digraph("flowchart", graph_attr=ATTRS["graph"])
    node_attrs = {k: v for k, v in ATTRS["node"].items() if k != "shape"}
    g.attr("node", shape="box", **node_attrs)
    g.node("s", "Start", shape="ellipse", fillcolor="#C8E6C9")
    g.node("a", "Open Application")
    g.node("b", "Authenticated?")
    g.node("c", "Redirect to auth.html")
    g.node("d", "Load Notebooks")
    g.node("e", "Upload PDF/Text")
    g.node("f", "Chat or Studio")
    g.node("g", "Call OpenRouter API")
    g.node("h", "Display Output")
    g.node("x", "End", shape="ellipse", fillcolor="#FFCDD2")
    g.edge("s", "a")
    g.edge("a", "b")
    g.edge("b", "c", label="No")
    g.edge("c", "a")
    g.edge("b", "d", label="Yes")
    g.edge("d", "e")
    g.edge("e", "f")
    g.edge("f", "g")
    g.edge("g", "h")
    g.edge("h", "x")
    return _render(g, "fig_4_8_flowchart")


def generate_all() -> dict:
    os.makedirs(ASSETS, exist_ok=True)
    return {
        "fig_3_1": fig_architecture(),
        "fig_4_1": fig_high_level(),
        "fig_4_2": fig_dfd0(),
        "fig_4_3": fig_dfd1(),
        "fig_4_4": fig_usecase(),
        "fig_4_5": fig_sequence(),
        "fig_4_6": fig_activity(),
        "fig_4_7": fig_er(),
        "fig_4_8": fig_flowchart(),
    }


if __name__ == "__main__":
    paths = generate_all()
    for k, v in paths.items():
        print(k, "->", v)
