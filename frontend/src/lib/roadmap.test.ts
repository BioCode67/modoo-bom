import { describe, it, expect } from 'vitest'
import type { Policy } from '@/data/policies'
import {
  applyChannel,
  isOnlineApplicable,
  buildRoadmap,
  roadmapToText,
  PHASE_ORDER,
  type RoadmapInput,
} from './roadmap'

const mk = (over: Partial<Policy>): Policy => ({
  id: 'T', name: '테스트정책', category: '기타', target: '', benefit: '', eligibility: '',
  required_docs: [], application: '', department: '', renewal: '', ...over,
})

describe('applyChannel', () => {
  it('온라인 신호 → online', () => {
    expect(applyChannel('복지로(www.bokjiro.go.kr) 온라인 신청')).toBe('online')
    expect(applyChannel('정부24 누리집에서 신청')).toBe('online')
  })
  it('방문 신호 → visit', () => {
    expect(applyChannel('주민센터 방문 신청')).toBe('visit')
    expect(applyChannel('행정복지센터 방문')).toBe('visit')
  })
  it('둘 다 있으면 mixed', () => {
    expect(applyChannel('주민센터 방문 또는 복지로 온라인 신청')).toBe('mixed')
  })
  it('신호 없으면 보수적으로 visit', () => {
    expect(applyChannel('')).toBe('visit')
    expect(applyChannel('문의 후 안내')).toBe('visit')
  })
})

describe('isOnlineApplicable', () => {
  it('online·mixed는 true, visit는 false', () => {
    expect(isOnlineApplicable('online')).toBe(true)
    expect(isOnlineApplicable('mixed')).toBe(true)
    expect(isOnlineApplicable('visit')).toBe(false)
  })
})

describe('buildRoadmap — 단계(phase) 배정', () => {
  it('마감 임박은 서류 미비여도 urgent가 최우선', () => {
    const inputs: RoadmapInput[] = [{
      policy: mk({ id: 'A', eligibility: '신청은 14일 이내', required_docs: ['신분증'], application: '주민센터 방문' }),
    }]
    const { steps } = buildRoadmap(inputs)
    expect(steps[0].phase).toBe('urgent')
    expect(steps[0].deadline?.urgent).toBe(true)
  })

  it('마감 없고 서류 미비면 docs (온라인 가능해도 서류 먼저)', () => {
    const inputs: RoadmapInput[] = [{
      policy: mk({ id: 'B', required_docs: ['신분증'], application: '복지로 온라인 신청' }),
    }]
    const { steps } = buildRoadmap(inputs)
    expect(steps[0].phase).toBe('docs')
    expect(steps[0].missingDocs).toEqual(['신분증'])
  })

  it('서류 다 준비 + 온라인 가능이면 online', () => {
    const inputs: RoadmapInput[] = [{
      policy: mk({ id: 'C', required_docs: ['신분증'], application: '복지로 온라인' }),
      checkedDocs: ['신분증'],
    }]
    const { steps } = buildRoadmap(inputs)
    expect(steps[0].phase).toBe('online')
    expect(steps[0].missingDocs).toEqual([])
  })

  it('마감 없고 서류 없고 방문 전용이면 visit', () => {
    const inputs: RoadmapInput[] = [{ policy: mk({ id: 'D', application: '주민센터 방문 신청' }) }]
    const { steps } = buildRoadmap(inputs)
    expect(steps[0].phase).toBe('visit')
  })
})

describe('buildRoadmap — 미비 서류(missingDocs)', () => {
  it('체크한 서류·보유 서류는 제외, 공백 표기차 정규화', () => {
    const inputs: RoadmapInput[] = [{
      policy: mk({ id: 'E', required_docs: ['주민등록등본', '통장 사본', '신분증'], application: '복지로' }),
      checkedDocs: ['주민등록 등본'], // 공백 표기 달라도 같은 서류로 인식
    }]
    // 통장 사본은 전역 보유(hasDoc)로 처리 → 남는 미비 서류는 신분증만
    const { steps } = buildRoadmap(inputs, { hasDoc: (d) => d.replace(/\s/g, '') === '통장사본' })
    expect(steps[0].missingDocs).toEqual(['신분증'])
  })
})

describe('buildRoadmap — 정렬·순번', () => {
  it('단계 순 → 월 현금액 큰 순 → 이름 순, order 1..n', () => {
    const inputs: RoadmapInput[] = [
      { policy: mk({ id: 'visit1', application: '주민센터 방문' }) },
      { policy: mk({ id: 'online-small', name: '작은지원', benefit: '월 10만원 지급', application: '복지로' }) },
      { policy: mk({ id: 'online-big', name: '큰지원', benefit: '월 최대 50만원 지급', application: '복지로' }) },
      { policy: mk({ id: 'urgent1', eligibility: '30일 이내 신청', application: '복지로' }) },
    ]
    const { steps } = buildRoadmap(inputs)
    expect(steps.map((s) => s.policyId)).toEqual(['urgent1', 'online-big', 'online-small', 'visit1'])
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4])
    // 단계 순서 불변식
    const phaseIdx = steps.map((s) => PHASE_ORDER.indexOf(s.phase))
    expect(phaseIdx).toEqual([...phaseIdx].sort((a, b) => a - b))
  })
})

describe('buildRoadmap — 요약(summary)', () => {
  it('현금·월단위만 합산(서비스·일시금 제외)', () => {
    const inputs: RoadmapInput[] = [
      { policy: mk({ id: 'cash', benefit: '월 최대 300,000원 지급', application: '복지로' }) },
      { policy: mk({ id: 'service', benefit: '가사·간병 방문 서비스 제공', application: '주민센터' }) },
      { policy: mk({ id: 'lumpsum', benefit: '출산 시 200만원 일시금', application: '주민센터' }) },
    ]
    const { summary } = buildRoadmap(inputs)
    expect(summary.totalMonthlyCash).toBe(300000) // service·일시금 제외
    expect(summary.stepCount).toBe(3)
  })

  it('단계별 개수 집계', () => {
    const inputs: RoadmapInput[] = [
      { policy: mk({ id: 'u', eligibility: '14일 이내', application: '복지로' }) },
      { policy: mk({ id: 'o', application: '복지로 온라인' }) },
      { policy: mk({ id: 'v', application: '주민센터 방문' }) },
    ]
    const { summary } = buildRoadmap(inputs)
    expect(summary.urgentCount).toBe(1)
    expect(summary.onlineCount).toBe(1)
    expect(summary.visitCount).toBe(1)
  })
})

describe('buildRoadmap — 서류 종합(allDocs)', () => {
  it('중복 제거 + 요구 정책 수(count) + 재사용 완료(done)', () => {
    const inputs: RoadmapInput[] = [
      { policy: mk({ id: 'P1', required_docs: ['주민등록등본', '신분증'], application: '복지로' }), checkedDocs: ['신분증'] },
      { policy: mk({ id: 'P2', required_docs: ['주민등록등본', '통장 사본'], application: '주민센터' }) },
    ]
    const { summary } = buildRoadmap(inputs)
    const byName = Object.fromEntries(summary.allDocs.map((d) => [d.name, d]))
    // 주민등록등본은 두 정책이 요구 → count 2, 최상단
    expect(summary.allDocs[0].name).toBe('주민등록등본')
    expect(byName['주민등록등본'].count).toBe(2)
    expect(byName['주민등록등본'].done).toBe(false)
    // 신분증은 P1에서 체크 → done true (한 번 떼면 재사용)
    expect(byName['신분증'].done).toBe(true)
    // 종합 3종(등본·신분증·통장사본), 완료 1종(신분증)
    expect(summary.docProgress).toEqual({ total: 3, done: 1 })
  })

  it('전역 보유(hasDoc)면 done 처리', () => {
    const inputs: RoadmapInput[] = [{ policy: mk({ id: 'P', required_docs: ['주민등록등본'], application: '복지로' }) }]
    const { summary } = buildRoadmap(inputs, { hasDoc: () => true })
    expect(summary.docProgress).toEqual({ total: 1, done: 1 })
  })
})

describe('buildRoadmap — 링크·빈 입력', () => {
  it('resolveUrl은 온라인 가능 단계에만 applyUrl 설정', () => {
    const inputs: RoadmapInput[] = [
      { policy: mk({ id: 'on', application: '복지로 온라인' }) },
      { policy: mk({ id: 'off', application: '주민센터 방문' }) },
    ]
    const { byPhase } = buildRoadmap(inputs, { resolveUrl: (p) => `https://x/${p.id}` })
    expect(byPhase.online[0].applyUrl).toBe('https://x/on')
    expect(byPhase.visit[0].applyUrl).toBeUndefined()
  })

  it('빈 입력이면 빈 로드맵', () => {
    const { steps, summary } = buildRoadmap([])
    expect(steps).toEqual([])
    expect(summary.totalMonthlyCash).toBe(0)
    expect(summary.docProgress).toEqual({ total: 0, done: 0 })
  })

  it('policy 없는 항목은 안전하게 무시', () => {
    const { steps } = buildRoadmap([{ policy: undefined as unknown as Policy }])
    expect(steps).toEqual([])
  })
})

describe('roadmapToText — 인쇄·복사용 평문', () => {
  it('단계 제목·정책·서류·합계를 담는다', () => {
    const inputs: RoadmapInput[] = [
      { policy: mk({ id: 'big', name: '큰현금', benefit: '월 최대 300,000원 지급', required_docs: ['신분증'], application: '복지로 온라인' }) },
      { policy: mk({ id: 'visit', name: '방문지원', required_docs: ['주민등록등본'], application: '주민센터 방문' }) },
    ]
    const text = roadmapToText(buildRoadmap(inputs))
    expect(text).toContain('복지 신청 로드맵')
    expect(text).toContain('큰현금')
    expect(text).toContain('방문지원')
    expect(text).toContain('준비할 서류: 신분증')
    expect(text).toContain('필요 서류 종합')
    expect(text).toContain('월 예상 현금지원 합계')
  })

  it('빈 로드맵도 안전하게 문자열 반환', () => {
    expect(typeof roadmapToText(buildRoadmap([]))).toBe('string')
  })
})
