-- ============================================================================
-- 2026-05-14  Custom PIN auth + team-scoped diagnosis responses
--
-- 이 마이그레이션은 Supabase Auth 와 병행되는 커스텀 PIN 로그인을 추가한다.
--   - kso_profiles: 자체 사용자 테이블 (email + 4-digit PIN hash + team + role)
--   - diagnosis_responses 에 respondent_profile_id, respondent_team 컬럼 추가
--
-- 기존 magic-link 로그인은 보존 (호환). 신규 회원가입은 PIN 사용.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kso_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  pin_hash    text NOT NULL,                     -- node:crypto scrypt 결과 (salt:hash)
  team        text,                              -- 'director'|'planning'|'design'|
                                                  -- 'engineering'|'operations'|'marketing' 또는 NULL
  role        text NOT NULL DEFAULT 'member'
              CHECK (role IN ('admin', 'member')),
  display_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kso_profiles_email ON kso_profiles(email);

-- diagnosis_responses 에 team 태그 추가
ALTER TABLE diagnosis_responses
  ADD COLUMN IF NOT EXISTS respondent_profile_id uuid REFERENCES kso_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS respondent_team text;

CREATE INDEX IF NOT EXISTS idx_diag_responses_profile
  ON diagnosis_responses(respondent_profile_id);
CREATE INDEX IF NOT EXISTS idx_diag_responses_team
  ON diagnosis_responses(workspace_id, respondent_team);
