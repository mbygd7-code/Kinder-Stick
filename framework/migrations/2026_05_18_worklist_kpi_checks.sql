-- =====================================================================
-- 2026-05-18 — kso_worklist_kpi_checks (팀 공유 KPI 체크 진행 상태)
-- =====================================================================
-- 목적:
--   워크리스트 카드의 검증 KPI 체크박스 상태를 워크스페이스 단위로 영구 저장.
--   - 같은 팀의 다른 멤버가 체크해도 즉시 보임 → 협업 가능
--   - 새 기기·시크릿 모드에서도 진행 상태 복원
--   - localStorage 는 1차(즉시) 캐시, Supabase 는 2차(공유) 캐시 + 영구 저장
--
-- 키 설계:
--   PRIMARY KEY (workspace_id, task_id)
--   - task 단위로 체크 항목 인덱스 배열을 통째로 저장.
--   - 인덱스 의미는 해당 task 의 playbook KPI 배열 순서에 종속 →
--     playbook 이 재생성되어 KPI 순서/개수가 바뀌면 stale 인덱스가 생길 수
--     있으나, 클라이언트가 `i < kpis.length` 필터로 무시함.
--
-- 인증:
--   기존 패턴(kso_ops_context, kso_worklist_playbooks 와 동일):
--     - service_role 키만 접근 (RLS 활성화 + 정책 없음)
--     - PIN 세션 검증은 라우트의 getCurrentProfile() 가 수행
--     - anon/authenticated 는 모두 차단
--
-- 실행:
--   Supabase Dashboard → SQL Editor → New query → 본 파일 전체 붙여넣기 → Run
-- =====================================================================

create table if not exists public.kso_worklist_kpi_checks (
  workspace_id text not null,
  task_id      text not null,
  checked      int[] not null default '{}',     -- KPI 인덱스 배열 (0-based)
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.kso_profiles(id),
  primary key (workspace_id, task_id)
);

comment on table public.kso_worklist_kpi_checks is
  '팀 공유 KPI 체크 진행 상태. workspace_id + task_id 단위로 통합.';

comment on column public.kso_worklist_kpi_checks.checked is
  'KPI playbook 배열의 체크된 인덱스(int) 목록. 0-based. 순서 무관.';

-- 빠른 hydrate: 워크리스트 페이지 mount 시 모든 task 의 체크 상태 한 번에
create index if not exists idx_kso_worklist_kpi_checks_ws
  on public.kso_worklist_kpi_checks (workspace_id);

-- updated_at 자동 갱신 트리거
create or replace function public.kso_worklist_kpi_checks_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_kso_worklist_kpi_checks_touch on public.kso_worklist_kpi_checks;
create trigger trg_kso_worklist_kpi_checks_touch
  before update on public.kso_worklist_kpi_checks
  for each row execute function public.kso_worklist_kpi_checks_touch_updated_at();

-- ── RLS ──
-- 정책 없음 → anon/authenticated 모두 차단. service_role 키(서버 라우트)만 접근.
-- 워크스페이스 멤버십 검사는 라우트의 PIN 세션 핸들러에서 수행.
alter table public.kso_worklist_kpi_checks enable row level security;

-- =====================================================================
-- 검증:
--   SELECT * FROM kso_worklist_kpi_checks LIMIT 1;     -- 빈 결과 OK
--   \d kso_worklist_kpi_checks                          -- 스키마 확인
-- =====================================================================
