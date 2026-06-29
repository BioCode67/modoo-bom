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
  if (d.includes('소득') || d.includes('재산') || d.includes('금융정보') || d.includes('동의서'))
    return { label: '주민센터 방문 작성', url: 'https://www.bokjiro.go.kr' }
  if (d.includes('출생') || d.includes('신분증') || d.includes('통장'))
    return { label: '본인 준비 서류', url: 'https://www.gov.kr/portal/main' }
  return { label: '정부24에서 검색', url: `https://www.gov.kr/search?srhQuery=${encodeURIComponent(doc)}` }
}

/** 정책 신청 채널 → 공식 신청 링크 */
export function applyLink(application: string): OfficialLink {
  const a = application || ''
  if (a.includes('복지로')) return { label: '복지로에서 신청', url: 'https://www.bokjiro.go.kr' }
  if (a.includes('고용24') || a.includes('고용센터') || a.includes('work'))
    return { label: '고용24에서 신청', url: 'https://www.work24.go.kr' }
  if (a.includes('정부24')) return { label: '정부24에서 신청', url: 'https://www.gov.kr/portal/main' }
  if (a.includes('주민센터')) return { label: '가까운 주민센터 방문', url: 'https://www.bokjiro.go.kr' }
  return { label: '복지로에서 신청', url: 'https://www.bokjiro.go.kr' }
}

/** RPA 자동발급 지원 서류 (백엔드 manager.py와 일치) */
export const RPA_SUPPORTED_DOCS = [
  '주민등록등본', '주민등록초본', '가족관계증명서', '장애인증명서',
  '건강보험 자격득실확인서', '고용보험 피보험자격 이력내역서',
]
export function isRpaSupported(doc: string): boolean {
  const d = doc.replace(/\s/g, '')
  return RPA_SUPPORTED_DOCS.some((s) => d.includes(s.replace(/\s/g, '')) || s.replace(/\s/g, '').includes(d))
}
