import { describe, expect, it } from 'vitest'
import { buildVoiceDiagText, hasVoiceExecIntent, shouldVoiceDiagnose } from './voiceDiag'
import { parseProfileFromText, profileSignalCount } from './parseQuery'
import { matchIssueIntent } from './chatAgent'
import { runAnalysis } from './welfare-engine'
import type { AnalysisResult, EligiblePolicy } from './welfare-engine'

// 결함 재현 문장 — 프로필 신호 2개(65세→나이, 혼자→1인가구) '이면서' 명시적 발급 명령('등본 떼줘')
const MIX = '65세 혼자 사는데 등본 떼줘'
const DOCS = ['주민등록등본', '주민등록초본', '가족관계증명서']

const pol = (id: string, name: string, priority: EligiblePolicy['priority'] = 'high', benefit = '월 30만원'): EligiblePolicy => ({
  id, name, category: '현금지원', target: '', benefit, eligibility: '', required_docs: [],
  application: '', department: '', renewal: '', reason: '', priority, confidence: 0.9,
})

const result = (policies: EligiblePolicy[]): AnalysisResult =>
  ({ eligible_policies: policies, required_docs: [] } as unknown as AnalysisResult)

describe('shouldVoiceDiagnose — 진단 분기가 실행 명령을 삼키지 않는다(챗위젯 순서 파리티)', () => {
  it('전제 실측: 재현 문장은 신호 2개 이상이면서 동시에 발급 인텐트다', () => {
    expect(profileSignalCount(MIX)).toBeGreaterThanOrEqual(2)
    expect(matchIssueIntent(MIX, DOCS)).toBe('주민등록등본')
  })
  it('에이전트 연결 시 실행 의도 우선 — "65세 혼자 사는데 등본 떼줘"는 진단 미발동(발급 경로로)', () => {
    expect(hasVoiceExecIntent(MIX, true, DOCS)).toBe(true)
    expect(shouldVoiceDiagnose(MIX, true, DOCS)).toBe(false)
  })
  it('전부발급·오토파일럿 명령도 진단이 삼키지 않는다', () => {
    expect(shouldVoiceDiagnose('65세 혼자 사는데 서류 전부 발급해줘', true, DOCS)).toBe(false)
    expect(shouldVoiceDiagnose('65세 혼자 사는데 알아서 다 해줘', true, DOCS)).toBe(false)
  })
  it('순수 상황 문장(실행 명령 없음)은 그대로 진단한다', () => {
    expect(shouldVoiceDiagnose('72세 혼자 사는데 소득이 적어요', true, DOCS)).toBe(true)
  })
  it('에이전트 미연결(웹)이면 발급 실행이 불가하므로 기존대로 진단(기능 축소 없음)', () => {
    expect(hasVoiceExecIntent(MIX, false, DOCS)).toBe(false)
    expect(shouldVoiceDiagnose(MIX, false, [])).toBe(true)
  })
  it('신호 0~1(지식 질문)은 진단 미발동 — 기존 계약 유지', () => {
    expect(shouldVoiceDiagnose('기초연금 알려줘', true, DOCS)).toBe(false)
  })
  it('발급 계열은 agentReply와 같은 게이트(issueDocs 있을 때만) — 진단만 눌리고 발급 응답이 안 나오는 어긋남 방지', () => {
    expect(hasVoiceExecIntent(MIX, true, [])).toBe(false)
    // 오토파일럿은 issueDocs 무관(agentReply 파리티)
    expect(hasVoiceExecIntent('알아서 다 해줘', true, [])).toBe(true)
  })
})

describe('buildVoiceDiagText — 낭독 개수는 결과 화면 헤더와 같은 정밀추천(POL-) 기준', () => {
  it('관련 복지(GOV/LOC/PRV)가 섞여도 정밀추천 개수만 헤드라인으로 말한다', () => {
    const res = result([
      pol('POL-001', '기초연금'),
      pol('POL-014', '주거급여', 'medium'),
      pol('GOV-B24-1', '관련복지A', 'low', '지원'),
      pol('LOC-1', '관련복지B', 'low', '지원'),
      pol('PRV-001', '민간장학', 'low', '심사 선발'),
    ])
    const text = buildVoiceDiagText(res)
    expect(text).toContain('복지가 2개 있어요') // primary 기준 — 전체 5개 아님(화면 헤더와 일치)
    expect(text).not.toContain('복지가 5개')
    // 관련 복지는 별도 한정어로만(정보 손실 없이 숫자 정직)
    expect(text).toContain('관련 복지도 3개')
    expect(text).toContain('기초연금')
  })
  it('정밀추천이 0건이면 전체를 그대로 말하고 관련 한정어는 붙이지 않는다(voiceBriefing base 폴백과 동일)', () => {
    const res = result([pol('GOV-1', '관련복지A', 'low', '지원'), pol('LOC-1', '관련복지B', 'low', '지원')])
    const text = buildVoiceDiagText(res)
    expect(text).toContain('복지가 2개 있어요')
    expect(text).not.toContain('관련 복지도')
  })
  it('금액은 정밀추천(POL-) 강력추천 현금성만 보수 합산 — 관련 복지 금액은 합치지 않는다', () => {
    const res = result([pol('POL-001', '기초연금', 'high', '월 30만원 현금 지급'), pol('GOV-1', '관련복지', 'high', '월 100만원')])
    const text = buildVoiceDiagText(res)
    expect(text).toContain('월 30만원')
    expect(text).not.toContain('130만원')
  })
  it('실엔진 종단: 통화 진단 문장의 낭독 개수 = 결과 화면 primary 개수(총계와 어긋나지 않음)', () => {
    const res = runAnalysis(parseProfileFromText('72세 혼자 사는데 소득이 적어요'))
    const primary = res.eligible_policies.filter((p) => /^POL-/.test(p.id))
    expect(primary.length).toBeGreaterThan(0)
    const text = buildVoiceDiagText(res)
    expect(text).toContain(`복지가 ${primary.length}개 있어요`)
    if (res.eligible_policies.length !== primary.length) {
      expect(text).not.toContain(`복지가 ${res.eligible_policies.length}개`)
      expect(text).toContain(`관련 복지도 ${res.eligible_policies.length - primary.length}개`)
    }
  })
})
