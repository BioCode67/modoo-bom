import { describe, it, expect, vi, afterEach } from 'vitest'
import { bestApplyUrl, bestApplyInfo, isGenericHome, oneTapApply, borrowApplyUrl, KNOWN_APPLY_URLS } from './quickApply'
import { getCatalog } from '@/data/catalog'

// 카탈로그 교차참조 테스트를 위해 getCatalog를 목킹(기본 빈 배열 → 기존 폴백 동작 유지).
// 인덱스 캐시는 '배열 참조'로 무효화되므로 mockReturnValue로 새 배열을 주면 자동 재구축된다.
vi.mock('@/data/catalog', () => ({ getCatalog: vi.fn(() => []) }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setCatalog = (arr: any[]) => (getCatalog as any).mockReturnValue(arr)
const deep = (wlf: string) => `https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=${wlf}`

describe('isGenericHome — 일반 홈 착지 패턴 판정', () => {
  it('홈(트레일링 슬래시·portal/main 변형 포함)은 generic', () => {
    expect(isGenericHome('https://www.bokjiro.go.kr')).toBe(true)
    expect(isGenericHome('https://www.bokjiro.go.kr/')).toBe(true)
    expect(isGenericHome('https://www.gov.kr/portal/main')).toBe(true)
    expect(isGenericHome('https://www.work24.go.kr')).toBe(true)
  })
  it('딥링크 파라미터가 있으면 generic 아님', () => {
    expect(isGenericHome('https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00001164')).toBe(false)
    expect(isGenericHome('https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000015')).toBe(false)
    expect(isGenericHome('https://www.gov.kr/search?srhQuery=x')).toBe(false)
  })
  it('타 호스트·비URL은 generic 아님(원본 유지)', () => {
    expect(isGenericHome('https://www.nhis.or.kr')).toBe(false)
    expect(isGenericHome('복지로 신청')).toBe(false)
  })
})

describe('bestApplyUrl — 착지 우선순위', () => {
  it('정책 자체 딥링크가 최우선(실데이터 존중)', () => {
    const deep = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00009999'
    expect(bestApplyUrl(deep, '기초연금')).toBe(deep)
  })
  it('일반 홈 착지 + 실측 검증 딥링크 보유 정책(정확 일치)은 복지로 상세 직행', () => {
    expect(bestApplyUrl('주민센터 방문 또는 복지로(www.bokjiro.go.kr) 온라인 신청', '기초연금')).toBe(KNOWN_APPLY_URLS['기초연금'])
    expect(bestApplyUrl('복지로 온라인 신청', '아동수당')).toContain('WLF00001171')
    expect(bestApplyUrl('주민센터 방문 신청', '국민기초생활보장 생계급여')).toContain('WLF00001132')
  })
  it('이름 정확 일치만 — 유사명이 딥링크를 가로채지 않음', () => {
    expect(bestApplyUrl('복지로 신청', '기초연금 수급자 특별지원')).not.toContain('WLF00001164')
  })
  it('일반 홈 착지는 정책명으로 정부24 통합검색 폴백', () => {
    expect(bestApplyUrl('복지로 신청', '희귀정책명')).toContain('gov.kr/search?srhQuery=')
  })
  it("'주민센터 방문' 채널은 검색 폴백 금지(오프라인 전용을 온라인처럼 오도하지 않음)", () => {
    expect(bestApplyUrl('주민센터 방문 신청', '어떤 방문형 복지')).toBe('https://www.bokjiro.go.kr')
  })
})

describe('bestApplyUrl — 확장(2026-07): seed 정책도 실제 신청 상세로 직행', () => {
  it('청년월세지원(seed) → 복지로 신청 상세(WLF00004661), gov.kr 검색 아님', () => {
    // 사용자 신고: 자유텍스트 application이라 gov.kr 키워드 검색으로 빠지던 것 → 실제 신청처로
    const u = bestApplyUrl('복지로 온라인 신청', '청년월세지원')
    expect(u).toContain('WLF00004661')
    expect(u).not.toContain('gov.kr/search')
  })
  it('장애인연금·노인일자리 등 확장 정책도 복지로 직행', () => {
    expect(bestApplyUrl('복지로 신청', '장애인연금')).toContain('WLF00003249')
    expect(bestApplyUrl('주민센터 또는 복지로', '노인 일자리 및 사회활동 지원')).toContain('WLF00001155')
  })
})

describe('borrowApplyUrl — 카탈로그 교차참조(공공데이터 검증 딥링크 재사용)', () => {
  afterEach(() => setCatalog([]))

  it('정확 일치 정책의 검증된 신청 URL을 빌려온다', () => {
    setCatalog([{ id: 'GOV-1', name: '희귀한지원사업', application: `신청: ${deep('WLF00009001')}` }])
    expect(borrowApplyUrl('희귀한지원사업')).toContain('WLF00009001')
  })
  it('접두 일치(70%+)는 허용 — "청년월세지원" ↔ "청년월세 지원사업"', () => {
    setCatalog([
      { id: 'GOV-1', name: '청년월세 지원사업', application: deep('WLF00004661') },
      { id: 'GOV-2', name: '전혀다른정책', application: deep('WLF00009999') },
    ])
    expect(borrowApplyUrl('청년월세지원')).toContain('WLF00004661')
  })
  it('오매칭 방지: "아동수당"이 "장애아동수당"을 가로채지 않음(접두 불일치)', () => {
    setCatalog([{ id: 'GOV-1', name: '장애아동수당', application: deep('WLF00003198') }])
    expect(borrowApplyUrl('아동수당')).toBe('') // 접두 일치가 아니므로 빌리지 않음(정직성)
  })
  it('딥링크 없는 정책(주민센터 방문 등)은 인덱스에서 제외 → 못 빌림', () => {
    setCatalog([{ id: 'LOC-1', name: '어떤동네지원', application: '주민센터 방문' }])
    expect(borrowApplyUrl('어떤동네지원')).toBe('')
  })
  it('bestApplyUrl이 교차참조로 gov.kr 검색 대신 실딥링크를 쓴다', () => {
    setCatalog([{ id: 'GOV-9', name: '무슨무슨바우처', application: deep('WLF00008888') }])
    const u = bestApplyUrl('복지로 온라인 신청', '무슨무슨바우처')
    expect(u).toContain('WLF00008888')
    expect(u).not.toContain('gov.kr/search')
  })

  // ── 감사 확정(HIGH): 동명 타 지자체 사업 오연결 차단 ──
  it('지자체(LOC-)는 대여자에서 제외 — 서산시 장수수당이 창원시 장수수당 URL을 빌리지 않음', () => {
    setCatalog([{ id: 'LOC-WLF00000109', name: '장수수당', application: deep('WLF00000109') }])
    expect(borrowApplyUrl('장수수당')).toBe('') // LOC 대여자 제외 → 못 빌림(오연결 방지)
  })
  it('지자체(LOC-) 정책 자신도 KNOWN·차용을 건너뜀 — 동명 국가사업 딥링크로 새지 않음', () => {
    setCatalog([{ id: 'GOV-1', name: '기초연금', application: deep('WLF00001164') }])
    const u = bestApplyUrl('복지로 신청', '기초연금', 'LOC-9999') // 어느 지자체의 동명 자체사업이라 가정
    expect(u).not.toContain('WLF00001164') // KNOWN 정확일치도 LOC엔 미적용
    expect(u).toContain('gov.kr/search') // 정직한 검색 폴백
  })
  it("접미어 화이트리스트 — '…추가지원'(다른 사업 한정어)은 본사업 URL을 빌리지 않음", () => {
    setCatalog([{ id: 'GOV-1', name: '발달장애인 주간활동서비스', application: deep('WLF00001165') }])
    expect(borrowApplyUrl('발달장애인 주간활동서비스 추가지원')).toBe('')
    // 반면 무의미 접미어('지원사업')는 계속 허용
    setCatalog([{ id: 'GOV-2', name: '청년월세 지원사업', application: deep('WLF00004661') }])
    expect(borrowApplyUrl('청년월세지원')).toContain('WLF00004661')
  })
})

describe('bestApplyInfo — 라벨은 최종 착지 기준(라벨-목적지 불일치 수정)', () => {
  it('KNOWN 딥링크로 가면 라벨도 복지로', () => {
    const r = bestApplyInfo('주민센터 방문 또는 복지로(www.bokjiro.go.kr) 온라인 신청', '기초연금')
    expect(r.url).toContain('WLF00001164')
    expect(r.label).toBe('복지로에서 신청')
  })
  it('검색 폴백이면 라벨도 정직하게 검색', () => {
    const r = bestApplyInfo('복지로 온라인 신청', '아주희귀한정책명')
    expect(r.url).toContain('gov.kr/search')
    expect(r.label).toBe('정부24에서 검색')
  })
  it('자체 딥링크(변경 없음)면 원래 라벨 유지', () => {
    const durl = deep('WLF00009999')
    const r = bestApplyInfo(durl, '아무거나')
    expect(r.url).toBe(durl)
    expect(r.label).toBe('복지로 상세페이지에서 신청')
  })
})

describe('KNOWN 2차 확장(2026-07-15) — 대표 국가제도 복지로 직행', () => {
  it.each([
    ['교육급여 (기초생활보장)', 'WLF00001089'],
    ['주거급여 (임차급여·수선유지급여)', 'WLF00003201'],
    ['보육료 지원 (어린이집)', 'WLF00003250'],
    ['육아휴직급여', 'WLF00003226'],
    ['한국장학재단 국가장학금 I 유형', 'WLF00003197'],
    ['국민내일배움카드', 'WLF00006229'],
    ['청년 월세 한시 특별지원', 'WLF00004661'],
  ])('%s → %s', (name, wlf) => {
    expect(bestApplyUrl('복지로 온라인 신청', name)).toContain(wlf)
  })
})

describe('oneTapApply — 팝업 차단 감지 + 이름만 복사', () => {
  afterEach(() => vi.unstubAllGlobals())
  const profile = null
  const rpa = { name: '김복지', birth_date: '1953-11-01', phone: '010-1234-5678' }

  it('새 탭이 열리면 opened=true(핸들 수신 후 opener 수동 절단), 이름 값만 복사', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const handle: { opener: unknown } = { opener: {} }
    const open = vi.fn().mockReturnValue(handle)
    vi.stubGlobal('window', { open })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const r = await oneTapApply('복지로 신청', '기초연금', profile, rpa)
    expect(r.opened).toBe(true)
    expect(r.copied).toBe(true)
    expect(writeText).toHaveBeenCalledWith('김복지') // '라벨: 값' 블롭이 아니라 붙여넣기 가능한 값만
    // ⚠️ features에 'noopener'를 넣으면 성공해도 null이 반환돼 차단 감지가 불가능(스펙) — 핸들+수동 절단 방식 고정
    expect(open).toHaveBeenCalledWith(KNOWN_APPLY_URLS['기초연금'], '_blank')
    expect(handle.opener).toBeNull()
    expect(r.url).toBe(KNOWN_APPLY_URLS['기초연금'])
  })
  it('팝업 차단(window.open→null)이면 opened=false — 허위 성공 안내 방지', async () => {
    vi.stubGlobal('window', { open: vi.fn().mockReturnValue(null) })
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const r = await oneTapApply('복지로 신청', '기초연금', profile, rpa)
    expect(r.opened).toBe(false)
    expect(r.url).toContain('WLF00001164')
  })
  it('이름이 비어 있으면(새로고침 후 기본 상태) 다른 값을 복사하지 않는다 — copied=false', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { open: vi.fn().mockReturnValue({ opener: {} }) })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const aged = { name: '', age: 72, gender: 'other', region: '서울', household_type: '1인가구', income_percentile: 30, disability: false, disability_grade: '', employment_status: '', has_children: false, children_ages: [], is_pregnant: false, life_events: [] }
    // @ts-expect-error 테스트용 최소 프로필
    const r = await oneTapApply('복지로 신청', '기초연금', aged, { name: '', birth_date: '', phone: '' })
    expect(r.copied).toBe(false)
    expect(writeText).not.toHaveBeenCalled() // '만 72세'를 이름이라며 복사하면 안 됨
  })
})
