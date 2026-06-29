import { WELFARE_POLICIES, type Policy } from '@/data/policies'

export const POLICY_MAP: Record<string, Policy> = Object.fromEntries(WELFARE_POLICIES.map((p) => [p.id, p]))
