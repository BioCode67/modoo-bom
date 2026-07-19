// 서류 촬영 → 제출용 문서 만들기 — 전부 브라우저 안에서 처리(서버 전송 없음, 프라이버시).
//   ① 자동 대비/흑백 보정으로 폰 사진을 '스캔처럼' 읽기 좋게, ② 여러 장을 A4 PDF 한 장씩으로 합쳐 저장.
//   ⚠️ 원근 자동보정('네 귀 인식') 같은 건 넣지 않는다 — 없는 기능을 있는 척하지 않는다(정직성).
//   문서영역 자동 감지(detectDocRegion)는 밝기 기반 '직사각 경계 제안'까지만이며 그렇게만 표기한다.

/** 자동 대비 경계(저/고 퍼센타일)를 명도 히스토그램에서 구한다 — 스캔 느낌의 대비 스트레치용. */
export function contrastBounds(hist: number[], total: number, cut = 0.02): { lo: number; hi: number } {
  let acc = 0
  let lo = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v] || 0
    if (acc >= total * cut) { lo = v; break }
  }
  acc = 0
  let hi = 255
  for (let v = 255; v >= 0; v--) {
    acc += hist[v] || 0
    if (acc >= total * cut) { hi = v; break }
  }
  if (hi <= lo) { lo = 0; hi = 255 } // 균일 이미지 보호(0 나눗셈 방지)
  return { lo, hi }
}

/** 폰 사진 보정 — 명도 히스토그램 스트레치(자동 대비) + 선택적 흑백. ImageData 제자리 수정 후 반환.
 *  흑백 모드는 계약서·인쇄물 가독을 높이고, 컬러 모드는 신분증(색·홀로그램)을 보존한다. */
export function enhanceImageData(img: { data: Uint8ClampedArray | number[]; width: number; height: number }, opts: { grayscale?: boolean } = {}): typeof img {
  const d = img.data
  const n = d.length
  const hist = new Array(256).fill(0)
  for (let i = 0; i < n; i += 4) {
    const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    hist[y < 0 ? 0 : y > 255 ? 255 : y]++
  }
  const total = n / 4
  const { lo, hi } = contrastBounds(hist, total)
  const scale = 255 / (hi - lo)
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
  for (let i = 0; i < n; i += 4) {
    if (opts.grayscale) {
      const y = clamp((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 - lo) * scale)
      d[i] = d[i + 1] = d[i + 2] = y
    } else {
      d[i] = clamp((d[i] - lo) * scale)
      d[i + 1] = clamp((d[i + 1] - lo) * scale)
      d[i + 2] = clamp((d[i + 2] - lo) * scale)
    }
    // 알파(d[i+3])는 유지
  }
  return img
}

export interface NormRect { x: number; y: number; w: number; h: number } // 이미지 대비 비율(0~1)

/**
 * 📄 문서 영역 자동 감지 — '어두운 배경 위의 밝은 서류'를 밝기 기준으로 찾아 잘라낼 영역을 제안한다.
 *
 * 정직성: 이것은 원근 보정도, AI 인식도 아니다. Otsu 임계값으로 밝은 픽셀을 가르고
 * 행/열 프로파일에서 밝은 픽셀이 충분한 연속 구간을 경계로 삼는 단순·견고한 휴리스틱이다.
 * 배경이 서류만큼 밝거나(흰 책상) 서류가 프레임을 꽉 채우면 null — 그땐 수동 자르기가 정답.
 * 반환은 이미지 대비 비율(0~1) 사각형(자르기 편집기의 초기 박스로 그대로 사용).
 */
export function detectDocRegion(img: { data: Uint8ClampedArray | number[]; width: number; height: number }): NormRect | null {
  const { data: d, width: W, height: H } = img
  if (!W || !H) return null
  // ① 명도 히스토그램 → Otsu 임계값(클래스 간 분산 최대)
  const hist = new Array(256).fill(0)
  const lum = new Uint8Array(W * H)
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    lum[p] = y
    hist[y]++
  }
  const total = W * H
  let sumAll = 0
  for (let v = 0; v < 256; v++) sumAll += v * hist[v]
  let wB = 0, sumB = 0, best = 0, thr = 127
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += v * hist[v]
    const mB = sumB / wB, mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thr = v }
  }
  // ② 행/열 프로파일 — 임계 초과(밝은) 픽셀 수가 축 길이의 35%를 넘는 연속 구간을 경계로
  const rows = new Array(H).fill(0)
  const cols = new Array(W).fill(0)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (lum[y * W + x] > thr) { rows[y]++; cols[x]++ }
    }
  }
  const band = (profile: number[], need: number): [number, number] | null => {
    let first = -1, last = -1
    for (let i = 0; i < profile.length; i++) {
      if (profile[i] >= need) { if (first < 0) first = i; last = i }
    }
    return first < 0 ? null : [first, last]
  }
  const rband = band(rows, W * 0.35)
  const cband = band(cols, H * 0.35)
  if (!rband || !cband) return null
  const box = { x: cband[0] / W, y: rband[0] / H, w: (cband[1] - cband[0] + 1) / W, h: (rband[1] - rband[0] + 1) / H }
  const area = box.w * box.h
  // ③ 신뢰 게이트 — 프레임의 15% 미만(서류가 아니라 반사·조각)이거나 92% 초과(경계 구분 실패)는 제안하지 않는다
  if (area < 0.15 || area > 0.92) return null
  return box
}

/** 드래그 두 점(비율 좌표) → 정규화 사각형. 방향 무관·0~1 클램프, 너무 작으면(가림 실수) null. */
export function normRectFromDrag(ax: number, ay: number, bx: number, by: number, minSize = 0.015): NormRect | null {
  const cl = (v: number) => Math.max(0, Math.min(1, v))
  const x1 = cl(Math.min(ax, bx)), y1 = cl(Math.min(ay, by))
  const x2 = cl(Math.max(ax, bx)), y2 = cl(Math.max(ay, by))
  const w = x2 - x1, h = y2 - y1
  if (w < minSize || h < minSize) return null
  return { x: x1, y: y1, w, h }
}

/** 🖍 가림(마스킹) — 비율 사각형들을 ImageData에 검정으로 채운다(주민번호 뒷자리 등 민감정보 제거).
 *  픽셀을 실제로 덮어쓴 뒤 JPEG로 저장되므로 '지운 척'이 아니라 원본 정보가 파일에 남지 않는다. */
export function applyMaskRects(img: { data: Uint8ClampedArray | number[]; width: number; height: number }, rects: NormRect[]): typeof img {
  const { data: d, width: W, height: H } = img
  for (const r of rects) {
    const x1 = Math.max(0, Math.floor(r.x * W)), y1 = Math.max(0, Math.floor(r.y * H))
    const x2 = Math.min(W, Math.ceil((r.x + r.w) * W)), y2 = Math.min(H, Math.ceil((r.y + r.h) * H))
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const i = (y * W + x) * 4
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0 // 알파는 유지
      }
    }
  }
  return img
}

/** data URL('data:image/jpeg;base64,...')에서 순수 바이트 추출. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(0, comma)
  const data = dataUrl.slice(comma + 1)
  if (/;base64/i.test(meta)) {
    const bin = atob(data)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(decodeURIComponent(data))
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Uint8Array(len)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

export interface PdfPage { jpeg: Uint8Array; width: number; height: number }

/** 여러 JPEG 페이지를 A4 PDF 한 장씩으로 합친다. JPEG 바이트를 DCTDecode로 '그대로' 임베드(재인코딩 없음 →
 *  화질 손실·용량 증가 없음). 각 페이지는 A4에 여백 두고 비율 유지로 가운데 배치. 표준 PDF 1.3 구조. */
export function jpegPagesToPdf(pages: PdfPage[]): Uint8Array {
  const A4W = 595, A4H = 842, M = 24 // A4(pt), 여백
  const enc = (s: string) => new TextEncoder().encode(s)
  const chunks: Uint8Array[] = []
  let offset = 0
  const offsets: number[] = []
  const push = (u: Uint8Array) => { chunks.push(u); offset += u.length }
  const pushObj = (num: number, body: Uint8Array) => {
    offsets[num] = offset
    push(enc(`${num} 0 obj\n`))
    push(body)
    push(enc(`\nendobj\n`))
  }

  const objs: { num: number; body: Uint8Array }[] = []
  const kids: number[] = []
  let next = 3 // 1=catalog, 2=pages
  for (const { jpeg, width, height } of pages) {
    const maxW = A4W - 2 * M, maxH = A4H - 2 * M
    const s = Math.min(maxW / width, maxH / height)
    const w = width * s, h = height * s
    const x = (A4W - w) / 2, y = (A4H - h) / 2
    const imgNum = next++, contentNum = next++, pageNum = next++
    kids.push(pageNum)
    objs.push({ num: imgNum, body: concatBytes([
      enc(`<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>\nstream\n`),
      jpeg,
      enc(`\nendstream`),
    ]) })
    const content = enc(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`)
    objs.push({ num: contentNum, body: concatBytes([enc(`<</Length ${content.length}>>\nstream\n`), content, enc(`\nendstream`)]) })
    objs.push({ num: pageNum, body: enc(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${A4W} ${A4H}]/Resources<</XObject<</Im0 ${imgNum} 0 R>>>>/Contents ${contentNum} 0 R>>`) })
  }

  const allObjs = [
    { num: 1, body: enc(`<</Type/Catalog/Pages 2 0 R>>`) },
    { num: 2, body: enc(`<</Type/Pages/Kids[${kids.map((k) => `${k} 0 R`).join(' ')}]/Count ${pages.length}>>`) },
    ...objs,
  ].sort((a, b) => a.num - b.num)

  push(enc(`%PDF-1.3\n`))
  for (const o of allObjs) pushObj(o.num, o.body)
  const xrefOffset = offset
  const count = allObjs.length + 1 // 0번(free) 포함
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  push(enc(xref))
  push(enc(`trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`))
  return concatBytes(chunks)
}
