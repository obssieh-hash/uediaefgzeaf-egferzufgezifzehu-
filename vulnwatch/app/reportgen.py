"""Génération du bulletin de veille : Word (.docx), PowerPoint (.pptx), Excel (.xlsx), PDF et HTML."""
import base64
import html
import io
import os
import re
from datetime import datetime

STATIC = os.path.join(os.path.dirname(__file__), "static")
BANNER = os.path.join(STATIC, "login-banner.jpg")

BLUE, BLUE2, GREEN, DARK, GREY, LIGHT = "0B4AA6", "1E88E5", "1A9F3A", "13213A", "5B6880", "EEF2F8"
PRIO_HEX = {1: "E5484D", 2: "F76B15", 3: "C99A1A", 4: "6B7A90"}
PRIO_FR = {1: "Critique — immédiat", 2: "Haute — 7 jours", 3: "Moyenne — 30 jours", 4: "Basse — cycle normal"}
STATUS_FR = {"new": "Nouveau", "analysis": "En analyse", "action": "Action requise", "done": "Traité", "na": "Non applicable"}
MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
METHODO = [
    ("P1", "Exploitée activement (CISA KEV) ou CVSS ≥ 9 avec EPSS ≥ 10 %", "Traitement immédiat"),
    ("P2", "CVSS ≥ 9, ou CVSS ≥ 7 avec EPSS ≥ 10 %", "Sous 7 jours"),
    ("P3", "CVSS ≥ 7", "Sous 30 jours"),
    ("P4", "Autres vulnérabilités", "Cycle normal de mise à jour"),
]


# ---------------------------------------------------------------- utilitaires

def fdate(s, with_time=False) -> str:
    if not s:
        return "—"
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00")) if len(str(s)) > 10 else datetime.fromisoformat(str(s))
    except ValueError:
        return str(s)[:10]
    out = f"{d.day:02d} {MONTHS[d.month - 1]} {d.year}"
    return out + (f" {d.hour:02d}:{d.minute:02d}" if with_time else "")


def segments(text: str) -> list[tuple[str, bool]]:
    """« **gras** » -> [(texte, gras?)]."""
    parts = re.split(r"(\*\*[^*]+\*\*)", text or "")
    return [(p[2:-2], True) if p.startswith("**") and p.endswith("**") else (p, False) for p in parts if p]


def plain(text: str) -> str:
    return (text or "").replace("**", "")


def trunc(s, n) -> str:
    s = (s or "").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def tlp_hex(classif: str) -> str:
    c = (classif or "").upper()
    for k, v in (("RED", "FF2B2B"), ("AMBER", "FFC000"), ("GREEN", "33FF00"), ("CLEAR", "FFFFFF"), ("WHITE", "FFFFFF")):
        if k in c:
            return v
    return "FFFFFF"


def vtitle(v) -> str:
    return v.get("title") or trunc(v.get("description"), 140)


def score(v) -> str:
    return f"{v['cvss_score']:.1f}" if v.get("cvss_score") is not None else "N/É"


def epss(v) -> str:
    return f"{v['epss'] * 100:.1f} %" if v.get("epss") is not None else "—"


def period(r) -> str:
    return f"du {fdate(r['start'])} au {fdate(r['end'])} ({r['days']} jours)"


def products_label(r) -> str:
    p = r.get("products") or []
    return ", ".join(p) if p else "aucun produit sélectionné"


KPI_DEF = [("scope_new", "Vulnérabilités sur les produits", BLUE), ("p1", "Priorité P1", PRIO_HEX[1]),
           ("p2", "Priorité P2", PRIO_HEX[2]), ("kev_new", "Ajouts CISA KEV", "B3261E"),
           ("certfr_alertes", "Alertes CERT-FR", GREEN), ("cve_new", "Nouvelles CVE (monde)", GREY)]


# ---------------------------------------------------------------- Word

def to_docx(r: dict) -> bytes:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    rgb = lambda h: RGBColor.from_string(h)
    doc = Document()
    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21)
    for side in ("left_margin", "right_margin"):
        setattr(sec, side, Cm(1.8))
    sec.top_margin, sec.bottom_margin = Cm(1.6), Cm(1.6)
    st = doc.styles["Normal"]
    st.font.name, st.font.size = "Calibri", Pt(10)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")

    def shade(cell, hexcol):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear"), shd.set(qn("w:color"), "auto"), shd.set(qn("w:fill"), hexcol)
        tcPr.append(shd)

    def para_shade(p, hexcol):
        pPr = p._p.get_or_add_pPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear"), shd.set(qn("w:color"), "auto"), shd.set(qn("w:fill"), hexcol)
        pPr.append(shd)

    def rich(p, text, size=None, color=None):
        for t, b in segments(text):
            run = p.add_run(t)
            run.bold = b
            if size:
                run.font.size = Pt(size)
            if color:
                run.font.color.rgb = rgb(color)
        return p

    def set_widths(t, widths):
        t.autofit = False
        grid = t._tbl.tblGrid
        for i, gc in enumerate(grid.findall(qn("w:gridCol"))):
            if i < len(widths):
                gc.set(qn("w:w"), str(int(Cm(widths[i]).twips)))
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)

    def heading(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before, p.paragraph_format.space_after = Pt(14), Pt(6)
        run = p.add_run(text)
        run.bold, run.font.size, run.font.color.rgb = True, Pt(14), rgb(BLUE)
        pPr = p._p.get_or_add_pPr()
        bdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        for k, v in (("w:val", "single"), ("w:sz", "6"), ("w:space", "2"), ("w:color", "C5CCD8")):
            bottom.set(qn(k), v)
        bdr.append(bottom)
        pPr.append(bdr)

    def table(headers, rows, widths=None, prio_col=None):
        t = doc.add_table(rows=1, cols=len(headers))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, h in enumerate(headers):
            c = t.rows[0].cells[i]
            c.text = ""
            run = c.paragraphs[0].add_run(h)
            run.bold, run.font.size, run.font.color.rgb = True, Pt(8.5), rgb("FFFFFF")
            shade(c, BLUE)
        for ri, row in enumerate(rows):
            cells = t.add_row().cells
            for i, val in enumerate(row):
                cells[i].text = ""
                run = cells[i].paragraphs[0].add_run(str(val))
                run.font.size = Pt(8.5)
                if prio_col is not None and i == prio_col:
                    run.bold, run.font.color.rgb = True, rgb("FFFFFF")
                    shade(cells[i], PRIO_HEX.get(int(str(val)[1:]) if str(val)[1:].isdigit() else 4, GREY))
                elif ri % 2:
                    shade(cells[i], "F5F7FB")
        if widths:
            set_widths(t, widths)
        doc.add_paragraph()
        return t

    # En-tête / pied de page : marquage TLP
    hp = sec.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para_shade(hp, "000000")
    run = hp.add_run(r["classification"].upper())
    run.bold, run.font.size, run.font.color.rgb = True, Pt(8.5), rgb(tlp_hex(r["classification"]))
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = fp.add_run(f"{r['app']} — Bulletin de veille — {r['classification']} — page ")
    run.font.size, run.font.color.rgb = Pt(8), rgb(GREY)
    for kind, txt in (("begin", None), (None, "PAGE"), ("end", None)):
        rr = fp.add_run()
        rr.font.size = Pt(8)
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = txt
        rr._r.append(el)

    # Page de garde
    if os.path.exists(BANNER):
        doc.add_picture(BANNER, width=Cm(17.4))
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    run = p.add_run("Bulletin de veille des vulnérabilités")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(24), rgb(DARK)
    p = doc.add_paragraph()
    run = p.add_run(f"Période {period(r)}")
    run.font.size, run.font.color.rgb = Pt(12), rgb(GREY)
    meta = [("Émetteur", f"{r['app']} — {r['org']} — Équipe SSI"), ("Produits couverts", products_label(r)),
            ("Édité le", f"{fdate(r['generated_at'], True)} par {r['generated_by']}"), ("Diffusion", r["classification"])]
    t = doc.add_table(rows=0, cols=2)
    for k, v in meta:
        cells = t.add_row().cells
        cells[0].text, cells[1].text = k, v
        cells[0].paragraphs[0].runs[0].bold = True
        shade(cells[0], LIGHT)
    set_widths(t, [4, 13.4])

    heading("1. Synthèse")
    t = doc.add_table(rows=2, cols=len(KPI_DEF))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (key, label, col) in enumerate(KPI_DEF):
        val = r["kpi"].get(key, 0)
        c0, c1 = t.rows[0].cells[i], t.rows[1].cells[i]
        c0.text, c1.text = "", ""
        run = c0.paragraphs[0].add_run(f"{val:,}".replace(",", " "))
        run.bold, run.font.size, run.font.color.rgb = True, Pt(20), rgb(col)
        run = c1.paragraphs[0].add_run(label + (f" (dont {r['kpi']['kev_new_scope']} sur les produits)" if key == "kev_new" else ""))
        run.font.size, run.font.color.rgb = Pt(8), rgb(GREY)
        for c in (c0, c1):
            c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            shade(c, LIGHT)
    doc.add_paragraph()
    for f in r["facts"]:
        rich(doc.add_paragraph(style="List Bullet"), f)

    heading("2. Actions recommandées")
    for a in r["actions"]:
        rich(doc.add_paragraph(style="List Number"), a)

    heading("3. Vulnérabilités prioritaires (P1 / P2)")
    if r["priority_items"]:
        table(["Prio.", "Identifiant", "Produit", "CVSS", "EPSS", "KEV", "Statut", "Vulnérabilité"],
              [[f"P{v['priority']}", v["id"], ", ".join(v["watches"]), score(v), epss(v), "Oui" if v["kev"] else "—",
                STATUS_FR.get(v["status"], v["status"]) + (f" — {v['assignee_name']}" if v.get("assignee_name") else ""),
                trunc(vtitle(v), 110)] for v in r["priority_items"]],
              [1.2, 2.9, 2.2, 1.2, 1.4, 1.1, 2.2, 5.2], prio_col=0)
    else:
        doc.add_paragraph("Aucune vulnérabilité P1/P2 sur les produits sélectionnés pour cette période.")

    heading("4. Répartition par produit")
    if r["by_watch"]:
        table(["Produit", "Total", "P1", "P2", "KEV", "CVSS max"],
              [[w["name"], w["total"], w["p1"], w["p2"], w["kev"], w["max_cvss"] if w["max_cvss"] is not None else "—"]
               for w in r["by_watch"]], [6.4, 2.2, 2.2, 2.2, 2.2, 2.2])
    else:
        doc.add_paragraph("Aucune nouveauté sur les produits sélectionnés.")

    heading("5. Suivi du traitement (P1/P2)")
    tri = r["triage"]
    if sum(tri.values()):
        table(["Statut", "Nombre"], [[STATUS_FR[k], tri.get(k, 0)] for k in STATUS_FR], [8, 3])
    else:
        doc.add_paragraph("Aucune vulnérabilité P1/P2 suivie.")

    heading("6. Nouvelles vulnérabilités exploitées (CISA KEV)")
    if r["kev_new"]:
        table(["Identifiant", "Vulnérabilité", "Ajout", "Échéance", "Produit surveillé"],
              [[v["id"], trunc(vtitle(v), 90), fdate(v["kev_added"]), fdate(v["kev_due"]), ", ".join(v["watches"]) or "—"]
               for v in r["kev_new"]], [2.8, 7.4, 2.2, 2.2, 2.8])
    else:
        doc.add_paragraph("Aucun ajout au catalogue sur la période.")

    heading("7. Bulletins CERT-FR")
    if r["bulletins"]:
        for b in r["bulletins"]:
            p = doc.add_paragraph(style="List Bullet")
            run = p.add_run(f"[{b['kind'].upper()}] ")
            run.bold, run.font.color.rgb = True, rgb(PRIO_HEX[1] if b["kind"] == "alerte" else BLUE)
            p.add_run(b["title"])
            run = p.add_run(f" — {fdate(b['published'])} — {b['link']}")
            run.font.size, run.font.color.rgb = Pt(8), rgb(GREY)
    else:
        doc.add_paragraph("Aucun bulletin CERT-FR sur la période.")

    heading("Annexe — Méthode de priorisation")
    table(["Priorité", "Critère", "Délai de traitement"], [list(m) for m in METHODO], [2, 10.4, 5])
    p = doc.add_paragraph()
    run = p.add_run("Sources : NVD (NIST), CISA KEV, FIRST EPSS, CVE.org / CISA Vulnrichment, CERT-FR (ANSSI), GitHub Advisories. "
                    f"Document généré automatiquement par {r['app']}.")
    run.font.size, run.font.color.rgb = Pt(8), rgb(GREY)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- PowerPoint

def to_pptx(r: dict) -> bytes:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.util import Emu, Inches, Pt

    rgb = lambda h: RGBColor.from_string(h)
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    W, H = prs.slide_width, prs.slide_height
    blank = prs.slide_layouts[6]
    count = {"n": 0}

    def box(slide, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE):
        s = slide.shapes.add_shape(shape, x, y, w, h)
        if fill:
            s.fill.solid()
            s.fill.fore_color.rgb = rgb(fill)
        else:
            s.fill.background()
        if line:
            s.line.color.rgb = rgb(line)
        else:
            s.line.fill.background()
        s.shadow.inherit = False
        return s

    def text(slide, x, y, w, h, content, size=14, bold=False, color=DARK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
        tb = slide.shapes.add_textbox(x, y, w, h)
        tf = tb.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        tf.margin_left = tf.margin_right = Inches(0.05)
        lines = content if isinstance(content, list) else [content]
        for i, line in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            for t, b in segments(line):
                run = p.add_run()
                run.text = t
                run.font.size, run.font.bold, run.font.color.rgb = Pt(size), bold or b, rgb(color)
                run.font.name = "Calibri"
        return tb

    def frame(title, subtitle=None):
        s = prs.slides.add_slide(blank)
        count["n"] += 1
        box(s, 0, 0, W, Inches(0.32), "000000")
        text(s, 0, 0, W, Inches(0.32), r["classification"].upper(), 10, True, tlp_hex(r["classification"]), PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
        text(s, Inches(0.6), Inches(0.5), Inches(11), Inches(0.7), title, 26, True, DARK)
        if subtitle:
            text(s, Inches(0.6), Inches(1.12), Inches(11), Inches(0.4), subtitle, 12, False, GREY)
        box(s, Inches(0.6), Inches(1.55), Inches(8), Emu(38000), BLUE)
        box(s, Inches(8.6), Inches(1.55), Inches(4.13), Emu(38000), GREEN)
        text(s, Inches(0.6), H - Inches(0.45), Inches(9), Inches(0.3), f"{r['app']} · {r['org']} · Bulletin de veille {period(r)}", 9, False, GREY)
        text(s, W - Inches(1.6), H - Inches(0.45), Inches(1), Inches(0.3), str(count["n"]), 9, True, GREY, PP_ALIGN.RIGHT)
        return s

    def grid(slide, headers, rows, x, y, w, col_w, prio_col=None, size=10):
        t = slide.shapes.add_table(len(rows) + 1, len(headers), x, y, w, Inches(0.3) * (len(rows) + 1)).table
        tot = sum(col_w)
        for i, cw in enumerate(col_w):
            t.columns[i].width = int(w * cw / tot)
        for i, h in enumerate(headers):
            c = t.cell(0, i)
            c.text = h
            c.fill.solid()
            c.fill.fore_color.rgb = rgb(BLUE)
            for p in c.text_frame.paragraphs:
                for run in p.runs:
                    run.font.size, run.font.bold, run.font.color.rgb = Pt(size), True, rgb("FFFFFF")
        for ri, row in enumerate(rows, start=1):
            for i, val in enumerate(row):
                c = t.cell(ri, i)
                c.text = str(val)
                c.fill.solid()
                is_prio = prio_col is not None and i == prio_col
                c.fill.fore_color.rgb = rgb(PRIO_HEX.get(int(str(val)[1:]), GREY) if is_prio else ("F5F7FB" if ri % 2 else "FFFFFF"))
                c.margin_top = c.margin_bottom = Inches(0.03)
                for p in c.text_frame.paragraphs:
                    for run in p.runs:
                        run.font.size = Pt(size)
                        run.font.color.rgb = rgb("FFFFFF" if is_prio else DARK)
                        run.font.bold = is_prio
        return t

    # 1. Page de titre
    s = prs.slides.add_slide(blank)
    count["n"] += 1
    if os.path.exists(BANNER):
        s.shapes.add_picture(BANNER, 0, 0, W, H)
    box(s, 0, H - Inches(1.45), W, Inches(1.45), BLUE)
    box(s, 0, H - Inches(1.45), W, Emu(50000), GREEN)
    text(s, Inches(0.6), H - Inches(1.38), Inches(12), Inches(0.6), "Bulletin de veille des vulnérabilités", 28, True, "FFFFFF")
    text(s, Inches(0.6), H - Inches(0.8), Inches(12), Inches(0.35), f"Période {period(r)}  ·  Produits : {trunc(products_label(r), 90)}", 12, False, "DCE6F5")
    text(s, Inches(0.6), H - Inches(0.46), Inches(12), Inches(0.35), f"Édité le {fdate(r['generated_at'], True)} par {r['generated_by']}", 10, False, "DCE6F5")
    box(s, 0, 0, W, Inches(0.32), "000000")
    text(s, 0, 0, W, Inches(0.32), r["classification"].upper(), 10, True, tlp_hex(r["classification"]), PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)

    # 2. Synthèse
    s = frame("Synthèse", f"Produits couverts : {trunc(products_label(r), 120)}")
    tw, gap = Inches(1.92), Inches(0.13)
    for i, (key, label, col) in enumerate(KPI_DEF):
        x = Inches(0.6) + (tw + gap) * i
        box(s, x, Inches(1.85), tw, Inches(1.35), "F5F7FB", "D9DEE8")
        box(s, x, Inches(1.85), Emu(60000), Inches(1.35), col)
        text(s, x + Inches(0.15), Inches(1.9), tw - Inches(0.2), Inches(0.7), f"{r['kpi'].get(key, 0):,}".replace(",", " "), 30, True, col)
        text(s, x + Inches(0.15), Inches(2.6), tw - Inches(0.2), Inches(0.55), label, 11, False, GREY)
    text(s, Inches(0.6), Inches(3.5), Inches(12.1), Inches(3.3), ["•  " + f for f in r["facts"]], 15)

    # 3. Actions recommandées
    s = frame("Actions recommandées", "À engager par les équipes d'exploitation et de développement")
    text(s, Inches(0.6), Inches(1.85), Inches(12.1), Inches(5), [f"{i}.  {a}" for i, a in enumerate(r["actions"], 1)], 16)

    # 4. Vulnérabilités prioritaires (8 par diapositive)
    items = r["priority_items"]
    pages = [items[i:i + 8] for i in range(0, len(items), 8)][:6] or [[]]
    for pi, chunk in enumerate(pages):
        s = frame("Vulnérabilités prioritaires (P1 / P2)" + (f" — {pi + 1}/{len(pages)}" if len(pages) > 1 else ""),
                  f"{len(items)} vulnérabilité(s) sur les produits sélectionnés")
        if chunk:
            grid(s, ["Prio.", "Identifiant", "Produit", "CVSS", "EPSS", "KEV", "Statut", "Vulnérabilité"],
                 [[f"P{v['priority']}", v["id"], trunc(", ".join(v["watches"]), 28), score(v), epss(v), "Oui" if v["kev"] else "—",
                   STATUS_FR.get(v["status"], v["status"]), trunc(vtitle(v), 85)] for v in chunk],
                 Inches(0.6), Inches(1.85), Inches(12.1), [0.7, 1.7, 1.7, 0.7, 0.8, 0.6, 1.3, 4.6], prio_col=0, size=10)
        else:
            text(s, Inches(0.6), Inches(2), Inches(12), Inches(1), "Aucune vulnérabilité P1/P2 sur la période.", 16, False, GREY)

    # 5. Par produit + suivi
    s = frame("Répartition par produit et suivi du traitement")
    if r["by_watch"]:
        grid(s, ["Produit", "Total", "P1", "P2", "KEV", "CVSS max"],
             [[w["name"], w["total"], w["p1"], w["p2"], w["kev"], w["max_cvss"] if w["max_cvss"] is not None else "—"] for w in r["by_watch"][:14]],
             Inches(0.6), Inches(1.85), Inches(7.4), [3, 1, 1, 1, 1, 1.2], size=11)
    else:
        text(s, Inches(0.6), Inches(2), Inches(7), Inches(1), "Aucune nouveauté sur les produits sélectionnés.", 14, False, GREY)
    tri = r["triage"]
    grid(s, ["Statut (P1/P2)", "Nombre"], [[STATUS_FR[k], tri.get(k, 0)] for k in STATUS_FR],
         Inches(8.5), Inches(1.85), Inches(4.2), [3, 1], size=11)

    # 6. KEV
    kev = r["kev_new"]
    for pi, chunk in enumerate([kev[i:i + 10] for i in range(0, len(kev), 10)][:3] or [[]]):
        s = frame("Nouvelles vulnérabilités exploitées (CISA KEV)", f"{r['kpi']['kev_new']} ajout(s) au catalogue sur la période")
        if chunk:
            grid(s, ["Identifiant", "Vulnérabilité", "Ajout", "Échéance", "Produit surveillé"],
                 [[v["id"], trunc(vtitle(v), 70), fdate(v["kev_added"]), fdate(v["kev_due"]), trunc(", ".join(v["watches"]) or "—", 30)] for v in chunk],
                 Inches(0.6), Inches(1.85), Inches(12.1), [1.6, 5, 1.2, 1.2, 2], size=10)
        else:
            text(s, Inches(0.6), Inches(2), Inches(12), Inches(1), "Aucun ajout au catalogue sur la période.", 16, False, GREY)

    # 7. CERT-FR
    bl = r["bulletins"]
    for chunk in [bl[i:i + 12] for i in range(0, len(bl), 12)][:3] or [[]]:
        s = frame("Bulletins CERT-FR", f"{r['kpi']['certfr_alertes']} alerte(s) et {r['kpi']['certfr_avis']} avis")
        lines = [f"**[{b['kind'].upper()}]** {trunc(b['title'], 110)} — {fdate(b['published'])}" for b in chunk] or ["Aucun bulletin sur la période."]
        text(s, Inches(0.6), Inches(1.85), Inches(12.1), Inches(5), lines, 13)

    # 8. Méthode
    s = frame("Méthode de priorisation", "Sources : NVD, CISA KEV, FIRST EPSS, CVE.org / CISA Vulnrichment, CERT-FR, GitHub Advisories")
    grid(s, ["Priorité", "Critère", "Délai"], [list(m) for m in METHODO], Inches(0.6), Inches(1.85), Inches(12.1), [1, 6, 2.5], prio_col=0, size=14)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- Excel

def to_xlsx(r: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_font, head_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor=BLUE)

    def sheet(ws, headers, rows, widths, prio_col=None):
        ws.append(headers)
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(vertical="center", wrap_text=True)
        for row in rows:
            ws.append(row)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        if prio_col is not None:
            for row in ws.iter_rows(min_row=2):
                c = row[prio_col]
                p = int(str(c.value)[1:]) if str(c.value)[1:].isdigit() else 4
                c.fill, c.font = PatternFill("solid", fgColor=PRIO_HEX[p]), Font(bold=True, color="FFFFFF")
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(vertical="top", wrap_text=True)
        ws.freeze_panes = "A2"
        if rows:
            ws.auto_filter.ref = ws.dimensions

    ws = wb.active
    ws.title = "Synthèse"
    ws["A1"] = r["classification"].upper()
    ws["A1"].font = Font(bold=True, color=tlp_hex(r["classification"]))
    ws["A1"].fill = PatternFill("solid", fgColor="000000")
    ws["A3"] = "Bulletin de veille des vulnérabilités"
    ws["A3"].font = Font(bold=True, size=16, color=DARK)
    rows = [("Émetteur", f"{r['app']} — {r['org']}"), ("Période", period(r)), ("Produits", products_label(r)),
            ("Édité le", f"{fdate(r['generated_at'], True)} par {r['generated_by']}"), ("", "")]
    rows += [(label, r["kpi"].get(key, 0)) for key, label, _ in KPI_DEF] + [("", ""), ("Faits marquants", "")]
    rows += [("•", plain(f)) for f in r["facts"]] + [("", ""), ("Actions recommandées", "")]
    rows += [(f"{i}.", plain(a)) for i, a in enumerate(r["actions"], 1)]
    for i, (k, v) in enumerate(rows, start=5):
        ws.cell(row=i, column=1, value=k).font = Font(bold=True)
        ws.cell(row=i, column=2, value=v).alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width, ws.column_dimensions["B"].width = 34, 120

    sheet(wb.create_sheet("Prioritaires P1-P2"),
          ["Priorité", "Identifiant", "Produit", "CVSS", "Sévérité", "EPSS (%)", "KEV", "Statut", "Assigné à", "Échéance", "Titre", "Description", "Lien"],
          [[f"P{v['priority']}", v["id"], ", ".join(v["watches"]), v["cvss_score"], v["severity"],
            round(v["epss"] * 100, 2) if v.get("epss") is not None else None, "Oui" if v["kev"] else "Non",
            STATUS_FR.get(v["status"], v["status"]), v.get("assignee_name") or "", v.get("due_date") or "",
            v.get("title") or "", v.get("description") or "",
            f"https://nvd.nist.gov/vuln/detail/{v['id']}" if v["id"].startswith("CVE-") else f"https://github.com/advisories/{v['id']}"]
           for v in r["priority_items"]],
          [9, 17, 20, 7, 11, 9, 7, 15, 18, 12, 40, 70, 45], prio_col=0)
    sheet(wb.create_sheet("Par produit"), ["Produit", "Total", "P1", "P2", "KEV", "CVSS max"],
          [[w["name"], w["total"], w["p1"], w["p2"], w["kev"], w["max_cvss"]] for w in r["by_watch"]], [30, 10, 8, 8, 8, 10])
    sheet(wb.create_sheet("Suivi"), ["Statut (P1/P2)", "Nombre"], [[STATUS_FR[k], r["triage"].get(k, 0)] for k in STATUS_FR], [24, 10])
    sheet(wb.create_sheet("CISA KEV"), ["Identifiant", "Vulnérabilité", "Ajout", "Échéance", "Action requise", "Produit surveillé"],
          [[v["id"], vtitle(v), v["kev_added"], v["kev_due"], v.get("kev_action") or "", ", ".join(v["watches"])] for v in r["kev_new"]],
          [17, 50, 12, 12, 60, 22])
    sheet(wb.create_sheet("CERT-FR"), ["Type", "Titre", "Date", "CVE", "Lien"],
          [[b["kind"], b["title"], fdate(b["published"]), ", ".join(b["cves"][:30]), b["link"]] for b in r["bulletins"]],
          [10, 70, 14, 50, 60])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- PDF

def to_pdf(r: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Image, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    font, bold = "Helvetica", "Helvetica-Bold"
    for d in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu"):
        if os.path.exists(os.path.join(d, "DejaVuSans.ttf")):
            try:
                pdfmetrics.registerFont(TTFont("DejaVu", os.path.join(d, "DejaVuSans.ttf")))
                pdfmetrics.registerFont(TTFont("DejaVu-Bold", os.path.join(d, "DejaVuSans-Bold.ttf")))
                pdfmetrics.registerFontFamily("DejaVu", normal="DejaVu", bold="DejaVu-Bold")
                font, bold = "DejaVu", "DejaVu-Bold"
            except Exception:
                pass
            break
    col = lambda h: colors.HexColor("#" + h)
    base = ParagraphStyle("b", fontName=font, fontSize=9, leading=12.5, textColor=col(DARK))
    small = ParagraphStyle("s", parent=base, fontSize=7.5, leading=9.5)
    h1 = ParagraphStyle("h1", parent=base, fontName=bold, fontSize=20, leading=24, spaceBefore=8)
    h2 = ParagraphStyle("h2", parent=base, fontName=bold, fontSize=12.5, leading=16, textColor=col(BLUE), spaceBefore=12, spaceAfter=6)
    th = ParagraphStyle("th", parent=small, fontName=bold, textColor=colors.white)

    def P(t, st=base):
        t = html.escape(t or "")
        t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
        return Paragraph(t, st)

    def tbl(headers, rows, widths, prio_col=None):
        data = [[Paragraph(html.escape(h), th) for h in headers]] + [[P(str(c), small) for c in row] for row in rows]
        if prio_col is not None:
            white = ParagraphStyle("pw", parent=small, fontName=bold, textColor=colors.white)
            for i, row in enumerate(rows, 1):
                data[i][prio_col] = Paragraph(html.escape(str(row[prio_col])), white)
        t = Table(data, colWidths=[w * cm for w in widths], repeatRows=1)
        style = [("BACKGROUND", (0, 0), (-1, 0), col(BLUE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                 ("GRID", (0, 0), (-1, -1), 0.4, col("D9DEE8")), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, col("F5F7FB")]),
                 ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                 ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]
        if prio_col is not None:
            for i, row in enumerate(rows, 1):
                p = int(str(row[prio_col])[1:]) if str(row[prio_col])[1:].isdigit() else 4
                style.append(("BACKGROUND", (prio_col, i), (prio_col, i), col(PRIO_HEX[p])))
        t.setStyle(TableStyle(style))
        return t

    def deco(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(colors.black)
        canvas.rect(0, h - 0.75 * cm, w, 0.75 * cm, stroke=0, fill=1)
        canvas.setFillColor(col(tlp_hex(r["classification"])))
        canvas.setFont(bold, 8.5)
        canvas.drawCentredString(w / 2, h - 0.5 * cm, r["classification"].upper())
        canvas.setFillColor(col(GREY))
        canvas.setFont(font, 7.5)
        canvas.drawString(1.8 * cm, 0.9 * cm, f"{r['app']} — Bulletin de veille {period(r)}")
        canvas.drawRightString(w - 1.8 * cm, 0.9 * cm, f"Page {doc.page}")
        canvas.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.5 * cm, bottomMargin=1.6 * cm,
                            title="Bulletin de veille des vulnérabilités", author=r["app"])
    S = []
    if os.path.exists(BANNER):
        S.append(Image(BANNER, width=17.4 * cm, height=17.4 * cm * 9 / 16))
    S += [P("Bulletin de veille des vulnérabilités", h1), P(f"Période {period(r)}", ParagraphStyle("p", parent=base, fontSize=11, textColor=col(GREY))), Spacer(1, 8)]
    meta = Table([[P("**Émetteur**"), P(f"{r['app']} — {r['org']} — Équipe SSI")], [P("**Produits couverts**"), P(products_label(r))],
                  [P("**Édité le**"), P(f"{fdate(r['generated_at'], True)} par {r['generated_by']}")], [P("**Diffusion**"), P(r["classification"])]],
                 colWidths=[4 * cm, 13.4 * cm])
    meta.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), col(LIGHT)), ("GRID", (0, 0), (-1, -1), 0.4, col("D9DEE8")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    S.append(meta)

    S.append(P("1. Synthèse", h2))
    kp = Table([[Paragraph(f"<font color='#{c}' size='17'><b>{r['kpi'].get(k, 0)}</b></font>", ParagraphStyle("k", parent=base, alignment=TA_CENTER, leading=20)) for k, _, c in KPI_DEF],
                [Paragraph(html.escape(l), ParagraphStyle("kl", parent=small, alignment=TA_CENTER, textColor=col(GREY))) for _, l, _ in KPI_DEF]],
               colWidths=[2.9 * cm] * len(KPI_DEF))
    kp.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), col(LIGHT)), ("BOX", (0, 0), (-1, -1), 0.4, col("D9DEE8")),
                            ("LINEAFTER", (0, 0), (-2, -1), 0.4, colors.white), ("TOPPADDING", (0, 0), (-1, -1), 6)]))
    S += [kp, Spacer(1, 8), ListFlowable([ListItem(P(f), leftIndent=10) for f in r["facts"]], bulletType="bullet", start="•")]
    S += [P("2. Actions recommandées", h2), ListFlowable([ListItem(P(a), leftIndent=12) for a in r["actions"]], bulletType="1")]
    S.append(P("3. Vulnérabilités prioritaires (P1 / P2)", h2))
    if r["priority_items"]:
        S.append(tbl(["Prio.", "Identifiant", "Produit", "CVSS", "EPSS", "KEV", "Statut", "Vulnérabilité"],
                     [[f"P{v['priority']}", v["id"], ", ".join(v["watches"]), score(v), epss(v), "Oui" if v["kev"] else "—",
                       STATUS_FR.get(v["status"], v["status"]), trunc(vtitle(v), 120)] for v in r["priority_items"]],
                     [1.2, 2.7, 2.2, 1.2, 1.4, 1.1, 2.0, 5.6], prio_col=0))
    else:
        S.append(P("Aucune vulnérabilité P1/P2 sur les produits sélectionnés pour cette période."))
    S.append(P("4. Répartition par produit", h2))
    S.append(tbl(["Produit", "Total", "P1", "P2", "KEV", "CVSS max"],
                 [[w["name"], w["total"], w["p1"], w["p2"], w["kev"], w["max_cvss"] if w["max_cvss"] is not None else "—"] for w in r["by_watch"]],
                 [6.4, 2.2, 2.2, 2.2, 2.2, 2.2]) if r["by_watch"] else P("Aucune nouveauté sur les produits sélectionnés."))
    S += [P("5. Suivi du traitement (P1/P2)", h2), tbl(["Statut", "Nombre"], [[STATUS_FR[k], r["triage"].get(k, 0)] for k in STATUS_FR], [8, 3])]
    S.append(P("6. Nouvelles vulnérabilités exploitées (CISA KEV)", h2))
    S.append(tbl(["Identifiant", "Vulnérabilité", "Ajout", "Échéance", "Produit surveillé"],
                 [[v["id"], trunc(vtitle(v), 100), fdate(v["kev_added"]), fdate(v["kev_due"]), ", ".join(v["watches"]) or "—"] for v in r["kev_new"]],
                 [2.8, 7.4, 2.2, 2.2, 2.8]) if r["kev_new"] else P("Aucun ajout au catalogue sur la période."))
    S.append(P("7. Bulletins CERT-FR", h2))
    S.append(ListFlowable([ListItem(P(f"**[{b['kind'].upper()}]** {b['title']} — {fdate(b['published'])}"), leftIndent=10) for b in r["bulletins"]],
                          bulletType="bullet", start="•") if r["bulletins"] else P("Aucun bulletin CERT-FR sur la période."))
    S += [P("Annexe — Méthode de priorisation", h2), tbl(["Priorité", "Critère", "Délai"], [list(m) for m in METHODO], [2, 10.4, 5], prio_col=0),
          Spacer(1, 8), P("Sources : NVD (NIST), CISA KEV, FIRST EPSS, CVE.org / CISA Vulnrichment, CERT-FR (ANSSI), GitHub Advisories. "
                          f"Document généré automatiquement par {r['app']}.", small)]
    doc.build(S, onFirstPage=deco, onLaterPages=deco)
    return buf.getvalue()


# ---------------------------------------------------------------- HTML (fichier autonome et corps d'e-mail)

def to_html(r: dict, email: bool = False) -> bytes:
    e = html.escape

    def rich(t):
        return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", e(t or ""))

    th = "background:#0B4AA6;color:#fff;text-align:left;padding:6px 8px;font-size:12px"
    td = "padding:6px 8px;border-bottom:1px solid #E1E6EF;font-size:12px;vertical-align:top"

    def table(headers, rows, prio_col=None):
        out = f"<table style='border-collapse:collapse;width:100%;margin:6px 0 4px'><tr>{''.join(f'<th style={chr(34)}{th}{chr(34)}>{e(h)}</th>' for h in headers)}</tr>"
        for row in rows:
            cells = []
            for i, c in enumerate(row):
                if prio_col is not None and i == prio_col:
                    p = int(str(c)[1:]) if str(c)[1:].isdigit() else 4
                    cells.append(f"<td style='{td}'><span style='background:#{PRIO_HEX[p]};color:#fff;font-weight:700;padding:1px 7px;border-radius:4px'>{e(str(c))}</span></td>")
                else:
                    cells.append(f"<td style='{td}'>{e(str(c))}</td>")
            out += "<tr>" + "".join(cells) + "</tr>"
        return out + "</table>"

    h2 = "color:#0B4AA6;font-size:16px;border-bottom:1px solid #D9DEE8;padding-bottom:4px;margin:22px 0 8px"
    banner = ""
    if not email and os.path.exists(BANNER):
        with open(BANNER, "rb") as f:
            banner = f"<img src='data:image/jpeg;base64,{base64.b64encode(f.read()).decode()}' style='width:100%;border-radius:8px' alt=''>"
    tiles = "".join(f"<td style='background:#EEF2F8;border-left:4px solid #{c};padding:10px;width:16%'><div style='font-size:22px;font-weight:700;color:#{c}'>{r['kpi'].get(k, 0)}</div>"
                    f"<div style='font-size:11px;color:#5B6880'>{e(l)}</div></td>" for k, l, c in KPI_DEF)
    body = f"""
<div style='font-family:Segoe UI,Calibri,Arial,sans-serif;color:#13213A;max-width:960px;margin:0 auto'>
  <div style='background:#000;color:#{tlp_hex(r["classification"])};text-align:center;font-weight:700;font-size:12px;padding:5px;letter-spacing:.06em'>{e(r["classification"].upper())}</div>
  {banner}
  <!--MESSAGE-->
  <h1 style='font-size:24px;margin:18px 0 2px'>Bulletin de veille des vulnérabilités</h1>
  <div style='color:#5B6880'>Période {e(period(r))} — {e(r["app"])}, {e(r["org"])}</div>
  <div style='color:#5B6880;font-size:12px;margin-top:4px'>Produits couverts : {e(products_label(r))} · Édité le {e(fdate(r["generated_at"], True))} par {e(r["generated_by"])}</div>
  <h2 style='{h2}'>1. Synthèse</h2>
  <table style='border-collapse:separate;border-spacing:6px;width:100%'><tr>{tiles}</tr></table>
  <ul style='line-height:1.7'>{''.join(f"<li>{rich(f)}</li>" for f in r["facts"])}</ul>
  <h2 style='{h2}'>2. Actions recommandées</h2>
  <ol style='line-height:1.7'>{''.join(f"<li>{rich(a)}</li>" for a in r["actions"])}</ol>
  <h2 style='{h2}'>3. Vulnérabilités prioritaires (P1 / P2)</h2>
  {table(["Prio.", "Identifiant", "Produit", "CVSS", "EPSS", "KEV", "Statut", "Vulnérabilité"],
         [[f"P{v['priority']}", v["id"], ", ".join(v["watches"]), score(v), epss(v), "Oui" if v["kev"] else "—",
           STATUS_FR.get(v["status"], v["status"]), trunc(vtitle(v), 120)] for v in r["priority_items"]], 0)
   if r["priority_items"] else "<p>Aucune vulnérabilité P1/P2 sur la période.</p>"}
  <h2 style='{h2}'>4. Répartition par produit</h2>
  {table(["Produit", "Total", "P1", "P2", "KEV", "CVSS max"], [[w["name"], w["total"], w["p1"], w["p2"], w["kev"], w["max_cvss"] if w["max_cvss"] is not None else "—"] for w in r["by_watch"]])
   if r["by_watch"] else "<p>Aucune nouveauté sur les produits sélectionnés.</p>"}
  <h2 style='{h2}'>5. Nouvelles vulnérabilités exploitées (CISA KEV)</h2>
  {table(["Identifiant", "Vulnérabilité", "Ajout", "Échéance", "Produit"], [[v["id"], trunc(vtitle(v), 100), fdate(v["kev_added"]), fdate(v["kev_due"]), ", ".join(v["watches"]) or "—"] for v in r["kev_new"]])
   if r["kev_new"] else "<p>Aucun ajout au catalogue sur la période.</p>"}
  <h2 style='{h2}'>6. Bulletins CERT-FR</h2>
  {"<ul>" + "".join(f"<li><b>[{e(b['kind'].upper())}]</b> <a href='{e(b['link'])}'>{e(b['title'])}</a> — {e(fdate(b['published']))}</li>" for b in r["bulletins"]) + "</ul>"
   if r["bulletins"] else "<p>Aucun bulletin CERT-FR sur la période.</p>"}
  <p style='color:#8C97AA;font-size:11px;border-top:1px solid #D9DEE8;padding-top:8px;margin-top:26px'>{e(r["classification"])} — Document généré automatiquement par {e(r["app"])}.
  Sources : NVD, CISA KEV, FIRST EPSS, CVE.org / CISA Vulnrichment, CERT-FR, GitHub Advisories.</p>
</div>"""
    if email:
        return body.encode()
    return (f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><title>Bulletin de veille — {e(r['app'])}</title>"
            f"<meta name='viewport' content='width=device-width, initial-scale=1'></head><body style='background:#fff;margin:20px'>{body}</body></html>").encode()
