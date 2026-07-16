import { buildPrefill, type RpaInfo } from '@/lib/prefill'
import { applyLink } from '@/lib/officialLinks'
import { getCatalog } from '@/data/catalog'
import type { UserProfile } from '@/lib/welfare-engine'

/**
 * 원터치 신청 이동(무설치·전 브라우저·모바일) — 가장 매끄럽고 안전한 신청 경로.
 *  ① 내 정보(이름)를 클립보드에 자동 복사(공식 신청서 첫 칸에 바로 붙여넣기)
 *  ② 공식 신청 페이지를 새 탭으로 즉시 열기(딥링크) → 사용자는 정부 공식 사이트에서 간편인증만.
 * 개인정보·본인인증은 정부 공식 사이트에만 머문다(우리 서버 전송 없음 — 안전).
 */

/**
 * 수요 최다 복지의 복지로 신청 상세 딥링크 — 라이브 실측 검증(2026-07, wlfareInfoNm 대조).
 * ⚠️ wlfareInfoId는 시간이 지나면 타 서비스로 재배정될 수 있어(실증 전례) 주기 재검증 필요 — `npm run check:links`.
 * 오매칭 방지를 위해 **정확 일치 키만** 사용한다(포함 매칭 금지 — '기초연금'이 유사명을 가로채지 않게).
 */
const BOKJIRO = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId='
export const KNOWN_APPLY_URLS: Record<string, string> = {
  기초연금: `${BOKJIRO}WLF00001164`,
  아동수당: `${BOKJIRO}WLF00001171`,
  부모급여: `${BOKJIRO}WLF00004657`,
  '청년 내일저축계좌': `${BOKJIRO}WLF00000060`,
  첫만남이용권: `${BOKJIRO}WLF00004656`,
  '국민기초생활보장 생계급여': `${BOKJIRO}WLF00001132`,
  '기초생활 생계급여': `${BOKJIRO}WLF00001132`,
  // ── 2026-07 확장: 공공데이터(B554287) 검증 복지로 딥링크 — seed 정책도 신청 상세로 직행 ──
  //    (seed는 application이 자유텍스트라 딥링크가 없어 gov.kr 검색으로 빠지던 것 정정. 실데이터 wlfareInfoId 대조)
  장애인연금: `${BOKJIRO}WLF00003249`,
  '국민취업지원제도 I 유형': `${BOKJIRO}WLF00003245`,
  청년월세지원: `${BOKJIRO}WLF00004661`,
  '노인 일자리 및 사회활동 지원': `${BOKJIRO}WLF00001155`,
  '장애인 활동지원서비스': `${BOKJIRO}WLF00003260`,
  '장애인 활동지원 서비스': `${BOKJIRO}WLF00003260`,
  '한부모가족 아동양육비': `${BOKJIRO}WLF00001068`,
  '노인 맞춤돌봄서비스': `${BOKJIRO}WLF00003191`,
  '청소년 산모 임신·출산 의료비 지원': `${BOKJIRO}WLF00003246`,
  에너지바우처: `${BOKJIRO}WLF00000072`,
  '청소년 특별지원': `${BOKJIRO}WLF00000078`,
  '희귀질환자 의료비 지원': `${BOKJIRO}WLF00000864`,
  청년미래적금: `${BOKJIRO}WLF00006266`,
  '통합문화이용권 (장애인)': `${BOKJIRO}WLF00000055`,
  '저소득층 기저귀·조제분유 지원': `${BOKJIRO}WLF00000092`,
  '다문화가족 방문교육 서비스': `${BOKJIRO}WLF00003192`,
  '농업인 건강보험료 지원': `${BOKJIRO}WLF00001099`,
  '장애인 의료비 지원': `${BOKJIRO}WLF00003181`,
  '아이돌봄 서비스': `${BOKJIRO}WLF00000024`,
  '청년 내일채움공제': `${BOKJIRO}WLF00006215`,
  '저소득층 에너지효율 개선 (단열·창호)': `${BOKJIRO}WLF00001128`,
  '학교 밖 청소년 지원 (꿈드림)': `${BOKJIRO}WLF00000948`,
  // ── 2026-07-15 2차 확장: 감사 워크플로가 발굴·검증(policies.json 실재 + 동일 제도 대조) ──
  //    규칙 매칭(정확/접두70%)이 표기차로 못 잡던 대표 국가제도 — gov.kr 검색으로 빠지던 것을 복지로 상세 직행.
  '교육급여 (기초생활보장)': `${BOKJIRO}WLF00001089`,
  '교육급여 (초중고 학생)': `${BOKJIRO}WLF00001089`,
  '주거급여 (기초생활보장)': `${BOKJIRO}WLF00003201`,
  '주거급여 (임차급여·수선유지급여)': `${BOKJIRO}WLF00003201`,
  '보육료 지원 (어린이집)': `${BOKJIRO}WLF00003250`,
  '유아학비 지원 (유치원)': `${BOKJIRO}WLF00000969`,
  '임신·출산 진료비 지원 (국민행복카드)': `${BOKJIRO}WLF00006313`,
  '임신·출산 진료비 지원 국민행복카드': `${BOKJIRO}WLF00006313`,
  // ⚠️ '출산 전후 휴가급여'는 여기서 제외 — 육아휴직급여와 다른 제도인데 같은 복지로 id(WLF00003226)를
  //   공유하면 한쪽이 '남의 제도' 상세로 잘못 이동한다(감사 HIGH). 둘 다 실은 고용보험(고용24) 급여라,
  //   출산전후휴가급여는 정책의 application('고용24 온라인')으로 폴백시켜 올바른 사이트로 보낸다.
  육아휴직급여: `${BOKJIRO}WLF00003226`,
  '한국장학재단 국가장학금 I 유형': `${BOKJIRO}WLF00003197`,
  국민내일배움카드: `${BOKJIRO}WLF00006229`,
  '장애아동 발달재활서비스': `${BOKJIRO}WLF00003195`,
  '노인 장기요양보험 (재가급여)': `${BOKJIRO}WLF00003248`,
  '노인 무릎 인공관절 수술비 지원': `${BOKJIRO}WLF00001179`,
  '국가예방접종 지원': `${BOKJIRO}WLF00003242`,
  '산모·신생아 건강관리 서비스': `${BOKJIRO}WLF00001188`,
  '여성 청소년 생리용품 바우처': `${BOKJIRO}WLF00000781`,
  '사회적 기업 일자리창출사업': `${BOKJIRO}WLF00003234`,
  '중소기업 직장어린이집 설치 지원': `${BOKJIRO}WLF00001163`,
  '청년 월세 한시 특별지원': `${BOKJIRO}WLF00004661`,
  '청소년 산모 의료비 지원': `${BOKJIRO}WLF00003246`,
}

const normApplyName = (s: string): string => (s || '').replace(/[\s()（）·,]/g, '')

/** 실제 '신청 딥링크'(복지로 상세·고용24 개인·정부24 민원)인지 — generic 홈/검색은 제외. */
function isRealApplyUrl(url: string): boolean {
  if (isGenericHome(url)) return false
  return /wlfareInfoId=WLF|work24\.go\.kr\/.+[?&=]|gov\.kr\/mw\//.test(url)
}

// 카탈로그(공공데이터 포함) 중 '실딥링크 보유' 정책의 정규화이름→URL 인덱스.
// 캐시 키는 카탈로그 '배열 참조' — getCatalog()는 병합 전까지 동일 참조를 반환하고 병합 시에만 교체되므로
// 참조가 바뀔 때(=데이터 변경)만 재구축한다(매 호출 재구축·length 충돌 방지).
let _applyIdx: Map<string, string> | null = null
let _applyIdxRef: ReturnType<typeof getCatalog> | null = null
function applyUrlIndex(): Map<string, string> {
  const cat = getCatalog()
  if (_applyIdx && _applyIdxRef === cat) return _applyIdx
  const m = new Map<string, string>()
  for (const p of cat) {
    // ⚠️ 지자체(LOC-)는 대여자에서 제외 — '같은 이름이라도 지역이 다르면 별개 사업'(감사 확정 HIGH:
    //    서산시 장수수당이 창원시 장수수당 URL을 빌리는 실측 오연결 168개 이름군). 국가/중앙 사업만 빌려준다.
    if (p.id.startsWith('LOC-')) continue
    const link = applyLink(p.application)
    if (!isRealApplyUrl(link.url)) continue
    const n = normApplyName(p.name)
    if (n && !m.has(n)) m.set(n, link.url) // 먼저 등록된 이름 우선(시드/대표 우선)
  }
  _applyIdx = m
  _applyIdxRef = cat
  return m
}

// 접두 일치 시 허용되는 '무의미 접미어'만 — 나머지(추가지원·추가형·감면·특별 등)는 다른 사업 한정어라 거부.
//   감사 확정: '발달장애인 주간활동서비스 추가지원'(지자체 추가사업)이 국가 본사업 URL을 빌리던 것 차단.
const GENERIC_SUFFIX_RE = /^(지원|사업|지급|서비스|제도)*$/

/**
 * 카탈로그 교차참조 — 딥링크 없는 정책명을 '같은 이름의 실딥링크 보유 정책'과 안전하게 매칭해
 * 공공데이터(B554287)의 검증된 신청 URL을 빌려온다. 정부24 키워드 검색으로 빠지던 것을 실제 신청처로.
 * ⚠️ '아동수당'이 '장애아동수당'을 가로채지 않도록 **정확 일치 또는 접두 일치(70%+)**만 허용하고,
 *    접두 일치의 잔여 문자열은 무의미 접미어(지원·사업류)일 때만 인정(한정어 소실 방지). 대여자는 비지자체만.
 */
export function borrowApplyUrl(policyName: string): string {
  const t = normApplyName(policyName)
  if (t.length < 3) return ''
  const idx = applyUrlIndex()
  const exact = idx.get(t)
  if (exact) return exact
  for (const [n, url] of idx) {
    if ((t.startsWith(n) || n.startsWith(t)) && Math.min(t.length, n.length) >= 0.7 * Math.max(t.length, n.length)) {
      const rest = t.length > n.length ? t.slice(n.length) : n.slice(t.length)
      if (!GENERIC_SUFFIX_RE.test(rest)) continue // '추가지원'·'(추가형)'·'감면' 등 의미 있는 한정어 → 다른 사업
      return url
    }
  }
  return ''
}

/**
 * '일반 홈' 착지 판정 — 정확 문자열 비교 대신 패턴 판정으로 트레일링 슬래시·index.do 등 변형까지 커버.
 * 딥링크 파라미터(wlfareInfoId·CappBizCD·검색어)가 있으면 홈이 아니다.
 */
export function isGenericHome(url: string): boolean {
  try {
    const u = new URL(url)
    if (!/(^|\.)bokjiro\.go\.kr$|(^|\.)gov\.kr$|(^|\.)work24\.go\.kr$/.test(u.hostname)) return false
    if (/wlfareInfoId|CappBizCD|srhQuery|searchTerm/i.test(u.search)) return false
    return u.pathname === '/' || u.pathname === '' || /^\/(portal\/main|index\.do|main\.do)\/?$/.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * 신청 시 열 최적 URL 우선순위:
 *  ① 정책 데이터의 자체 딥링크(applyLink가 추출 — 실데이터가 항상 우선)
 *  ② 일반 홈 착지라면: 실측 검증된 복지로 신청 딥링크(KNOWN_APPLY_URLS, 정책명 정확 일치)
 *  ③ 그래도 없으면 카탈로그 교차참조 — 같은 이름의 공공데이터 정책(검증된 복지로 딥링크)을 재사용
 *     (시드 정책이 '복지로 온라인 신청' 자유텍스트만 가져 gov.kr 검색으로 빠지던 것을 실제 신청 상세로)
 *  ④ 그래도 못 찾으면 정책명으로 정부24 통합검색(사용자가 홈에서 헤매는 것 방지)
 *  단, '주민센터 방문' 채널은 온라인 신청처럼 오도하지 않도록 검색 폴백을 걸지 않는다.
 *  ⚠️ 지자체(LOC-) 정책은 ②③을 건너뛴다 — 동명 국가/타지역 사업으로 오연결 금지(자체 URL 또는 검색만).
 */
export function bestApplyUrl(application: string, policyName?: string, policyId?: string): string {
  const link = applyLink(application)
  if (!isGenericHome(link.url)) return link.url // ① 정책 자체 딥링크 최우선(실데이터 존중)
  const isLoc = !!policyId && policyId.startsWith('LOC-')
  if (!isLoc && policyName && KNOWN_APPLY_URLS[policyName]) return KNOWN_APPLY_URLS[policyName] // ② 실측 검증 딥링크(정확 일치)
  if (!isLoc && policyName) {
    const borrowed = borrowApplyUrl(policyName) // ③ 공공데이터 교차참조로 검증된 신청 URL 확보
    if (borrowed) return borrowed
  }
  // ④ 최후 폴백: 온라인 신청형만 정부24 통합검색(주민센터 방문형은 온라인처럼 오도하지 않게 제외)
  if (policyName && !link.label.includes('주민센터')) {
    return `https://www.gov.kr/search?srhQuery=${encodeURIComponent(policyName)}`
  }
  return link.url
}

/**
 * 이 정책이 '복지로 자동신청(에이전트·확장)'이 실제로 가능한 딥링크로 해석되는가 —
 * 자동신청 버튼 노출·'나의 복지' 집계가 어긋나지 않도록 하는 단일 기준.
 * (application 필드가 '복지로 온라인 신청' 같은 표시문자열이어도 bestApplyUrl이 WLF…로 해석되면 true)
 */
export function isBokjiroApplyable(application: string, policyName?: string, policyId?: string): boolean {
  const u = bestApplyUrl(application, policyName, policyId)
  // 복지로 '딥링크'(wlfareInfoId 등)만 자동신청 대상 — 홈(www.bokjiro.go.kr)으로만 빠지는
  //   방문형·미해석 정책을 자동신청 가능으로 오판하지 않게 generic 홈은 제외.
  return /bokjiro\.go\.kr/.test(u) && !isGenericHome(u)
}

/**
 * 신청 CTA용 URL+라벨 세트 — 라벨은 '최종 목적지' 기준으로 산출해 라벨-착지 불일치를 없앤다
 * (감사 확정: raw applyLink 라벨('복지로에서 신청')을 단 버튼이 실제론 정부24 검색으로 가던 것).
 */
export function bestApplyInfo(application: string, policyName?: string, policyId?: string): { url: string; label: string } {
  const url = bestApplyUrl(application, policyName, policyId)
  const raw = applyLink(application)
  if (url === raw.url) return { url, label: raw.label }
  if (url.includes('bokjiro.go.kr')) return { url, label: '복지로에서 신청' }
  if (url.includes('gov.kr/search')) return { url, label: '정부24에서 검색' }
  if (url.includes('gov.kr')) return { url, label: '정부24에서 신청' }
  if (url.includes('work24')) return { url, label: '고용24에서 신청' }
  return { url, label: raw.label }
}

export interface OneTapResult {
  /** 클립보드 복사 성공 여부(안내 문구 분기용) */
  copied: boolean
  /** 새 탭이 실제로 열렸는지 — 팝업 차단이면 false(허위 '이동했어요' 안내 방지) */
  opened: boolean
  /** 연 (또는 열려던) 공식 신청 URL — 차단 시 직접 이동 링크로 재사용 */
  url: string
}

export async function oneTapApply(application: string, policyName: string | undefined, profile: UserProfile | null, rpaInfo?: RpaInfo, policyId?: string): Promise<OneTapResult> {
  const url = bestApplyUrl(application, policyName, policyId)
  // ⚠️ 새 탭은 사용자 제스처 안에서 '먼저' 열어야 한다. clipboard await 뒤에 open하면 제스처 체인이
  //    끊겨 모바일 Safari 등에서 팝업이 차단된다 → 반드시 window.open을 동기적으로 먼저 호출.
  // ⚠️ features에 'noopener'를 넣으면 스펙상 성공해도 null을 반환해 팝업 차단을 감지할 수 없다 —
  //    핸들을 받아 opener를 수동 절단(동등한 보안)하고, null일 때만 진짜 차단으로 판정한다.
  let opened = false
  try {
    const w = window.open(url, '_blank')
    if (w) {
      try { w.opener = null } catch { /* 크로스오리진 등 — 절단 실패해도 진행 */ }
      opened = true
    }
  } catch { /* 팝업 차단 등 */ }
  let copied = false
  try {
    // 정부 신청서는 필드별 input이라 '라벨: 값' 전체 블롭은 붙여넣기가 안 된다 —
    // '이름' 값만 복사하고, 나머지는 신청 키트에서 항목별 복사(정직한 한 번-붙여넣기).
    // 이름이 비어 있으면(새로고침 후 기본 상태) 복사하지 않는다 — 다른 값을 이름이라 안내하는 오류 방지.
    const name = buildPrefill(profile, rpaInfo).find((f) => f.label === '이름')
    if (name) {
      await navigator.clipboard.writeText(name.value)
      copied = true
    }
  } catch { /* 클립보드 미지원/비허용 환경은 무시 */ }
  return { copied, opened, url }
}
