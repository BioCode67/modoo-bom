import { describe, it, expect } from 'vitest'
import { diffScenarios, diffSummary } from './scenarioDiff'
import { medianIncome } from './medianIncome'

// 1인 기준 중위소득으로 상한 시점을 만든다: pct 이하면 그 급여 자격.
const at = (pct: number) => Math.floor((medianIncome(1) * pct) / 100)

describe('diffScenarios — 소득 변화에 따른 자격 급여 득실', () => {
  it('소득이 늘면(30%→45%) 생계·의료를 잃는다', () => {
    const d = diffScenarios({ total: at(30), size: 1 }, { total: at(45), size: 1 })
    expect(d.totalDelta).toBeGreaterThan(0)
    const lostKeys = d.lost.map((x) => x.key)
    expect(lostKeys).toContain('livelihood') // 32% 초과
    expect(lostKeys).toContain('medical')    // 40% 초과
    expect(d.gained).toEqual([])
  })

  it('소득이 줄면(45%→30%) 생계·의료가 열린다', () => {
    const d = diffScenarios({ total: at(45), size: 1 }, { total: at(30), size: 1 })
    expect(d.totalDelta).toBeLessThan(0)
    const gainedKeys = d.gained.map((x) => x.key)
    expect(gainedKeys).toContain('livelihood')
    expect(gainedKeys).toContain('medical')
    expect(d.lost).toEqual([])
  })

  it('경계를 안 넘으면 변화 없음', () => {
    const d = diffScenarios({ total: at(20), size: 1 }, { total: at(25), size: 1 })
    expect(d.unchanged).toBe(true)
    expect(d.gained).toEqual([])
    expect(d.lost).toEqual([])
  })

  it('50% 초과로 넘어가면 모든 급여를 잃는다', () => {
    const d = diffScenarios({ total: at(45), size: 1 }, { total: at(60), size: 1 })
    expect(d.lost.length).toBeGreaterThan(0)
    expect(d.gained).toEqual([])
  })
})

describe('diffSummary — 한 줄 요약', () => {
  it('잃음/열림을 문구로', () => {
    expect(diffSummary(diffScenarios({ total: at(30), size: 1 }, { total: at(45), size: 1 }))).toMatch(/잃음/)
    expect(diffSummary(diffScenarios({ total: at(45), size: 1 }, { total: at(30), size: 1 }))).toMatch(/열림/)
  })
  it('변화 없으면 그대로 안내', () => {
    expect(diffSummary(diffScenarios({ total: at(20), size: 1 }, { total: at(22), size: 1 }))).toMatch(/변화 없음/)
  })
})
