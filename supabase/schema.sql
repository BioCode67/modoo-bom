-- 모두봄(ModooBom) — '나의 복지' 신청 현황 클라우드 동기화 스키마
-- Supabase SQL Editor에 붙여넣고 실행하세요. (사용자별 Row Level Security로 본인 데이터만 접근)

create table if not exists public.tracked_policies (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  policy_id  text        not null,
  data       jsonb       not null,           -- 프론트의 TrackedItem (상태/신청일/점검일/체크서류 등)
  updated_at timestamptz not null default now(),
  primary key (user_id, policy_id)
);

alter table public.tracked_policies enable row level security;

-- 본인(auth.uid()) 행만 조회/삽입/수정/삭제 허용
drop policy if exists "tracked_select_own" on public.tracked_policies;
create policy "tracked_select_own" on public.tracked_policies
  for select using (auth.uid() = user_id);

drop policy if exists "tracked_insert_own" on public.tracked_policies;
create policy "tracked_insert_own" on public.tracked_policies
  for insert with check (auth.uid() = user_id);

drop policy if exists "tracked_update_own" on public.tracked_policies;
create policy "tracked_update_own" on public.tracked_policies
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tracked_delete_own" on public.tracked_policies;
create policy "tracked_delete_own" on public.tracked_policies
  for delete using (auth.uid() = user_id);
