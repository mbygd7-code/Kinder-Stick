-- ============================================================
-- 2026-05-19: organizations.stage check constraint 갱신
--
-- 문제:
--   schema_v2.sql 의 초기 constraint 는 펀딩 단계(pre_seed/seed/series_a/...) 를
--   허용했으나, 앱 코드(src/lib/scoring.ts:Stage)는 제품 출시 단계
--   (closed_beta / open_beta / ga_early / ga_growth / ga_scale) 를 사용한다.
--   → 모든 organization insert 가 23514 위반으로 실패하며,
--     /api/agent/sessions/start, /api/worklist/kpi-evidence 등 다수 라우트가 500.
--
-- 해결:
--   ⚠ 순서 중요: 옛 constraint 가 'open_beta' 를 거부하므로
--   UPDATE 보다 먼저 constraint 를 제거해야 한다.
--
-- 적용:
--   Supabase Dashboard → SQL Editor 에서 이 파일 전체 실행.
-- ============================================================

begin;

-- 1) 옛 check constraint 먼저 제거 (이래야 다음 UPDATE 가 허용됨)
alter table organizations
  drop constraint if exists organizations_stage_check;

-- 2) 기존 row 정리: app 이 인식 못 하는 stage 값을 default 로 교체
update organizations
   set stage = 'open_beta'
 where stage is null
    or stage not in (
      'closed_beta','open_beta','ga_early','ga_growth','ga_scale'
    );

-- 3) 새 check constraint 추가 (app Stage 와 1:1 매핑)
alter table organizations
  add constraint organizations_stage_check
  check (stage in (
    'closed_beta','open_beta','ga_early','ga_growth','ga_scale'
  ));

-- 4) 기본값 명시
alter table organizations
  alter column stage set default 'open_beta';

commit;
