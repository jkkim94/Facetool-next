# -*- coding: utf-8 -*-
"""Generate a 2-slide PPT summarizing the DNA MetaHuman web playback PoC."""
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

FONT = "Malgun Gothic"
NAVY = RGBColor(0x1F, 0x2D, 0x52)
BLUE = RGBColor(0x25, 0x63, 0xEB)
LIGHT = RGBColor(0xEE, 0xF2, 0xFB)
GRAY = RGBColor(0x44, 0x4A, 0x57)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
MUTED = RGBColor(0x8A, 0x90, 0x9C)

SHOT = r"C:\Users\skpark\AppData\Local\Temp\cursor\screenshots\page-2026-06-05T03-05-54-684Z.png"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
blank = prs.slide_layouts[6]


def set_font(run, size, color=GRAY, bold=False):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.bold = bold


def add_text(slide, x, y, w, h, lines, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    for i, (text, size, color, bold, level) in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.level = level
        p.space_after = Pt(4)
        r = p.add_run()
        r.text = text
        set_font(r, size, color, bold)
    return tb


def add_box(slide, x, y, w, h, fill, line=None, radius=True):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    shape.shadow.inherit = False
    return shape


def box_text(shape, lines, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER):
    tf = shape.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = Pt(6)
    tf.margin_right = Pt(6)
    tf.margin_top = Pt(4)
    tf.margin_bottom = Pt(4)
    for i, (text, size, color, bold) in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = text
        set_font(r, size, color, bold)


def header(slide, title, page):
    bar = add_box(slide, 0, 0, 13.333, 1.0, NAVY, radius=False)
    box_text(bar, [(title, 24, WHITE, True)], align=PP_ALIGN.LEFT)
    bar.text_frame.margin_left = Pt(28)
    pg = add_box(slide, 12.4, 0.28, 0.7, 0.44, BLUE)
    box_text(pg, [(page, 14, WHITE, True)])


# ============================ SLIDE 1 ============================
s1 = prs.slides.add_slide(blank)
header(s1, "DNA MetaHuman 웹 재생 PoC — 구현 개요", "1")

# goal
add_text(s1, 0.55, 1.15, 12.3, 0.7, [
    ("목표", 15, BLUE, True, 0),
    ("Unreal MetaHuman(DNA)을 추출하고, 프레임별 컨트롤 값(NPY)으로 RigLogic을 평가해 "
     "그 결과(표정·시선·턱)를 웹 뷰어(FaceTool)에서 텍스처·오디오와 함께 재생", 13, GRAY, False, 0),
])

# pipeline title
add_text(s1, 0.55, 2.0, 12.3, 0.4, [("전체 파이프라인", 15, BLUE, True, 0)])

# pipeline boxes
py = 2.5
pw, ph = 2.75, 1.35
gap = 0.45
xs = 0.55
steps = [
    ("1. DNA 추출", ["head.dna (v2.5)", "지오메트리·스킨·", "블렌드셰이프·RigLogic"]),
    ("2. RigLogic 평가", ["pybind11 확장(rl4)", "컨트롤 → 블렌드셰이프", "가중치 + 조인트 쿼터니언"]),
    ("3. 베이크", ["블렌드셰이프 + LBS", "프레임별 정점 + UV", "메시별 텍스처"]),
    ("4. 웹 뷰어", ["three.js 정점 스트리밍", "오디오 동기 재생", "온디맨드 베이크"]),
]
for i, (title, subs) in enumerate(steps):
    x = xs + i * (pw + gap)
    b = add_box(s1, x, py, pw, ph, LIGHT, line=BLUE)
    lines = [(title, 14, NAVY, True)] + [(t, 10.5, GRAY, False) for t in subs]
    box_text(b, lines, anchor=MSO_ANCHOR.MIDDLE)
    if i < len(steps) - 1:
        ar = s1.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW,
                                 Inches(x + pw + 0.04), Inches(py + ph / 2 - 0.18),
                                 Inches(gap - 0.08), Inches(0.36))
        ar.fill.solid(); ar.fill.fore_color.rgb = BLUE; ar.line.fill.background()
        ar.shadow.inherit = False

# key points
add_text(s1, 0.55, 4.3, 12.3, 0.4, [("핵심 포인트", 15, BLUE, True, 0)])
add_text(s1, 0.7, 4.75, 12.1, 2.4, [
    ("• DNA 2.5는 기존 오픈소스(MetaHuman-DNA-Calibration, v2.1)로 못 읽음 → "
     "UE 5.6 RigLogic C++ 소스(rl4)를 pybind11로 standalone 빌드해 Python에서 직접 평가", 12.5, GRAY, False, 0),
    ("• NPY 컬럼은 GUI가 아닌 raw 컨트롤(251/260개 매핑) → setRawControls로 직접 주입", 12.5, GRAY, False, 0),
    ("• RigLogic 출력은 쿼터니언 조인트 델타 → Configuration을 Quaternions + ZYX로 맞춰 "
     "네이티브 크래시 해결(회전 타입/순서 불일치가 원인)", 12.5, GRAY, False, 0),
    ("• 무컨트롤 입력 = 중립 메시 (편차 3e-5 cm) 검증으로 스키닝·모핑 수학 정확성 확인", 12.5, GRAY, False, 0),
    ("• 스택: pybind11/MSVC · NumPy 베이크 · Next.js 16 / React 19 / three.js 0.182", 12.5, GRAY, False, 0),
])

# ============================ SLIDE 2 ============================
s2 = prs.slides.add_slide(blank)
header(s2, "구현 상세 & 결과", "2")

# left column: details
lx = 0.55
add_text(s2, lx, 1.2, 6.4, 0.4, [("1) RigLogic Python 확장", 14, BLUE, True, 0)])
add_text(s2, lx + 0.15, 1.6, 6.3, 1.1, [
    ("UE5.6 RigLogicLib(.cpp 90개)를 UE 의존성 없이 빌드", 11.5, GRAY, False, 0),
    ("DNA 로드·메타데이터·지오메트리·평가 API를 Python 노출", 11.5, GRAY, False, 0),
    ("AlignedMemoryResource로 SIMD 정렬 크래시 회피", 11.5, GRAY, False, 0),
])

add_text(s2, lx, 2.75, 6.4, 0.4, [("2) 베이크 (bake.py)", 14, BLUE, True, 0)])
add_text(s2, lx + 0.15, 3.15, 6.3, 1.35, [
    ("프레임별: 블렌드셰이프 모핑 + 선형 블렌드 스키닝(LBS)", 11.5, GRAY, False, 0),
    ("오디오 길이로 FPS 산출(30fps) → 정확한 동기", 11.5, GRAY, False, 0),
    ("float16 + 원점 중심화로 용량 절감(헤드 1162프레임≈83MB)", 11.5, GRAY, False, 0),
    ("head·치아·눈알 메시별 UV/텍스처 → 그룹 단위 출력", 11.5, GRAY, False, 0),
])

add_text(s2, lx, 4.55, 6.4, 0.4, [("3) FaceTool 웹 뷰어", 14, BLUE, True, 0)])
add_text(s2, lx + 0.15, 4.95, 6.3, 1.6, [
    ("three.js: 정점 버퍼 스트리밍 + 메시별 머티리얼(map/normalMap)", 11.5, GRAY, False, 0),
    ("audio.currentTime × fps로 프레임 인덱스 → 오디오 기준 동기", 11.5, GRAY, False, 0),
    ("데이터셋 89개 클립 드롭다운 + 온디맨드 베이크(최초 1회·캐시)", 11.5, GRAY, False, 0),
    ("API: 클립 목록 / 베이크 산출물 서빙 / Python 베이크 실행", 11.5, GRAY, False, 0),
])

# right column: screenshot + caption
rx = 7.25
if os.path.exists(SHOT):
    pic = s2.shapes.add_picture(SHOT, Inches(rx), Inches(1.35), width=Inches(5.55))
    cap_y = 1.35 + pic.height / 914400 + 0.1
else:
    cap_y = 4.0
box = add_box(s2, rx, 6.05, 5.55, 1.1, LIGHT, line=BLUE)
box_text(box, [
    ("결과", 13, NAVY, True),
    ("DNA MetaHuman이 컨트롤 값으로 재생 — 표정·시선·턱이 움직이며 "
     "치아/눈알/피부 텍스처와 오디오가 동기", 11, GRAY, False),
], align=PP_ALIGN.LEFT)

out = r"E:\Viewer\RigLogic_MetaHuman_Web_PoC.pptx"
prs.save(out)
print("SAVED", out)
