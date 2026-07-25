import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyLink, docLink, isRpaSupported, isApplyAutomatable, isCertIssuable, certKind, CERT_WALLET } from './officialLinks'

describe('applyLink', () => {
  it('복지로 상세 딥링크(application이 URL)면 그 URL 그대로 연결', () => {
    const deep = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000123'
    const r = applyLink(deep)
    expect(r.url).toBe(deep)
    expect(r.label).toContain('복지로')
  })
  it('고용24 URL은 고용24 라벨', () => {
    expect(applyLink('https://www.work24.go.kr/x').label).toContain('고용24')
  })
  it('정부24 URL은 정부24 라벨', () => {
    expect(applyLink('https://www.gov.kr/abc').label).toContain('정부24')
  })
  it('한글 채널 설명(복지로)은 홈으로 폴백', () => {
    expect(applyLink('복지로 또는 주민센터 방문 신청').url).toBe('https://www.bokjiro.go.kr')
  })
  it('직업훈련(HRD-Net·K-디지털)은 정부24 검색이 아니라 HRD-Net으로 — 청년취업사관학교 실사용 제보', () => {
    const r = applyLink('K-디지털 트레이닝 플랫폼 또는 직업훈련포털(HRD-Net)')
    expect(r.url).toBe('https://www.hrd.go.kr')
    expect(r.label).toContain('HRD-Net')
  })
  it('빈 값은 복지로 홈 기본값', () => {
    expect(applyLink('').url).toBe('https://www.bokjiro.go.kr')
  })
})

describe('docLink', () => {
  it('주민등록등본 → 정부24 민원 딥링크(실측 13100000015) + RPA 지원 — 일반 홈 착지 금지', () => {
    const r = docLink('주민등록등본')
    expect(r.url).toContain('CappBizCD=13100000015')
    expect(r.rpa).toBe(true)
    expect(docLink('주민등록초본').url).toContain('CappBizCD=13100000015') // 등·초본 동일 민원
  })
  it('가족관계증명서 → 대법원 efamily 직행 — 정부24 경로는 전자문서지갑 선행·연계 차단(실사용 확정)', () => {
    // 2026-07-20 실측: 원 발급처 efamily는 24시간 발급되는데 정부24 연계는 새벽에 막혔다(사용자 스크린샷).
    // '링크라도 제대로' — 사용자가 눌렀을 때 실제로 발급되는 사이트로 보낸다.
    expect(docLink('가족관계증명서').url).toContain('efamily.scourt.go.kr')
  })
  it('건강보험 자격득실 → 건보 + RPA', () => {
    expect(docLink('건강보험 자격득실확인서').url).toContain('nhis')
  })
  it('미지정 서류는 정부24 검색으로 폴백', () => {
    expect(docLink('희귀서류명').url).toContain('gov.kr/search')
  })
  it('소득증빙·소득확인서류 → 소득금액증명 발급 안내', () => {
    expect(docLink('소득증빙').url).toContain('CappBizCD=12100000021')
    expect(docLink('소득확인서류').label).toContain('소득금액증명')
  })
  it('재학증명서 → 정부24 초·중·고 발급 코드(실측)', () => {
    const r = docLink('재학증명서')
    expect(r.url).toContain('CappBizCD=13410000017')
    expect(r.label).toContain('초·중·고')
  })
  it('대학교 재학증명서 → 정부24 대학 발급 코드(실측)', () => {
    const r = docLink('대학교 재학증명서')
    expect(r.url).toContain('CappBizCD=13404000010')
    expect(r.label).toContain('대학')
  })
  it('대학 졸업증명서 → 정부24 대학 졸업 코드', () => {
    expect(docLink('대학 졸업증명서').url).toContain('CappBizCD=13404000009')
  })
  it('임대차계약서 → 발급 서류 아님(본인 보관), 확정일자는 인터넷등기소', () => {
    const r = docLink('임대차계약서')
    expect(r.url).toContain('iros.go.kr')
    expect(r.label).toContain('본인 보관')
    expect(r.rpa).toBeFalsy() // 정부 자동발급 대상 아님
  })
  it('신분증은 본인 지참(발급 서류 아님) — 재발급만 정부24 안내', () => {
    const r = docLink('신분증')
    expect(r.label).toContain('본인 지참')
    expect(r.rpa).toBeFalsy()
  })
  it('회사 발급 확장: 통상임금·휴가확인 / 고용 이력: 취업경험→고용24', () => {
    expect(docLink('통상임금 확인 서류').label).toContain('회사')
    expect(docLink('출산 전후 휴가 확인서').label).toContain('회사')
    expect(docLink('취업경험 확인서류').url).toContain('work24')
  })
  it('병원·은행·회사 발급 서류는 발급 주체를 정직하게 안내', () => {
    expect(docLink('진단서').label).toContain('병원')
    expect(docLink('임신확인서').label).toContain('병원')
    expect(docLink('출생증명서').label).toContain('병원')
    expect(docLink('통장 사본').label).toContain('은행')
    expect(docLink('근로계약서').label).toContain('회사')
    expect(docLink('재직확인 서류').label).toContain('회사')
  })
  it('기관 직링크: 건보료 납부확인·등기부·장기요양·사업자등록증명·생활기록부', () => {
    expect(docLink('건강보험료 납부확인서').url).toContain('nhis.or.kr')
    expect(docLink('건물 등기부등본').url).toContain('iros.go.kr')
    expect(docLink('장기요양인정서').url).toContain('longtermcare.or.kr')
    expect(docLink('사업자등록증').url).toContain('CappBizCD=12100000016')
    expect(docLink('성적증명서').url).toContain('CappBizCD=13410000019')
  })
  it('장애인등록증·장애인증명서 → 정부24 직링크(실측 코드)', () => {
    expect(docLink('장애인등록증').url).toContain('CappBizCD=14600000273')
  })
  it('발급 불가/본인 지참 서류는 RPA 자동발급 대상이 아님', () => {
    expect(isRpaSupported('임대차계약서')).toBe(false)
    expect(isRpaSupported('신분증')).toBe(false)
    expect(isRpaSupported('재학증명서')).toBe(false)
  })
})

describe('isCertIssuable — 무설치 전자발급(전자증명서) 가능 서류', () => {
  it('정부24·공공 전자발급 서류는 true', () => {
    expect(isCertIssuable('주민등록등본')).toBe(true)
    expect(isCertIssuable('가족관계증명서')).toBe(true)
    expect(isCertIssuable('장애인증명서')).toBe(true)
    expect(isCertIssuable('기초생활수급자 증명서')).toBe(true)
    expect(isCertIssuable('건강보험 자격득실확인서')).toBe(true)
    expect(isCertIssuable('국민연금 가입내역확인서')).toBe(true)
  })
  it('병원·은행·회사 발급 서류는 온라인 전자발급 대상 아님(false)', () => {
    expect(isCertIssuable('진단서')).toBe(false)
    expect(isCertIssuable('통장 사본')).toBe(false)
    expect(isCertIssuable('근로계약서')).toBe(false)
    expect(isCertIssuable('임대차계약서')).toBe(false)
    expect(isCertIssuable('희귀서류명')).toBe(false) // 검색 폴백은 발급 확정 아님
  })
  it('거짓양성 회귀 방지 — 본인 준비물·사업주 제출 서류에 전자발급 배지 금지(감사 실측)', () => {
    expect(isCertIssuable('가족사진')).toBe(false) // 본인 준비물(과거 portal/main 정규식이 true로 오판)
    expect(isCertIssuable('출생 관련 서류')).toBe(false)
    expect(isCertIssuable('이직확인서')).toBe(false) // 사업주가 고용센터에 제출 — 본인 발급 불가
    expect(docLink('이직확인서').label).toContain('회사가 고용센터에 제출')
    expect(docLink('이직확인서').rpa).toBeFalsy()
  })
  it('certKind — 전자문서지갑(wallet)과 단순 온라인 발급(online)을 구분', () => {
    expect(certKind('주민등록등본')).toBe('wallet')
    expect(certKind('건물 등기부등본')).toBe('online') // 인터넷등기소 — 온라인 발급 가능하나 지갑 유통 아님
    expect(certKind('장기요양인정서')).toBe('online')
    expect(certKind('진단서')).toBeUndefined()
    // 피보험자격 이력은 본인 발급 가능(true 유지), 취업경험 확인도 고용24
    expect(isCertIssuable('고용보험 피보험자격 이력내역서')).toBe(true)
  })
  it('전자문서지갑 안내 링크 제공', () => {
    expect(CERT_WALLET.url).toContain('dpaper.kr')
  })
})

describe('RPA/자동신청 지원 판별', () => {
  it('지원 서류 식별', () => {
    expect(isRpaSupported('주민등록등본')).toBe(true)
    expect(isRpaSupported('통장사본')).toBe(false)
  })
  it('자동신청 가능 서비스 식별', () => {
    expect(isApplyAutomatable('기초연금')).toBe(true)
    expect(isApplyAutomatable('산림복지서비스이용권')).toBe(false)
  })
})

describe('isApplyAutomatable — 별개 사업 오탐 차단(감사 확정 회귀)', () => {
  // 과거 양방향 substring 포함이 '장애아동수당 …'(별개 사업)을 '아동수당' 지원으로 오판 →
  // 활성 자동신청 버튼이 백엔드 400(정확일치 6종 + 딥링크 없음)으로 확정 막다른 길이 되던 결함.
  it('지원 서비스명을 부분 포함해도 별개 사업이면 false — 실카탈로그 실재 이름 그대로', () => {
    expect(isApplyAutomatable('장애아동수당')).toBe(false) // GOV-WLF00003198 — 아동수당과 다른 제도
    expect(isApplyAutomatable('장애아동수당 미수급자 지원')).toBe(false) // LOC-WLF00005404(방문형)
    expect(isApplyAutomatable('장애아동수당 시비특별지원')).toBe(false) // LOC-WLF00002750(방문형)
    expect(isApplyAutomatable('장애아동수당 추가지원')).toBe(false) // LOC-WLF00000881
    expect(isApplyAutomatable('아동수당플러스 지원 사업')).toBe(false) // LOC-WLF00004041 — '플러스'는 한정어
  })
  it('실카탈로그(policies.json) 대조 — 감사 오탐 3건은 false, 동일 제도 표기변형은 true 유지', () => {
    const ext = JSON.parse(readFileSync(new URL('../../public/policies.json', import.meta.url), 'utf-8'))
    const byId = new Map<string, string>(ext.map((p: { id: string; name: string }) => [p.id, p.name]))
    for (const id of ['LOC-WLF00005404', 'LOC-WLF00002750', 'LOC-WLF00004041']) {
      expect(byId.get(id), `${id} 실데이터 존재 전제`).toBeTruthy()
      expect(isApplyAutomatable(byId.get(id)!), `${id} ${byId.get(id)}`).toBe(false)
    }
    // 백엔드 SERVICE_APPLY_URLS와 같은 wlfareInfoId를 가진 동일 제도의 공공데이터 표기 — 계속 허용
    expect(isApplyAutomatable(byId.get('GOV-WLF00001171')!)).toBe(true) // '아동수당 지급'(WLF00001171)
    expect(isApplyAutomatable(byId.get('GOV-WLF00004657')!)).toBe(true) // '부모급여 지원'(WLF00004657)
  })
  it('역방향 substring 오탐 제거 — 서비스명 조각·빈 문자열은 false', () => {
    expect(isApplyAutomatable('아동')).toBe(false)
    expect(isApplyAutomatable('수당')).toBe(false)
    expect(isApplyAutomatable('연금')).toBe(false)
    expect(isApplyAutomatable('')).toBe(false) // 과거엔 ''.includes 로 무조건 true
  })
  it('의도된 허용 유지 — 정확 일치 6종·공백 변형·무의미 접미어·문장형(webAgent 계약)', () => {
    for (const s of ['기초연금', '아동수당', '부모급여', '청년 내일저축계좌', '첫만남이용권', '기초생활 생계급여'])
      expect(isApplyAutomatable(s), s).toBe(true)
    expect(isApplyAutomatable('청년내일저축계좌')).toBe(true) // 공백 무시 동등
    expect(isApplyAutomatable('아동수당 지급')).toBe(true) // 무의미 접미어(동일 제도)
    expect(isApplyAutomatable('부모급여 지원')).toBe(true)
    expect(isApplyAutomatable('기초연금 신청')).toBe(true) // webAgent 목표 문장(webAgent.test.ts 고정)
    expect(isApplyAutomatable('기초연금을 신청해줘')).toBe(true)
  })
})

describe('docLink — 지방세 세목별 과세증명서 CappBizCD(자기리뷰 #3)', () => {
  it('세목별 과세는 13100000084, 납세는 13100000056(서로 다른 코드)', () => {
    expect(docLink('지방세 세목별 과세증명서').url).toContain('13100000084')
    expect(docLink('지방세 납세증명서').url).toContain('13100000056')
  })
})
