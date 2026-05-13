export type NodeStatus = 'pending' | 'running' | 'done' | 'error'

export interface NodeEvent {
  node: string
  status: NodeStatus
  message: string
  data?: Record<string, unknown>
}

export interface UserProfile {
  name: string
  age: number
  gender: 'male' | 'female' | 'other'
  region: string
  household_type: string
  income_percentile: number
  disability: boolean
  disability_grade: string
  employment_status: string
  has_children: boolean
  children_ages: number[]
  is_pregnant: boolean
  life_events: string[]
}

export interface EligiblePolicy {
  id: string
  name: string
  eligible: boolean
  confidence: number
  reason: string
  priority: 'high' | 'medium' | 'low'
  benefit?: string
  application?: string
  department?: string
  category?: string
}

export interface ApplicationGuide {
  policy_id: string
  policy_name: string
  plain_description: string
  steps: string[]
  tips: string
  estimated_days: number
}

export interface RetrievedDoc {
  success: boolean
  doc_name: string
  receipt_number?: string
  issued_for?: string
  issued_at?: string
  issuing_org?: string
  validity_days?: number
  preview_url?: string
  download_url?: string
  error?: string
  fallback_url?: string
  manual_required?: boolean
  fallback_message?: string
}

export interface Notification {
  trigger: string
  type: string
  title: string
  recommended_policies: string[]
  urgency: 'high' | 'medium' | 'low'
}

export interface TrackedApplication {
  policy_id: string
  policy_name: string
  application_status: string
  applied_at: string
  last_updated: string
  rejection_reason?: string
  alternative?: string
  required_additional_docs?: string[]
}

export interface PortfolioSummary {
  total_eligible: number
  high_priority_count: number
  medium_priority_count: number
  low_priority_count: number
  total_benefit_amount: number
  categories: string[]
  high_priority_policies: { id: string; name: string; reason: string }[]
  all_eligible_names: string[]
  docs_retrieved: number
  docs_pending: number
}

export interface AnalysisResult {
  eligible_policies: EligiblePolicy[]
  application_guides: ApplicationGuide[]
  retrieved_docs: RetrievedDoc[]
  portfolio_summary: PortfolioSummary
  notifications: Notification[]
  tracked_applications: TrackedApplication[]
  final_response: string
  profile_summary: string
}

export type WsMessage =
  | { type: 'start'; message: string; total_nodes: number }
  | { type: 'node_event'; node: string; status: NodeStatus; message: string; data?: Record<string, unknown> }
  | { type: 'complete'; result: AnalysisResult }
  | { type: 'error'; message: string }

export const NODE_LABELS: Record<string, string> = {
  profile_analyzer: '프로필 분석',
  policy_search: 'RAG 정책 검색',
  eligibility_check: '자격 판별 (Claude)',
  reflection_check: 'Reflection 검증',
  guide_generator: '신청 가이드 생성',
  doc_retrieval: '서류 자동 취득',
  portfolio_manager: '포트폴리오 구성',
  notification_agent: '생애이벤트 알림',
  result_tracker: '신청 결과 추적',
  orchestrator: '최종 안내 생성',
}

export const NODE_ORDER = Object.keys(NODE_LABELS)
