# Kinder Stick OS — Framework

이 폴더는 Kinder Stick OS(조직 진단·코칭 운영 시스템)의 **단일 진실원천(Single Source of Truth)** 자산을 담는다. Next.js 앱은 빌드 시 이 파일들을 import해서 진단 UI · 점수 산식 · AI 코치 · 코칭 플레이북을 구성한다.

엔지니어가 처음 보는 경우 [Plan 파일](C:/Users/rimmma/.claude/plans/synchronous-exploring-lecun.md)을 먼저 읽고 돌아오기를 권장한다.

## 파일 인벤토리

| 파일 | 용도 | 빌드 시 사용처 |
|---|---|---|
| `question_bank.yaml` | 14 도메인 × ~210 sub-item 마스터 데이터. 본 파일은 ~55개 worked example만 담음. 나머지는 동일 스키마로 확장. | `domain_definitions` + `sub_items` 테이블 시드, 진단 UI 렌더링, 점수 산식 입력 |
| `playbooks.yaml` | 42개 (14 도메인 × 3 모드) 실패 모드 코칭 플레이북. AI 코치 1-shot 예시. | 코칭 상태머신의 `analyzing` 상태에서 trigger 매칭 후 코치 시스템 프롬프트에 주입 |
| `agent_prompts/_base.md` | 모든 도메인 코치가 공유하는 시스템 프롬프트 템플릿 | Claude API 호출 시 system 메시지의 골격 |
| `agent_prompts/domain_coaches.md` | 14인 도메인 코치 specialization (RAG corpus, 1-shot, hard rule) | `_base.md` + 해당 섹션을 합쳐서 시스템 프롬프트 완성 |
| `scoring.md` | Bayesian failure probability + Critical cap + Time decay + Consensus 점수 산식 명세 | `lib/scoring.ts` 구현 시 단위 테스트 시드 |
| `schema_v2.sql` | Supabase 확장 스키마 — 14 신규 테이블, RLS 3-tier, RPC 함수 | Supabase SQL Editor에서 실행 |
| `README.md` (이 파일) | 오케스트레이션 인덱스 | — |

기존 [`D:/claude_project/Kinder Stick/schema.sql`](../../Kinder Stick/schema.sql)(v1, 단순 `diagnosis_responses`만)는 보존하고, 본 v2 스키마가 `alter table`로 확장한다.

## 개념 구조

```
Domain (14)            → ex. A2 PMF (weight 13%)
  └─ Group (4-6)        → ex. A2.SE Sean Ellis (weight 0.45 within domain)
       └─ Sub-item       → ex. A2.SE.40 (weight 0.45 within group)
            ├─ belief    (5pt 척도)
            ├─ evidence  (5단계 객관 + KPI source 옵션)
            ├─ citation  (외부 벤치마크/논문)
            └─ failure_trigger (코칭 자동 발동 조건)
```

## 이 프레임워크 위에 만드는 것

```
┌─────────────────────────────────────────────────────────────────┐
│ Next.js App (구현 대상)                                          │
│                                                                  │
│  · /diag/[ws]               (익명 분기 진단 — KinderBoard 호환)  │
│  · /[org]/dashboard         (14-도메인 레이더 + 신호 피드)        │
│  · /[org]/coaching/[id]     (코칭 대화 — Claude streaming)        │
│  · /api/cron/kpi-sync       (Stripe/GA4/ChannelTalk 일일 ingest)  │
│  · /api/webhooks/meetflow   (외부 AI 콜백 수신, HMAC 검증)        │
│                                                                  │
│  ↓ imports                                                       │
└─────────────────────────────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────────────────────────────┐
│ framework/ (이 폴더)                                              │
│                                                                  │
│  question_bank.yaml ───┐                                          │
│  playbooks.yaml ──────┼─→ scoring.md (산식 명세)                  │
│  agent_prompts/ ──────┘                                          │
│  schema_v2.sql                                                    │
└─────────────────────────────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────────────────────────────┐
│ Supabase (organizations, sub_items, agent_sessions, kpi_*, ...)  │
└─────────────────────────────────────────────────────────────────┘
```

## 8주 롤아웃 단계

[plan 파일 §10](../../../../Users/rimmma/.claude/plans/synchronous-exploring-lecun.md) 참조. 요약:

- **Phase 1 (W1-2) Foundation**: Next.js + Supabase 골격, 기존 94문항 마이그레이션, 14-도메인 레이더 v0
- **Phase 2 (W3-4) AI Coaching MVP**: PMF·Unit Eco·Team 3개 도메인 결손→코칭→액션→follow-up 루프
- **Phase 3 (W5-6) KPI Integration**: Stripe/Toss/GA4/ChannelTalk 자동 sync, 신호 피드, 주간 브리프
- **Phase 4 (W7-8) External AI & Polish**: Meetflow 핸드오프, Linear/Jira, PII redaction, 분기 진단 자동화

## 즉시 다음 작업 (엔지니어 ‏대상)

### 1) 프로젝트 초기화
```bash
# Next.js 15 + TypeScript + Tailwind + Supabase
pnpm create next-app@latest kinder-stick-os --ts --tailwind --app
cd kinder-stick-os
pnpm add @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk recharts zod yaml
pnpm add -D @types/yaml
```

### 2) Supabase 프로젝트 생성 + 스키마 적용
1. https://supabase.com/dashboard 에서 새 프로젝트 (region: ap-northeast-2 Seoul 권장)
2. SQL Editor에서 기존 [`Kinder Stick/schema.sql`](../../Kinder Stick/schema.sql) 실행 (v1)
3. 본 폴더의 `schema_v2.sql` 실행 (v2 확장)
4. Database → Extensions에서 `pgvector`, `pg_cron`, `pg_net` 활성

### 3) 빌드 시 YAML → DB 시드
`scripts/seed_from_yaml.ts` 작성 — `question_bank.yaml`을 읽어서:
- `domain_definitions` 14개 row INSERT
- `sub_items` ~55개 row INSERT (worked examples; 나머지는 점진 추가)

### 4) 핵심 라이브러리 구현 우선순위

```
lib/scoring.ts              ← scoring.md 명세대로 (단위 테스트 9개 시드 포함)
lib/agents/build_prompt.ts  ← _base.md + domain_coaches.md 매칭, retrieved context 주입
lib/agents/state_machine.ts ← 11개 상태 전이 강제
lib/coach_client.ts         ← Claude API streaming, evidence_required validator
app/(app)/[org]/dashboard/  ← 레이더 (Recharts), 신호 피드
app/api/agent/stream/       ← SSE proxy
```

### 5) 첫 end-to-end 검증 시나리오
1. 익명 워크스페이스 `kb-2026-q2`에 4명이 분기 진단 응답
2. PMF 도메인 의도적 빨강 (Sean Ellis evidence=1)
3. PMF Coach가 자동 활성화 → "최근 활성 사용자 100명 'Very disappointed' 설문 돌려본 적 있나?" 진단 질문
4. 사용자 "없음" → `coaching_actions` row 생성 (deadline +7d)
5. 30일 후 follow-up cron이 metric 재측정 → resolved 또는 escalation

## 자주 묻는 질문

### Q. ~210 sub-item을 한 번에 다 채워야 하나?
A. 아니다. Phase 2 MVP는 critical sub-item (~50개)만으로도 작동한다. 각 도메인의 critical sub-item 1-2개는 `question_bank.yaml`에 이미 worked example로 존재. 나머지는 운영하면서 추가.

### Q. 외부 AI(Meetflow) 없이도 작동하나?
A. 작동한다. `external_handoff` 트리거가 발동돼도 옵션 제시 단계에서 사용자가 무시할 수 있다. Phase 4까지는 외부 통합 없이 14인 내부 코치만으로 구동.

### Q. 한국어가 아닌 글로벌 EdTech에도 쓸 수 있나?
A. 본 프레임워크는 한국 EdTech 컨텍스트에 최적화 (누리과정·KISA·평가제). 글로벌 적용 시 A7 (규제) 도메인을 GDPR/COPPA로 교체, A1·A3 도메인의 buyer persona 한국 고유 요소 제거 필요.

### Q. AI 코치가 얼마나 정확한가? 환각이 걱정된다.
A. `_base.md`의 `<evidence_basis>` + `<output_format>` + 서버 사이드 validator로 다중 가드. citation 빈 응답은 차단. 정량 주장은 source_id 강제. severity 5는 self-critique 2nd pass. `scoring.md` 단위 테스트는 정량 산출의 결정성을 보장.

### Q. 가중치를 우리 회사에 맞게 바꿀 수 있나?
A. `domain_definitions.weight` + `sub_items.weight_within_group`을 DB에서 직접 수정 가능. 기본값은 한국 EdTech seed 단계 가정. CB Insights LR도 `question_bank.yaml`의 `likelihood_ratios`에서 조정.

## 참고 자료

- [Plan 파일](../../../Users/rimmma/.claude/plans/synchronous-exploring-lecun.md) — 전체 시스템 청사진
- [기존 KinderBoard CLAUDE.md](../../Kinder%20Stick/CLAUDE.md) — v1 마이그레이션 가이드
- [기존 KinderBoard PATCH.md](../../Kinder%20Stick/PATCH.md) — Supabase 통합 4단계 패치
- [기존 index.html](../../Kinder%20Stick/kinderboard-supabase-handoff/handoff/index.html) — `AREAS` (1011), `QUESTIONS` (1126), `calculateScores` (1759), `calculateFailureProbability` (1938)

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-07 | v1.0.0 초기 생성 — question_bank, playbooks, agent_prompts, scoring, schema_v2 |
