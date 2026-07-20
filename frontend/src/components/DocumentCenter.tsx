import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, ExternalLink, Bot, Loader2, CheckCircle2, AlertCircle, Check, Undo2 } from 'lucide-react'
import { getPolicyMap } from '@/data/catalog'
import { useAppStore } from '@/store/useAppStore'
import { docLink, isRpaSupported, isCertIssuable, certKind, CERT_WALLET, isApplyAutomatable, LOCAL_RPA_DOCS, setLocalRpaDocs, isLocalBetaDoc } from '@/lib/officialLinks'
import { issuableCanonical, substituteIssuableDoc } from '@/lib/docAliases'
import { isBokjiroApplyable, bestApplyUrl } from '@/lib/quickApply'
import { getRpaBase } from '@/lib/backend'
import { useBackend } from '@/lib/useBackend'
import { detectExtension, issueViaExtension, issueManyViaExtension, getExtensionTrace, onExtensionStatus, sameDocName } from '@/lib/extension'
import { setPendingReturn } from '@/lib/returnPrompt'
import { RpaInfoForm } from '@/components/RpaInfoForm'
import { RemoteRpaSetup } from '@/components/RemoteRpaSetup'
import { DocCameraModal } from '@/components/DocCameraModal'
import { DocVault, notifyDocsChanged, DOCS_CHANGED_EVENT } from '@/components/DocVault'
import { ProbeCoverage, requestProbe } from '@/components/ProbeCoverage'
import { ISSUE_DOC_EVENT, ISSUE_ALL_EVENT, takePendingIssue, takePendingIssueAll } from '@/lib/issueBridge'
import { AgentStatusStrip } from '@/components/AgentStatusStrip'
import { rememberLive, forgetLive, listLive } from '@/lib/liveTasks'
import { downloadDocsBundle } from '@/lib/bundleDocs'
import { titleBadge } from '@/lib/titleBadge'
import { playAuthCue, isAuthWaitTransition } from '@/lib/authCue'
import { cn } from '@/lib/utils'

// 저장 경로를 사람이 읽게 축약 — '…/모두봄서류/주민등록등본_홍길동_2026-07-15_1430.pdf'
const shortPath = (p: string) => { const seg = p.split(/[\\/]/).filter(Boolean); return seg.length > 2 ? `…/${seg.slice(-2).join('/')}` : p }

type RpaState = {
  status: string
  step: string
  at?: number
  taskId?: string
  saved?: boolean
  downloadToken?: string
  shot?: string
  stepsTail?: string[]
  savedPath?: string
  success?: boolean
  resultStatus?: string
  filledFields?: string[]
  attachedDocs?: string[]
  manualApply?: boolean
} | null

// 폴링이 끝났는데(상한 도달·404·연속실패) 아직 running/대기인 카드를 정직한 안내로 확정 —
// '침묵 스피너 영구고정'(감사 :208/:247)을 막는다. 이미 완료/오류/취소된 카드는 그대로 둔다.
function markRemainingStuck(prev: Record<string, RpaState>, docs: string[], msg: string): Record<string, RpaState> {
  const next = { ...prev }
  for (const d of docs) {
    const st = next[d]
    if (st && !['done', 'completed', 'error', 'cancelled'].includes(st.status)) {
      next[d] = { ...st, status: 'error', step: msg }
    }
  }
  return next
}

export function DocumentCenter() {
  const { tracked, profile, rpaInfo, toggleDocDone, isDocDone, setStatus } = useAppStore()
  const { ready, caps } = useBackend()
  const localAgent = ready === true && !!caps?.rpa   // RPA 가능한 에이전트(원격 옵트인 포함)
  // 🔒 서류함 계열(목록·등록·삭제)은 '내 PC' 에이전트에서만 — 원격(공유) RPA에선 서버 폴더에 다른
  //   이용자의 서류(실명 표시명)가 섞일 수 있어 조회·업로드하지 않는다(서버도 RPA_SHARED=1로 차단).
  const vaultOn = localAgent && !caps?.rpaRemote && !caps?.shared
  const [ext, setExt] = useState(false)              // 크롬 확장(브라우저 내 자동화)
  const backend = localAgent || ext                  // 둘 중 하나면 자동발급 노출
  const [rpa, setRpa] = useState<Record<string, RpaState>>({})
  const [diagCopied, setDiagCopied] = useState(false)
  // 🗂 동적 지원목록 — 에이전트의 rpa-supported로 승격(프로브 --register 확장분이 β로 즉시 반영).
  //   실패·웹 배포면 내장 15종 유지(기능 무손실). officialLinks 게이트(isRpaSupported/자동첨부 별칭)도 함께 갱신.
  const [localDocs, setLocalDocs] = useState<string[]>(LOCAL_RPA_DOCS)
  useEffect(() => {
    if (!localAgent) return
    let alive = true
    fetch(`${getRpaBase()}/api/documents/rpa-supported`)
      .then((r) => r.json())
      .then((d: { supported?: string[]; beta?: string[] }) => {
        if (!alive || !Array.isArray(d.supported) || d.supported.length === 0) return
        setLocalRpaDocs(d.supported, d.beta || [])
        setLocalDocs(d.supported)
      })
      .catch(() => { /* 미응답이면 내장 목록 그대로 — 정직 폴백 */ })
    return () => { alive = false }
  }, [localAgent])
  // 💬→🖨 챗 "등본 발급해줘"(단건)/"전부 발급해줘"(연쇄) 이어받기 — 뷰 전환 직후(마운트)의 보류분 +
  //   이미 떠 있을 때의 이벤트 모두. 실행 함수는 훅 구역보다 뒤에 정의되므로 ref로 최신 참조(TDZ·의존성 회피).
  const issueFnRef = useRef<(doc: string) => void>(() => {})
  const issueAllFnRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!localAgent) return // 에이전트 없이 보류분을 소모하면 발급 기회가 증발 — 남겨서 다음 마운트가 처리
    const onIssue = (e: Event) => {
      const doc = takePendingIssue() || String((e as CustomEvent).detail || '')
      if (doc) issueFnRef.current(doc)
    }
    const onIssueAll = () => { if (takePendingIssueAll()) issueAllFnRef.current() }
    window.addEventListener(ISSUE_DOC_EVENT, onIssue)
    window.addEventListener(ISSUE_ALL_EVENT, onIssueAll)
    const t = setTimeout(() => { // 마운트 직후 보류분 — 첫 렌더가 끝나 실행 함수 ref가 채워진 뒤에
      const pend = takePendingIssue()
      if (pend) issueFnRef.current(pend)
      if (takePendingIssueAll()) issueAllFnRef.current()
    }, 120)
    return () => {
      clearTimeout(t)
      window.removeEventListener(ISSUE_DOC_EVENT, onIssue)
      window.removeEventListener(ISSUE_ALL_EVENT, onIssueAll)
    }
  }, [localAgent])

  // '서류가 어디 저장되는지 모르겠다'(실사용 피드백) — 로컬 에이전트(내 PC)일 때만 탐색기 열기 제공
  const rpaBase = getRpaBase()
  const isLocalAgentBase = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(rpaBase)
    || (rpaBase === '' && typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname))
  const [folderMsg, setFolderMsg] = useState('')
  const openFolder = async () => {
    try {
      const r = await fetch(`${getRpaBase()}/api/documents/open-folder`, { method: 'POST' }).then((x) => x.json())
      setFolderMsg(r.opened ? '' : `저장 위치: ${r.path || ''}`)
    } catch {
      setFolderMsg('폴더 열기는 데스크탑 앱에서만 돼요 — 카드에 적힌 경로에서 파일을 찾아주세요.')
    }
  }
  // 언마운트 후 폴링이 계속 setState/fetch 하지 않도록 하는 가드('나의 복지'를 떠나면 중단)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  // 진행 중 여정 id/토큰 — [중단] 버튼이 여정 전체를 취소할 수 있게 보관(단건은 taskId로 취소)
  const journeyRef = useRef<{ id: string; running: boolean } | null>(null)
  // 여정 수준 진행률(n/m·현재 단계·인증 대기 여부) — 카드별 상태만으론 전체 흐름이 안 보이던 갭(감사). null=여정 없음.
  const [journeyProg, setJourneyProg] = useState<{ total: number; done: number; current?: string; authWait?: boolean } | null>(null)
  // 여정 종결 요약(발급 n건·건너뜀 n건·신청 양식 준비 n건) — 헤더가 사라진 뒤 '어떻게 끝났는지' 한 줄 닫음말.
  //   issued는 '발급물 폴더 열기' CTA 노출 판단용(실발급 0건이면 폴더를 열 이유가 없다).
  const [journeySummary, setJourneySummary] = useState<{ text: string; issued: number } | null>(null)
  // 🗂 자유 선택 일괄발급 — 담은 정책의 필요서류 밖이라도 지원 서류를 골라 한 번 인증으로 연쇄 발급
  const [pickOpen, setPickOpen] = useState(false)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [pickMsg, setPickMsg] = useState('')
  // 🚀→📨 발급 후 '자동신청까지' 이어갈 수 있는 담은 복지 — 단건 신청과 동일 기준(내장 6종 ∪ 복지로 딥링크 해석).
  //   백엔드 여정(service_names)이 서류 발급을 모두 마친 뒤 신청 단계를 이어서 실행한다(자동첨부 성립 순서).
  const chainSvcs = useMemo(() => {
    const map = getPolicyMap()
    const names: string[] = []
    for (const t of tracked) {
      const p = map[t.policyId]
      if (!p || t.status === 'applied' || t.status === 'done') continue // 이미 신청한 건 제외
      if ((isApplyAutomatable(p.name) || isBokjiroApplyable(p.application || '', p.name, p.id)) && !names.includes(p.name)) names.push(p.name)
    }
    return names
  }, [tracked])
  const [chainApply, setChainApply] = useState(true) // 발급 후 자동신청 연쇄(제출 전 정지) — 원클릭 전체 사이클

  // 📎/📷 내 서류함 — 자동발급 불가 서류(임대차계약서·신분증 등)를 사용자가 직접 등록/촬영 → 데스크탑앱이면
  //   로컬 서버가 발급 폴더에 같은 이름 규칙으로 저장 → 복지 신청의 자동첨부(recent_issued_docs)가 이 파일도
  //   찾아 붙인다. 웹(로컬 서버 없음)이면 파일로 내려받아 사용자가 신청 화면에서 직접 첨부.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const registerForRef = useRef<string | null>(null)
  const [registered, setRegistered] = useState<Record<string, string>>({}) // 서류명 -> 상태 메시지
  const [cameraFor, setCameraFor] = useState<string | null>(null) // 촬영 모달 대상 서류
  const pickFileFor = (doc: string) => { registerForRef.current = doc; fileInputRef.current?.click() }

  // 파일/촬영본(Blob)을 서류함에 등록(데스크탑) 또는 내려받기(웹) — 파일선택·촬영이 공유하는 단일 경로.
  const registerBlob = async (doc: string, blob: Blob, filename: string) => {
    setRegistered((s) => ({ ...s, [doc]: '등록 중…' }))
    try {
      if (!vaultOn) {
        // 웹/원격 RPA: 로컬 폴더가 없거나(웹) 공유 서버라(원격) 업로드하지 않는다 —
        // 파일로 내려받아 사용자가 신청 화면에서 직접 첨부하게 한다(정직한 폴백).
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1500)
        setRegistered((s) => ({ ...s, [doc]: `⬇️ ${filename} 저장됨 — 신청 화면에서 이 파일을 첨부하세요` }))
        if (!isDocDone(doc)) toggleDocDone(doc)
        return
      }
      const fd = new FormData()
      fd.append('doc_name', doc)
      fd.append('user_name', rpaInfo.name || profile?.name || '')
      fd.append('file', blob, filename)
      const res = await fetch(`${getRpaBase()}/api/documents/register`, { method: 'POST', body: fd })
      if (!res.ok) { const d = await res.json().then((x) => x?.detail).catch(() => ''); throw new Error(d || '등록에 실패했어요.') }
      const r = await res.json()
      setRegistered((s) => ({ ...s, [doc]: `✅ 등록됨 — 신청할 때 자동으로 첨부돼요 (${r.filename || filename})` }))
      if (!isDocDone(doc)) toggleDocDone(doc) // 준비 완료로 표시(체크리스트·신청 준비에 반영)
      notifyDocsChanged() // 🗂 내 서류함 즉시 갱신
    } catch (err) {
      setRegistered((s) => ({ ...s, [doc]: err instanceof Error ? err.message : '등록에 실패했어요.' }))
    }
  }
  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const doc = registerForRef.current
    e.target.value = '' // 같은 파일 다시 선택 가능하게 리셋
    if (file && doc) registerBlob(doc, file, file.name)
  }

  // ⏭ 여정 '현재 단계만' 건너뛰기 — 이 서류 발급만 접고 다음 단계로 계속(전체 중단과 구분).
  //   인증이 반복 실패하거나 지금 필요 없는 서류 하나 때문에 연쇄 전체를 끊지 않게 하는 탈출구.
  const skipCurrent = async () => {
    if (!journeyRef.current?.running) return
    try {
      const r = await fetch(`${getRpaBase()}/api/journey/skip/${journeyRef.current.id}`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      // 수락 실패(단계 전환 중 등)는 다음 폴링이 실상태를 그려주므로 조용히 둔다 — 거짓 '건너뜀' 표시 금지
      if (!j?.skipped) return
    } catch { /* 요청 실패 — 폴링이 계속 실상태를 반영 */ }
  }

  // ⏹ 진행 중 자동발급 중단 — 멈춘 카드의 복구 수단(백엔드 취소 API 호출). 로컬 에이전트에서만.
  const cancel = async (doc: string) => {
    const st = rpa[doc]
    // 여정 중이면 카드 하나의 ⏹이 '여정 전체'를 취소한다 — 사용자가 모르고 전체를 끊지 않게 확인(감사 갭)
    if (journeyRef.current?.running && !window.confirm('연쇄 자동발급 전체를 중단할까요?\n(이 서류만 넘기려면 취소하고 위 진행률 바의 [이 단계 건너뛰기]를 누르세요)')) return
    setRpa((s) => (s[doc] ? { ...s, [doc]: { ...s[doc]!, step: '중단하는 중…' } } : s))
    try {
      if (journeyRef.current?.running) {
        await fetch(`${getRpaBase()}/api/journey/cancel/${journeyRef.current.id}`, { method: 'POST' })
      } else if (st?.taskId) {
        await fetch(`${getRpaBase()}/api/documents/rpa-cancel/${st.taskId}`, { method: 'POST' })
      } else {
        // taskId가 아직 없으면(시작 직후) 로컬 상태만 취소로 정리 — 백엔드는 시작 전이라 곧 반영
        setRpa((s) => (s[doc] ? { ...s, [doc]: { ...s[doc]!, status: 'error', step: '중단했어요. 필요하면 다시 시작하세요.' } } : s))
      }
    } catch {
      setRpa((s) => (s[doc] ? { ...s, [doc]: { ...s[doc]!, status: 'error', step: '중단 요청을 보내지 못했어요 — 브라우저 창을 닫으면 자동으로 정리돼요.' } } : s))
    }
  }
  // 인증정보 폼(이 컴포넌트 소유)으로 스크롤/포커스할 때 전역 id 대신 ref로 스코프 —
  // 정책 상세 드로어의 RpaInfoForm과 id가 겹쳐 '엉뚱한 폼'으로 점프하던 것 방지.
  const rpaFormRef = useRef<HTMLDivElement>(null)

  // 확장 감지 + 진행상태 구독(확장은 서류명별 status를 푸시)
  // ⚠️ 확장은 서류명을 정규화(resolveDoc)해 보내므로 퍼지매칭으로 기존 카드 키에 연결(불일치 시 '시작 중' 멈춤 방지)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    detectExtension().then(setExt)
    const t = setInterval(() => setTick((x) => x + 1), 7000) // 무응답 감지용 리렌더
    const extAuthWaitRef = { cur: new Set<string>() } // 확장 경로 인증 대기 '전이' 감지(서류별 1회)
    const off = onExtensionStatus((s) => {
      if (!s.docName) return
      // 📱 확장 경로에도 인증 대기 알림음 — 'waiting' + [인증 허용]/📱 신호로 전이 판정(로컬 에이전트와 파리티)
      const isAuthWait = s.status === 'waiting' && /\[인증 허용\]|인증 허용|📱/.test(s.step || '')
      if (isAuthWait && !extAuthWaitRef.cur.has(s.docName)) { playAuthCue(); titleBadge(`📱 ${s.docName} — 휴대폰 인증 승인 필요`) }
      if (isAuthWait) extAuthWaitRef.cur.add(s.docName)
      else extAuthWaitRef.cur.delete(s.docName)
      setRpa((prev) => {
        // 확장은 서류명을 정규화(resolveDoc)해 보내므로, 표기가 다른 여러 카드('주민등록등본',
        // '청년 주민등록등본' 등)가 같은 정규명으로 매칭될 수 있음 → 매칭되는 카드 전부 갱신
        // (첫 카드만 갱신하면 나머지가 '대기열…'에 영구히 멈춤)
        const keys = Object.keys(prev).filter((k) => sameDocName(k, s.docName))
        const entry = { status: s.status, step: s.step, at: Date.now() }
        const targets = keys.length ? keys : [s.docName!]
        return { ...prev, ...Object.fromEntries(targets.map((k) => [k, entry])) }
      })
    })
    return () => { clearInterval(t); off() }
  }, [])

  // 담은 정책들의 필요 서류 → 어떤 복지들에 필요한지까지 집계 (공통 서류 우선 준비)
  // 표기 변형('자녀 주민등록등본'·'한부모 확인서')은 정식 발급명으로 정규화해 카드·발급·첨부가 한 이름을
  // 쓰게 한다 — 백엔드는 정확명만 수락하므로 변형명 그대로면 단건 400·여정 탈락이 났다(잠재 결함 해소).
  // 같은 문서의 변형끼리는 카드도 합쳐진다(등본 1장이면 되는데 2장을 떼던 낭비 제거). 원 표기는 카드에 병기.
  const { docNeeds, docVariants } = useMemo(() => {
    const map = getPolicyMap()
    const m = new Map<string, string[]>()
    const variants = new Map<string, string[]>()
    tracked.forEach((t) => map[t.policyId]?.required_docs.forEach((d) => {
      const canon = issuableCanonical(d, 'local') ?? d
      const arr = m.get(canon) ?? []
      const nm = map[t.policyId]?.name
      if (nm && !arr.includes(nm)) arr.push(nm)
      m.set(canon, arr)
      if (canon !== d) {
        const vs = variants.get(canon) ?? []
        if (!vs.includes(d)) vs.push(d)
        variants.set(canon, vs)
      }
    }))
    // 여러 복지에 공통으로 필요한 서류를 위로 정렬
    return { docNeeds: [...m.entries()].sort((a, b) => b[1].length - a[1].length), docVariants: variants }
  }, [tracked])

  // 🔁 세션 연속성 — 새로고침·뷰 이탈 후 다시 들어오면 '진행 중이던' 발급/여정 추적을 재연결(감사 갭:
  //   백엔드 브라우저는 계속 도는데 앱은 백지가 되던 문제). 시작 시 기억(rememberLive)해둔 태스크를
  //   에이전트 감지 완료 시 1회 복원한다. 종결·소멸(404)은 폴링이 스스로 정리.
  //   ⚠️ 이 훅은 아래 조기 return(null)보다 먼저 선언돼야 한다(rules-of-hooks). pollDocTask/pollJourney는
  //   effect 실행 시점(마운트 후)엔 정의돼 있고, 카드가 하나도 없으면(docNeeds 0) 몸체가 참조 전에 빠져나간다.
  const resumedRef = useRef(false)
  useEffect(() => {
    // 담은 복지 0(슬림 모드)에서도 여정 복원은 해야 한다 — 자유 선택 발급 중 새로고침하면 패널 상태줄로 복귀
    if (!localAgent || resumedRef.current) return
    resumedRef.current = true
    const docSet = new Set(docNeeds.map(([d]) => d))
    const liveDocs = listLive('doc')
    for (const [doc, t] of Object.entries(liveDocs)) {
      if (!docSet.has(doc)) continue // 지금 화면에 카드가 없는 서류는 표시할 곳이 없음(다시 담으면 그때 복원)
      setRpa((s) => (s[doc] ? s : { ...s, [doc]: { status: 'running', step: '진행 상태 다시 연결 중…', at: Date.now(), taskId: t.taskId, downloadToken: t.token } }))
      pollDocTask(doc, t.taskId, t.token, true)
    }
    const j = listLive('journey')['current']
    // docs가 비어도(자동신청만 여정) 복원한다 — 신청 카드 진행은 pollJourney의 step 매핑이 그린다
    if (j && Array.isArray(j.docs)) {
      journeyRef.current = { id: j.taskId, running: true }
      setRpa((s) => {
        const n = { ...s }
        for (const d of j.docs!) if (docSet.has(d) && !n[d]) n[d] = { status: 'running', step: '진행 상태 다시 연결 중…', at: Date.now() }
        return n
      })
      pollJourney(j.taskId, j.token, j.docs, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAgent, docNeeds.length])

  // 🗂 서류함 실파일 기준 '이미 있음' 인덱스 — docDone(이 기기 기억)과 별개의 '서버 폴더 진실'.
  //    다른 경로(전자증명서·직접 등록)로 이미 확보한 서류를 연쇄가 또 발급하지 않게 한다.
  //    stale(발급 3개월 초과)은 '있음'으로 치지 않는다(제출처 거절 위험 — 재발급 대상 유지).
  //    목록 조회 실패 시엔 비워둔다(모르면 발급하는 쪽이 안전 — 누락보다 중복이 낫다).
  const [vaultHave, setVaultHave] = useState<Record<string, 'ok' | 'stale'>>({})
  const loadVaultTypes = useCallback(async () => {
    if (!vaultOn) { setVaultHave({}); return }
    try {
      const r = await fetch(`${getRpaBase()}/api/documents/list`)
      if (!r.ok) return
      const j = await r.json()
      const map: Record<string, 'ok' | 'stale'> = {}
      for (const d of (j.documents || []) as { doc_type?: string; validity?: string | null }[]) {
        const k = (d.doc_type || '').replace(/\s/g, '')
        if (!k) continue
        if (map[k] !== 'ok') map[k] = d.validity === 'stale' ? 'stale' : 'ok' // 유효본이 하나라도 있으면 ok
      }
      setVaultHave(map)
    } catch { /* 조회 실패 — 스킵 없이 전량 발급(안전한 쪽) */ }
  }, [vaultOn])
  useEffect(() => {
    loadVaultTypes()
    window.addEventListener(DOCS_CHANGED_EVENT, loadVaultTypes)
    // 정부 사이트 탭에서 전자발급을 마치고 돌아온 순간에도 — 새 파일이 폴더에 생겼을 수 있다(DocVault와 동일)
    const onVis = () => { if (document.visibilityState === 'visible') loadVaultTypes() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener(DOCS_CHANGED_EVENT, loadVaultTypes); document.removeEventListener('visibilitychange', onVis) }
  }, [loadVaultTypes])
  const vaultOk = (d: string) => vaultHave[d.replace(/\s/g, '')] === 'ok'

  // 📨 자동신청만 진행 경로의 안내 메시지 — 훅은 조기 return 앞(rules-of-hooks)
  const [applyOnlyMsg, setApplyOnlyMsg] = useState('')

  // ⚠️ 사용자 요청(실사용): '나의 복지'는 '담은 혜택에 필요한 서류'만 정리해서 보여준다.
  //   지원 15종 자유 선택 그리드는 '필요 없는 서류'라 기본으로 펼치지 않는다(과거 슬림모드 자동펼침 제거).
  //   자유 선택은 아래 '다른 서류도 필요하세요?' 버튼으로 opt-in — 패널은 접힌 상태로 시작한다.

  // 담은 복지가 없고 에이전트도 없으면(웹) 표시할 것이 없다. 에이전트가 있으면 아래 '슬림 모드'로 계속 —
  // 심사·첫 사용처럼 아무것도 안 담고 들어와도 15종 자유 발급·서류함은 동작해야 한다(데스크탑 1순위).
  if (docNeeds.length === 0 && !localAgent) return null
  // 발급 완료로 표시한 서류는 뒤로(진행 기억 — 남은 서류가 먼저 보이게, 정렬은 안정적으로 유지)
  const docs = [...docNeeds.map(([d]) => d)].sort((a, b) => Number(isDocDone(a)) - Number(isDocDone(b)))
  const needText = (doc: string) => {
    const ns = docNeeds.find(([d]) => d === doc)?.[1] ?? []
    if (ns.length === 0) return '' // 이름 없는 정책만 있을 때 'undefined에 필요' 렌더 방지
    return ns.length > 1 ? `${ns[0]} 외 ${ns.length - 1}곳에 필요` : `${ns[0]}에 필요`
  }

  const startRpa = async (doc: string) => {
    // 본인인증 자동입력엔 실명·생년월일·휴대폰이 필요 — 비어 있으면 시작 전에 안내하고
    // 사용자를 '첫 빈 칸'으로 바로 데려간다(스크롤+포커스) → 어디에 뭘 넣는지 헤매지 않게.
    if (!rpaInfo.name?.trim() || !rpaInfo.birth_date?.trim() || !rpaInfo.phone?.trim()) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '실명·생년월일·휴대폰만 넣으면 본인인증 화면까지 자동으로 채워드려요. 아래 칸에 입력해 주세요 👇 (내 기기에만 저장)', at: Date.now() } }))
      const missingIdx = !rpaInfo.name?.trim() ? 0 : !rpaInfo.birth_date?.trim() ? 1 : 2 // 이름·생년월일·휴대폰 순
      setTimeout(() => {
        const root = rpaFormRef.current // 전역 id가 아니라 '이 컴포넌트의' 폼으로 스코프
        if (!root) return
        root.scrollIntoView({ behavior: 'smooth', block: 'center' })
        ;(root.querySelectorAll('input')[missingIdx] as HTMLInputElement | undefined)?.focus({ preventScroll: true })
      }, 80)
      return
    }
    setRpa((s) => ({ ...s, [doc]: { status: 'running', step: '시작 중…', at: Date.now() } }))
    // 채널 라우팅: 로컬 백엔드는 15종 지원(officialLinks.LOCAL_RPA_DOCS) — 로컬이 못 하는 서류는 확장으로(있으면), 둘 다 안 되면 정직한 안내
    const localOk = isRpaSupported(doc, 'local')
    if ((!localAgent || !localOk) && ext) {
      const r = await issueViaExtension(doc, {
        // 본인인증엔 실명(rpaInfo.name)이 필요 — 프로필 이름(데모 페르소나일 수 있음)은 폴백
        user_name: rpaInfo.name || profile?.name || '사용자',
        birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
        auth_provider: rpaInfo.auth_provider || 'kakao', // 선택한 인증수단(PASS 등)을 확장에도 전달
      })
      if (!r.ok) setRpa((s) => ({ ...s, [doc]: { status: 'error', step: r.error || '확장이 이 서류를 지원하지 않아요.', at: Date.now() } }))
      return
    }
    if (localAgent && !localOk) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '이 서류는 로컬 에이전트가 자동발급을 지원하지 않아요 — 옆의 발급 버튼으로 공식 사이트에서 직접 발급하세요.', at: Date.now() } }))
      return
    }
    try {
      const res = await fetch(`${getRpaBase()}/api/documents/rpa-issue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_name: doc, user_name: rpaInfo.name || profile?.name || '사용자',
          birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
          sido: rpaInfo.sido, sigungu: rpaInfo.sigungu,
          auth_provider: rpaInfo.auth_provider || 'kakao', // 어르신은 통신사 PASS가 많음
          // 🔒 가족관계(efamily)용 — 서버는 자동입력에만 쓰고 저장하지 않음(다른 서류에선 무시됨)
          rrn_back: rpaInfo.rrn_back || '', parent_kind: rpaInfo.parent_kind || '부', parent_name: rpaInfo.parent_name || '',
        }),
      })
      if (!res.ok) {
        // 503(이용자 많음/RPA 비활성)은 서버의 안내 문구를 그대로 — 옆의 '전자발급' 링크로 폴백하면 됨
        const detail = await res.json().then((d) => d?.detail).catch(() => '')
        throw new Error(detail || (res.status === 503 ? '지금은 자동 발급이 어려워요 — 옆의 전자발급으로 진행해 주세요.' : '지원하지 않는 서류'))
      }
      const issued = await res.json()
      const task_id = issued.task_id
      const downloadToken = issued.download_token || ''  // 시작자에게만 반환되는 다운로드 인가 토큰
      rememberLive('doc', doc, { taskId: task_id, token: downloadToken }) // 새로고침·뷰 이탈 후 복원용
      await pollDocTask(doc, task_id, downloadToken)
    } catch (e) {
      setRpa((s) => ({ ...s, [doc]: { status: 'error', step: e instanceof Error ? e.message : '실패' } }))
    }
  }

  // 🔁 서류함 ⚠️ 손상의 '지우고 다시 발급' — 카드가 없는 서류는 자유 발급 패널의 상태줄로 진행을 보여준다(침묵 금지)
  const reissueFromVault = (doc: string) => {
    if (!docs.includes(doc)) setPickOpen(true)
    startRpa(doc)
  }
  issueFnRef.current = reissueFromVault // 💬→🖨 브리지의 실행 함수 — 매 렌더 최신 클로저 유지

  // 단건 발급 폴링 — 시작(startRpa)과 복원(마운트 재연결)이 공유하는 단일 루프.
  //   resumed=true(복원)면 404를 오류 카드 대신 '조용한 정리'로 처리 — 앱 재시작으로 사라진 태스크를
  //   사용자가 다시 볼 이유가 없다(시작 직후 404는 기존대로 정직한 오류 표시).
  const pollDocTask = async (doc: string, task_id: string, downloadToken: string, resumed = false) => {
    // ⚠️ 폴링 상한을 백엔드 대기창(로그인 8분·전자서명 대기 등) 이상으로 — 어르신 본인인증이 90초를
    //    넘겨도 UI가 완료 전에 멈추지 않게(과거 60회=90초라 인증이 느리면 발급돼도 '진행 중'에 영구 정지, 감사 확정).
    let failStreak = 0
    let prevBody = '' // 직전 응답 원문 — 같으면 setState/파싱 생략(1.5s 폴링의 불필요 리렌더 제거)
    let prevStatus = '' // 📱 인증 대기 '전이' 감지용(같은 대기 상태 폴링마다 울리지 않게)
    for (let i = 0; i < 1200; i++) { // 최대 ~30분
      await new Promise((r) => setTimeout(r, 1500))
      if (!mountedRef.current) return // 뷰를 떠나면 폴링 중단(언마운트 후 setState/fetch 방지 — 복원이 이어받음)
      // ?t= 토큰: 스크린샷 포함 응답 인가(백엔드 게이트) — 시작자만 진행 화면을 볼 수 있게
      let st: { status?: string; current_step?: string; result?: { saved_path?: string }; screenshot_b64?: string; steps?: { time?: string; msg?: string }[] }
      let bodyTxt = ''
      try {
        const resp = await fetch(`${getRpaBase()}/api/documents/rpa-status/${task_id}${downloadToken ? `?t=${encodeURIComponent(downloadToken)}` : ''}`)
        if (resp.status === 404) {
          // 태스크가 사라짐(데스크탑앱 재시작 등) — 좀비 폴링 대신 정직하게 종료(감사 :147)
          forgetLive('doc', doc)
          if (!mountedRef.current) return
          if (resumed) { setRpa((s) => { const n = { ...s }; delete n[doc]; return n }) } // 복원 중 소멸 → 조용히 정리
          else setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '자동발급 세션이 끊겼어요(앱 재시작 등) — 다시 시도해 주세요.', at: s[doc]?.at, taskId: task_id } }))
          return
        }
        if (!resp.ok) throw new Error(`status ${resp.status}`)
        bodyTxt = await resp.text()
        failStreak = 0 // 성공 응답 — '연속' 실패 카운터는 여기서 리셋(변화 없음 continue보다 먼저, 누적 오탐 방지)
        if (bodyTxt === prevBody) continue // 변화 없음(인증 대기 등) — 렌더 생략(구형 PC 부담↓, 종결은 반드시 변화로 도달)
        st = JSON.parse(bodyTxt)
      } catch {
        // 일시적 네트워크 실패 1회로 폴링을 끝내지 않는다(감사 :160) — 연속 5회(≈7.5초) 실패만 종료
        failStreak++
        if (failStreak >= 5) {
          if (!mountedRef.current) return
          // 네트워크 문제는 태스크 소멸이 아님 — 기억은 유지해 다음 마운트에서 재연결 기회를 남긴다
          setRpa((s) => ({ ...s, [doc]: { status: 'error', step: '상태 확인이 계속 실패해요 — 네트워크를 확인하고 다시 시도해 주세요.', at: s[doc]?.at, taskId: task_id } }))
          return
        }
        continue
      }
      if (!mountedRef.current) return
      prevBody = bodyTxt
      // 발급 완료 시 result.saved_path가 있으면 문서를 사용자에게 돌려줄 수 있음(다운로드 버튼 노출)
      setRpa((s) => ({ ...s, [doc]: {
        status: st.status || 'running', step: st.current_step || '', at: s[doc]?.at ?? Date.now(), taskId: task_id, downloadToken,
        saved: !!(st.result && st.result.saved_path),
        savedPath: (st.result && st.result.saved_path) || undefined,
        // 진행 실화면(토큰 인가 시 응답에 포함) + 최근 단계 로그 — '멈춘 것처럼 보임' 해소(실사용 피드백)
        shot: st.screenshot_b64 || undefined,
        stepsTail: Array.isArray(st.steps) ? st.steps.slice(-3).map((x: { time?: string; msg?: string }) => `${x.time || ''} ${String(x.msg || '').split('\n')[0]}`.trim()) : undefined,
      } }))
      // 📱 인증 대기로 '넘어가는 순간' 알림음 + 탭 제목 배지 — 화면을 안 보고 있어도 폰을 집게
      if (isAuthWaitTransition(prevStatus, st.status)) { playAuthCue(); titleBadge(`📱 ${doc} — 휴대폰 인증 승인 필요`) }
      prevStatus = st.status || ''
      if (st.status === 'done' || st.status === 'error' || st.status === 'completed' || st.status === 'cancelled') {
        forgetLive('doc', doc) // 종결 — 복원 대상에서 제거(좀비 복원 방지)
        // 발급이 종결되면 🗂 내 서류함을 즉시 갱신(새 발급물이 목록·자동첨부 후보에 바로 보이게)
        if (st.status === 'done' || st.status === 'completed') notifyDocsChanged()
        // 실발급 성공(서버가 PDF 저장을 확인)은 '발급 완료'로 기억 — 재실행 시 같은 서류 중복 발급 방지.
        //   saved_path 없는 done(⚠️)은 기억하지 않는다(등록 경로의 수동 표시와 동일한 실증 기준).
        if ((st.status === 'done' || st.status === 'completed') && st.result?.saved_path && !isDocDone(doc)) toggleDocDone(doc)
        // 다른 탭(정부 사이트 등)에 가 있으면 탭 제목으로 종결을 알림 — 돌아오면 자동 원복
        titleBadge(st.status === 'done' || st.status === 'completed' ? `✅ ${doc} 발급 완료 — 모두봄` : `⚠️ ${doc} 확인 필요 — 모두봄`)
        break
      }
    }
  }

  // 🚀 연쇄 자동발급 — 지원 서류 전부를 한 흐름으로(정부24는 한 번 로그인으로 이어짐)
  // 이미 '발급 완료'로 표시한 서류는 재발급 대상에서 제외.
  const rpaDocs = docs.filter((d) => isRpaSupported(d) && !isDocDone(d))
  // 로컬 백엔드(데스크탑앱)가 실제로 발급 가능한 서류 — 확장 지원목록(13종)과 로컬 지원목록(15종)은 서로
  //   포함관계가 아니라, rpaDocs(확장 기준)를 다시 거르면 로컬 전용 서류(건보료 납부확인서 등)가 '전부 자동발급'에서
  //   누락된다(감사). 전체 docs에 'local' 채널을 직접 적용해야 15종을 온전히 포함한다.
  //   + 서류함에 '유효한 실파일'이 이미 있는 서류도 제외(부족분만 발급) — 확장 경로는 서버 폴더를
  //     쓰지 않으므로(다운로드 폴더 저장) 로컬 에이전트 연쇄에만 적용한다.
  const rpaDocsLocal = docs.filter((d) => isRpaSupported(d, 'local') && !isDocDone(d) && !vaultOk(d))
  // 서류함 덕에 건너뛰는 서류(사용자에게 '왜 n종만 발급하는지' 보여줄 목록)
  const vaultCovered = docs.filter((d) => isRpaSupported(d, 'local') && !isDocDone(d) && vaultOk(d))
  // 연쇄 발급 대상: 확장 있으면 전체(13종), 없고 로컬 에이전트면 로컬 지원분(15종)
  const chainDocs = ext ? rpaDocs : rpaDocsLocal
  const certAll = docs.filter((d) => isCertIssuable(d)) // 무설치 전자발급(전자증명서) 가능 서류
  const certDocs = certAll.filter((d) => !isDocDone(d)) // 그중 아직 발급 안 한 서류 — 배너 CTA가 순서대로 안내

  // 무설치 전자발급 시작 — 새 탭은 <a>가 사용자 제스처 안에서 직접 열고, 여기선
  // ① 폼 첫 칸에 붙여넣을 이름을 클립보드에 준비 ② 복귀 시 '발급하셨나요?' 확인 대기만 건다
  const openIssue = (doc: string) => {
    setPendingReturn({ kind: 'doc', doc })
    const nm = (rpaInfo.name || profile?.name || '').trim()
    if (nm) navigator.clipboard?.writeText(nm).catch(() => { /* 미지원 환경 무시 */ })
  }
  // 로컬 백엔드(데스크탑앱) 연쇄 발급 — 한 번 카카오 인증으로 서류들을 순차 발급(orchestrator journey).
  //   svcList가 있으면 발급을 모두 마친 뒤 '자동신청'까지 이어서(자동첨부 성립 순서, 제출 전 정지).
  const runJourneyViaBackend = async (docList: string[], svcList: string[] = []) => {
    setJourneySummary(null) // 새 여정 시작 — 직전 여정의 종결 요약을 걷어낸다
    const res = await fetch(`${getRpaBase()}/api/journey/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_names: docList, service_names: svcList,
        user_name: rpaInfo.name || profile?.name || '사용자',
        birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
        auth_provider: rpaInfo.auth_provider || 'kakao',
        sido: rpaInfo.sido, sigungu: rpaInfo.sigungu, // 연쇄발급에서도 주민등록 주소 자동정정
        // 🔒 가족관계(efamily)용 — 여정에 가족관계가 포함되면 인증 요청까지 자동(서버 미저장)
        rrn_back: rpaInfo.rrn_back || '', parent_kind: rpaInfo.parent_kind || '부', parent_name: rpaInfo.parent_name || '',
        // 신청 단계 자동입력 + 일반화 딥링크: 단일 서비스 여정이면 해석된 복지로 딥링크를 동봉 —
        //   단건 신청(AgentSubmitButton)과 능력 파리티. 내장 검증 서비스는 백엔드가 이름 우선이라 무시하고,
        //   다중 서비스 여정엔 백엔드가 아예 안 쓰므로(한 URL 오재사용 방지 설계) 동봉해도 무해.
        profile: {
          ...(profile || {}),
          ...(() => {
            if (svcList.length !== 1) return {}
            const p = Object.values(getPolicyMap()).find((x) => x.name === svcList[0])
            const u = p ? bestApplyUrl(p.application, p.name, p.id) : ''
            return /bokjiro\.go\.kr/.test(u) ? { apply_url: u } : {}
          })(),
        },
      }),
    })
    if (!res.ok) {
      const detail = await res.json().then((d) => d?.detail).catch(() => '')
      throw new Error(detail || '연쇄 발급을 시작하지 못했어요.')
    }
    const started = await res.json()
    const journey_id = started.journey_id
    const jtok = started.download_token || ''  // 스크린샷/경로 열람 인가 토큰(시작자에게만)
    journeyRef.current = { id: journey_id, running: true }  // [중단]이 여정 전체를 취소할 수 있게
    // 지원목록 밖 서류는 여정에서 제외되므로, 서버가 실제로 받은 서류만 추적한다(나머지 카드가 스피너로 영구고정되지 않게).
    const accepted: string[] = Array.isArray(started.docs) ? started.docs : docList
    const dropped = docList.filter((d) => !accepted.includes(d))
    if (dropped.length) {
      setRpa((s) => ({ ...s, ...Object.fromEntries(dropped.map((d) => [d, { status: 'error', step: '이 서류는 자동발급 대상이 아니에요 — 옆의 발급 버튼으로 진행해 주세요.', at: Date.now() }])) }))
    }
    // 요청한 '자동신청까지'가 여정에서 탈락했으면 침묵하지 않는다 — 사용자는 신청까지 이어진다고 알고 있음(정직성)
    const acceptedSvcs: string[] = Array.isArray(started.services) ? started.services : []
    const droppedSvcs = svcList.filter((sv) => !acceptedSvcs.includes(sv))
    if (droppedSvcs.length) {
      setRpa((s) => ({ ...s, ...Object.fromEntries(droppedSvcs.map((sv) => [sv, { status: 'error', step: '이 서비스는 자동신청 연쇄에 포함되지 못했어요 — 발급이 끝나면 정책 상세의 에이전트 신청이나 공식 페이지에서 이어 주세요.', at: Date.now() }])) }))
    }
    rememberLive('journey', 'current', { taskId: journey_id, token: jtok, docs: accepted }) // 새로고침 복원용
    await pollJourney(journey_id, jtok, accepted)
  }

  // 연쇄발급(여정) 폴링 — 시작과 복원이 공유. resumed=true면 404를 조용한 정리로(앱 재시작 등).
  const pollJourney = async (journey_id: string, jtok: string, accepted: string[], resumed = false) => {
    const tq = jtok ? `?t=${encodeURIComponent(jtok)}` : ''
    // 폴링 상한을 백엔드 대기창 이상으로 — 각 서류 인증이 느려도 UI가 완료 전에 멈추지 않게.
    // ⚠️ 서류 수에 비례해야 한다: 고정 1400(~35분)은 '자유 선택 15종' 여정에서 백엔드가 아직 도는데
    //    UI만 멈춘 것으로 오보할 수 있다. 스텝당 백엔드 하드타임아웃(30분=1200폴)+버퍼로 계산(종결은 상태로 감지).
    const MAX_POLL = Math.max(1400, accepted.length * 1250 + 400)
    let failStreak = 0
    let finished = false
    let prevBody = '' // 직전 응답 원문 — 같으면 집계·setState 생략(장시간 여정의 불필요 리렌더 제거)
    let prevAuthKey = '' // 📱 인증 대기 전이 감지 — 단계마다(등본→가족관계→…) 각각 한 번씩 울리게 단계명 포함
    try {
      for (let i = 0; i < MAX_POLL; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        if (!mountedRef.current) return
        let j: { status?: string; current?: string; current_message?: string; current_status?: string; current_screenshot?: string; steps?: { name: string; status: string; kind?: string; saved_path?: string; error?: string; task_id?: string; download_token?: string; success?: boolean; result_status?: string; filled_fields?: string[]; attached_docs?: string[]; manual_apply?: boolean }[] }
        let bodyTxt = ''
        try {
          const resp = await fetch(`${getRpaBase()}/api/journey/status/${journey_id}${tq}`)
          if (resp.status === 404) {
            // 여정이 사라짐(앱 재시작 등) — 아직 running 인 카드를 좀비 스피너로 두지 않고 정직하게 종료(감사 :147/:208)
            forgetLive('journey', 'current')
            if (!mountedRef.current) return
            if (resumed) setRpa((s) => { const n = { ...s }; for (const d of accepted) delete n[d]; return n }) // 복원 중 소멸 → 조용히 정리
            else setRpa((s) => markRemainingStuck(s, accepted, '자동발급 세션이 끊겼어요(앱 재시작 등) — 다시 시도해 주세요.'))
            finished = true
            return
          }
          if (!resp.ok) throw new Error(`status ${resp.status}`)
          bodyTxt = await resp.text()
          failStreak = 0 // 성공 응답 — '연속' 실패 카운터 리셋(변화 없음 continue보다 먼저, 누적 오탐 방지)
          if (bodyTxt === prevBody) continue // 변화 없음 — 렌더 생략(종결·전이는 반드시 응답 변화로 도달)
          j = JSON.parse(bodyTxt)
        } catch {
          // 일시적 네트워크 실패는 몇 번 견딘다(감사 :160) — 연속 5회만 종료
          failStreak++
          if (failStreak >= 5) {
            if (!mountedRef.current) return
            setRpa((s) => markRemainingStuck(s, accepted, '상태 확인이 계속 실패해요 — 네트워크를 확인하고 다시 시도해 주세요.'))
            finished = true
            return
          }
          continue
        }
        prevBody = bodyTxt
        // 여정 수준 집계(진행률 바) — 종결 단계 수/전체 + 현재 단계명 + 인증 대기 여부(헤더 강조)
        {
          const steps = j.steps || []
          const doneN = steps.filter((sp) => ['done', 'completed', 'error', 'cancelled'].includes(sp.status)).length
          setJourneyProg({ total: steps.length, done: doneN, current: j.current || undefined, authWait: j.current_status === 'waiting_login' })
        }
        // 📱 현재 단계가 인증 대기로 넘어가는 순간 알림음 — 단계가 바뀔 때마다 각각 한 번씩
        {
          const authKey = j.current_status === 'waiting_login' ? `${j.current || ''}:waiting_login` : ''
          if (authKey && authKey !== prevAuthKey) { playAuthCue(); titleBadge(`📱 ${j.current || '발급'} — 휴대폰 인증 승인 필요`) }
          prevAuthKey = authKey
        }
        // 여정 중 실발급 성공한 서류는 즉시 '발급 완료'로 기억 — 중간 이탈/재실행에도 중복 발급 방지
        for (const step of (j.steps || [])) {
          if (step.kind !== 'apply' && step.saved_path && ['done', 'completed'].includes(step.status) && !isDocDone(step.name)) toggleDocDone(step.name)
        }
        setRpa((s) => {
          const next = { ...s }
          for (const step of (j.steps || [])) {
            const isCur = j.current === step.name
            const applyFacts = step.kind === 'apply' && step.success === true
              ? [step.filled_fields?.length ? `기본정보 ${step.filled_fields.length}개 입력` : '', step.attached_docs?.length ? `서류 ${step.attached_docs.length}건 첨부` : ''].filter(Boolean).join(' · ')
              : ''
            const msg = isCur && j.current_message ? j.current_message
              : step.status === 'running' ? '진행 중…'
              // 실발급 신호(saved_path)가 있어야 '발급 완료' — 없으면 완료로 오보하지 않음(감사 확정 정직성, 아이콘 amber와 동일 기준)
              // 신청(apply) 단계는 애초에 saved_path 가 없다 — 서류용 '발급 미완료' 문구가 잘못 뜨지 않게 구분
              : (step.status === 'done' || step.status === 'completed')
                ? (step.kind === 'apply' ? (step.success === true
                  ? `신청 양식 준비 완료${applyFacts ? ` — ${applyFacts}` : ''} · 열린 창에서 확인 후 제출해 주세요`
                  : '신청 페이지 도달 — 자동 양식 준비는 확인되지 않아 열린 창에서 직접 진행해 주세요')
                  : step.saved_path ? '발급 완료' : '발급 미완료 — 화면에서 확인해 주세요')
              : step.status === 'error' ? (step.error || '실패')
              : step.status === 'cancelled' ? '중단했어요' : '대기 중…'
            // 발급 완료 단계는 taskId+토큰을 실어 '발급 문서 받기' 버튼이 뜨게(서버 RPA/원격에서 PDF 회수)
            // 현재 단계는 진행 실화면(current_screenshot, 시작자 토큰 인가 시)도 실어 단건 발급과 동일하게
            // '멈춘 것처럼 보임'을 해소한다 — 여정에서만 실화면이 빠져 있던 갭.
            next[step.name] = {
              status: step.status, step: msg, at: s[step.name]?.at,
              saved: !!step.saved_path, savedPath: step.saved_path || undefined,
              taskId: step.task_id, downloadToken: step.download_token,
              shot: isCur ? j.current_screenshot || undefined : undefined,
              success: step.success, resultStatus: step.result_status,
              filledFields: step.filled_fields, attachedDocs: step.attached_docs,
              manualApply: step.manual_apply,
            }
          }
          return next
        })
        if (j.status === 'completed' || j.status === 'error' || j.status === 'cancelled') {
          forgetLive('journey', 'current') // 종결 — 복원 대상에서 제거
          if (j.status === 'completed') notifyDocsChanged() // 발급물들이 서류함·자동첨부 후보에 바로 보이게
          const manualApplications = (j.steps || []).filter((sp) => sp.kind === 'apply' && ['done', 'completed'].includes(sp.status) && sp.success !== true).length
          titleBadge(j.status === 'completed' && manualApplications === 0 ? '✅ 연쇄 발급 완료 — 모두봄' : '⚠️ 연쇄 발급 확인 필요 — 모두봄')
          // 종결 요약 한 줄 — 실발급(saved_path)·건너뜀·신청 양식 준비만 정직하게 집계(0건 항목은 표기 생략)
          {
            const steps = j.steps || []
            const oneLogin = !!(j as { one_login?: boolean }).one_login // 백엔드 사실 플래그 — 공유 세션 여정만 true
            const issued = steps.filter((sp) => sp.kind !== 'apply' && sp.saved_path).length
            const skipped = steps.filter((sp) => sp.status === 'cancelled').length
            const prepared = steps.filter((sp) => sp.kind === 'apply' && ['done', 'completed'].includes(sp.status) && sp.success === true).length
            const manual = steps.filter((sp) => sp.kind === 'apply' && ['done', 'completed'].includes(sp.status) && sp.success !== true).length
            const parts = [
              issued > 0 ? `서류 ${issued}건 발급${oneLogin && issued > 1 ? ' (🔑 로그인 인증 1회)' : ''}` : '',
              skipped > 0 ? `${skipped}건 건너뜀` : '',
              prepared > 0 ? `신청 양식 ${prepared}건 준비(제출은 본인 확인 후)` : '',
              manual > 0 ? `신청 ${manual}건 직접 진행 필요` : '',
            ].filter(Boolean)
            const head = j.status === 'completed'
              ? (manual > 0 ? '⚠️ 서류 발급 완료 · 신청 확인 필요' : '✅ 연쇄 자동발급 끝')
              : j.status === 'cancelled' ? '⏹ 연쇄 중단됨' : '⚠️ 연쇄가 오류로 끝났어요'
            setJourneySummary({ text: parts.length ? `${head} — ${parts.join(' · ')}` : head, issued })
          }
          finished = true; break
        }
      }
      // 폴링 상한에 도달했는데 여정이 끝나지 않았으면 — 남은 running 카드를 침묵 스피너로 두지 않는다(감사 :208)
      if (!finished && mountedRef.current) {
        setRpa((s) => markRemainingStuck(s, accepted, '자동발급이 예상보다 오래 걸려요 — 열린 브라우저 창을 확인하거나 다시 시도해 주세요.'))
      }
    } finally {
      if (journeyRef.current?.id === journey_id) journeyRef.current = null
      if (mountedRef.current) setJourneyProg(null) // 여정 종료 — 진행률 헤더 내리기(카드별 결과는 유지)
    }
  }

  // 인증정보 미입력 시 폼의 '첫 빈 칸'으로 스크롤+포커스 — 원클릭/자동신청 경로 공용
  const focusRpaForm = () => {
    const missingIdx = !rpaInfo.name?.trim() ? 0 : !rpaInfo.birth_date?.trim() ? 1 : 2
    setTimeout(() => {
      const root = rpaFormRef.current
      if (!root) return
      root.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ;(root.querySelectorAll('input')[missingIdx] as HTMLInputElement | undefined)?.focus({ preventScroll: true })
    }, 80)
  }
  const rpaInfoReady = !!(rpaInfo.name?.trim() && rpaInfo.birth_date?.trim() && rpaInfo.phone?.trim())

  // 📨 '서류는 전부 준비됨 + 신청만 남음' 경로 — 발급 0건 여정으로 자동신청만 진행(상태 훅은 상단 선언)
  const startApplyOnly = async () => {
    if (!rpaInfoReady) { setApplyOnlyMsg('아래 "자동입력 추가정보"에 실명·생년월일·휴대폰을 먼저 입력해 주세요.'); focusRpaForm(); return }
    setApplyOnlyMsg('')
    try {
      await runJourneyViaBackend([], chainSvcs)
    } catch (e) {
      setApplyOnlyMsg(e instanceof Error ? e.message : '자동신청 시작에 실패했어요 — 잠시 후 다시 시도해 주세요.')
    }
  }

  const startAll = async () => {
    if (!rpaInfoReady) {
      setRpa((s) => ({ ...s, [chainDocs[0]]: { status: 'error', step: '아래 "자동입력 추가정보"에 실명·생년월일·휴대폰을 먼저 입력해 주세요.', at: Date.now() } }))
      // 단건 발급과 동일하게 '첫 빈 칸'으로 스크롤+포커스 — 원클릭 경로에서도 헤매지 않게
      focusRpaForm()
      return
    }
    // 이미 단건으로 진행 중인 서류는 연쇄에서 제외 — 같은 서류가 슬롯 2개(브라우저 창 2개)로 중복 발급되는 것 방지
    const busy = chainDocs.filter((d) => { const st = rpa[d]; return !!(st && !['done', 'completed', 'error', 'cancelled'].includes(st.status)) })
    const chainRun = chainDocs.filter((d) => !busy.includes(d))
    if (!chainRun.length) return // 전부 이미 진행 중 — 각 카드가 상태를 보여주고 있으므로 조용히 무시
    const userInfo = {
      user_name: rpaInfo.name || profile?.name || '사용자',
      birth_date: rpaInfo.birth_date, phone: rpaInfo.phone, carrier: rpaInfo.carrier,
      auth_provider: rpaInfo.auth_provider || 'kakao', // 확장 연쇄발급에도 인증수단 전달
    }
    setRpa((s) => ({ ...s, ...Object.fromEntries(chainRun.map((d) => [d, { status: 'running', step: '대기열에 추가됨…', at: Date.now() }])) }))
    // 로컬 에이전트(데스크탑앱) 우선 — 확장이 없거나 로컬만 있을 때 백엔드 여정으로 연쇄 발급.
    if (localAgent && !ext) {
      try {
        await runJourneyViaBackend(chainRun, chainApply ? chainSvcs : [])
      } catch (e) {
        // 시작 실패(503 등)면 첫 카드뿐 아니라 '대기열에 추가됨…'으로 켜둔 모든 카드를 정직히 종료(감사 :247)
        const msg = e instanceof Error ? e.message : '연쇄 발급 실패'
        setRpa((s) => markRemainingStuck(s, chainRun, msg))
      }
      return
    }
    const r = await issueManyViaExtension(rpaDocs, userInfo)
    if (!r.ok) { setRpa((s) => ({ ...s, [rpaDocs[0]]: { status: 'error', step: r.error || '연쇄 발급을 시작하지 못했어요.', at: Date.now() } })); return }
    // 확장이 표기변형을 정규화·디듑해 실제 큐에 들어간 목록(r.docs)만 진행 대상 — 나머지 카드는
    // 중복(같은 서류)이므로 '동일 서류로 함께 발급됨'으로 표시(영구 '대기열…' 방지)
    if (r.docs && r.docs.length) {
      setRpa((s) => {
        const next = { ...s }
        for (const d of rpaDocs) {
          if (!r.docs!.some((rd) => sameDocName(rd, d))) next[d] = { status: 'running', step: '같은 서류로 함께 발급돼요…', at: Date.now() }
        }
        return next
      })
    }
  }
  // 💬→🚀 챗 "전부 발급해줘" 실행 함수 — 연쇄 대상이 있으면 원클릭 연쇄 그대로, 담은 복지가 없어
  //   대상이 비면 자유 선택 패널을 전부 선택 상태로 열어 한 번에 시작할 수 있게(막다른 응답 방지)
  issueAllFnRef.current = () => {
    if (chainDocs.length) { void startAll() }
    else { setPickOpen(true); setPicked(Object.fromEntries(localDocs.map((d) => [d, true]))) }
  }

  // 🗂 자유 선택 일괄발급 시작 — 검증·중복 가드는 원클릭 연쇄(startAll)와 동일 기준
  const startPicked = async () => {
    const sel = localDocs.filter((d) => picked[d])
    if (!sel.length) { setPickMsg('발급할 서류를 하나 이상 선택해 주세요.'); return }
    if (!rpaInfoReady) { setPickMsg('아래 "자동입력 추가정보"에 실명·생년월일·휴대폰을 먼저 입력해 주세요.'); focusRpaForm(); return }
    // 이미 진행 중인 서류는 제외 — 같은 서류가 브라우저 2개로 중복 발급되는 것 방지(startAll과 동일)
    const busy = sel.filter((d) => { const st = rpa[d]; return !!(st && !['done', 'completed', 'error', 'cancelled'].includes(st.status)) })
    const run = sel.filter((d) => !busy.includes(d))
    if (!run.length) { setPickMsg('선택한 서류는 모두 이미 진행 중이에요 — 아래 진행 상태를 확인해 주세요.'); return }
    setPickMsg('')
    setRpa((s) => ({ ...s, ...Object.fromEntries(run.map((d) => [d, { status: 'running', step: '대기열에 추가됨…', at: Date.now() }])) }))
    try {
      await runJourneyViaBackend(run, [])
    } catch (e) {
      setRpa((s) => markRemainingStuck(s, run, e instanceof Error ? e.message : '일괄 발급을 시작하지 못했어요.'))
    }
  }

  // ── 메인·슬림 두 렌더가 공유하는 블록들 ──────────────────────────────────
  // 🗂 자유 선택 일괄발급 — 담은 정책의 필요서류 밖이라도 지원 서류 전체에서 골라 한 번 인증 연쇄 발급
  const freePickerBlock = (!ext && localAgent) ? (
    <div className="mt-3">
      {!pickOpen ? (
        <button
          onClick={() => { setPickOpen(true); setPicked(Object.fromEntries(chainDocs.map((d) => [d, true]))) }}
          className="btn-secondary w-full !py-2 text-xs">
          {/* 담은 혜택 서류가 있으면 '다른 서류도', 없으면(슬림) '서류를 골라' — 필요 서류만 보여주는 기본 뷰에 맞춘 opt-in */}
          {docs.length > 0 ? '🗂 다른 서류도 필요하세요?' : '🗂 서류를 골라 발급하기'} 지원 {localDocs.length}종에서 골라 한번에 발급 →
        </button>
      ) : (
        <div className="rounded-2xl border-2 border-sky2-100 bg-sky2-50/40 p-3.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-bold">🗂 원하는 서류 골라 일괄발급 <span className="text-xs font-semibold text-muted-foreground">지원 {localDocs.length}종 · 한 번 인증으로 이어서</span></p>
            <button onClick={() => setPickOpen(false)} aria-label="일괄발급 선택 닫기" className="text-xs font-semibold text-muted-foreground hover:underline">닫기</button>
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
            {localDocs.map((d) => (
              <label key={d} className="flex items-start gap-1.5 text-xs font-medium cursor-pointer select-none">
                <input type="checkbox" checked={!!picked[d]} onChange={(e) => setPicked((s) => ({ ...s, [d]: e.target.checked }))} className="mt-0.5 accent-sky2-600" />
                <span className="break-keep">{d}
                  {vaultOk(d) && <span className="ml-1 rounded-md bg-sky2-100 px-1 py-0.5 text-[10px] font-bold text-sky2-700" title="서류함에 유효한 파일이 이미 있어요 — 다시 발급하지 않아도 돼요">🗂 있음</span>}
                  {isLocalBetaDoc(d) && <span className="ml-1 rounded-md bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-700" title="내 PC에서 실측 등록한 확장 서류예요 — 코드·발급버튼은 확인됐고, 첫 발급 완주가 최종 검증이에요">β</span>}
                </span>
              </label>
            ))}
          </div>
          <button onClick={startPicked} className="btn-primary w-full mt-2.5 !py-2 text-sm">
            🚀 선택한 {localDocs.filter((d) => picked[d]).length}종 한번에 발급 (한 번 인증으로 이어서)
          </button>
          {pickMsg && <p className="mt-1 text-[11px] font-semibold text-rose-600">{pickMsg}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground">📱 각 서류 차례에 인증 요청이 오면 승인만 해주세요 · 발급물은 🗂 서류함에 모여요</p>
          {/* 담은 정책 카드 밖 서류의 진행 상태 — 카드가 없으므로 여기서 그대로 보여준다(침묵 금지) */}
          {localDocs.filter((d) => rpa[d] && !docs.includes(d)).map((d) => {
            const st = rpa[d]!
            const done = ['done', 'completed'].includes(st.status)
            return (
              <div key={d} className="mt-1">
                <p className={`text-[11px] font-semibold ${st.status === 'error' ? 'text-rose-600' : done ? 'text-sprout-700' : st.status === 'cancelled' ? 'text-muted-foreground' : 'text-sky2-700'}`}>
                  {done ? '✅' : st.status === 'error' ? '⚠️' : st.status === 'cancelled' ? '⏹' : '⏳'} {d} — {String(st.step || st.status).split('\n')[0]}
                </p>
                {/* 진행 실화면 파리티 — 카드가 없는 자유 발급 서류도 지금 브라우저 화면이 보이게(단건 카드와 동일 신뢰 장치) */}
                {st.shot && !done && st.status !== 'error' && st.status !== 'cancelled' && (
                  <img src={`data:image/jpeg;base64,${st.shot}`} alt={`${d} 진행 화면`}
                    className="mt-1 max-h-36 w-auto rounded-lg border border-sky2-100" />
                )}
              </div>
            )
          })}
          {/* 🔎 커버리지 실측 추가 — 서류명 하나로 정부24 실측→통과 시 재시작 없이 β 합류(본인 PC 전용) */}
          {vaultOn && (
            <ProbeCoverage onExpanded={(s, b) => { setLocalRpaDocs(s, b); setLocalDocs(s) }} />
          )}
        </div>
      )}
    </div>
  ) : null

  // 🚀 여정(연쇄발급) 진행률 헤더 — 전체 흐름 n/m + 현재 단계 + 전체 중단(확인 포함)
  const journeyProgBlock = journeyProg ? (
    <div className="mt-4 rounded-2xl border-2 border-sprout-200 bg-sprout-50/70 p-3.5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs font-bold">
        <span>
          🚀 연쇄 자동발급 진행 중 — {journeyProg.done}/{journeyProg.total} 완료{journeyProg.current ? ` · 지금: ${journeyProg.current}` : ''}
          {journeyProg.authWait && (
            <span className="ml-1.5 inline-block animate-pulse rounded-lg bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
              📱 휴대폰에서 인증 승인해 주세요
            </span>
          )}
        </span>
        <span className="inline-flex gap-1.5">
          {journeyProg.current && (
            <button onClick={skipCurrent}
              title="지금 단계만 접고 다음 서류/신청으로 넘어가요(인증이 계속 실패할 때의 탈출구)"
              className="rounded-lg border border-sprout-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-sprout-700 hover:bg-sprout-50">
              ⏭ 이 단계 건너뛰기
            </button>
          )}
          <button onClick={() => cancel(journeyProg.current || docs[0] || '')}
            className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-100">
            ⏹ 전체 중단
          </button>
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full border border-sprout-100 bg-white">
        <div className="h-full rounded-full bg-sprout-500 transition-all duration-500"
          style={{ width: `${journeyProg.total ? Math.max(4, Math.round((journeyProg.done / journeyProg.total) * 100)) : 4}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">한 번 인증으로 순서대로 발급돼요 — 📱 인증 요청이 오면 승인만 해주세요.</p>
    </div>
  ) : null

  // 여정 종결 요약 — 진행률 헤더가 사라진 자리에서 '어떻게 끝났는지' 한 줄로 닫는다(무언 종료 방지)
  const journeySummaryBlock = (!journeyProg && journeySummary) ? (
    <div className="mt-4 flex items-center justify-between gap-2 flex-wrap rounded-2xl border-2 border-sprout-200 bg-white p-3.5 text-xs font-bold" role="status" aria-live="polite">
      <span>{journeySummary.text}</span>
      <span className="inline-flex items-center gap-1.5 shrink-0">
        {/* 실발급 ≥1건 + 내 PC 에이전트일 때만 — 방금 만들어진 PDF를 1클릭으로 확인(데모·실사용 마무리).
            원격/공유 서버의 폴더는 내 것이 아니므로 열지 않는다(실패 메시지는 folderMsg 자리에 뜸). */}
        {journeySummary.issued > 0 && vaultOn && (
          <>
            <button onClick={() => { downloadDocsBundle().catch((e) => setFolderMsg(e instanceof Error ? e.message : '서류 묶음에 실패했어요.')) }}
              title="서류 종류별 최신 1건씩 ZIP 한 파일로 — 복지로 수동 첨부·이메일 제출용"
              className="rounded-lg border border-sprout-200 bg-sprout-50 px-2 py-1 text-[11px] font-semibold text-sprout-700 hover:bg-sprout-100">
              📦 묶음 받기(ZIP)
            </button>
            <button onClick={openFolder}
              title="방금 발급된 PDF가 저장된 폴더를 탐색기로 열어요"
              className="rounded-lg border border-sprout-200 bg-sprout-50 px-2 py-1 text-[11px] font-semibold text-sprout-700 hover:bg-sprout-100">
              🗂 발급물 폴더 열기
            </button>
          </>
        )}
        <button onClick={() => setJourneySummary(null)} aria-label="여정 요약 닫기"
          className="rounded-lg px-1.5 py-0.5 text-muted-foreground hover:bg-sprout-50">✕</button>
      </span>
    </div>
  ) : null

  // ── 슬림 모드: 담은 복지 0 + 에이전트 연결 — 심사·첫 사용에서도 발급 도우미가 동작해야 한다 ──
  if (docNeeds.length === 0) {
    return (
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-extrabold flex items-center gap-2"><FileText className="h-5 w-5 text-sky2-500" /> 서류 발급 도우미</h2>
          <span className="chip-sprout"><Bot className="h-3.5 w-3.5" /> 자동발급 가능</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          아직 담은 복지가 없어도 괜찮아요 — 필요한 증명서를 골라 <b>한 번 인증으로 자동발급</b>해 두면, 나중에 복지 신청 때 자동첨부돼요.
          <span className="block mt-0.5 text-xs">🔒 카카오 본인인증은 보안을 위해 본인이 직접 진행해요.</span>
        </p>
        <div className="mt-3"><AgentStatusStrip /></div>
        {caps?.rpaRemote && (
          <p className="mt-2 text-xs text-amber-700">🔒 내 서버로 자동발급 중 — 이름·생년월일·연락처가 지정 서버를 거쳐요(본인인증은 내 폰에서).</p>
        )}
        <div ref={rpaFormRef}><RpaInfoForm /></div>
        {freePickerBlock}
        {folderMsg && <p className="mt-2 text-xs text-amber-700">{folderMsg}</p>}
        {journeyProgBlock}
        {journeySummaryBlock}
        {vaultOn && <DocVault onReissue={reissueFromVault} />}
      </motion.section>
    )
  }

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
      {/* 📎 내 서류함 파일 선택(숨김) — '등록' 클릭 시 열리고, 선택하면 로컬 서버 발급 폴더에 저장 */}
      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        className="hidden" onChange={onFilePicked} aria-hidden="true" tabIndex={-1} />
      {/* 📷 서류 촬영 모달 — 완성 PDF를 서류함 등록(데스크탑) 또는 내려받기(웹) */}
      {cameraFor && (
        <DocCameraModal
          docName={cameraFor}
          onClose={() => setCameraFor(null)}
          onComplete={(pdf) => registerBlob(cameraFor, new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${cameraFor}.pdf`)}
        />
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-extrabold flex items-center gap-2"><FileText className="h-5 w-5 text-sky2-500" /> 서류 준비 도우미</h2>
        {backend ? (
          <span className="chip-sprout"><Bot className="h-3.5 w-3.5" /> 자동발급 가능</span>
        ) : certDocs.length > 0 ? (
          <span className="chip-sprout">📄 무설치 전자발급</span>
        ) : (
          <span className="chip-sky">공식 사이트 바로가기</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        담은 복지에 필요한 서류 {docs.length}종이에요. {backend ? '에이전트로 자동 발급하거나 발급처로 바로 이동하세요.' : '설치 없이 전자증명서로 발급하거나 발급처로 바로 이동하세요.'}
        {backend && <span className="block mt-0.5 text-xs">🔒 카카오 본인인증은 보안을 위해 본인이 직접 진행해요.</span>}
      </p>

      {/* 🤖 에이전트 상태 스트립 — 연결·버전·발급 슬롯 + 사전 브라우저 점검(데스크탑) */}
      {localAgent && <div className="mt-3"><AgentStatusStrip /></div>}

      {/* ⭐ 무설치 전자발급(전자증명서) — 권장 기본 경로. 확장·서버 없이 정부 공식 유통망으로 발급·제출.
          CTA는 남은 첫 서류의 민원 딥링크로 직결 — 발급 후 돌아와 완료 표시하면 다음 서류를 이어서 안내
          (정부24 로그인 세션이 유지되므로 확장의 '한 번 인증으로 이어서'를 무설치로 재현). */}
      {!ext && certDocs.length > 0 && (
        <div className="mt-3 rounded-2xl border-2 border-sprout-200 bg-gradient-to-br from-sprout-50 to-emerald-50 p-3.5">
          <p className="text-sm font-extrabold flex items-center gap-1.5">📄 설치 없이 <span className="gradient-text">전자증명서</span>로 발급하기 <span className="chip-sprout !py-0.5 text-[10px]">권장</span></p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            남은 <b>{certDocs.length}종</b>{certAll.length > certDocs.length && <> (총 {certAll.length}종 중 {certAll.length - certDocs.length}종 발급 완료)</>}은
            프로그램 설치 없이 정부24·건보공단 등 <b>공식 사이트에서 전자문서로 바로</b> 발급돼요.
            정부24 발급 화면이라면 <b>'수령방법'에서 [전자문서지갑]을 선택</b> — 복지로·주민센터에 <b>종이 없이 전자제출</b>까지 돼요(정부 공식 방식).
            <b> 본인인증만 직접</b> 하시면 됩니다 · 🔒 개인정보는 서버로 안 나가요.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={docLink(certDocs[0]).url} target="_blank" rel="noopener noreferrer"
              onClick={() => openIssue(certDocs[0])}
              className="btn-primary !px-3 !py-2 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 지금 「{certDocs[0]}」 전자발급 시작
            </a>
            {certDocs.length > 1 && (
              <span className="text-[11px] text-muted-foreground">
                발급 후 돌아오면 다음 서류를 이어서 안내해요(같은 사이트 서류는 한 번 로그인으로 이어져요)
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <a href={CERT_WALLET.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground/80 hover:underline">
              전자문서지갑이 뭔가요? →
            </a>
            <a
              href="https://github.com/BioCode67/modoo-bom/tree/main/extension#설치-개발자-모드--데모"
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground/80 hover:underline"
            >
              고급: 크롬 확장으로 자동화도 가능해요 →
            </a>
          </div>
        </div>
      )}
      {/* 백엔드(로컬 에이전트·확장·옵트인 원격 서버)가 없을 때만: 설치 없이 '내 서버'로 자동발급 옵트인(고급) */}
      {!backend && <div className="mt-3"><RemoteRpaSetup /></div>}
      {backend && <div ref={rpaFormRef}><RpaInfoForm /></div>}
      {/* 옵트인 원격 서버로 연결된 경우: 내 정보가 서버를 거친다는 안내 유지(정직성) */}
      {localAgent && caps?.rpaRemote && (
        <p className="mt-2 text-xs text-amber-700">🔒 내 서버로 자동발급 중 — 이름·생년월일·연락처가 지정 서버를 거쳐요(본인인증은 내 폰에서).</p>
      )}

      {/* 🚀 연쇄 자동발급 — 확장이 있고 지원 서류가 2개 이상일 때 */}
      {/* 연쇄 자동발급 — 확장(전체) 또는 로컬 에이전트(데스크탑앱, 로컬 지원분)로 한 번 인증에 이어서 발급 */}
      {(ext || localAgent) && chainDocs.length > 1 && (
        <div className="mt-3">
          <button onClick={startAll} className="btn-primary w-full !py-2.5 text-sm">
            🚀 {vaultCovered.length > 0
              ? `부족한 서류 ${chainDocs.length}종만 자동발급`
              : `필요한 서류 ${chainDocs.length}종 전부 자동발급`}{!ext && chainApply && chainSvcs.length > 0 ? ' + 자동신청까지' : ''} (한 번 인증으로 이어서)
          </button>
          {/* 🗂 서류함 실파일 기준 스마트 스킵 가시화 — '왜 n종만 발급하는지'를 숨기지 않는다 */}
          {!ext && vaultCovered.length > 0 && (
            <p className="mt-1.5 text-[11px] font-medium text-sky2-700">
              🗂 서류함에 이미 유효한 <b>{vaultCovered.length}종</b>({vaultCovered.slice(0, 3).join(' · ')}{vaultCovered.length > 3 ? ' 외' : ''})이 있어 건너뛰어요 — 신청 때 그 파일이 자동첨부돼요
            </p>
          )}
          {/* 발급→신청 원클릭 연쇄(데스크탑) — 발급이 끝나면 담은 복지의 신청 양식까지 이어서 작성·자동첨부.
              최종 제출은 언제나 본인(제출 직전 정지) — 켜져 있어도 비가역 행위는 일어나지 않는다. */}
          {!ext && localAgent && chainSvcs.length > 0 && (
            <label className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={chainApply} onChange={(e) => setChainApply(e.target.checked)} className="mt-0.5 accent-sprout-600" />
              <span>발급이 끝나면 <b className="text-sprout-700">{chainSvcs.slice(0, 2).join(' · ')}{chainSvcs.length > 2 ? ` 외 ${chainSvcs.length - 2}건` : ''}</b> 자동신청까지 이어서
                — 방금 발급한 서류를 양식에 자동첨부하고 <b>제출 직전에 멈춰요</b>(제출은 본인 확인 후)</span>
            </label>
          )}
        </div>
      )}

      {/* 📨 서류는 준비 완료 + 신청만 남음 — 발급 0건 여정으로 자동신청만(제출 직전 정지는 동일) */}
      {!ext && localAgent && chainDocs.length === 0 && chainSvcs.length > 0
        && (vaultCovered.length > 0 || docs.some((d) => isDocDone(d))) && (
        <div className="mt-3">
          <button onClick={startApplyOnly} className="btn-primary w-full !py-2.5 text-sm">
            📨 서류는 준비 완료 — {chainSvcs.slice(0, 2).join(' · ')}{chainSvcs.length > 2 ? ` 외 ${chainSvcs.length - 2}건` : ''} 자동신청만 진행 (제출 직전 정지)
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground">🗂 서류함의 유효한 발급물을 신청 양식에 자동첨부해요 · 최종 제출은 본인 확인 후예요</p>
          {applyOnlyMsg && <p className="mt-1 text-[11px] font-semibold text-rose-600">{applyOnlyMsg}</p>}
        </div>
      )}

      {/* 🗂 자유 선택 일괄발급(데스크탑) — 슬림 모드와 공유(정의는 return 직전) */}
      {freePickerBlock}

      {/* 🔍 진단 복사 — 발급이 멈추거나 오류일 때만 노출(완료는 제외 — 성공 후에도 뜨면 오해) */}
      {ext && Object.values(rpa).some((s) => s && (s.status === 'error' || (!['done', 'completed'].includes(s.status) && s.at && Date.now() - s.at > 30000))) && (
        <button
          onClick={async () => {
            const t = await getExtensionTrace()
            if (t) { try { await navigator.clipboard.writeText(t); setDiagCopied(true); setTimeout(() => setDiagCopied(false), 3000) } catch { /* noop */ } }
          }}
          className="btn-secondary w-full mt-2 !py-2 text-xs"
        >
          {diagCopied ? '✅ 진단이 복사됐어요 — 개발자에게 붙여넣어 주세요' : '🔍 진단 복사 (발급이 안 될 때 눌러 신고)'}
        </button>
      )}

      {folderMsg && <p className="mt-2 text-xs text-amber-700">{folderMsg}</p>}

      {/* 🚀 여정 진행률 헤더 + 종결 요약 — 슬림 모드와 공유(정의는 return 직전) */}
      {journeyProgBlock}
      {journeySummaryBlock}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {docs.map((doc) => {
          const link = docLink(doc)
          // 확장 있으면 13종, 로컬 백엔드만이면 로컬 지원 15종만 '자동' 표시(과대 표시 시 클릭 오류 — 감사 실측)
          const supported = ext ? isRpaSupported(doc) : isRpaSupported(doc, 'local')
          const kind = certKind(doc) // 'wallet'=전자증명서(지갑 유통) · 'online'=온라인 발급 · undefined=오프라인/본인준비
          const done = isDocDone(doc)
          const st = rpa[doc]
          // 자동발급도 전자발급도 안 되는 '본인 준비물'(임대차계약서·신분증 등) — '내 서류함'에 파일 등록 대상
          const userProvided = !supported && !kind
          const regMsg = registered[doc]
          // 진행 중(비종결) 여부 — 버튼 중복기동 방지 + [중단] 노출 판단(감사 :438)
          const active = !!(st && !['done', 'completed', 'error', 'cancelled'].includes(st.status))
          // 30초 넘게 진행상태가 안 오면(새 탭에서 사용자 조작 대기 등) 웹에서도 정직하게 안내
          const stale = !!(st && !['done', 'completed', 'error', 'cancelled'].includes(st.status) && st.at && Date.now() - st.at > 30000 && tick >= 0)
          return (
            // flex-wrap + 제목 최소폭 — 큰글씨 모드×390px에서 버튼이 폭을 다 먹어 제목이 '주..'로
            // 뭉개지던 실측 문제. 좁으면 버튼들이 아랫줄로 내려가고 서류명은 항상 읽힌다(어르신 1순위).
            <div key={doc} className={cn('card-cute p-4 flex flex-wrap items-center gap-3', done && 'opacity-75')}>
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', done ? 'bg-success-50 text-success-500' : 'bg-sky2-100 text-sky2-700')}>
                {done ? <CheckCircle2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-[9rem]">
                <p className={cn('font-bold text-sm', done && 'line-through decoration-success-500/60')}>{doc}</p>
                {/* 정규화로 합쳐진 원 표기 병기 — 정책이 요구한 이름과 발급물 이름이 달라도 어리둥절하지 않게 */}
                {(docVariants.get(doc)?.length ?? 0) > 0 && (
                  <p className="text-[10px] text-muted-foreground/80 truncate" title={docVariants.get(doc)!.join(', ')}>
                    정책 표기: {docVariants.get(doc)!.slice(0, 2).join(' · ')}{docVariants.get(doc)!.length > 2 ? ' 외' : ''} — 이 서류로 충족돼요
                  </p>
                )}
                {/* 대체 발급물 힌트 — 다른 문서지만 통상 이걸로 충족(자동 편입은 안 함 — 제출처 확인 필요).
                    자동발급 미지원이면 전자발급형이어도 안내(예: '수급자 확인서' → 기초생활수급자 증명서 자동발급) */}
                {!supported && substituteIssuableDoc(doc) && (
                  <p className="text-[10px] font-semibold text-sprout-700">
                    💡 보통 「{substituteIssuableDoc(doc)}」(자동발급 지원)으로 충족돼요 — 제출처 요구를 확인해 보세요
                  </p>
                )}
                {regMsg ? (
                  <p className={cn('text-xs font-semibold mt-0.5', regMsg.startsWith('✅') ? 'text-success-600' : regMsg === '등록 중…' ? 'text-sky2-700' : 'text-rose-600')}>{regMsg}</p>
                ) : done && !(st && (st.status === 'done' || st.status === 'completed') && st.saved) ? (
                  // 발급완료 표시(수동 체크 or 자동발급 성공 기억) — 단, 방금 발급 성공(st.saved)이면
                  //   그 결과 UI('발급 문서 받기'·저장 위치)가 우선(자동 docDone 기억이 링크를 가리지 않게)
                  <p className="text-xs text-success-600 font-semibold">발급 완료로 표시했어요</p>
                ) : st ? (
                  <>
                  {/* 자동발급 진행/완료/오류를 스크린리더가 즉시 읽도록 라이브 영역으로 */}
                  <p className="text-xs flex items-center gap-1 mt-0.5" role="status" aria-live="polite">
                    {st.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                      // 발급까지 진행됐지만 문서 저장을 확정 못 한 'done'(saved 없음)은 초록 성공이 아니라 주의(amber)로 — 과장 방지
                      : (st.status === 'done' || st.status === 'completed') && !st.saved ? <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                      : st.status === 'done' || st.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />
                      : <Loader2 className="h-3.5 w-3.5 animate-spin text-sky2-500" />}
                    <span className="text-muted-foreground truncate">{st.step || st.status}</span>
                  </p>
                  {/* 최근 단계 로그 — 지금까지 무엇을 했는지 한눈에(진행상황 불투명 피드백) */}
                  {st.stepsTail && st.stepsTail.length > 1 && !['done', 'completed'].includes(st.status) && (
                    <ul className="mt-1 space-y-0.5">
                      {st.stepsTail.slice(0, -1).map((line, li) => (
                        <li key={li} className="text-[10px] text-muted-foreground/70 truncate">· {line}</li>
                      ))}
                    </ul>
                  )}
                  {/* 진행 실화면(토큰 인가) — 에이전트가 지금 보고 있는 정부 페이지를 그대로(멈춤 오인 해소) */}
                  {st.shot && !['done', 'completed', 'error'].includes(st.status) && (
                    <img src={`data:image/jpeg;base64,${st.shot}`} alt="발급 진행 화면"
                      className="mt-1.5 w-full max-h-44 object-cover object-top rounded-lg border border-sprout-100" />
                  )}
                  {/* 발급 완료 + 서버에 문서 저장됨 → 내 브라우저로 바로 받기(확장 없이 인증만 하면 내 손에). 토큰(?t=)으로 인가 */}
                  {(st.status === 'done' || st.status === 'completed') && st.saved && st.taskId && st.downloadToken && (
                    <a
                      href={`${getRpaBase()}/api/documents/rpa-file/${st.taskId}?t=${encodeURIComponent(st.downloadToken)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="btn-primary !px-3 !py-1.5 mt-1.5 text-xs inline-flex"
                    >
                      <FileText className="h-3.5 w-3.5" /> 발급 문서 받기 (PDF)
                    </a>
                  )}
                  {/* 어디 저장됐는지 명시 — 파일명까지(알기 쉬운 이름: 서류명_이름_날짜) */}
                  {(st.status === 'done' || st.status === 'completed') && st.savedPath && (
                    <p className="mt-1.5 rounded-lg bg-sprout-50 px-2 py-1.5 text-[11px] leading-relaxed text-sprout-800 break-all">
                      🗂 <b>{shortPath(st.savedPath)}</b>
                      {isLocalAgentBase && (
                        <button onClick={openFolder} className="ml-1.5 underline font-semibold shrink-0">저장 폴더 열기</button>
                      )}
                    </p>
                  )}
                  {stale && (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      {ext
                        ? <>진행이 잠시 멈춘 듯해요 — 확장이 연 <b>정부 사이트 탭</b>을 확인해 주세요(본인인증 등 직접 눌러야 하는 단계일 수 있어요). 안 되면 </>
                        : <>자동발급이 지연되고 있어요. 안 되면 </>}
                      <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline font-semibold">공식 사이트에서 직접 발급</a>하세요.
                    </p>
                  )}
                  </>
                ) : (
                  <>
                    <p className="text-xs text-sprout-700 font-semibold truncate">{needText(doc)}</p>
                    <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                      {kind === 'wallet' && <span className="chip-sprout !py-0 !px-1.5 text-[9px] shrink-0">무설치 전자발급</span>}
                      {kind === 'online' && <span className="chip-sky !py-0 !px-1.5 text-[9px] shrink-0">온라인 발급</span>}
                      <span className="truncate">{link.label}</span>
                    </p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5 items-center">
                {/* 진행 중이면 [중단] 노출(로컬 에이전트 취소 API) — 멈춘 카드의 복구 수단(감사) */}
                {!done && active && localAgent ? (
                  <button onClick={() => cancel(doc)} className="rounded-xl border-2 border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition-colors">
                    ⏹ 중단
                  </button>
                ) : !done && backend && supported && (
                  // 진행 중(비종결)이면 중복 기동 금지 — 과거 'running' 한정이라 queued/waiting_login 중 재클릭으로
                  //   같은 서류가 슬롯 2개를 소진하던 결함(감사 :438) 차단.
                  <button onClick={() => startRpa(doc)} disabled={active} className="btn-primary !px-3 !py-2 text-xs disabled:opacity-50">
                    <Bot className="h-4 w-4" /> 자동
                  </button>
                )}
                {/* 전자증명서 발급 가능한 서류는 '전자발급'으로 강조(무설치 기본 경로) —
                    클릭 시 이름 클립보드 준비 + 복귀 확인 대기(발급 완료를 앱이 기억하게) */}
                {/* 자동발급 불가 '본인 준비물'(임대차계약서·신분증 등): 데스크탑앱이면 '내 파일 등록'(→ 신청 자동첨부),
                    웹이면 정직하게 '본인 준비물' 칩(포털 홈 가짜 '발급' 버튼 금지, 감사 확정). */}
                {!done && userProvided ? (
                  <>
                    {/* 📷 촬영 → 자동 대비 보정 + 제출용 PDF. 데스크탑은 서류함 등록(자동첨부), 웹은 PDF 내려받기. */}
                    <button
                      onClick={() => setCameraFor(doc)}
                      title="촬영하면 보정해서 제출용 PDF로 만들어요"
                      className="btn-primary !px-2.5 !py-2 text-xs whitespace-nowrap"
                    >
                      📷 촬영
                    </button>
                    {vaultOn && (
                      <button
                        onClick={() => pickFileFor(doc)}
                        title="내가 가진 파일(PDF·사진)을 등록하면 신청할 때 자동으로 첨부돼요"
                        className="btn-secondary !px-2.5 !py-2 text-xs whitespace-nowrap"
                      >
                        📎 {regMsg?.startsWith('✅') ? '다시' : '파일'}
                      </button>
                    )}
                  </>
                ) : !done && /본인 (준비|지참|보관)/.test(link.label) ? (
                  <span className="rounded-xl border-2 border-sprout-100 bg-sprout-50/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    본인 준비물
                  </span>
                ) : !done && (
                  <a
                    href={link.url} target="_blank" rel="noopener noreferrer"
                    onClick={kind ? () => openIssue(doc) : undefined}
                    className={kind === 'wallet' && !backend ? 'btn-primary !px-3 !py-2 text-xs' : 'btn-secondary !px-3 !py-2 text-xs'}
                  >
                    <ExternalLink className="h-4 w-4" /> {kind === 'wallet' ? '전자발급' : '발급'}
                  </a>
                )}
                {/* 🔎 아직 자동발급 미지원 + 본인 PC 에이전트 → 정부24 실측으로 지원 확장 시도(β).
                    날조 금지: 실측 통과분만, 실패는 정직 보고 — 패널의 ProbeCoverage가 진행·결과를 보여준다 */}
                {!done && vaultOn && !supported && !userProvided && (
                  <button
                    onClick={() => { setPickOpen(true); requestProbe(doc) }}
                    title="정부24를 실측 조사해 이 서류가 자동발급 가능하면 목록에 바로 추가해요(β · 로그인·개인정보 없이)"
                    className="rounded-xl border-2 border-sky2-100 bg-white px-2.5 py-2 text-xs font-semibold text-sky2-700 hover:border-sky2-300 whitespace-nowrap transition-colors"
                  >
                    🔎 자동 확인
                  </button>
                )}
                <button
                  onClick={() => toggleDocDone(doc)}
                  aria-pressed={done}
                  aria-label={done ? `${doc} 발급 완료 표시 취소` : `${doc} 발급 완료로 표시`}
                  title={done ? '완료 표시 취소' : '발급 완료로 표시'}
                  className={cn('rounded-xl border-2 p-2 transition-colors',
                    done ? 'border-success-500/40 bg-success-50 text-success-600 hover:bg-success-50/60' : 'border-sprout-100 bg-white text-muted-foreground hover:border-sprout-300 hover:text-sprout-700')}
                >
                  {done ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 📨 여정의 '자동신청' 단계 카드 — 서류 카드가 없는 apply 단계(청년월세지원 등)의 진행/결과 가시화.
          (pollJourney가 모든 단계를 rpa 맵에 쓰므로, 서류 목록에 없는 키 = 신청 단계) */}
      {Object.entries(rpa).filter(([k, v]) => v && !docs.includes(k)).map(([svc, st]) => (
        <div key={svc} className={cn('mt-3 flex items-start gap-3 rounded-2xl border-2 p-3.5',
          ['done', 'completed'].includes(st!.status) && st!.success !== true
            ? 'border-amber-200 bg-amber-50/50'
            : 'border-sky2-100 bg-sky2-50/40')}>
          <span className="mt-0.5 shrink-0">
            {st!.status === 'error' ? <AlertCircle className="h-4 w-4 text-rose-500" />
              : ['done', 'completed'].includes(st!.status) && st!.success === true ? <CheckCircle2 className="h-4 w-4 text-success-500" />
              : ['done', 'completed'].includes(st!.status) ? <AlertCircle className="h-4 w-4 text-amber-600" />
              : st!.status === 'cancelled' ? <AlertCircle className="h-4 w-4 text-muted-foreground" />
              : <Loader2 className="h-4 w-4 animate-spin text-sky2-500" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">📨 자동신청 — {svc}</p>
            <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{st!.step || '진행 중…'}</p>
            {['done', 'completed'].includes(st!.status) && st!.success === true && (() => {
              // 원클릭 연쇄로 연 신청도 드로어의 단건 신청과 같은 '제출 완료 기록' 경로를 가진다 —
              // 사용자가 직접 눌러야만 기록(자동 낙관처리 금지). 기록 여부는 스토어(tracked.status)가 진실.
              const item = tracked.find((t) => getPolicyMap()[t.policyId]?.name === svc)
              return (
                <>
                  <p className="mt-1 text-[11px] font-semibold text-sprout-700">열린 브라우저 창에서 내용 확인 후 <b>최종 제출은 본인이 직접</b> 해주세요.</p>
                  {item && (item.status === 'applied' || item.status === 'done' ? (
                    <span className="mt-1.5 inline-block rounded-xl border border-success-500/30 bg-success-50 px-3 py-1.5 text-[11px] font-bold text-success-600">
                      ✅ 신청 완료로 기록했어요 — 담은 복지 카드의 모니터링이 진행 점검을 챙겨드려요
                    </span>
                  ) : (
                    <button
                      onClick={() => setStatus(item.policyId, 'applied')}
                      className="mt-1.5 rounded-xl border-2 border-success-500/40 bg-success-50 px-3 py-1.5 text-[11px] font-bold text-success-600 hover:bg-success-50/70">
                      ✓ 제출까지 마쳤어요 — 신청 완료로 기록
                    </button>
                  ))}
                </>
              )
            })()}
            {['done', 'completed'].includes(st!.status) && st!.success !== true && (
              <p className="mt-1.5 rounded-lg border border-amber-200 bg-white/70 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-amber-800">
                자동 입력·첨부가 끝난 것으로 확인되지 않았어요. 열린 복지로 창에서 신청 양식을 직접 열고 내용을 확인해 주세요.
              </p>
            )}
          </div>
        </div>
      ))}

      {/* 🗂 내 서류함 — 데스크탑 에이전트에서만(이 PC 폴더의 발급/등록물 가시화 + 자동첨부 후보 표시) */}
      {vaultOn && <DocVault onReissue={reissueFromVault} />}
    </motion.section>
  )
}
