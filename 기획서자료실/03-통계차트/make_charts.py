# -*- coding: utf-8 -*-
"""기획서용 통계 차트 생성 — 전부 실측치(실데이터-통계.json + 저장소 게이트 수치).
실행: backend/venv/Scripts/python.exe 기획서자료실/03-통계차트/make_charts.py
"""
import json, io
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = Path(__file__).parent
plt.rcParams['font.family'] = 'Malgun Gothic'
plt.rcParams['axes.unicode_minus'] = False

GREEN = '#16a34a'; LIGHT = '#86efac'; DARK = '#166534'
PEACH = '#fb923c'; SKY = '#38bdf8'; ROSE = '#fb7185'; GRAY = '#94a3b8'
BG = '#fdfcf8'

stats = json.loads((HERE / '실데이터-통계.json').read_text(encoding='utf-8'))

def save(fig, name):
    fig.savefig(HERE / name, dpi=200, bbox_inches='tight', facecolor=BG)
    plt.close(fig)
    print('saved', name)

# ── 1. 데이터 구성 도넛 ──────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(8.6, 5.6))
fig.patch.set_facecolor(BG)
sizes = [stats['loc'], stats['gov'], stats['pol'] + stats['sup'] + stats['hou'] + stats['fin'], stats['prv']]
labels = [f"지자체 복지\n{stats['loc']:,}건", f"중앙부처 복지\n{stats['gov']}건",
          f"검증 큐레이션(정부·금융·주거)\n{stats['pol']+stats['sup']+stats['hou']+stats['fin']}건", f"민간재단\n{stats['prv']}건"]
colors = [LIGHT, GREEN, PEACH, ROSE]
w, _ = ax.pie(sizes, colors=colors, startangle=90, counterclock=False,
              wedgeprops=dict(width=0.42, edgecolor='white', linewidth=2))
ax.text(0, 0.06, f"{stats['total']:,}건", ha='center', va='center', fontsize=30, fontweight='bold', color=DARK)
ax.text(0, -0.16, '전국 복지 통합 카탈로그\n(전부 실데이터·공식 출처)', ha='center', va='center', fontsize=10.5, color='#555')
ax.legend(w, [l.replace('\n', ' ') for l in labels], loc='center left', bbox_to_anchor=(1.02, 0.5),
          fontsize=11.5, frameon=False)
ax.set_title('모두봄 데이터 구성 — 정부·지자체·민간을 한곳에', fontsize=15, fontweight='bold', color=DARK, pad=16, loc='left')
save(fig, 'chart1-데이터구성.png')

# ── 2. 카테고리 분포 가로바 ──────────────────────────────────────────
top = stats['categoriesTop'][:12][::-1]
fig, ax = plt.subplots(figsize=(9.2, 6.2))
fig.patch.set_facecolor(BG); ax.set_facecolor(BG)
names = [c for c, _ in top]; vals = [v for _, v in top]
bars = ax.barh(names, vals, color=[GREEN if v == max(vals) else LIGHT for v in vals], edgecolor='white')
for b, v in zip(bars, vals):
    ax.text(b.get_width() + max(vals)*0.01, b.get_y() + b.get_height()/2, f'{v:,}', va='center', fontsize=10.5, color=DARK, fontweight='bold')
ax.set_title(f'분야별 복지 정책 수 (총 {stats["total"]:,}건 중 상위 12개 분야)', fontsize=15, fontweight='bold', color=DARK, pad=12)
ax.spines[['top', 'right']].set_visible(False)
ax.set_xlabel('정책 수 (건)', fontsize=11)
ax.tick_params(labelsize=11.5)
save(fig, 'chart2-분야별정책수.png')

# ── 3. 페르소나별 발견 가치(월 최대 현금지원, 라이브 실측) ───────────
fig, ax = plt.subplots(figsize=(9.2, 5.4))
fig.patch.set_facecolor(BG); ax.set_facecolor(BG)
personas = ['독거 어르신\n(72세·중위25%)', '출산 가정\n(0세 자녀)', '중증장애인\n(45세·중위35%)']
vals = [639700, 1193000, 349700]
colors3 = [GREEN, PEACH, SKY]
bars = ax.bar(personas, vals, color=colors3, width=0.52, edgecolor='white')
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width()/2, v + 25000, f'월 최대 {v:,}원', ha='center', fontsize=12.5, fontweight='bold', color=DARK)
ax.set_title('"몰라서 못 받던 돈" — 페르소나별 핵심 현금지원 발견액 (라이브 실측)', fontsize=14.5, fontweight='bold', color=DARK, pad=14)
ax.set_ylim(0, 1400000)
ax.yaxis.set_major_formatter(lambda x, _: f'{int(x/10000)}만')
ax.spines[['top', 'right']].set_visible(False)
ax.tick_params(labelsize=11.5)
fig.text(0.13, 0.015, "※ '월 최대·중복 미반영' 기준 — 강력추천 중 현금성 지원만 보수적으로 합산(상품권·서비스·물품 제외). 실제 수급액은 심사에 따라 달라질 수 있음.",
         fontsize=8.5, color='#777')
save(fig, 'chart3-페르소나발견가치.png')

# ── 4. 품질 게이트 실측 ──────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(9.2, 5.0))
fig.patch.set_facecolor(BG); ax.set_facecolor(BG)
items = ['프론트 단위테스트', '백엔드 pytest', 'E2E 실브라우저 여정', '신청·발급 URL 생존검사', '접근성(Lighthouse)']
vals4 = [353, 34, 10, 70, 96]
labels4 = ['353개 통과', '34개 통과', '10개 여정 · 에러 0', '70건 중 69건 생존(1건 즉시 정정)', '96점 / BP·SEO 100점']
bars = ax.barh(items[::-1], vals4[::-1], color=[SKY, ROSE, PEACH, LIGHT, GREEN][::-1], edgecolor='white')
for b, lab in zip(bars, labels4[::-1]):
    ax.text(b.get_width() + 4, b.get_y() + b.get_height()/2, lab, va='center', fontsize=11, fontweight='bold', color=DARK)
ax.set_xlim(0, 460)
ax.set_title('품질을 숫자로 증명 — 자동 검증 게이트 (매 변경마다 실행)', fontsize=15, fontweight='bold', color=DARK, pad=12)
ax.spines[['top', 'right']].set_visible(False)
ax.tick_params(labelsize=11.5); ax.set_xticks([])
save(fig, 'chart4-품질게이트.png')

# ── 5. 서류 발급 자동화 — 사람이 할 일 8→1 ──────────────────────────
fig, ax = plt.subplots(figsize=(9.2, 4.6))
fig.patch.set_facecolor(BG); ax.set_facecolor(BG)
steps = ['사이트 접속', '로그인 찾기', '간편인증 선택', '정보 입력', '동의 체크', '민원 검색', '발급 신청', '문서 저장']
xs = range(len(steps))
for i, s in enumerate(steps):
    auto = True
    ax.add_patch(plt.Rectangle((i, 0), 0.86, 1, color=GREEN if auto else PEACH, alpha=0.92))
    ax.text(i + 0.43, 0.5, s, ha='center', va='center', fontsize=10, color='white', fontweight='bold', rotation=0)
    ax.text(i + 0.43, 1.14, '🤖 자동', ha='center', fontsize=9.5, color=DARK)
ax.add_patch(plt.Rectangle((len(steps), 0), 0.86, 1, color=PEACH))
ax.text(len(steps) + 0.43, 0.5, '본인인증\n(폰 승인)', ha='center', va='center', fontsize=10, color='white', fontweight='bold')
ax.text(len(steps) + 0.43, 1.14, '🙋 본인 1번', ha='center', fontsize=9.5, color='#b45309', fontweight='bold')
ax.set_xlim(-0.2, len(steps) + 1.1); ax.set_ylim(-0.35, 1.65)
ax.axis('off')
ax.set_title('서류 자동발급 — 9단계 중 사람은 "폰에서 인증 승인" 1번만 (법적 필수 단계)', fontsize=14.5, fontweight='bold', color=DARK, pad=10)
fig.text(0.13, 0.03, '※ 본인인증·최종 제출은 법이 사람에게 요구하는 단계 — human-in-the-loop 설계(무인 대행은 의도적으로 배제)', fontsize=9, color='#777')
save(fig, 'chart5-자동화단계.png')

# ── 6. 기존 복지앱 불만 → 모두봄 대응 ────────────────────────────────
fig, ax = plt.subplots(figsize=(10.2, 5.6))
fig.patch.set_facecolor(BG); ax.axis('off')
rows = [
    ('😤 "입력하다 상태를 잃어요"', '진행 임시저장 — 새로고침해도 이어서'),
    ('👵 "글씨가 작아 못 읽어요"', '어르신 선택 시 큰글씨 원탭 제안 + 질문 읽어주기(TTS)'),
    ('🧱 "결국 막다른 길에서 멈춰요"', '모든 0건 화면에 다음 행동(재분석·AI검색·129 전화)'),
    ('🔐 "로그인·인증이 너무 복잡해요"', '회원가입·로그인 없이 전 기능 (개인정보 기기 안에만)'),
    ('📵 "결국 PC를 켜야 해요"', '모바일 PWA로 전 기능 + 설치·오프라인 지원'),
    ('🙉 "항의해도 답이 없어요"', '의견 보내기 채널 상시 + 129 무료상담 연결'),
]
ax.text(0.25, 1.02, '기존 복지앱 사용자 불만 (앱스토어 리뷰·언론 실측)', ha='center', fontsize=13, fontweight='bold', color='#b91c1c', transform=ax.transAxes)
ax.text(0.75, 1.02, '모두봄의 대응 (전부 구현·배포됨)', ha='center', fontsize=13, fontweight='bold', color=DARK, transform=ax.transAxes)
for i, (pain, sol) in enumerate(rows):
    y = 0.9 - i * 0.16
    ax.add_patch(plt.Rectangle((0.01, y - 0.06), 0.46, 0.125, transform=ax.transAxes, color='#fee2e2', ec='#fecaca'))
    ax.add_patch(plt.Rectangle((0.53, y - 0.06), 0.46, 0.125, transform=ax.transAxes, color='#dcfce7', ec='#bbf7d0'))
    ax.text(0.03, y, pain, fontsize=11.5, va='center', transform=ax.transAxes)
    ax.text(0.55, y, sol, fontsize=11.5, va='center', transform=ax.transAxes)
    ax.annotate('', xy=(0.525, y), xytext=(0.478, y), xycoords='axes fraction',
                arrowprops=dict(arrowstyle='->', color=GREEN, lw=2))
save(fig, 'chart6-불만대응맵.png')
print('ALL CHARTS DONE')
