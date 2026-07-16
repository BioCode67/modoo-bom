import { describe, it, expect } from 'vitest'
import { contrastBounds, enhanceImageData, dataUrlToBytes, jpegPagesToPdf, type PdfPage } from './docScan'

const latin1 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return s }

describe('contrastBounds', () => {
  it('저/고 퍼센타일 경계를 찾는다', () => {
    const hist = new Array(256).fill(0)
    for (let v = 50; v <= 200; v++) hist[v] = 10 // 50~200에 균등 분포
    const total = 151 * 10
    const { lo, hi } = contrastBounds(hist, total, 0.02)
    expect(lo).toBeGreaterThanOrEqual(50)
    expect(lo).toBeLessThan(60)
    expect(hi).toBeGreaterThan(190)
    expect(hi).toBeLessThanOrEqual(200)
  })
  it('균일 이미지는 0~255로 보호(0 나눗셈 방지)', () => {
    const hist = new Array(256).fill(0); hist[128] = 1000
    const { lo, hi } = contrastBounds(hist, 1000)
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('enhanceImageData', () => {
  const mk = (vals: number[]) => {
    // vals = 픽셀당 회색값 → RGBA로 확장
    const data = new Uint8ClampedArray(vals.length * 4)
    vals.forEach((v, i) => { data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255 })
    return { data, width: vals.length, height: 1 }
  }
  it('대비를 넓혀 어두운 사진을 밝게(스캔 느낌)', () => {
    const img = mk([100, 110, 120, 130, 140]) // 좁은 중간톤
    enhanceImageData(img)
    const outs = [0, 1, 2, 3, 4].map((i) => img.data[i * 4])
    expect(Math.min(...outs)).toBeLessThan(100) // 최저가 더 어두워지고
    expect(Math.max(...outs)).toBeGreaterThan(140) // 최고가 더 밝아짐 → 대비 확장
    expect(img.data[3]).toBe(255) // 알파 보존
  })
  it('흑백 모드는 R=G=B로 만든다', () => {
    const img = { data: new Uint8ClampedArray([200, 50, 50, 255, 50, 200, 50, 255]), width: 2, height: 1 }
    enhanceImageData(img, { grayscale: true })
    expect(img.data[0]).toBe(img.data[1])
    expect(img.data[1]).toBe(img.data[2])
    expect(img.data[4]).toBe(img.data[5])
  })
})

describe('dataUrlToBytes', () => {
  it('base64 data URL을 바이트로', () => {
    // 'PDF' = UERG in base64
    const bytes = dataUrlToBytes('data:image/jpeg;base64,' + btoa('PDF'))
    expect(latin1(bytes)).toBe('PDF')
  })
})

describe('jpegPagesToPdf — 여러 사진을 A4 PDF로', () => {
  const fakeJpeg = (tag: number) => new Uint8Array([0xff, 0xd8, 0xff, tag, 1, 2, 3, 0xff, 0xd9])
  const pages: PdfPage[] = [
    { jpeg: fakeJpeg(0xe0), width: 1200, height: 1600 },
    { jpeg: fakeJpeg(0xe1), width: 1600, height: 1200 },
  ]

  it('유효한 PDF 골격(%PDF…%%EOF) + 페이지 수', () => {
    const pdf = jpegPagesToPdf(pages)
    const s = latin1(pdf)
    expect(s.startsWith('%PDF-1.3')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(s).toContain('/Count 2')
    expect((s.match(/\/Type\/Page[^s]/g) || []).length).toBe(2) // Page 2개(Pages 제외)
    expect(s).toContain('/Filter/DCTDecode') // JPEG 임베드
  })

  it('JPEG 바이트가 재인코딩 없이 그대로 들어간다', () => {
    const pdf = jpegPagesToPdf(pages)
    const s = latin1(pdf)
    expect(s).toContain(latin1(pages[0].jpeg))
    expect(s).toContain(latin1(pages[1].jpeg))
  })

  it('xref 오프셋이 실제 "N 0 obj" 위치를 정확히 가리킨다(뷰어 파싱 성립)', () => {
    const pdf = jpegPagesToPdf(pages)
    const s = latin1(pdf)
    const m = s.match(/startxref\s+(\d+)/)
    expect(m).toBeTruthy()
    const xrefStart = Number(m![1])
    // xref 헤더 파싱: "xref\n0 COUNT\n" 이후 각 줄 "OOOOOOOOOO GGGGG n "
    const xrefText = s.slice(xrefStart)
    const cm = xrefText.match(/^xref\s+0\s+(\d+)/)
    expect(cm).toBeTruthy()
    const count = Number(cm![1])
    const entryRe = /(\d{10}) (\d{5}) (n|f) /g
    const entries: { off: number; type: string }[] = []
    let em: RegExpExecArray | null
    while ((em = entryRe.exec(xrefText)) && entries.length < count) entries.push({ off: Number(em[1]), type: em[3] })
    expect(entries.length).toBe(count)
    expect(entries[0].type).toBe('f') // 0번은 free
    // 1..count-1: 오프셋 위치의 바이트가 정확히 "i 0 obj"로 시작해야 한다
    for (let i = 1; i < count; i++) {
      expect(entries[i].type).toBe('n')
      expect(s.slice(entries[i].off, entries[i].off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`)
    }
  })
})
