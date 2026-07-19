# -*- coding: utf-8 -*-
"""심사위원-실행-가이드.md → 심사위원-실행-가이드.pdf (A4, 제출용).

MD가 단일 소스 — 이 스크립트는 최소 변환기(헤딩·표·리스트·코드·볼드)로 스타일드 HTML을 만들어
Playwright 인쇄로 PDF를 뽑는다(발표자료 render-deck.py와 같은 파이프라인, 외부 의존성 없음).
사용법: cd docs/제출 && python render-guide.py
"""
import glob
import html
import pathlib
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "심사위원-실행-가이드.md"
PDF = HERE / "심사위원-실행-가이드.pdf"

CSS = """
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#1f2a1f;font-size:11.5px;
     line-height:1.62;margin:34px 44px}
h1{font-size:21px;border-bottom:3px solid #4caf6d;padding-bottom:8px;margin:0 0 10px}
h2{font-size:14.5px;color:#2e7d4f;margin:20px 0 6px;border-left:4px solid #4caf6d;padding-left:8px}
blockquote{margin:6px 0;padding:7px 12px;background:#f2f9f4;border-radius:8px;color:#375a42;font-size:11px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:11px}
th,td{border:1px solid #cfe3d5;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#eaf6ee}
code{background:#f0f4f1;border-radius:4px;padding:1px 4px;font-size:10.5px}
pre{background:#f0f4f1;border-radius:8px;padding:10px 12px;font-size:10.5px;line-height:1.5;overflow:hidden;white-space:pre-wrap}
ul{margin:5px 0;padding-left:20px}
li{margin:2.5px 0}
hr{border:none;border-top:1px solid #cfe3d5;margin:14px 0}
b,strong{color:#14401f}
"""


def inline(s: str) -> str:
    s = html.escape(s, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"(https?://[^\s)<]+)", r'<a href="\1">\1</a>', s)
    return s


def md_to_html(md: str) -> str:
    out, in_code, in_ul, in_table, in_quote = [], False, False, False, False

    def close_blocks():
        nonlocal in_ul, in_table, in_quote
        if in_ul:
            out.append("</ul>")
            in_ul = False
        if in_table:
            out.append("</table>")
            in_table = False
        if in_quote:
            out.append("</blockquote>")
            in_quote = False

    for line in md.splitlines():
        if line.strip().startswith("```"):
            if in_code:
                out.append("</pre>")
            else:
                close_blocks()
                out.append("<pre>")
            in_code = not in_code
            continue
        if in_code:
            out.append(html.escape(line))
            continue
        s = line.rstrip()
        if not s.strip():
            close_blocks()
            continue
        if s.startswith("# "):
            close_blocks()
            out.append(f"<h1>{inline(s[2:])}</h1>")
        elif s.startswith("## "):
            close_blocks()
            out.append(f"<h2>{inline(s[3:])}</h2>")
        elif s.startswith("> "):
            if not in_quote:
                close_blocks()
                out.append("<blockquote>")
                in_quote = True
            out.append(inline(s[2:]) + "<br>")
        elif s.startswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue  # 구분선
            if not in_table:
                close_blocks()
                out.append("<table>")
                in_table = True
                out.append("<tr>" + "".join(f"<th>{inline(c)}</th>" for c in cells) + "</tr>")
            else:
                out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
        elif s.strip().startswith("- "):
            if not in_ul:
                close_blocks()
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{inline(s.strip()[2:])}</li>")
        elif re.fullmatch(r"-{3,}", s.strip()):
            close_blocks()
            out.append("<hr>")
        elif re.match(r"^\d+\. ", s.strip()):
            close_blocks()
            out.append(f"<p style='margin:3px 0'>{inline(s.strip())}</p>")
        else:
            close_blocks()
            out.append(f"<p style='margin:4px 0'>{inline(s.strip())}</p>")
    close_blocks()
    if in_code:
        out.append("</pre>")
    return f"<!doctype html><meta charset='utf-8'><style>{CSS}</style><body>" + "\n".join(out)


def main():
    from playwright.sync_api import sync_playwright
    doc = md_to_html(SRC.read_text(encoding="utf-8"))
    tmp = HERE / "_guide_tmp.html"
    tmp.write_text(doc, encoding="utf-8")
    with sync_playwright() as p:
        exe = glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
        b = p.chromium.launch(executable_path=(exe[0] if exe else None))
        pg = b.new_page()
        pg.goto(tmp.as_uri())
        pg.wait_for_load_state("networkidle")
        pg.pdf(path=str(PDF), format="A4", print_background=True,
               margin={"top": "10mm", "bottom": "12mm", "left": "10mm", "right": "10mm"})
        b.close()
    tmp.unlink(missing_ok=True)
    print(f"완료: {PDF.name}")


if __name__ == "__main__":
    main()
