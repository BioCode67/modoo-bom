import { describe, it, expect } from 'vitest'
import { trustInfo } from './trust'
describe('trustInfo — 출처·신뢰 라벨', () => {
  it('큐레이션(POL/PRV/HOU/SUP/FIN)은 verified=true', () => {
    for (const id of ['POL-1', 'PRV-001', 'HOU-001', 'SUP-009', 'FIN-001']) expect(trustInfo(id).verified).toBe(true)
  })
  it('공공데이터(GOV/LOC)는 verified=false(요약)', () => {
    expect(trustInfo('GOV-1').verified).toBe(false)
    expect(trustInfo('LOC-1').verified).toBe(false)
  })
  it('민간재단은 심사·선발형임을 note에 명시', () => {
    expect(trustInfo('PRV-001').note).toMatch(/심사·선발/)
  })
  it('모든 항목이 source 문자열을 가짐', () => {
    for (const id of ['POL-1','PRV-1','HOU-1','SUP-1','GOV-1','LOC-1','X-1']) expect(trustInfo(id).source).toBeTruthy()
  })
})
