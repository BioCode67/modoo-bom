/** 서류/신청 공식 사이트 연동 매핑 */

export interface OfficialLink {
  label: string
  url: string
  /** 백엔드 RPA로 자동발급 지원 여부 (manager.py SUPPORTED_DOC_NAMES 기준) */
  rpa?: boolean
}

/** 서류명 → 발급 가능한 공식 사이트 */
export function docLink(doc: string): OfficialLink {
  const d = doc.replace(/\s/g, '')
  if (d.includes('주민등록등본') || d.includes('주민등록초본'))
    return { label: '정부24에서 발급', url: 'https://www.gov.kr/portal/main', rpa: true }
  if (d.includes('가족관계'))
    return { label: '전자가족관계등록시스템', url: 'https://efamily.scourt.go.kr', rpa: true }
  if (d.includes('장애인등록') || d.includes('장애인증명'))
    return { label: '정부24에서 발급', url: 'https://www.gov.kr/portal/main', rpa: true }
  if (d.includes('건강보험') && (d.includes('자격') || d.includes('득실')))
    return { label: '건강보험공단에서 발급', url: 'https://www.nhis.or.kr', rpa: true }
  if (d.includes('고용보험') || d.includes('피보험자격') || d.includes('이직확인'))
    return { label: '고용24에서 발급', url: 'https://www.work24.go.kr', rpa: true }
  if (d.includes('소득금액증명') || (d.includes('소득') && d.includes('증명')))
    return { label: '정부24/홈택스에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12100000021', rpa: true }
  if (d.includes('지방세') && (d.includes('납세') || d.includes('과세') || d.includes('납부')))
    return { label: '정부24/위택스에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000056', rpa: true }
  if (d.includes('수급자') || d.includes('기초생활'))
    return { label: '정부24에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=14600000280', rpa: true }
  if (d.includes('한부모'))
    return { label: '정부24에서 발급', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=10601000001', rpa: true }
  if (d.includes('국민연금') || (d.includes('연금') && d.includes('가입')))
    return { label: '국민연금공단에서 발급', url: 'https://www.nps.or.kr/elctcvlcpt/comm/getOHAC0000M5.do?menuId=MN24001054', rpa: true }
  // 소득 증빙류(소득증빙·소득확인서류 등)는 소득금액증명 발급으로 안내(정부24/홈택스)
  if (d.includes('소득증빙') || d.includes('소득확인') || (d.includes('소득') && (d.includes('증빙') || d.includes('확인'))))
    return { label: '정부24/홈택스에서 발급 (소득금액증명)', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12100000021' }
  // 재학·졸업·성적 증명은 학교 발급 — 초·중·고는 정부24, 대학은 각 학교 포털
  if (d.includes('재학') || d.includes('졸업증명') || d.includes('성적증명'))
    return { label: '정부24에서 발급(초·중·고) · 대학은 학교 포털', url: 'https://www.gov.kr/search?srhQuery=재학증명서' }
  // 임대차계약서는 정부 발급 서류가 아님(사인 간 계약) — 본인 보관본을 제출, 확정일자는 인터넷등기소에서 확인
  if (d.includes('임대차') || d.includes('전월세') || d.includes('임대계약') || d.includes('월세계약'))
    return { label: '본인 보관 계약서 제출 (확정일자는 인터넷등기소)', url: 'https://www.iros.go.kr' }
  if (d.includes('소득') || d.includes('재산') || d.includes('금융정보') || d.includes('동의서'))
    return { label: '주민센터 방문 작성', url: 'https://www.bokjiro.go.kr' }
  // 신분증은 발급 서류가 아니라 본인이 지참 — 분실 시 재발급은 정부24에서 신청
  if (d.includes('신분증') || d.includes('주민등록증') || d.includes('운전면허'))
    return { label: '본인 지참 (재발급 신청은 정부24)', url: 'https://www.gov.kr/search?srhQuery=주민등록증+재발급' }
  if (d.includes('출생') || d.includes('통장') || d.includes('가족사진'))
    return { label: '본인 준비 서류', url: 'https://www.gov.kr/portal/main' }
  return { label: '정부24에서 검색', url: `https://www.gov.kr/search?srhQuery=${encodeURIComponent(doc)}` }
}

/** 정책 신청 채널 → 공식 신청 링크 */
export function applyLink(application: string): OfficialLink {
  const a = application || ''
  // 공공데이터 정책은 application 자체가 복지로 상세 딥링크(…?wlfareInfoId=WLF…)인 경우가 많다.
  // 일반 홈으로 보내지 말고 해당 복지의 정확한 상세/신청 페이지로 바로 연결한다.
  const m = a.match(/https?:\/\/\S+/)
  if (m) {
    const url = m[0]
    if (url.includes('bokjiro')) return { label: '복지로 상세페이지에서 신청', url }
    if (url.includes('work24')) return { label: '고용24에서 신청', url }
    if (url.includes('gov.kr')) return { label: '정부24에서 신청', url }
    return { label: '공식 사이트에서 신청', url }
  }
  if (a.includes('복지로')) return { label: '복지로에서 신청', url: 'https://www.bokjiro.go.kr' }
  if (a.includes('고용24') || a.includes('고용센터') || a.includes('work'))
    return { label: '고용24에서 신청', url: 'https://www.work24.go.kr' }
  if (a.includes('정부24')) return { label: '정부24에서 신청', url: 'https://www.gov.kr/portal/main' }
  if (a.includes('주민센터')) return { label: '가까운 주민센터 방문', url: 'https://www.bokjiro.go.kr' }
  return { label: '복지로에서 신청', url: 'https://www.bokjiro.go.kr' }
}

/** RPA 자동발급 지원 서류 (백엔드 manager.py와 일치) */
export const RPA_SUPPORTED_DOCS = [
  '주민등록등본', '주민등록초본', '가족관계증명서', '장애인증명서', '소득금액증명',
  '지방세 납세증명서', '지방세 세목별 과세증명서', '기초생활수급자 증명서', '한부모가족 증명서',
  '국민연금 가입자 증명서', '국민연금 가입내역확인서',
  '건강보험 자격득실확인서', '고용보험 피보험자격 이력내역서',
]
export function isRpaSupported(doc: string): boolean {
  const d = doc.replace(/\s/g, '')
  return RPA_SUPPORTED_DOCS.some((s) => d.includes(s.replace(/\s/g, '')) || s.replace(/\s/g, '').includes(d))
}

/** 에이전트(RPA) 신청 자동화 지원 서비스 (백엔드 manager.py SUPPORTED_SERVICE_NAMES와 일치) */
export const APPLY_AUTOMATABLE = [
  '기초연금', '아동수당', '부모급여', '청년 내일저축계좌', '첫만남이용권', '기초생활 생계급여',
]
export function isApplyAutomatable(name: string): boolean {
  const n = (name || '').replace(/\s/g, '')
  return APPLY_AUTOMATABLE.some((s) => n.includes(s.replace(/\s/g, '')) || s.replace(/\s/g, '').includes(n))
}
