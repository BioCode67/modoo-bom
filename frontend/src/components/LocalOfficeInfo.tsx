import { MapPin, Phone, Clock, ExternalLink, Search } from 'lucide-react'
import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface Office {
  name: string
  type: '주민센터' | '복지관' | '보건소' | '고용센터' | '건강보험공단'
  region: string
  address: string
  phone: string
  hours: string
  services: string[]
  url?: string
}

const OFFICES: Office[] = [
  { name: '서울 종로구 복지관', type: '복지관', region: '서울특별시', address: '서울시 종로구 삼일대로 428', phone: '02-1234-5678', hours: '평일 09:00~18:00', services: ['기초생활', '노인복지', '장애인복지', '방문상담'], url: 'https://www.bokjiro.go.kr' },
  { name: '서울 강남구 주민센터', type: '주민센터', region: '서울특별시', address: '서울시 강남구 테헤란로 1234', phone: '02-3423-5000', hours: '평일 09:00~18:00', services: ['주민등록', '복지신청', '증명서발급'] },
  { name: '부산 해운대구 복지관', type: '복지관', region: '부산광역시', address: '부산시 해운대구 센텀2로 25', phone: '051-749-4000', hours: '평일 09:00~18:00', services: ['노인복지', '장애인복지', '아동복지'], url: 'https://www.bokjiro.go.kr' },
  { name: '경기 수원시 고용센터', type: '고용센터', region: '경기도', address: '수원시 팔달구 효원로 1', phone: '031-1350', hours: '평일 09:00~18:00', services: ['실업급여', '취업지원', '직업훈련'] },
  { name: '인천 남동구 보건소', type: '보건소', region: '인천광역시', address: '인천시 남동구 소래로701번길 60', phone: '032-453-5000', hours: '평일 09:00~18:00', services: ['의료급여', '건강검진', '장애진단'] },
  { name: '대구 달서구 주민센터', type: '주민센터', region: '대구광역시', address: '대구시 달서구 달구벌대로 1700', phone: '053-667-2000', hours: '평일 09:00~18:00', services: ['복지신청', '주민등록', '증명서발급'] },
  { name: '광주 북구 복지관', type: '복지관', region: '광주광역시', address: '광주시 북구 용봉로 25', phone: '062-000-1234', hours: '평일 09:00~18:00', services: ['노인복지', '아동복지', '장애인복지'] },
  { name: '대전 서구 건강보험공단', type: '건강보험공단', region: '대전광역시', address: '대전시 서구 둔산중로 74', phone: '1577-1000', hours: '평일 09:00~18:00', services: ['보험료 조회', '자격확인', '환급신청'] },
  { name: '경기 성남시 고용센터', type: '고용센터', region: '경기도', address: '성남시 분당구 황새울로 319', phone: '031-1350', hours: '평일 09:00~18:00', services: ['실업급여', '취업지원', '청년취업'] },
  { name: '경기 고양시 복지관', type: '복지관', region: '경기도', address: '고양시 일산동구 중앙로 1275', phone: '031-000-1234', hours: '평일 09:00~18:00', services: ['기초생활', '노인복지', '아동복지'] },
]

const TYPE_CONFIG: Record<string, { bg: string; text: string; border: string; emoji: string }> = {
  '주민센터':     { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',   emoji: '🏛️' },
  '복지관':      { bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200',  emoji: '🏥' },
  '보건소':      { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200',   emoji: '🩺' },
  '고용센터':    { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200', emoji: '💼' },
  '건강보험공단': { bg: 'bg-purple-50', text: 'text-purple-700',  border: 'border-purple-200', emoji: '🏢' },
}

const REGIONS = ['전체', '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '경기도']
const TYPES = ['전체', '주민센터', '복지관', '보건소', '고용센터', '건강보험공단']

interface Props {
  userRegion?: string
}

export function LocalOfficeInfo({ userRegion }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRegion, setSelectedRegion] = useState(userRegion || '전체')
  const [selectedType, setSelectedType] = useState('전체')

  const filtered = useMemo(() => {
    return OFFICES.filter((o) => {
      const matchRegion = selectedRegion === '전체' || o.region === selectedRegion
      const matchType = selectedType === '전체' || o.type === selectedType
      const matchSearch = !searchQuery || o.name.includes(searchQuery) || o.address.includes(searchQuery) || o.services.some((s) => s.includes(searchQuery))
      return matchRegion && matchType && matchSearch
    })
  }, [selectedRegion, selectedType, searchQuery])

  return (
    <div className="space-y-5">
      {/* 안내 배너 */}
      <div className="rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 p-4 flex items-start gap-3">
        <MapPin className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-800">가까운 복지 시설 찾기</p>
          <p className="text-xs text-emerald-600 mt-0.5">
            주민센터, 복지관, 보건소 등에서 전문 상담사와 직접 상담할 수 있습니다.
            복지로(www.bokjiro.go.kr) 또는 전화 129로도 문의 가능합니다.
          </p>
        </div>
      </div>

      {/* 필터 */}
      <div className="space-y-3">
        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="기관명, 주소, 서비스 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 h-10 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {/* 지역 필터 */}
        <div className="flex gap-1.5 flex-wrap">
          {REGIONS.map((r) => (
            <button
              key={r}
              onClick={() => setSelectedRegion(r)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                selectedRegion === r
                  ? 'bg-primary text-white border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40',
              )}
            >
              {r}
            </button>
          ))}
        </div>

        {/* 유형 필터 */}
        <div className="flex gap-1.5 flex-wrap">
          {TYPES.map((t) => {
            const cfg = TYPE_CONFIG[t]
            return (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all',
                  selectedType === t
                    ? 'bg-primary text-white border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {cfg && <span>{cfg.emoji}</span>}
                {t}
              </button>
            )
          })}
        </div>
      </div>

      {/* 결과 */}
      <div className="text-xs text-muted-foreground mb-2">
        {filtered.length}개 기관 표시 중 (전국 기준 대표 기관)
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <MapPin className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((office, i) => {
            const cfg = TYPE_CONFIG[office.type] ?? TYPE_CONFIG['주민센터']
            return (
              <div key={i} className={cn('rounded-2xl border p-4 space-y-3', cfg.bg, cfg.border)}>
                {/* 헤더 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm">{cfg.emoji}</span>
                      <span className={cn('text-[10px] font-bold rounded-full px-2 py-0.5 bg-white/60', cfg.text)}>
                        {office.type}
                      </span>
                    </div>
                    <p className={cn('text-sm font-bold leading-tight', cfg.text)}>{office.name}</p>
                  </div>
                  {office.url && (
                    <a
                      href={office.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn('shrink-0 h-7 w-7 rounded-lg flex items-center justify-center bg-white/60 hover:bg-white transition-colors', cfg.text)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                {/* 상세 정보 */}
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 text-xs text-foreground/70">
                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{office.address}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-foreground/70">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <a href={`tel:${office.phone}`} className="hover:underline">{office.phone}</a>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-foreground/70">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>{office.hours}</span>
                  </div>
                </div>

                {/* 서비스 태그 */}
                <div className="flex flex-wrap gap-1">
                  {office.services.map((s) => (
                    <span key={s} className="rounded-full bg-white/70 text-foreground/70 text-[10px] px-2 py-0.5 font-medium border border-white">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 복지로 링크 */}
      <div className="rounded-2xl bg-muted/40 border border-border/40 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">복지로에서 더 찾기</p>
          <p className="text-xs text-muted-foreground mt-0.5">전국 모든 복지 시설 정보는 복지로에서 확인할 수 있습니다</p>
        </div>
        <a
          href="https://www.bokjiro.go.kr"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1.5 rounded-xl bg-primary text-white px-4 py-2 text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          복지로 바로가기
        </a>
      </div>
    </div>
  )
}
