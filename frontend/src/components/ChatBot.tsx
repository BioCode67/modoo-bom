import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send, Loader2, Bot, User, Sparkles } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'status'
  content: string
  relatedPolicies?: { id: string; name: string; category: string }[]
}

const SUGGESTIONS = [
  '65세인데 받을 수 있는 혜택이 뭐가 있나요?',
  '청년 저축 지원 어떻게 신청하나요?',
  '한부모가족 지원금 얼마나 받나요?',
  '장애인 활동지원 신청 방법 알려주세요',
  '실직 후 받을 수 있는 지원은?',
]

export function ChatBot() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: '안녕하세요! 복지 정책 전문 AI 상담사입니다 😊\n궁금한 복지 혜택을 질문해 주세요. 나이·소득·상황을 말씀해 주시면 더 정확한 답변을 드릴 수 있습니다.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      if (!wsRef.current || wsRef.current.readyState > 1) {
        const apiBase = import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:8000`
        const wsUrl = apiBase.replace(/^http/, 'ws') + '/ws/chat'
        wsRef.current = new WebSocket(wsUrl)

        wsRef.current.onmessage = (evt) => {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'searching' || msg.type === 'thinking') {
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.role === 'status') {
                return [...prev.slice(0, -1), { ...last, content: msg.message }]
              }
              return [...prev, { id: Date.now().toString(), role: 'status', content: msg.message }]
            })
          } else if (msg.type === 'answer') {
            setLoading(false)
            setMessages(prev => {
              const filtered = prev.filter(m => m.role !== 'status')
              return [...filtered, {
                id: Date.now().toString(),
                role: 'assistant',
                content: msg.answer,
                relatedPolicies: msg.related_policies,
              }]
            })
          } else if (msg.type === 'error') {
            setLoading(false)
            setMessages(prev => prev.filter(m => m.role !== 'status').concat({
              id: Date.now().toString(),
              role: 'assistant',
              content: '죄송합니다, 오류가 발생했습니다. 다시 질문해 주세요.',
            }))
          }
        }

        wsRef.current.onerror = () => {
          setLoading(false)
          setMessages(prev => prev.filter(m => m.role !== 'status').concat({
            id: Date.now().toString(),
            role: 'assistant',
            content: '서버 연결에 실패했습니다. 백엔드가 실행 중인지 확인해 주세요.',
          }))
        }
      }
    } else {
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [open])

  const send = useCallback((text?: string) => {
    const q = (text ?? input).trim()
    if (!q || loading) return
    if (!wsRef.current || wsRef.current.readyState !== 1) return

    setInput('')
    setLoading(true)
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: q,
    }])

    wsRef.current.send(JSON.stringify({ type: 'question', question: q }))
  }, [input, loading])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/)
      return (
        <p key={i} className={i > 0 ? 'mt-1' : ''}>
          {parts.map((part, j) =>
            part.startsWith('**') && part.endsWith('**')
              ? <strong key={j} className="font-semibold text-blue-900">{part.slice(2, -2)}</strong>
              : <span key={j}>{part}</span>
          )}
        </p>
      )
    })
  }

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full shadow-lg shadow-blue-500/30 transition-all duration-300 ${
          open
            ? 'bg-slate-600 px-4 py-3'
            : 'bg-gradient-to-br from-blue-600 to-indigo-600 px-5 py-3.5 hover:scale-105'
        }`}
        aria-label="복지 상담 챗봇"
      >
        {open ? (
          <><X className="h-5 w-5 text-white" /><span className="text-sm font-semibold text-white">닫기</span></>
        ) : (
          <><MessageCircle className="h-5 w-5 text-white" /><span className="text-sm font-bold text-white">복지 AI 상담</span></>
        )}
      </button>

      {/* 챗봇 패널 */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-[360px] sm:w-[420px] h-[520px] flex flex-col rounded-2xl bg-white border border-border/60 shadow-2xl shadow-slate-900/15 overflow-hidden animate-slide-up">
          {/* 헤더 */}
          <div className="flex items-center gap-3 px-4 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">복지 AI 상담사</p>
              <p className="text-[11px] text-blue-100">120개 정책 기반 · 즉시 답변</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-2 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-green-300 animate-pulse" />
              <span className="text-[10px] text-white font-medium">온라인</span>
            </div>
          </div>

          {/* 메시지 목록 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {messages.map(msg => (
              <div key={msg.id}>
                {msg.role === 'status' ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {msg.content}
                  </div>
                ) : msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="flex items-end gap-2 max-w-[80%]">
                      <div className="rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2.5 text-sm text-white leading-relaxed">
                        {msg.content}
                      </div>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100">
                        <User className="h-3.5 w-3.5 text-blue-600" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end gap-2 max-w-[90%]">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                    </div>
                    <div className="rounded-2xl rounded-bl-sm bg-white border border-border/60 px-3.5 py-2.5 shadow-sm">
                      <div className="text-sm text-foreground leading-relaxed">
                        {renderContent(msg.content)}
                      </div>
                      {msg.relatedPolicies && msg.relatedPolicies.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap gap-1">
                          {msg.relatedPolicies.map(p => (
                            <span key={p.id} className="text-[10px] bg-blue-50 text-blue-700 rounded-full px-2 py-0.5 border border-blue-200">
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* 추천 질문 (메시지 1개일 때만) */}
          {messages.length === 1 && (
            <div className="px-3 py-2 bg-white border-t border-border/40 shrink-0">
              <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">자주 묻는 질문</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.slice(0, 3).map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-[11px] bg-blue-50 text-blue-700 rounded-full px-2.5 py-1 border border-blue-200 hover:bg-blue-100 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 입력창 */}
          <div className="flex items-center gap-2 px-3 py-3 bg-white border-t border-border/40 shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="복지 혜택이 궁금하세요?"
              disabled={loading}
              className="flex-1 rounded-xl border border-border/60 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-50 transition-all"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
