-- =====================================================================
-- Kinder Stick OS — Supabase Schema v2
-- 기존 D:\claude_project\Kinder Stick\schema.sql (v1)을 확장한다.
-- v1의 diagnosis_responses 테이블은 보존하되, 정규화된 sub-item 테이블과
-- AI 코칭 / KPI / 외부 AI 호출 / 주간 다이제스트 테이블을 추가한다.
--
-- 실행 위치: Supabase Dashboard → SQL Editor → New query
-- 의존성: Postgres 15+, pgvector, pg_cron, pg_net (Supabase Cloud 기본 활성)
-- =====================================================================

-- 0. EXTENSIONS -------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists vector;        -- pgvector for RAG embeddings
-- pg_cron, pg_net은 Supabase Dashboard → Database → Extensions에서 활성

-- 1. ORGANIZATIONS & USERS -------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stage text check (stage in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus')),
  industry text default 'edtech_korea',
  plan text default 'free',
  active_domains text[] default array['A1','A2','A3','A4','A5','A7'],  -- 소규모 팀 디폴트 6개
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'lead', 'contributor', 'viewer', 'external_expert')),
  domain_leads text[] default '{}',         -- 어떤 도메인 코드를 책임지는지
  invited_by uuid references auth.users(id),
  joined_at timestamptz default now(),
  unique (org_id, user_id)
);

create index if not exists idx_org_members_user on org_members(user_id);

-- 2. SUB-ITEM MASTER (question_bank.yaml에서 빌드 시 INSERT) ----------
create table if not exists sub_items (
  code text primary key,                    -- "A2.SE.40"
  domain_code text not null,                -- "A2"
  group_code text not null,                 -- "A2.SE"
  tier text not null check (tier in ('critical','important','supporting')),
  weight_within_group numeric(4,3) not null,
  belief jsonb not null,                    -- {q, anchors, help}
  evidence jsonb not null,                  -- {q, type, options, kpi_source, refresh_period_days}
  citation text,
  failure_trigger text,                     -- 평가 시 SQL-like 표현, 코드에서 해석
  cadence text check (cadence in ('daily','weekly','monthly','quarterly','semi_annual')),
  data_quality_required smallint default 1 check (data_quality_required between 1 and 3),
  reverse_scoring boolean default false,
  active boolean default true,
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_sub_items_domain on sub_items(domain_code) where active;
create index if not exists idx_sub_items_group on sub_items(group_code) where active;

create table if not exists domain_definitions (
  code text primary key,                    -- "A2"
  name_ko text not null,
  name_en text not null,
  tier text not null check (tier in ('critical','important','supporting')),
  weight numeric(4,2) not null,             -- 합계 100
  threshold_red smallint default 40,
  threshold_yellow smallint default 60,
  threshold_green smallint default 75,
  framework text,
  notes text,
  agent_prompt_id text                      -- agent_prompts/domain_coaches.md의 섹션 키
);

-- 3. DIAGNOSIS RESPONSES (v1 확장) -----------------------------------
-- v1의 diagnosis_responses는 그대로 보존. 새 멀티테넌트 컬럼 추가.
alter table diagnosis_responses
  add column if not exists org_id uuid references organizations(id) on delete cascade,
  add column if not exists session_id uuid,
  add column if not exists anonymous_token text,
  add column if not exists context jsonb default '{}'::jsonb;
  -- responses jsonb는 그대로 (sub_item_code → {belief, evidence, recorded_at, source})

-- 정규화된 응답 테이블 (분석·집계용 — JSONB 풀어두기)
create table if not exists sub_item_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  diagnosis_session_id uuid not null,                       -- diagnosis_responses.session_id 참조
  respondent_id text not null,                              -- auth.users.id::text 또는 anonymous_token
  sub_item_code text not null references sub_items(code),
  belief smallint check (belief between 1 and 5),
  evidence smallint check (evidence between 1 and 5),
  evidence_recorded_at timestamptz default now(),
  data_source text check (data_source in ('self_report','kpi','uploaded_doc')),
  evidence_refs uuid[] default '{}',                        -- evidence_files.id[]
  computed_score numeric(5,2),                              -- 0..100
  computed_at timestamptz default now()
);

create index if not exists idx_sir_org_session on sub_item_responses(org_id, diagnosis_session_id);
create index if not exists idx_sir_sub_item on sub_item_responses(sub_item_code);
create index if not exists idx_sir_recorded_at on sub_item_responses(evidence_recorded_at desc);

-- 4. KPI & EVIDENCE ---------------------------------------------------
create table if not exists kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null,                     -- "stripe","ga4","mixpanel","slack","github","toss","channeltalk"
  metric_key text not null,                 -- "mrr","wau","d1_activation","gross_margin"
  value numeric(20,4),
  captured_at timestamptz default now(),
  raw jsonb,
  anomaly_flag boolean default false,
  anomaly_reason text
);

create index if not exists idx_kpi_org_metric on kpi_snapshots(org_id, metric_key, captured_at desc);
create index if not exists idx_kpi_anomaly on kpi_snapshots(org_id, captured_at desc) where anomaly_flag;

create table if not exists metric_definitions (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  metric_key text not null,
  mapped_sub_item_code text references sub_items(code),
  transform_fn text,                        -- "value < 20 → evidence.v=1; 20-34 → 2; ..."
  threshold_rule jsonb,                     -- {red: "< 20", yellow: "20-34", green: ">= 35"}
  cadence text check (cadence in ('realtime','daily','weekly','monthly')),
  active boolean default true,
  created_at timestamptz default now(),
  unique (source, metric_key)
);

create table if not exists evidence_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text check (kind in ('interview_transcript','financial_csv','screenshot','survey_export','contract','other')),
  storage_path text not null,               -- supabase storage path
  filename text,
  uploader_id uuid references auth.users(id),
  linked_sub_items text[] default '{}',     -- sub_items.code[]
  embedding vector(1024),                   -- voyage-3-large
  redacted_at timestamptz,                  -- PII redaction 시각
  created_at timestamptz default now()
);

create index if not exists idx_evidence_org on evidence_files(org_id, created_at desc);
create index if not exists idx_evidence_embedding on evidence_files using hnsw (embedding vector_cosine_ops);

-- 5. AI COACHING SESSIONS ---------------------------------------------
create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  domain_code text not null references domain_definitions(code),
  state text not null default 'idle' check (state in (
    'idle','triggered','diagnosing','evidence_request','analyzing',
    'escalating_external','action_planning','awaiting_owner_confirm',
    'in_progress','verifying','rescoring','resolved','abandoned'
  )),
  severity smallint check (severity between 1 and 5),
  trigger_kind text,                        -- "kpi_anomaly","diagnosis_score","manual","scheduled"
  trigger_metadata jsonb,
  matched_playbook_id text,                 -- playbooks.yaml의 id
  opened_at timestamptz default now(),
  resolved_at timestamptz,
  summary text,
  created_by uuid references auth.users(id)
);

create index if not exists idx_agent_sessions_org_state on agent_sessions(org_id, state, opened_at desc);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references agent_sessions(id) on delete cascade,
  role text not null check (role in ('system','user','agent','external_expert','tool_result')),
  content jsonb not null,                   -- {finding, evidence[], severity, next_step, confidence}
  evidence_refs uuid[] default '{}',
  tool_calls jsonb default '[]'::jsonb,
  citations jsonb default '[]'::jsonb,
  model text,                               -- "claude-sonnet-4-7"
  tokens_in int,
  tokens_out int,
  created_at timestamptz default now()
);

create index if not exists idx_agent_messages_session on agent_messages(session_id, created_at);

create table if not exists coaching_actions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references agent_sessions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  smart_payload jsonb not null,             -- {specific, measurable, owner_role, deadline_days, verification_metric}
  owner_id uuid references auth.users(id),
  owner_role text,                          -- "Founder","PM","CTO" 등 — 사람 미배정 시
  deadline timestamptz,
  status text default 'proposed' check (status in (
    'proposed','accepted','in_progress','completed','verified','failed','abandoned'
  )),
  external_url text,                        -- Linear/Jira issue URL
  verified_at timestamptz,
  verification_metric jsonb,                -- {metric_key, target, actual}
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_coaching_actions_org_status on coaching_actions(org_id, status, deadline);
create index if not exists idx_coaching_actions_owner on coaching_actions(owner_id, status) where status in ('accepted','in_progress');

-- 6. EXTERNAL AI HANDOFF ----------------------------------------------
create table if not exists external_ai_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references agent_sessions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null,                   -- "meetflow","kisa_consulting","legal_partner"
  request_id uuid not null unique,
  payload jsonb not null,                   -- redacted payload
  callback_secret_hmac text not null,
  response jsonb,
  status text default 'pending' check (status in (
    'pending','dispatched','responded','reviewed','exposed','failed','timeout'
  )),
  cost_krw int,
  hmac_verified boolean default false,
  dispatched_at timestamptz,
  responded_at timestamptz,
  exposed_at timestamptz,
  reviewer_id uuid references auth.users(id),
  reviewer_notes text,
  created_at timestamptz default now()
);

create index if not exists idx_external_ai_status on external_ai_calls(status, dispatched_at);

-- 7. WEEKLY DIGESTS ---------------------------------------------------
create table if not exists weekly_digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  week_of date not null,                    -- 월요일 기준
  summary_md text,
  domains_improved text[],
  domains_worsened text[],
  top_actions uuid[] default '{}',          -- coaching_actions.id[]
  failure_probability_6m numeric(4,3),
  failure_probability_12m numeric(4,3),
  generated_by_model text,
  generated_at timestamptz default now(),
  unique (org_id, week_of)
);

-- 8. SIGNAL FEED ------------------------------------------------------
-- 데일리 신호 피드 — KPI 임계 이탈/액션 변동/세션 진행 등 narrative 이벤트
create table if not exists signal_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null,                       -- "kpi_anomaly","action_completed","domain_score_changed","new_coaching_session"
  domain_code text references domain_definitions(code),
  narrative text not null,                  -- "PMF -5pt: Sean Ellis 38% (목표 40%) → 코칭 시작"
  severity smallint default 2,
  metadata jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_signals_org_recent on signal_events(org_id, created_at desc);

-- =====================================================================
-- 9. ROW LEVEL SECURITY
-- =====================================================================
alter table organizations enable row level security;
alter table org_members enable row level security;
alter table sub_item_responses enable row level security;
alter table kpi_snapshots enable row level security;
alter table evidence_files enable row level security;
alter table agent_sessions enable row level security;
alter table agent_messages enable row level security;
alter table coaching_actions enable row level security;
alter table external_ai_calls enable row level security;
alter table weekly_digests enable row level security;
alter table signal_events enable row level security;

-- helper: 현재 사용자가 속한 org_id 목록
create or replace function current_user_org_ids()
returns setof uuid
language sql
security definer
as $$
  select org_id from org_members where user_id = auth.uid()
$$;

-- 정책은 idempotent하게 — 재실행 시에도 안전하도록 DROP IF EXISTS 후 CREATE
-- ORG_MEMBERS: 본인 + 자기 org의 다른 멤버 보기
drop policy if exists "members can view their org" on org_members;
create policy "members can view their org" on org_members
  for select using (org_id in (select current_user_org_ids()));

-- 일반 org-scoped 정책 — sub_item_responses 등에 동일 패턴 적용
drop policy if exists "org members read sub_item_responses" on sub_item_responses;
create policy "org members read sub_item_responses" on sub_item_responses
  for select using (org_id in (select current_user_org_ids()));
drop policy if exists "org members insert sub_item_responses" on sub_item_responses;
create policy "org members insert sub_item_responses" on sub_item_responses
  for insert with check (org_id in (select current_user_org_ids()));

drop policy if exists "org members read kpi" on kpi_snapshots;
create policy "org members read kpi" on kpi_snapshots
  for select using (org_id in (select current_user_org_ids()));
-- KPI 쓰기는 service_role만 (Edge Function이 ingest)

drop policy if exists "org members read evidence" on evidence_files;
create policy "org members read evidence" on evidence_files
  for select using (org_id in (select current_user_org_ids()));
drop policy if exists "org members insert evidence" on evidence_files;
create policy "org members insert evidence" on evidence_files
  for insert with check (
    org_id in (select current_user_org_ids())
    and uploader_id = auth.uid()
  );

drop policy if exists "org members read agent_sessions" on agent_sessions;
create policy "org members read agent_sessions" on agent_sessions
  for select using (org_id in (select current_user_org_ids()));
drop policy if exists "org admins manage agent_sessions" on agent_sessions;
create policy "org admins manage agent_sessions" on agent_sessions
  for all using (
    org_id in (
      select org_id from org_members
      where user_id = auth.uid() and role in ('owner','admin','lead')
    )
  );

drop policy if exists "org members read agent_messages" on agent_messages;
create policy "org members read agent_messages" on agent_messages
  for select using (
    session_id in (select id from agent_sessions where org_id in (select current_user_org_ids()))
  );

drop policy if exists "org members read coaching_actions" on coaching_actions;
create policy "org members read coaching_actions" on coaching_actions
  for select using (org_id in (select current_user_org_ids()));
drop policy if exists "owners admins or owner_self update coaching_actions" on coaching_actions;
create policy "owners admins or owner_self update coaching_actions" on coaching_actions
  for update using (
    owner_id = auth.uid()
    or org_id in (
      select org_id from org_members where user_id = auth.uid() and role in ('owner','admin')
    )
  );

drop policy if exists "org members read digests" on weekly_digests;
create policy "org members read digests" on weekly_digests
  for select using (org_id in (select current_user_org_ids()));

drop policy if exists "org members read signals" on signal_events;
create policy "org members read signals" on signal_events
  for select using (org_id in (select current_user_org_ids()));

-- 외부 AI 호출 — 결과만 read, 호출/콜백은 service_role
drop policy if exists "org members read external_ai" on external_ai_calls;
create policy "org members read external_ai" on external_ai_calls
  for select using (org_id in (select current_user_org_ids()));

-- =====================================================================
-- 10. RPC FUNCTIONS
-- =====================================================================

-- 다음 회차 번호 (v1 호환)
-- next_respondent_num(ws) — 기존 v1에서 그대로 유지

-- 익명 진단 시 워크스페이스 사후 귀속
create or replace function claim_workspace(
  p_workspace_id text,
  p_org_id uuid
) returns int
language plpgsql
security definer
as $$
declare
  affected int;
begin
  -- 호출자가 해당 org의 owner/admin인지 확인
  if not exists (
    select 1 from org_members
    where org_id = p_org_id and user_id = auth.uid() and role in ('owner','admin')
  ) then
    raise exception 'unauthorized';
  end if;

  update diagnosis_responses
    set org_id = p_org_id
  where workspace_id = p_workspace_id and org_id is null;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- 도메인 점수 계산 (참고용 — 정확한 계산은 코드에서 scoring.md 따라)
create or replace function summarize_domain(
  p_org_id uuid,
  p_session_id uuid,
  p_domain_code text
) returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'domain', p_domain_code,
    'sub_items', jsonb_agg(jsonb_build_object(
      'code', sir.sub_item_code,
      'belief', sir.belief,
      'evidence', sir.evidence,
      'score', sir.computed_score,
      'evidence_recorded_at', sir.evidence_recorded_at
    )),
    'avg_score', avg(sir.computed_score),
    'n_responses', count(*)
  )
  from sub_item_responses sir
  join sub_items si on si.code = sir.sub_item_code
  where sir.org_id = p_org_id
    and sir.diagnosis_session_id = p_session_id
    and si.domain_code = p_domain_code
$$;

-- =====================================================================
-- 11. SCHEDULED JOBS (pg_cron — Supabase에서 활성화 후 등록)
-- =====================================================================
-- select cron.schedule('kpi-sync', '0 21 * * *',  -- 매일 06:00 KST = 21:00 UTC
--   $$ select net.http_post('https://app.kinderstick.io/api/cron/kpi-sync', ...) $$);

-- select cron.schedule('weekly-digest', '0 22 * * 0',  -- 매주 월요일 07:00 KST = 일요일 22:00 UTC
--   $$ select net.http_post('https://app.kinderstick.io/api/cron/weekly-digest', ...) $$);

-- select cron.schedule('deficiency-detector', '*/15 * * * *',
--   $$ insert into agent_sessions (org_id, domain_code, state, severity, trigger_kind, ...) ... $$);

-- =====================================================================
-- 12. SEED DATA (도메인 정의 — question_bank.yaml에서 빌드 스크립트로 INSERT)
-- =====================================================================
-- INSERT INTO domain_definitions (code, name_ko, name_en, tier, weight, ...) VALUES
--   ('A1', '시장-문제 적합성', 'Problem-Market Fit', 'critical', 9, ...),
--   ('A2', '제품-시장 적합성 (PMF)', 'Product-Market Fit', 'critical', 13, ...),
--   ... (14개)

-- 빌드 스크립트는 D:\claude_project\Milo\framework\scripts\seed_from_yaml.ts (engineer가 작성)

-- =====================================================================
-- 검증 쿼리
-- =====================================================================
-- 14개 도메인 등록 확인:
-- select code, name_ko, weight, tier from domain_definitions order by code;

-- sub_items 가중치 합 확인 (각 그룹 내 weight_within_group 합이 1.0):
-- select group_code, sum(weight_within_group) from sub_items group by group_code having sum(weight_within_group) != 1;

-- 도메인 가중치 합 = 100 확인:
-- select sum(weight) from domain_definitions; -- 100 이어야 함

-- RLS 정책 확인:
-- select tablename, policyname, cmd from pg_policies where schemaname='public' order by tablename;
