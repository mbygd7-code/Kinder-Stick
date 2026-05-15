-- =====================================================================
-- 2026-05-17 — kso_worklist_playbooks (팀 공유 AI playbook 캐시)
-- =====================================================================
-- 목적:
--   워크리스트의 AI 자동생성 playbook 결과를 워크스페이스 단위로 영구
--   저장 → 같은 팀의 다른 직원도 즉시 같은 결과를 보게 함.
--   localStorage 캐시는 1차(즉시) 캐시로 유지, Supabase 는 2차(공유) 캐시
--   + 새 사용자/기기 hydrate 용.
--
-- 키 설계:
--   PRIMARY KEY (workspace_id, task_id, task_hash, ops_hash)
--   - task_hash: task 정의(title/why/team/...) 의 콘텐츠 해시 → 정의 동일 시 재사용
--   - ops_hash: ops_context 의 해시 (없으면 'generic')
--                → 같은 회사 정보 + 같은 task 면 재사용, 정보 바뀌면 새 행 생성
--   - workspace_id 단위 격리
--
-- 인증:
--   기존 패턴(kso_ops_context, kso_surveys 와 동일)을 따른다 — 모든 접근은
--   PIN 세션 검증을 거친 서버 라우트(service_role 키)를 통해서만. RLS 는 활성화
--   하지만 정책을 두지 않음 → anon/authenticated 는 모두 차단, service_role 만 통과.
--
-- 실행:
--   Supabase Dashboard → SQL Editor → New query → 본 파일 전체 붙여넣기 → Run
--   (kso_workspace_members 같은 별도 멤버십 테이블 의존 없음)
-- =====================================================================

create table if not exists public.kso_worklist_playbooks (
  workspace_id text not null,
  task_id      text not null,
  task_hash    text not null,
  ops_hash     text not null default 'generic',
  data         jsonb not null,                 -- PlaybookData (summary/output/steps/kpis/sample/pitfalls/references/model/generated_at)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, task_id, task_hash, ops_hash)
);

comment on table public.kso_worklist_playbooks is
  '팀 공유 AI playbook 캐시. workspace_id + task_hash + ops_hash 단위로 dedupe.';

-- 빠른 조회: 특정 워크스페이스의 모든 캐시 한 번에 (hydrate 시)
create index if not exists idx_kso_worklist_playbooks_ws
  on public.kso_worklist_playbooks (workspace_id);

-- TaskHash 가 stale 한 행 cleanup 을 위한 보조 인덱스
create index if not exists idx_kso_worklist_playbooks_task
  on public.kso_worklist_playbooks (task_id, task_hash);

-- updated_at 자동 갱신 트리거
create or replace function public.kso_worklist_playbooks_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_kso_worklist_playbooks_touch on public.kso_worklist_playbooks;
create trigger trg_kso_worklist_playbooks_touch
  before update on public.kso_worklist_playbooks
  for each row execute function public.kso_worklist_playbooks_touch_updated_at();

-- ── RLS ──
-- 정책 없음 → anon/authenticated 모두 차단. service_role 키(서버 라우트)만 접근.
-- 워크스페이스 멤버십 검사는 라우트의 PIN 세션 핸들러에서 수행.
alter table public.kso_worklist_playbooks enable row level security;

-- =====================================================================
-- 검증:
--   SELECT * FROM kso_worklist_playbooks LIMIT 1;     -- 빈 결과 OK
--   \d kso_worklist_playbooks                          -- 스키마 확인
-- =====================================================================
