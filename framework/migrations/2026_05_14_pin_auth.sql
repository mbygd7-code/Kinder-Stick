-- ============================================================================
-- 2026-05-14  Custom PIN auth + team-scoped diagnosis responses
--
-- 이 마이그레이션은 Supabase Auth 와 병행되는 커스텀 PIN 로그인을 추가한다.
--   - kso_profiles: 자체 사용자 테이블 (email + 4-digit PIN hash + team + role)
--   - diagnosis_responses 에 respondent_profile_id, respondent_team 컬럼 추가
--
-- 기존 magic-link 로그인은 보존 (호환). 신규 회원가입은 PIN 사용.
--
-- 실행 방법:
--   1) Supabase Dashboard → SQL Editor → New query
--   2) 아래 전체 내용 붙여넣기 → "Run" 버튼
--   3) 실행 후 Table editor 에서 kso_profiles 가 생성됐는지 확인
--   4) 에러 "relation diagnosis_responses does not exist" 가 나오면 먼저
--      schema_v2.sql 부터 실행 (이 마이그레이션은 그 이후에 적용)
-- ============================================================================

-- ── 1. kso_profiles 자체 사용자 테이블 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS kso_profiles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        NOT NULL UNIQUE,
  pin_hash        text        NOT NULL,                     -- "salt(hex):hash(hex)" (node:crypto scrypt)
  team            text,                                     -- 'director'|'planning'|'design'|
                                                            -- 'engineering'|'operations'|'marketing' 또는 NULL
  role            text        NOT NULL DEFAULT 'member'
                              CHECK (role IN ('admin', 'member')),
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  failed_attempts int         NOT NULL DEFAULT 0,
  locked_until    timestamptz
);

COMMENT ON TABLE  kso_profiles                IS 'Custom PIN-auth user profiles (병행: Supabase auth.users)';
COMMENT ON COLUMN kso_profiles.email          IS 'lowercase 이메일 — 로그인 ID';
COMMENT ON COLUMN kso_profiles.pin_hash       IS '4자리 PIN 의 scrypt 해시. "salt(hex):hash(hex)" 형태';
COMMENT ON COLUMN kso_profiles.team           IS 'director/planning/design/engineering/operations/marketing 또는 NULL';
COMMENT ON COLUMN kso_profiles.role           IS 'admin (전 권한) 또는 member (자기 팀 시각만 응답)';
COMMENT ON COLUMN kso_profiles.failed_attempts IS '연속 PIN 오답 카운터. 5회 초과 시 locked_until 설정';
COMMENT ON COLUMN kso_profiles.locked_until   IS 'NULL 또는 잠금 해제 시각 (15분 후)';

CREATE INDEX IF NOT EXISTS idx_kso_profiles_email ON kso_profiles(email);

-- ── 2. diagnosis_responses 에 team 태그 컬럼 추가 ───────────────────────────
ALTER TABLE diagnosis_responses
  ADD COLUMN IF NOT EXISTS respondent_profile_id uuid REFERENCES kso_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS respondent_team text;

COMMENT ON COLUMN diagnosis_responses.respondent_profile_id IS '응답자의 kso_profiles.id (NULL = 익명 응답)';
COMMENT ON COLUMN diagnosis_responses.respondent_team       IS 'director/planning/.../marketing | admin | NULL';

CREATE INDEX IF NOT EXISTS idx_diag_responses_profile
  ON diagnosis_responses(respondent_profile_id);
CREATE INDEX IF NOT EXISTS idx_diag_responses_team
  ON diagnosis_responses(workspace_id, respondent_team);

-- ── 3. RLS 설정 ────────────────────────────────────────────────────────────
-- 이 서비스는 모든 DB 접근을 service_role 키(서버 라우트) 로 한다.
-- 클라이언트가 직접 kso_profiles 를 읽는 경우는 없으므로 RLS 를 켜둔 채
-- "deny all" 로 두고, service_role bypass 에만 의존.
--
-- 만약 클라이언트 anon-key 가 이 테이블을 읽어야 하는 케이스가 생기면
-- 별도 SELECT 정책 추가 필요 (예: pin_hash·failed_attempts 컬럼 제외).
ALTER TABLE kso_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kso_profiles_default_deny ON kso_profiles;
-- 기본 정책 없으면 anon/authenticated 모두 차단 (service_role 만 통과)
-- 명시적 deny 정책은 불필요하지만 안전을 위해 빈 SELECT 정책으로 의도 표시.
-- (service_role 은 RLS bypass 라 영향 없음)

-- ── 4. updated_at 자동 트리거 (last_login_at 갱신 시 사용 X — application 측에서 set) ──
-- (생략. 필요해지면 별도 트리거 추가)

-- ============================================================================
-- 실행 결과 검증:
--   SELECT * FROM kso_profiles LIMIT 1;                  -- 빈 결과 OK
--   \d diagnosis_responses                                 -- 새 컬럼 2개 확인
--   SELECT respondent_team FROM diagnosis_responses LIMIT 5;
--
-- 첫 사용자는 /auth/signup 으로 가입하면 자동 admin 권한 (API 라우트 로직).
-- ============================================================================
