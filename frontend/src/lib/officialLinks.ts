/** 서류/신청 공식 사이트 연동 매핑 */

export interface OfficialLink {
  label: string
  url: string
  /** 백엔드 RPA로 자동발급 지원 여부 (manager.py SUPPORTED_DOC_NAMES 기준) */
  rpa?: boolean
  /** 무설치 온라인 발급 등급 — 'wallet'=정부24 전자증명서(전자문서지갑 유통·전자제출 가능),
   *  'online'=온라인 발급은 되지만 전자문서지갑 유통 대상은 아님(등기부·장기요양 등). 없으면 오프라인/본인준비. */
  issue?: 'wallet' | 'online'
}

/** 서류명 → 발급 가능한 공식 사이트
 *  ⚠️ CappBizCD 딥링크는 전부 라이브 실측 검증(2026-07, <title> 민원명 대조 — `npm run check:links`로 재검증). */
export function docLink(doc: string): OfficialLink {
  const d = doc.replace(/\s/g, '')
  if (d.includes('주민등록등본') || d.includes('주민등록초본'))
    return { label: '정부24에서 발급 (주민등록표 등·초본)', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000015', rpa: true, issue: 'wallet' }
  if (d.includes('가족관계'))
    // ⚠️ 실측(2026-07-20, 사용자 스크린샷): 원 발급처는 대법원 전자가족관계등록시스템(efamily) — 24시간·무료.
    //   정부24 경로는 '전자문서지갑' 선행 요구 + 연계 차단이 잦아 직접 링크는 efamily 로 보낸다(정부24 안내 페이지도 결국 여기로 보냄).
    return { label: '전자가족관계등록시스템(대법원)에서 발급 — 인터넷 무료·본인인증 필요', url: 'https://efamily.scourt.go.kr/index.jsp', rpa: true, issue: 'wallet' }
  if (d.includes('장애인등록') || d.includes('장애인증명'))
    return { label: '정부24에서 발급 (장애인증명서)', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=14600000273', rpa: true, issue: 'wallet' }
  if (d.includes('건강보험') && (d.includes('자격') || d.includes('득실')))
    return { label: '건강보험공단에서 발급 (홈 > 민원여기요 > 개인민원 > 증명서 발급)', url: 'https://www.nhis.or.kr', rpa: true, issue: 'wallet' }
  // 이직확인서는 사업주(회사)가 고용센터에 제출하는 서류 — 본인이 발급할 수 없다(처리여부만 조회 가능)
  if (d.includes('이직확인'))
    return { label: '회사가 고용센터에 제출하는 서류 — 처리 여부는 고용24에서 조회', url: 'https://www.work24.go.kr' }
  if (d.includes('고용보험') || d.includes('피보험자격') || d.includes('취업경험') || d.includes('구직등록'))
    return { label: '고용24에서 발급 (고용보험 > 개인 증명원 발급)', url: 'https://www.work24.go.kr', rpa: true, issue: 'wallet' }
  if (d.includes('소득금액증명') || (d.includes('소득') && d.includes('증명')))
    return { label: '정부24/홈택스에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12100000021', rpa: true, issue: 'wallet' }
  // 세목별 과세증명서(13100000084)를 납세증명서(13100000056)보다 먼저 — 더 구체적인 분기.
  if (d.includes('지방세') && d.includes('세목별'))
    return { label: '정부24/위택스에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000084', rpa: true, issue: 'wallet' }
  if (d.includes('지방세') && (d.includes('납세') || d.includes('과세') || d.includes('납부')))
    return { label: '정부24/위택스에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000056', rpa: true, issue: 'wallet' }
  if (d.includes('수급자') || d.includes('기초생활'))
    return { label: '정부24에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=14600000280', rpa: true, issue: 'wallet' }
  if (d.includes('한부모'))
    return { label: '정부24에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=10601000001', rpa: true, issue: 'wallet' }
  if (d.includes('국민연금') || (d.includes('연금') && d.includes('가입')))
    return { label: '국민연금공단에서 발급', url: 'https://www.nps.or.kr/elctcvlcpt/comm/getOHAC0000M5.do?menuId=MN24001054', rpa: true, issue: 'wallet' }
  // ── 기관·민간 발급 서류(정부24 아님) — 어디서 받는지 정직하게 안내 ──
  // 병원 발급: 진단서·소견서·임신확인서·출생증명서 등은 진료한 병원에서만 발급된다
  if (/진단서|소견서|임신확인서|임신\s*확인|출생증명/.test(d))
    return { label: '진료받은 병원에서 발급', url: `https://www.gov.kr/search?srhQuery=${encodeURIComponent(doc)}` }
  // 은행 발급: 통장사본·계좌 확인·이체확인증은 거래 은행 앱(모바일)이나 영업점에서
  // (월세 이체확인증은 현금 납부 등 이체내역이 없으면 복지로 '월차임 납부확인서' 양식으로 대체 — 공식 안내)
  if (/이체확인|이체\s*내역|송금확인/.test(d))
    return { label: '거래 은행 앱에서 이체확인증 발급 (이체내역 없으면 복지로 월차임 납부확인서)', url: 'https://www.bokjiro.go.kr' }
  if (/통장|계좌/.test(d))
    return { label: '거래 은행 앱·영업점에서 발급', url: `https://www.gov.kr/search?srhQuery=${encodeURIComponent(doc)}` }
  // 회사 발급: 재직·경력·급여 관련은 재직(했던) 회사에서
  if (/재직|근로계약서|임금대장|근로자\s*명부|경력증명|원천징수|통상임금|휴가\s*확인|육아휴직\s*확인/.test(d))
    return { label: '재직 회사에서 발급', url: `https://www.gov.kr/search?srhQuery=${encodeURIComponent(doc)}` }
  // 건강보험(자격득실 외): 보험료 납부확인서·건강보험증 등 — 건보공단 민원(온라인 발급 가능, 지갑 유통 아님)
  if (d.includes('건강보험') || d.includes('보험료납부'))
    return { label: '건강보험공단에서 발급 (홈 > 민원여기요 > 개인민원)', url: 'https://www.nhis.or.kr', issue: 'online' }
  // 부동산 등기: 인터넷등기소 — 온라인 열람·발급 가능(수수료), 전자문서지갑 유통 대상은 아님
  if (/등기부|등기사항/.test(d))
    return { label: '인터넷등기소에서 발급', url: 'https://www.iros.go.kr', issue: 'online' }
  // 장기요양 인정서·등급: 노인장기요양보험 — 온라인 조회·출력 가능
  if (d.includes('장기요양'))
    return { label: '노인장기요양보험에서 조회·발급', url: 'https://www.longtermcare.or.kr', issue: 'online' }
  // 사업자등록증(명): 정부24 실측 코드(12100000016) — 홈택스에서도 가능
  if (d.includes('사업자등록'))
    return { label: '정부24/홈택스에서 발급 (사업자등록증명)', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12100000016', issue: 'wallet' }
  // 의료급여증: 시·군·구(주민센터) 발급
  if (d.includes('의료급여증'))
    return { label: '주민센터(시·군·구)에서 발급', url: 'https://www.bokjiro.go.kr' }
  // 소득 증빙류(소득증빙·소득확인서류 등)는 소득금액증명 발급으로 안내(정부24/홈택스)
  if (d.includes('소득증빙') || d.includes('소득확인') || (d.includes('소득') && (d.includes('증빙') || d.includes('확인'))))
    return { label: '정부24/홈택스에서 발급 (소득금액증명)', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12100000021', issue: 'wallet' }
  // 재학·졸업 증명은 정부24에서 무료 발급(실측 검증한 CappBizCD). 학교급별로 코드가 다름(초·중·고 vs 대학).
  if (/성적증명|생활기록부/.test(d))
    return { label: '정부24에서 발급 (초·중·고 생활기록부) · 대학은 학교 포털', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13410000019', issue: 'wallet' }
  if (d.includes('재학') || d.includes('졸업증명') || (d.includes('졸업') && d.includes('증명'))) {
    const univ = d.includes('대학')
    const grad = d.includes('졸업')
    const capp = grad ? (univ ? '13404000009' : '13410000020') : (univ ? '13404000010' : '13410000017')
    return {
      label: `정부24에서 발급 (${univ ? '대학' : '초·중·고'}${grad ? ' 졸업' : ' 재학'})`,
      url: `https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=${capp}`,
      issue: 'wallet',
    }
  }
  // 임대차계약서는 정부 발급 서류가 아님(사인 간 계약) — 본인 보관본을 제출, 확정일자는 인터넷등기소에서 확인
  if (d.includes('임대차') || d.includes('전월세') || d.includes('임대계약') || d.includes('월세계약'))
    return { label: '본인 보관 계약서 제출 (확정일자는 인터넷등기소)', url: 'https://www.iros.go.kr' }
  if (d.includes('소득') || d.includes('재산') || d.includes('금융정보') || d.includes('동의서'))
    return { label: '주민센터 방문 작성', url: 'https://www.bokjiro.go.kr' }
  // 신분증은 발급 서류가 아니라 본인이 지참 — 분실 시 재발급은 정부24에서 신청
  if (d.includes('신분증') || d.includes('주민등록증') || d.includes('운전면허'))
    return { label: '본인 지참 (재발급 신청은 정부24)', url: 'https://www.gov.kr/search?srhQuery=주민등록증+재발급' }
  // ('통장'은 위 은행 분기가 항상 선점하므로 여기서 제외 — 가족사진 등 본인 준비물만)
  if (d.includes('출생') || d.includes('가족사진'))
    return { label: '본인 준비 서류', url: 'https://www.gov.kr/portal/main' }
  return { label: '정부24에서 검색', url: `https://www.gov.kr/search?srhQuery=${encodeURIComponent(doc)}` }
}

/** 정책 신청 채널 → 공식 신청 링크 */
export function applyLink(application: string): OfficialLink {
  const a = application || ''
  // 공공데이터 정책은 application 자체가 복지로 상세 딥링크(…?wlfareInfoId=WLF…)인 경우가 많다.
  // 일반 홈으로 보내지 말고 해당 복지의 정확한 상세/신청 페이지로 바로 연결한다.
  // URL은 공백·닫는 괄호·한글 앞에서 끊는다(예: "(https://a.kr)에서" → "https://a.kr").
  const m = a.match(/https?:\/\/[^\s)）」』】가-힣]+/)
  if (m) {
    const url = m[0]
    if (url.includes('bokjiro')) return { label: '복지로 상세페이지에서 신청', url }
    if (url.includes('work24')) return { label: '고용24에서 신청', url }
    // 청년주택 모집공고 게시판(LH청약플러스·마이홈·SH·서울주거포털·GH) — '공고 바로가기'로 안내
    if (/apply\.lh\.or\.kr|myhome\.go\.kr|i-sh\.co\.kr|housing\.seoul\.go\.kr|gh\.or\.kr/.test(url))
      return { label: '공식 모집공고에서 확인·신청', url }
    if (url.includes('gov.kr')) return { label: '정부24에서 신청', url }
    return { label: '공식 사이트에서 신청', url }
  }
  if (a.includes('복지로')) return { label: '복지로에서 신청', url: 'https://www.bokjiro.go.kr' }
  // 직업훈련(HRD-Net·K-디지털 트레이닝·내일배움 훈련과정) — 복지로/정부24가 아니라 HRD-Net에서 신청·수강한다.
  //   실사용 제보: 훈련형 정책이 '정부24 검색'으로 빠지면 신청처를 못 찾아 헤맨다 → 올바른 포털로 직행(정직성).
  if (a.includes('HRD') || a.includes('직업훈련포털') || a.includes('K-디지털') || a.includes('내일배움') || a.includes('직업훈련'))
    return { label: '직업훈련포털(HRD-Net)에서 신청', url: 'https://www.hrd.go.kr' }
  if (a.includes('고용24') || a.includes('고용센터') || a.includes('work'))
    return { label: '고용24에서 신청', url: 'https://www.work24.go.kr' }
  if (a.includes('정부24')) return { label: '정부24에서 신청', url: 'https://www.gov.kr/portal/main' }
  if (a.includes('주민센터')) return { label: '가까운 주민센터 방문', url: 'https://www.bokjiro.go.kr' }
  return { label: '복지로에서 신청', url: 'https://www.bokjiro.go.kr' }
}

/**
 * 정부·공공 온라인에서 '전자증명서'로 **무설치** 발급 가능한 서류인지 — 크롬 확장·RPA·백엔드 없이 본인이 직접 발급.
 * 정부24 서류는 **전자증명서(전자문서지갑)**로 발급해 복지로·주민센터에 전자제출까지 가능(정부 공식 유통망).
 * 판정은 docLink의 명시 필드(issue)로 한다 — URL 정규식 추론은 '가족사진'(본인 준비물)·'이직확인서'
 * (사업주 제출 서류)에 허위 '전자발급' 배지를 붙였던 전력이 있어 폐기(과장 금지 원칙).
 */
export function isCertIssuable(doc: string): boolean {
  return docLink(doc).issue === 'wallet'
}
/** 무설치 발급 등급('wallet'|'online'|undefined) — 배지 표기용 */
export function certKind(doc: string): 'wallet' | 'online' | undefined {
  return docLink(doc).issue
}

/**
 * 정부 전자증명서(전자문서지갑) — 발급한 민원서류를 종이 없이 전자문서로 보관하고
 * 복지로·주민센터 등 제3자에게 전자제출까지 하는 정부 공식 서비스. 네이버·카카오·토스·은행 앱에서도 지갑 이용 가능.
 */
export const CERT_WALLET = {
  label: '정부 전자문서지갑(전자증명서)',
  url: 'https://dpaper.kr/',
}

/** RPA 자동발급 지원 서류 — 크롬 확장 기준 13종 (extension/background.js DOCS와 일치) */
export const RPA_SUPPORTED_DOCS = [
  '주민등록등본', '주민등록초본', '가족관계증명서', '장애인증명서', '소득금액증명',
  '지방세 납세증명서', '지방세 세목별 과세증명서', '기초생활수급자 증명서', '한부모가족 증명서',
  '국민연금 가입자 증명서', '국민연금 가입내역확인서',
  '건강보험 자격득실확인서', '고용보험 피보험자격 이력내역서',
]
/** 로컬 백엔드(Playwright, backend/rpa/manager.py _SUPPORTED_DOCS)가 지원하는 서류 — 15종.
 *  확장 없이 로컬 에이전트만 연결된 환경에서 미지원 서류를 '자동'으로 표시하면
 *  클릭 시 오류가 난다(감사 실측) → 채널별로 정직하게 분리 표시.
 *  ⚠️ 여기 목록은 backend/rpa/manager.py `_SUPPORTED_DOCS`와 반드시 일치시킬 것. */
export const LOCAL_RPA_DOCS = [
  '주민등록등본', '주민등록초본', '가족관계증명서', '장애인증명서',
  '소득금액증명', '지방세 납세증명서', '지방세 세목별 과세증명서', '기초생활수급자 증명서', '한부모가족 증명서',
  // 2026-07-11 확장 4종 — 정부24 AA020 실측(즉시발급형·본인·무료)
  '국세 납세증명서', '출입국에 관한 사실증명', '병적증명서', '건강보험료 납부확인서',
  '건강보험 자격득실확인서', '고용보험 피보험자격 이력내역서',
]
function docIn(list: string[], doc: string): boolean {
  const d = doc.replace(/\s/g, '')
  return list.some((s) => d.includes(s.replace(/\s/g, '')) || s.replace(/\s/g, '').includes(d))
}

// ── 동적 커버리지 — 에이전트의 /api/documents/rpa-supported 응답으로 로컬 지원목록을 승격 ──
// 사용자 PC에서 프로브 실측(--register)으로 확장된 서류가 코드 수정 없이 패널·게이트에 반영된다.
// 기본값은 내장 15종(LOCAL_RPA_DOCS) — 서버 응답이 없거나 웹 배포면 그대로 유지(기능 무손실).
let _localDocs: string[] = [...LOCAL_RPA_DOCS]
let _localBeta = new Set<string>()
export function setLocalRpaDocs(supported: string[], beta: string[] = []): void {
  if (Array.isArray(supported) && supported.length > 0) {
    _localDocs = [...supported]
    _localBeta = new Set((beta || []).map((b) => b.replace(/\s/g, '')))
  }
}
export function localRpaDocs(): string[] {
  return _localDocs
}
/** β(동적 확장) 서류인가 — '첫 실발급이 최종 검증' 배지 표기용 */
export function isLocalBetaDoc(doc: string): boolean {
  return _localBeta.has(doc.replace(/\s/g, ''))
}

/** channel: 'ext'=크롬 확장(13종) · 'local'=로컬 백엔드(15종+동적 β) · 미지정=둘 중 아무거나(최대 집합) */
export function isRpaSupported(doc: string, channel?: 'ext' | 'local'): boolean {
  if (channel === 'local') return docIn(_localDocs, doc)
  return docIn(RPA_SUPPORTED_DOCS, doc) || docIn(_localDocs, doc)
}

/** 에이전트(RPA) 신청 자동화 지원 서비스 (백엔드 manager.py SUPPORTED_SERVICE_NAMES와 일치) */
export const APPLY_AUTOMATABLE = [
  '기초연금', '아동수당', '부모급여', '청년 내일저축계좌', '첫만남이용권', '기초생활 생계급여',
]
// 접두 일치 시 허용하는 잔여 문자열 — quickApply.borrowApplyUrl(GENERIC_SUFFIX_RE)과 동일 취지.
//   무의미 접미어(동일 제도 표기변형: '아동수당 지급'·'부모급여 지원')와 '…(을) 신청(해줘)' 문장형
//   (webAgent 목표 문장)만 인정. '플러스'·'미수급자'·'특별' 등 한정어는 별개 사업이라 거부.
const APPLY_GENERIC_SUFFIX_RE = /^(지원|사업|지급|서비스|제도)*$/
const APPLY_VERB_TAIL_RE = /^(을|를)?(신청|접수)/
export function isApplyAutomatable(name: string): boolean {
  const n = (name || '').replace(/\s/g, '')
  if (!n) return false
  // ⚠️ 과거 양방향 substring 포함('장애아동수당 미수급자 지원' ⊃ '아동수당')이 별개 사업을 자동신청
  //    지원으로 오판(감사 확정) — 백엔드는 정확일치 6종(+딥링크)만 수락해 버튼이 400 막다른 길이 됐다.
  //    → 정확 일치 또는 '지원명으로 시작 + 무의미 접미어/신청 동사'만 허용(borrowApplyUrl 수정과 동급).
  return APPLY_AUTOMATABLE.some((s) => {
    const t = s.replace(/\s/g, '')
    if (n === t) return true
    if (!n.startsWith(t)) return false
    const rest = n.slice(t.length)
    return APPLY_GENERIC_SUFFIX_RE.test(rest) || APPLY_VERB_TAIL_RE.test(rest)
  })
}
