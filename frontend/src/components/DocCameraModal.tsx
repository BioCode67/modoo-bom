import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Camera, RotateCw, Trash2, Crop, Check, Loader2, ImagePlus, AlertCircle } from 'lucide-react'
import { useModalFocus } from '@/hooks/useModalFocus'
import { enhanceImageData, dataUrlToBytes, jpegPagesToPdf, type PdfPage } from '@/lib/docScan'

const MAX_EDGE = 1600 // 다운스케일 상한(제출용으로 충분 + PDF 용량·처리 절감)
const JPEG_Q = 0.85

interface Shot { canvas: HTMLCanvasElement; thumb: string }

/** 원본 이미지를 비율 유지로 MAX_EDGE 안에 맞춰 캔버스에 그린다(원본 픽셀 보관 — 흑백 토글이 되돌릴 수 있게). */
function drawScaled(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale))
  const c = document.createElement('canvas')
  c.width = cw; c.height = ch
  c.getContext('2d')!.drawImage(src, 0, 0, cw, ch)
  return c
}

/** 서류 촬영 모달 — 폰/웹캠으로 여러 장 찍어 보정 후 제출용 PDF로 만든다. 완성 PDF 바이트를 onComplete로 넘긴다.
 *  촬영·보정·PDF 생성 전부 브라우저 안에서(서버 전송 없음). getUserMedia 불가 시 파일선택(카메라 촬영 포함)으로 폴백. */
export function DocCameraModal({ docName, onClose, onComplete }: {
  docName: string
  onComplete: (pdf: Uint8Array) => Promise<void> | void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocus(panelRef, true, onClose)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [grayscale, setGrayscale] = useState(false)
  const [camErr, setCamErr] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setLive(false)
  }, [])

  // 카메라 시작 — 후면 카메라 우선. 거부/미지원이면 파일선택 폴백 안내.
  useEffect(() => {
    let cancelled = false
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!md || !md.getUserMedia) { setCamErr('이 브라우저에선 카메라를 못 열어요 — 아래 “사진 선택”으로 촬영/등록하세요.'); return }
    md.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const v = videoRef.current
        if (v) { v.srcObject = stream; v.play().catch(() => {}) }
        setLive(true)
      })
      .catch((e) => {
        const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : ''
        setCamErr(name === 'NotAllowedError'
          ? '카메라 권한이 거부됐어요 — 브라우저 주소창의 카메라 허용 후 다시 열거나, 아래 “사진 선택”을 쓰세요.'
          : '카메라를 열 수 없어요 — 아래 “사진 선택”으로 촬영/등록하세요.')
      })
    return () => { cancelled = true; stopCam() }
  }, [stopCam])

  const addShot = (canvas: HTMLCanvasElement) => {
    const thumb = canvas.toDataURL('image/jpeg', 0.6)
    setShots((s) => [...s, { canvas, thumb }])
  }

  // 라이브 프레임 촬영
  const capture = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    addShot(drawScaled(v, v.videoWidth, v.videoHeight))
  }

  // 파일선택 폴백(모바일은 카메라 촬영도 뜸) — 여러 장 지원.
  //   ⚠️ CSP img-src에 blob:이 없어(정책상 'data: https:'만) createObjectURL(blob:)은 이미지 로드가 차단된다 →
  //   FileReader로 data: URL을 만들어 로드한다(허용 스킴). 실측: blob: 경로는 사진 선택이 조용히 실패했다.
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    for (const f of files) {
      try {
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f)
        })
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUrl
        })
        addShot(drawScaled(img, img.naturalWidth, img.naturalHeight))
      } catch { /* 개별 파일 실패는 건너뜀 */ }
    }
  }

  // 촬영본 90° 회전(가로로 찍힌 신분증·계약서를 세워 제출) — 저장 캔버스를 회전본으로 교체.
  const rotateShot = (i: number) => setShots((s) => s.map((shot, idx) => {
    if (idx !== i) return shot
    const src = shot.canvas
    const c = document.createElement('canvas')
    c.width = src.height; c.height = src.width // 90° 회전 → 가로·세로 교환
    const ctx = c.getContext('2d')!
    ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(src, 0, 0)
    return { canvas: c, thumb: c.toDataURL('image/jpeg', 0.6) }
  }))

  const removeShot = (i: number) => setShots((s) => s.filter((_, idx) => idx !== i))

  // ✂️ 촬영본 자르기(옵트인) — 배경(책상·여백)을 잘라 서류만 남긴다.
  //   ⚠️ 기본은 '자르지 않음'(build는 shot.canvas 원본 사용) → 안 쓰면 현재 동작 그대로라 데모 흐름 불변.
  const [cropIdx, setCropIdx] = useState<number | null>(null)
  const [crop, setCrop] = useState({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 }) // 이미지 대비 비율(0~1)
  const cropContRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ mode: string; sx: number; sy: number; box: { x: number; y: number; w: number; h: number } } | null>(null)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const openCrop = (i: number) => { setCrop({ x: 0.06, y: 0.06, w: 0.88, h: 0.88 }); setCropIdx(i) }
  const startCropDrag = (mode: string) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, box: { ...crop } }
  }
  const onCropMove = (e: React.PointerEvent) => {
    const d = dragRef.current, cont = cropContRef.current
    if (!d || !cont) return
    const r = cont.getBoundingClientRect()
    if (!r.width || !r.height) return
    const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height
    let { x, y, w, h } = d.box
    const MIN = 0.12
    if (d.mode === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h) }
    else {
      if (d.mode.includes('l')) { const nx = clamp(x + dx, 0, x + w - MIN); w += x - nx; x = nx }
      if (d.mode.includes('r')) { w = clamp(w + dx, MIN, 1 - x) }
      if (d.mode.includes('t')) { const ny = clamp(y + dy, 0, y + h - MIN); h += y - ny; y = ny }
      if (d.mode.includes('b')) { h = clamp(h + dy, MIN, 1 - y) }
    }
    setCrop({ x, y, w, h })
  }
  const endCropDrag = () => { dragRef.current = null }
  const handleStyle = (h: string): React.CSSProperties => {
    const st: React.CSSProperties = { cursor: (h === 'tl' || h === 'br') ? 'nwse-resize' : 'nesw-resize' }
    if (h.includes('t')) st.top = -12; else st.bottom = -12
    if (h.includes('l')) st.left = -12; else st.right = -12
    return st
  }
  const applyCrop = () => {
    if (cropIdx === null) return
    const i = cropIdx
    setShots((s) => s.map((shot, idx) => {
      if (idx !== i) return shot
      const src = shot.canvas
      const cx = Math.round(crop.x * src.width), cy = Math.round(crop.y * src.height)
      const cw = Math.max(1, Math.round(crop.w * src.width)), ch = Math.max(1, Math.round(crop.h * src.height))
      const c = document.createElement('canvas'); c.width = cw; c.height = ch
      c.getContext('2d')!.drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch)
      return { canvas: c, thumb: c.toDataURL('image/jpeg', 0.6) }
    }))
    setCropIdx(null)
  }

  // 보정 적용 → JPEG 바이트 → PDF 조립 → onComplete
  const build = async () => {
    if (!shots.length || busy) return
    setBusy(true)
    try {
      const pages: PdfPage[] = []
      for (const shot of shots) {
        const c = shot.canvas
        const ctx = c.getContext('2d')!
        const id = ctx.getImageData(0, 0, c.width, c.height)
        enhanceImageData(id, { grayscale }) // 자동 대비(+선택 흑백)
        const out = document.createElement('canvas')
        out.width = c.width; out.height = c.height
        out.getContext('2d')!.putImageData(id, 0, 0)
        pages.push({ jpeg: dataUrlToBytes(out.toDataURL('image/jpeg', JPEG_Q)), width: c.width, height: c.height })
      }
      const pdf = jpegPagesToPdf(pages)
      stopCam()
      await onComplete(pdf)
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <>
    <AnimatePresence>
      <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div
          className="card-cute w-full max-w-lg max-h-[92vh] overflow-auto nice-scroll"
          initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
          onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${docName} 촬영`}
          ref={panelRef} tabIndex={-1}
        >
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-sprout-100 px-5 py-3.5 flex items-center justify-between">
            <h2 className="font-extrabold text-base flex items-center gap-2"><Camera className="h-5 w-5 text-sky2-500" /> {docName} 촬영</h2>
            <button onClick={onClose} aria-label="닫기" className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>

          <div className="p-4 space-y-3">
            {/* 카메라 미리보기 또는 폴백 안내 */}
            {!camErr ? (
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-[3/4] max-h-[46vh] mx-auto">
                <video ref={videoRef} playsInline autoPlay muted className="h-full w-full object-cover" />
                {/* 정렬 가이드 프레임 */}
                <div className="pointer-events-none absolute inset-4 border-2 border-white/70 rounded-xl" aria-hidden="true" />
                {!live && <div className="absolute inset-0 grid place-items-center text-white/80 text-sm"><Loader2 className="h-5 w-5 animate-spin" /></div>}
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{camErr}</span>
              </div>
            )}

            {/* 촬영/사진선택 버튼 */}
            <div className="flex items-center justify-center gap-2">
              {live && (
                <button onClick={capture} className="btn-primary !px-5 !py-2.5 text-sm"><Camera className="h-4 w-4" /> 촬영</button>
              )}
              <button onClick={() => fileRef.current?.click()} className="btn-secondary !px-4 !py-2.5 text-sm">
                <ImagePlus className="h-4 w-4" /> 사진 선택
              </button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onFiles} />
            </div>

            {/* 찍은 장 미리보기 */}
            {shots.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">{shots.length}장 · 순서대로 한 PDF로 합쳐요</p>
                  <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none">
                    <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} className="accent-sky2-500" />
                    흑백 문서(계약서 권장)
                  </label>
                </div>
                <div className="flex gap-2 overflow-x-auto nice-scroll pb-1">
                  {shots.map((s, i) => (
                    <div key={i} className="relative shrink-0">
                      <img src={s.thumb} alt={`${i + 1}쪽`} className={`h-24 w-auto rounded-lg border-2 border-sprout-100 ${grayscale ? 'grayscale contrast-125' : ''}`} />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                      {/* 90° 회전 — 가로로 찍힌 신분증·계약서 세우기 */}
                      <button onClick={() => rotateShot(i)} aria-label={`${i + 1}쪽 90도 회전`} title="90° 회전"
                        className="absolute -left-1.5 -top-1.5 rounded-full bg-sky2-500 p-1 text-white shadow hover:bg-sky2-600">
                        <RotateCw className="h-3 w-3" />
                      </button>
                      <button onClick={() => removeShot(i)} aria-label={`${i + 1}쪽 삭제`} title="이 장 삭제(다시 찍기)"
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-500 p-1 text-white shadow hover:bg-rose-600">
                        <Trash2 className="h-3 w-3" />
                      </button>
                      {/* ✂️ 자르기 — 배경(책상·여백) 제거해 서류만 남기기 */}
                      <button onClick={() => openCrop(i)} aria-label={`${i + 1}쪽 자르기`} title="자르기(배경 제거)"
                        className="absolute -left-1.5 -bottom-1.5 rounded-full bg-sprout-500 p-1 text-white shadow hover:bg-sprout-600">
                        <Crop className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              📸 촬영본은 자동 대비 보정 후 <b>제출용 PDF</b>로 만들어져요. 신분증은 <b>앞·뒤 2장</b>, 계약서는 페이지마다 한 장씩 찍으세요.
              가로로 찍혔으면 <b>↻</b>로 세우고, 배경이 넓으면 <b>✂️</b>로 서류만 잘라내세요. 모든 처리는 <b>이 기기 안에서</b>만 이뤄져요(사진은 서버로 안 보내요).
            </p>

            <button onClick={build} disabled={!shots.length || busy} className="btn-primary w-full !py-2.5 text-sm justify-center disabled:opacity-50">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> 제출문서 만드는 중…</> : <><Check className="h-4 w-4" /> 제출문서로 만들기 ({shots.length}장)</>}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>

    {/* ✂️ 자르기 편집기 — 모서리를 끌어 서류 영역만 남긴다. 적용 시 해당 장 캔버스를 잘라 교체. */}
    {cropIdx !== null && shots[cropIdx] && (
      <div className="fixed inset-0 z-[70] bg-black/85 flex flex-col items-center justify-center gap-3 p-4"
        onPointerMove={onCropMove} onPointerUp={endCropDrag} onPointerLeave={endCropDrag}
        role="dialog" aria-modal="true" aria-label="서류 자르기">
        <p className="text-white text-sm font-semibold">모서리를 끌어 <b className="text-sprout-300">서류 부분만</b> 남기세요</p>
        <div ref={cropContRef} className="relative touch-none select-none">
          <img src={shots[cropIdx].thumb} alt="자를 이미지" draggable={false} className="block max-w-[92vw] max-h-[62vh] w-auto h-auto rounded" />
          {/* 바깥 어둡게 */}
          <div className="pointer-events-none absolute inset-0 bg-black/45"
            style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${crop.x * 100}% ${crop.y * 100}%, ${crop.x * 100}% ${(crop.y + crop.h) * 100}%, ${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%, ${(crop.x + crop.w) * 100}% ${crop.y * 100}%, ${crop.x * 100}% ${crop.y * 100}%)` }} />
          <div className="absolute border-2 border-sprout-400 bg-sprout-400/5 cursor-move"
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
            onPointerDown={startCropDrag('move')}>
            {(['tl', 'tr', 'bl', 'br'] as const).map((h) => (
              <span key={h} onPointerDown={startCropDrag(h)}
                className="absolute h-6 w-6 rounded-full bg-white border-2 border-sprout-500 shadow" style={handleStyle(h)} />
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCropIdx(null)} className="btn-secondary !px-5 !py-2 text-sm">취소</button>
          <button onClick={applyCrop} className="btn-primary !px-5 !py-2 text-sm"><Crop className="h-4 w-4" /> 자르기 적용</button>
        </div>
      </div>
    )}
    </>
  )
}
