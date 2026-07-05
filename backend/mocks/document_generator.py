"""
실제 정부 문서 형태의 HTML 문서 생성기
- 주민등록등본, 건강보험 자격득실확인서, 고용보험 피보험자격 이력내역서 등
- 브라우저에서 미리보기 가능, Ctrl+P로 PDF 저장 가능
"""
import html
import re
import uuid
from datetime import datetime, date


def _safe_name(user_name: str) -> str:
    """사용자 입력 이름을 HTML에 안전하게 넣기 위한 정제.
    - 이름 문자셋(한글·영문·공백·점)만 허용하고 길이 제한 → 스크립트/태그 주입 차단(저장형 XSS·문서위조 방지).
    - HTML 특수문자는 escape로 이중 방어.
    """
    raw = (user_name or "").strip()[:40]
    cleaned = re.sub(r"[^0-9A-Za-z가-힣\s.\-]", "", raw) or "홍길동"
    return html.escape(cleaned, quote=True)


def _today() -> str:
    return datetime.now().strftime("%Y년 %m월 %d일")


def _issue_num() -> str:
    return f"서울-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"


_BASE_CSS = """
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', sans-serif;
    font-size: 10pt;
    color: #000;
    background: #fff;
    padding: 20px;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 20mm 15mm;
    background: #fff;
    position: relative;
  }
  .watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 80pt;
    color: rgba(200, 200, 200, 0.15);
    font-weight: bold;
    pointer-events: none;
    z-index: 0;
  }
  .doc-header {
    text-align: center;
    border-bottom: 2px solid #000;
    padding-bottom: 10px;
    margin-bottom: 15px;
  }
  .doc-title {
    font-size: 18pt;
    font-weight: bold;
    letter-spacing: 4px;
    margin-bottom: 5px;
  }
  .doc-subtitle {
    font-size: 9pt;
    color: #555;
  }
  .section-title {
    font-size: 10pt;
    font-weight: bold;
    background: #f0f0f0;
    padding: 4px 8px;
    margin: 12px 0 6px;
    border-left: 4px solid #333;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    font-size: 9.5pt;
  }
  th, td {
    border: 1px solid #999;
    padding: 5px 8px;
    vertical-align: middle;
  }
  th {
    background: #e8e8e8;
    font-weight: bold;
    text-align: center;
    width: 28%;
  }
  td { text-align: left; }
  .center { text-align: center; }
  .right { text-align: right; }
  .notice-box {
    border: 1px solid #aaa;
    padding: 10px;
    margin-top: 15px;
    font-size: 8.5pt;
    background: #fafafa;
    line-height: 1.6;
  }
  .footer-seal {
    margin-top: 25px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .seal-box {
    text-align: center;
    border: 1px solid #aaa;
    padding: 12px 20px;
    min-width: 120px;
  }
  .seal-box .org { font-size: 11pt; font-weight: bold; }
  .seal-box .date { font-size: 8.5pt; margin-top: 4px; color: #444; }
  .purpose-line {
    border: 1px solid #999;
    padding: 6px 10px;
    margin-bottom: 12px;
    font-size: 9pt;
  }
  .qr-box {
    width: 70px; height: 70px;
    border: 1px solid #aaa;
    display: flex; align-items: center; justify-content: center;
    font-size: 7pt; color: #999; text-align: center;
  }
  .issue-info {
    font-size: 8pt;
    color: #666;
    margin-top: 8px;
    border-top: 1px dashed #ccc;
    padding-top: 8px;
  }
  @media print {
    .no-print { display: none; }
    body { padding: 0; }
    .page { padding: 15mm 12mm; }
  }
  .print-btn {
    position: fixed;
    top: 15px;
    right: 15px;
    background: #1a56db;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    z-index: 999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
  .print-btn:hover { background: #1e429f; }
  .mock-badge {
    position: fixed;
    bottom: 15px;
    right: 15px;
    background: #dc2626;
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    z-index: 999;
  }
  @media print { .print-btn, .mock-badge { display: none; } }
</style>
"""


def generate_resident_register(user_name: str, birth_year: int = 1952, region: str = "경기도 수원시") -> str:
    """주민등록등본 HTML 생성"""
    issue_num = _issue_num()
    today = _today()
    jumin = f"{str(birth_year)[2:]}{(datetime.now().month):02d}01-1{'*' * 6}"
    address = f"{region} 팔달구 인계로 123, 101동 501호"

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>주민등록등본</title>
{_BASE_CSS}
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
<div class="mock-badge no-print">⚠ 모두봄 시연용 샘플 문서</div>
<div class="watermark">SAMPLE</div>
<div class="page">

  <div class="doc-header">
    <div class="doc-title">주 민 등 록 표 ( 등 본 )</div>
    <div class="doc-subtitle">주민등록법 제29조에 의하여 주민등록표의 등본임을 증명합니다</div>
  </div>

  <div class="purpose-line">
    용도: <strong>복지급여 신청용</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급번호: <strong>{issue_num}</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급일: <strong>{today}</strong>
  </div>

  <div class="section-title">▶ 세대 정보</div>
  <table>
    <tr><th>세대주</th><td>{user_name}</td><th>세대구성사유</th><td>단독세대</td></tr>
    <tr><th>주소</th><td colspan="3">{address}</td></tr>
    <tr><th>전입일자</th><td>2018년 03월 15일</td><th>세대원수</th><td>1명</td></tr>
  </table>

  <div class="section-title">▶ 세대원 현황</div>
  <table>
    <tr class="center">
      <th style="width:8%">번호</th>
      <th style="width:20%">성명</th>
      <th style="width:22%">주민등록번호</th>
      <th style="width:18%">세대주관계</th>
      <th style="width:16%">전입일</th>
      <th style="width:16%">변동일</th>
    </tr>
    <tr>
      <td class="center">1</td>
      <td>{user_name}</td>
      <td>{jumin}</td>
      <td class="center">본인(세대주)</td>
      <td class="center">2018.03.15</td>
      <td class="center">—</td>
    </tr>
  </table>

  <div class="notice-box">
    <strong>※ 유의사항</strong><br>
    1. 이 증명서는 주민등록법에 의하여 발급된 공문서입니다.<br>
    2. 위·변조하거나 목적 외 사용하는 경우 법적 제재를 받을 수 있습니다.<br>
    3. 유효기간: 발급일로부터 90일<br>
    4. 본 문서는 모두봄(ModooBom) 시연용 샘플입니다. 실제 효력이 없습니다.
  </div>

  <div class="footer-seal">
    <div>
      <div class="qr-box">QR<br>진위확인</div>
      <div class="issue-info">
        정부24 연동 발급<br>
        발급기관: 경기도 수원시 팔달구청장<br>
        담당자 확인
      </div>
    </div>
    <div class="seal-box">
      <div class="org">경기도 수원시장</div>
      <div style="font-size:28pt;margin:4px 0;">직인</div>
      <div class="date">{today}</div>
    </div>
  </div>

</div>
</body>
</html>"""


def generate_health_insurance_cert(user_name: str, birth_year: int = 1952) -> str:
    """건강보험 자격득실확인서 HTML 생성"""
    issue_num = _issue_num()
    today = _today()
    jumin = f"{str(birth_year)[2:]}0101-1{'*' * 6}"

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>건강보험 자격득실확인서</title>
{_BASE_CSS}
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
<div class="mock-badge no-print">⚠ 모두봄 시연용 샘플 문서</div>
<div class="watermark">SAMPLE</div>
<div class="page">

  <div class="doc-header">
    <div style="font-size:8pt;text-align:right;margin-bottom:6px;">
      국민건강보험공단<br>National Health Insurance Service
    </div>
    <div class="doc-title">건강보험 자격득실확인서</div>
    <div class="doc-subtitle">국민건강보험법 제11조에 의거하여 건강보험 자격 이력을 확인합니다</div>
  </div>

  <div class="purpose-line">
    용도: <strong>복지급여 신청용</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급번호: <strong>{issue_num}</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급일: <strong>{today}</strong>
  </div>

  <div class="section-title">▶ 인적사항</div>
  <table>
    <tr><th>성명</th><td>{user_name}</td><th>주민등록번호</th><td>{jumin}</td></tr>
    <tr><th>가입자구분</th><td colspan="3">지역가입자</td></tr>
  </table>

  <div class="section-title">▶ 자격 이력</div>
  <table>
    <tr class="center">
      <th style="width:8%">번호</th>
      <th style="width:18%">자격구분</th>
      <th style="width:18%">취득일</th>
      <th style="width:18%">상실일</th>
      <th style="width:20%">보험료(월)</th>
      <th style="width:18%">사유</th>
    </tr>
    <tr class="center">
      <td>1</td><td>지역가입자</td><td>2020.01.01</td><td>현재</td>
      <td>48,720원</td><td>현재 유지</td>
    </tr>
    <tr class="center">
      <td>2</td><td>직장가입자</td><td>2015.03.01</td><td>2019.12.31</td>
      <td>63,150원</td><td>퇴직</td>
    </tr>
  </table>

  <div class="section-title">▶ 현재 자격사항</div>
  <table>
    <tr><th>자격상태</th><td><strong>자격유지 (지역가입자)</strong></td></tr>
    <tr><th>피부양자</th><td>해당 없음</td></tr>
    <tr><th>월 보험료</th><td>48,720원</td></tr>
  </table>

  <div class="notice-box">
    <strong>※ 유의사항</strong><br>
    1. 이 확인서는 국민건강보험법에 의하여 발급된 공문서입니다.<br>
    2. 유효기간: 발급일로부터 30일<br>
    3. 본 문서는 모두봄(ModooBom) 시연용 샘플입니다. 실제 효력이 없습니다.
  </div>

  <div class="footer-seal">
    <div>
      <div class="qr-box">QR<br>진위확인</div>
      <div class="issue-info">온라인 발급 | 국민건강보험공단</div>
    </div>
    <div class="seal-box">
      <div class="org">국민건강보험공단<br>이사장</div>
      <div style="font-size:24pt;margin:4px 0;">직인</div>
      <div class="date">{today}</div>
    </div>
  </div>

</div>
</body>
</html>"""


def generate_employment_insurance_cert(user_name: str, birth_year: int = 1998) -> str:
    """고용보험 피보험자격 이력내역서 HTML 생성"""
    issue_num = _issue_num()
    today = _today()

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>고용보험 피보험자격 이력내역서</title>
{_BASE_CSS}
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
<div class="mock-badge no-print">⚠ 모두봄 시연용 샘플 문서</div>
<div class="watermark">SAMPLE</div>
<div class="page">

  <div class="doc-header">
    <div style="font-size:8pt;text-align:right;margin-bottom:6px;">
      고용노동부 고용24<br>Ministry of Employment and Labor
    </div>
    <div class="doc-title">고용보험 피보험자격 이력내역서</div>
    <div class="doc-subtitle">고용보험법 제43조에 의거하여 피보험자격 이력을 확인합니다</div>
  </div>

  <div class="purpose-line">
    용도: <strong>실업급여 / 복지급여 신청용</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급번호: <strong>{issue_num}</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급일: <strong>{today}</strong>
  </div>

  <div class="section-title">▶ 인적사항</div>
  <table>
    <tr><th>성명</th><td>{user_name}</td><th>생년월일</th><td>{birth_year}년 01월 01일</td></tr>
  </table>

  <div class="section-title">▶ 피보험자격 이력</div>
  <table>
    <tr class="center">
      <th style="width:6%">번호</th>
      <th style="width:28%">사업장명</th>
      <th style="width:16%">취득일</th>
      <th style="width:16%">상실일</th>
      <th style="width:18%">피보험기간</th>
      <th style="width:16%">상실사유</th>
    </tr>
    <tr class="center">
      <td>1</td><td class="left">㈜한국테크놀로지</td>
      <td>2023.03.02</td><td>2025.02.28</td>
      <td>1년 11개월</td><td>계약만료</td>
    </tr>
    <tr class="center">
      <td>2</td><td class="left">㈜서울소프트웨어</td>
      <td>2022.01.10</td><td>2023.02.28</td>
      <td>1년 1개월</td><td>자발적이직</td>
    </tr>
  </table>

  <div class="section-title">▶ 피보험단위기간 합산</div>
  <table>
    <tr>
      <th>총 피보험단위기간</th>
      <td><strong>3년 0개월 (약 1,095일)</strong></td>
      <th>실업급여 수급자격</th>
      <td><strong style="color:#1a56db;">요건 충족 (180일 이상)</strong></td>
    </tr>
  </table>

  <div class="notice-box">
    <strong>※ 유의사항</strong><br>
    1. 이 내역서는 고용보험법에 의거하여 발급된 공문서입니다.<br>
    2. 유효기간: 발급일로부터 30일<br>
    3. 실업급여 신청은 이직일 다음날부터 12개월 이내에 하셔야 합니다.<br>
    4. 본 문서는 모두봄(ModooBom) 시연용 샘플입니다. 실제 효력이 없습니다.
  </div>

  <div class="footer-seal">
    <div>
      <div class="qr-box">QR<br>진위확인</div>
      <div class="issue-info">고용24 온라인 발급 | 고용노동부</div>
    </div>
    <div class="seal-box">
      <div class="org">고용노동부장관</div>
      <div style="font-size:24pt;margin:4px 0;">직인</div>
      <div class="date">{today}</div>
    </div>
  </div>

</div>
</body>
</html>"""


def generate_family_relation_cert(user_name: str) -> str:
    """가족관계증명서 HTML 생성"""
    issue_num = _issue_num()
    today = _today()

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>가족관계증명서</title>
{_BASE_CSS}
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
<div class="mock-badge no-print">⚠ 모두봄 시연용 샘플 문서</div>
<div class="watermark">SAMPLE</div>
<div class="page">

  <div class="doc-header">
    <div style="font-size:8pt;text-align:right;margin-bottom:6px;">
      대법원 전자가족관계등록시스템
    </div>
    <div class="doc-title">가 족 관 계 증 명 서</div>
    <div class="doc-subtitle">가족관계의 등록 등에 관한 법률 제15조에 의하여 증명합니다</div>
  </div>

  <div class="purpose-line">
    용도: <strong>복지급여 신청용</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급번호: <strong>{issue_num}</strong> &nbsp;&nbsp;|&nbsp;&nbsp;
    발급일: <strong>{today}</strong>
  </div>

  <div class="section-title">▶ 등록기준지</div>
  <table>
    <tr><td>서울특별시 종로구 삼청로 1</td></tr>
  </table>

  <div class="section-title">▶ 구분: 일반증명서</div>
  <table>
    <tr class="center">
      <th style="width:16%">구분</th>
      <th style="width:22%">성명</th>
      <th style="width:28%">출생연월일</th>
      <th style="width:18%">성별</th>
      <th style="width:16%">본</th>
    </tr>
    <tr class="center">
      <td>본인</td><td>{user_name}</td>
      <td>비공개</td><td>여</td><td>김해</td>
    </tr>
  </table>

  <div class="notice-box">
    <strong>※ 유의사항</strong><br>
    1. 이 증명서는 가족관계의 등록 등에 관한 법률에 의하여 발급된 공문서입니다.<br>
    2. 유효기간: 발급일로부터 90일<br>
    3. 본 문서는 모두봄(ModooBom) 시연용 샘플입니다. 실제 효력이 없습니다.
  </div>

  <div class="footer-seal">
    <div>
      <div class="qr-box">QR<br>진위확인</div>
      <div class="issue-info">정부24 연동 | 대법원 가족관계등록시스템</div>
    </div>
    <div class="seal-box">
      <div class="org">대법원장</div>
      <div style="font-size:24pt;margin:4px 0;">직인</div>
      <div class="date">{today}</div>
    </div>
  </div>

</div>
</body>
</html>"""


# 문서 유형 → 생성 함수 매핑
DOCUMENT_GENERATORS = {
    "주민등록등본":               generate_resident_register,
    "주민등록초본":               generate_resident_register,
    "가족관계증명서":             generate_family_relation_cert,
    "건강보험 자격득실확인서":    generate_health_insurance_cert,
    "고용보험 피보험자격 이력내역서": generate_employment_insurance_cert,
}


def generate_document(doc_name: str, user_name: str, birth_year: int = 1990):  # Optional[str]
    """문서 이름에 맞는 HTML 생성. 지원 안 하면 None 반환.
    ⚠️ user_name은 사용자 입력이므로 반드시 정제해 f-string에 넣는다(저장형 XSS·문서위조 차단)."""
    gen = DOCUMENT_GENERATORS.get(doc_name)
    if gen is None:
        return None
    safe = _safe_name(user_name)
    try:
        return gen(safe, birth_year)  # type: ignore
    except TypeError:
        return gen(safe)  # type: ignore
