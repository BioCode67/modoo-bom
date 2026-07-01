import { describe, it, expect } from 'vitest'
import { detectLang } from './detectLang'

describe('detectLang', () => {
  it('빈 문자열은 null', () => {
    expect(detectLang('')).toBeNull()
    expect(detectLang('   ')).toBeNull()
  })

  it('한국어 감지', () => {
    expect(detectLang('노인인데 돈이 없어요')?.code).toBe('ko')
  })

  it('영어 감지', () => {
    expect(detectLang('I lost my job and need help')?.code).toBe('en')
  })

  it('베트남어 감지(성조 문자)', () => {
    expect(detectLang('Tôi là người khuyết tật')?.code).toBe('vi')
    expect(detectLang('Tôi cần hỗ trợ tiền thuê nhà')?.code).toBe('vi')
  })

  it('중국어(한자) 감지', () => {
    expect(detectLang('我需要帮助')?.code).toBe('zh')
  })

  it('일본어(가나) 감지', () => {
    expect(detectLang('お金がありません')?.code).toBe('ja')
  })

  it('한글이 섞이면 한국어 우선', () => {
    expect(detectLang('welfare 복지 help')?.code).toBe('ko')
  })

  it('감지 결과에 라벨·국기 포함', () => {
    const d = detectLang('xin chào tôi cần giúp đỡ')
    expect(d?.label).toBe('Tiếng Việt')
    expect(d?.flag).toBe('🇻🇳')
  })
})
