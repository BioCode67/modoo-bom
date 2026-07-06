import { describe, it, expect, vi, afterEach } from 'vitest'
import { bestApplyUrl, isGenericHome, oneTapApply, KNOWN_APPLY_URLS } from './quickApply'

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
