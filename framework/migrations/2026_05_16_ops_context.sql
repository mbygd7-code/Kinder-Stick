-- ============================================================================
-- 2026-05-16  OpsContext server-side persistence + change history
--
-- 진단 카드별 운영 컨텍스트(현황·목표) 를 서버에 저장.
-- 다른 직원이 같은 카드에서 진단 시작 시 기본값으로 prefill.
-- 변경 이력 + 변경자 ID 보존.
--
-- 두 테이블:
--   kso_ops_context: workspace 당 1 row, 최신 commit 된 컨텍스트
--   kso_ops_context_changes: 필드별 변경 기록 (이력 modal 에 노출)
-- ============================================================================

-- ── 1. 최신 commit 된 컨텍스트 (workspace 당 1) ──
CREATE TABLE IF NOT EXISTS kso_ops_context (
  workspace_id  text PRIMARY KEY,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  applied_by    uuid REFERENCES kso_profiles(id) ON DELETE SET NULL,
  -- "진단에 반영" 클릭 시 갱신되는 commit revision
  revision      int NOT NULL DEFAULT 1
);

COMMENT ON TABLE kso_ops_context IS 'OpsContext per workspace — latest committed';
COMMENT ON COLUMN kso_ops_context.applied_by IS '"진단에 반영" 을 누른 사용자';

-- ── 2. 필드별 변경 이력 ──
CREATE TABLE IF NOT EXISTS kso_ops_context_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   text NOT NULL,
  field_name     text NOT NULL,                -- "mau" / "goal_new_signups_monthly" / etc.
  old_value      jsonb,                         -- NULL 이면 최초 입력
  new_value      jsonb,                         -- NULL 이면 삭제
  changed_by     uuid REFERENCES kso_profiles(id) ON DELETE SET NULL,
  changed_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE kso_ops_context_changes IS 'Field-level change log for ops context';

CREATE INDEX IF NOT EXISTS idx_ops_ctx_changes_ws_field
  ON kso_ops_context_changes(workspace_id, field_name, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_ctx_changes_ws
  ON kso_ops_context_changes(workspace_id, changed_at DESC);

-- ── 3. RLS ──
ALTER TABLE kso_ops_context           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kso_ops_context_changes   ENABLE ROW LEVEL SECURITY;
-- 모든 접근은 service_role 라우트 (인증 PIN 세션 검사) 를 거침.
