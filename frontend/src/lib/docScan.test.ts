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

// ── 신규: 문서영역 자동 감지 + 마스킹 (2026-07-19 서류 인식 축) ──────────────────

import { detectDocRegion, normRectFromDrag, applyMaskRects } from './docScan'

/** 합성 이미지: W×H를 bg 명도로 채우고, 지정 사각형만 fg 명도로. */
function synth(W: number, H: number, bg: number, fg?: { x: number; y: number; w: number; h: number; v: number }) {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    let v = bg
    if (fg && x >= fg.x && x < fg.x + fg.w && y >= fg.y && y < fg.y + fg.h) v = fg.v
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255
  }
  return { data, width: W, height: H }
}

describe('detectDocRegion — 밝기 기반 문서영역 제안', () => {
  it('어두운 배경 위 밝은 서류의 경계를 찾는다(±2px 허용)', () => {
    const img = synth(100, 100, 25, { x: 20, y: 30, w: 60, h: 55, v: 235 })
    const r = detectDocRegion(img)
    expect(r).not.toBeNull()
    expect(Math.abs(r!.x * 100 - 20)).toBeLessThanOrEqual(2)
    expect(Math.abs(r!.y * 100 - 30)).toBeLessThanOrEqual(2)
    expect(Math.abs(r!.w * 100 - 60)).toBeLessThanOrEqual(3)
    expect(Math.abs(r!.h * 100 - 55)).toBeLessThanOrEqual(3)
  })
  it('균일 이미지(경계 없음)·프레임 꽉 참·조각(15% 미만)은 제안하지 않는다', () => {
    expect(detectDocRegion(synth(80, 80, 30))).toBeNull()                                     // 균일
    expect(detectDocRegion(synth(80, 80, 25, { x: 1, y: 1, w: 78, h: 78, v: 235 }))).toBeNull() // 꽉 참(>92%)
    expect(detectDocRegion(synth(80, 80, 25, { x: 35, y: 35, w: 8, h: 8, v: 235 }))).toBeNull() // 조각(<15%)
  })
})

describe('normRectFromDrag — 드래그 사각형 정규화', () => {
  it('역방향 드래그도 좌상단 기준으로 정규화하고 0~1로 클램프한다', () => {
    expect(normRectFromDrag(0.8, 0.7, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: expect.closeTo(0.6), h: expect.closeTo(0.6) })
    const r = normRectFromDrag(-0.2, 0.5, 0.5, 1.4)
    expect(r!.x).toBe(0)
    expect(r!.y).toBe(0.5)
    expect(r!.x + r!.w).toBeLessThanOrEqual(1)
    expect(r!.y + r!.h).toBeLessThanOrEqual(1)
  })
  it('너무 작은(실수 클릭) 사각형은 null', () => {
    expect(normRectFromDrag(0.5, 0.5, 0.505, 0.505)).toBeNull()
  })
})

describe('applyMaskRects — 민감정보 가림(픽셀 덮어쓰기)', () => {
  it('사각형 안은 검정, 밖은 원본 유지 — 알파 보존', () => {
    const img = synth(10, 10, 200)
    applyMaskRects(img, [{ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }])
    const at = (x: number, y: number) => { const i = (y * 10 + x) * 4; return [img.data[i], img.data[i + 3]] }
    expect(at(3, 3)).toEqual([0, 255])   // 안 — 검정+알파 유지
    expect(at(8, 8)).toEqual([200, 255]) // 밖 — 원본
  })
})
