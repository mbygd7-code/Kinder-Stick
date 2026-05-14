-- ============================================================================
-- 2026-05-15  Internal NPS + Sean Ellis (PMF) surveys
--
-- 이 마이그레이션은 외부 도구(Typeform/Tally) 의존 없이 시스템 안에서
-- end-to-end NPS·Sean Ellis 설문을 처리하기 위해 두 테이블을 추가한다.
--
--   - kso_surveys: 운영자가 만든 설문 인스턴스 (workspace 별 active 1개)
--   - kso_survey_responses: 익명 응답
--
-- 점수가 30+ 응답에 도달하면 진단 시스템이 자동으로 evidence 로 주입
-- (sub_item_responses 직접 쓰진 않고 aggregateRespondents() 가 read-time 합산).
--
-- 실행:
--   Supabase Dashboard → SQL Editor → New query → 붙여넣기 → Run
-- ============================================================================

-- ── 1. kso_surveys — 설문 인스턴스 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kso_surveys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('nps', 'pmf')),
  share_token  text UNIQUE NOT NULL,                  -- 16-byte base64url
  title        text NOT NULL,                          -- "2026 Q2 교사 NPS"
  question     text NOT NULL,                          -- 운영자 정의 또는 기본값
  reason_label text,                                   -- "왜 그렇게 평가하셨나요?"
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'closed')),
  created_by   uuid REFERENCES kso_profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);

COMMENT ON TABLE kso_surveys IS 'Internal NPS/PMF survey instances (외부 SaaS 의존 제거)';
COMMENT ON COLUMN kso_surveys.share_token IS '공개 URL 의 토큰 (16-byte base64url, 익명 응답자가 사용)';
COMMENT ON COLUMN kso_surveys.kind IS 'nps = Net Promoter Score 11점, pmf = Sean Ellis 40% 테스트 3옵션';

-- workspace + kind 당 active 1개만 (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_kind_per_ws
  ON kso_surveys(workspace_id, kind)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_kso_surveys_workspace ON kso_surveys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kso_surveys_token ON kso_surveys(share_token);

-- ── 2. kso_survey_responses — 익명 응답 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS kso_survey_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   uuid NOT NULL REFERENCES kso_surveys(id) ON DELETE CASCADE,
  score       int CHECK (score >= 0 AND score <= 10),     -- NPS 0~10
  pmf_choice  int CHECK (pmf_choice IN (1, 2, 3)),         -- 1=매우 실망 2=다소 실망 3=실망 안 함
  reason      text,                                         -- 선택 입력
  ip_hash     text,                                         -- 스팸 방지
  ua_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- 하나의 응답은 NPS score 또는 PMF choice 둘 중 정확히 하나만
  CONSTRAINT score_xor_choice CHECK (
    (score IS NOT NULL AND pmf_choice IS NULL) OR
    (score IS NULL AND pmf_choice IS NOT NULL)
  )
);

COMMENT ON TABLE kso_survey_responses IS '익명 NPS·PMF 응답 (이메일·이름 컬럼 없음, IP/UA 해시만)';
COMMENT ON COLUMN kso_survey_responses.score IS 'NPS: 0~10 점수';
COMMENT ON COLUMN kso_survey_responses.pmf_choice IS 'Sean Ellis: 1=매우 실망 2=다소 실망 3=실망 안 함';

CREATE INDEX IF NOT EXISTS idx_responses_survey
  ON kso_survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_responses_ratelimit
  ON kso_survey_responses(ip_hash, ua_hash, created_at);

-- ── 3. RLS ─────────────────────────────────────────────────────────────────
-- 모든 접근은 service_role 라우트를 거치므로 RLS 활성화 + 기본 deny.
-- 익명 응답도 /api/surveys/[token]/submit 라우트에서 service-role 로 INSERT.
ALTER TABLE kso_surveys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kso_survey_responses  ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 검증:
--   SELECT * FROM kso_surveys;
--   SELECT * FROM kso_survey_responses;
--   \d kso_surveys
-- ============================================================================
