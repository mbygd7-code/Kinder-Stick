# Scoring Algorithm — Specification

Kinder Stick OS 점수 산출의 수학적 명세. 기존 KinderBoard의 `belief × evidence` 단순 곱셈을 폐기하고 베이지안 실패확률 + Critical cap + 시간 감쇠 + 합의도 보정을 결합한다.

이 문서는 구현 단위 테스트의 기준이 된다. 모든 함수는 순수 함수로 작성하고, 입력은 진단 응답(JSONB) + KPI 값 + sub-item 마스터 데이터로 한정.

## 입력 데이터 형식

```ts
type DiagnosisInput = {
  org: { stage: 'pre_seed' | 'seed' | 'series_a' | 'series_b' };
  responses: Array<{
    sub_item_code: string;        // "A2.SE.40" 등
    respondent_id: string;
    belief: 1 | 2 | 3 | 4 | 5;     // 5점 척도
    evidence: 1 | 2 | 3 | 4 | 5 | null;
    evidence_recorded_at: ISO;     // 시간 감쇠 계산용
    data_source: 'self_report' | 'kpi' | 'uploaded_doc';
    reverse_scoring?: boolean;     // A7.PII.INCIDENT 같은 reverse 항목
  }>;
  kpi_links?: Array<{
    sub_item_code: string;
    metric_value: number;          // 자동 KPI 연동 값
    captured_at: ISO;
  }>;
  sub_items_master: SubItem[];     // question_bank.yaml에서 빌드된 정의
  thresholds: {                    // question_bank.yaml에서
    priors: PriorTable;
    likelihood_ratios: { [code: string]: number };
    critical_caps: CriticalCap[];
  };
};
```

## 1단계: Sub-item Score `s_i` (0–100)

```python
def sub_item_score(response, sub_item_def, now):
    # 5점 척도를 0..100로 정규화
    B = (response.belief - 1) / 4 * 100
    
    # Reverse scoring (A7.PII.INCIDENT 등 — 1=좋음, 5=나쁨)
    if sub_item_def.reverse_scoring:
        E_raw = response.evidence
        if E_raw is None:
            E = None
        else:
            E = (5 - E_raw) / 4 * 100   # 1→100, 5→0
    else:
        E = (response.evidence - 1) / 4 * 100 if response.evidence else None

    # Evidence 결측 처리
    penalty = 0
    if E is None:
        if sub_item_def.data_quality_required >= 2:
            return None, -8        # NULL + 도메인 점수에서 -8
        else:  # data_quality_required == 1
            E = 0.7 * B            # belief 단독, 신뢰도 ×0.7

    # 결합 (Belief 35% + Evidence 65%)
    raw = 0.35 * B + 0.65 * E

    # Belief–Evidence 망상 페널티
    gap = B - E
    if gap > 25:
        raw -= min(15, (gap - 25) * 0.5)

    # Time decay
    days = (now - response.evidence_recorded_at).days
    flag = None
    if days <= 90:
        decay = 1.0
    elif days <= 180:
        decay = 1.0 - (days - 90) / 90 * 0.20    # 0.80까지 선형 감쇠
    else:
        decay = 0.5
        flag = "stale, refresh required"

    s = max(0, min(100, raw * decay))
    return s, penalty, flag
```

**테스트 케이스**:
| Belief | Evidence | days | 결과 |
|---|---|---|---|
| 5 | 5 | 30 | 100 |
| 5 | 1 | 30 | 47.5 (B=100, E=0, gap=100, raw=35-15=20, decay=1.0... 잠깐 재계산) |
| 5 | 1 | 30 | B=100, E=0, raw=35, gap=100, raw-=min(15, (100-25)*0.5)=15, raw=20. ✓ |
| 1 | 5 | 30 | B=0, E=100, raw=65, gap=-100 (음수, 페널티 없음), s=65 |
| 4 | 4 | 200 | B=75, E=75, raw=75, gap=0, decay=0.5, s=37.5 + flag="stale" |
| 3 | null (dq_req=2) | 30 | s=NULL, penalty=-8 |
| 3 | null (dq_req=1) | 30 | B=50, E=35, raw=40.25, s=40.25 |
| 5 (reverse, PII사고 0건) | 1 (reverse) | 30 | B=100, E_raw=1 → E=(5-1)/4*100=100, raw=100, s=100 ✓ |
| 5 (reverse, PII사고 진행중) | 5 (reverse) | 30 | E=(5-5)/4*100=0, raw=35, s=35 |

## 2단계: Group Score `G_g` (0–100)

```python
def group_score(group_responses, group_def):
    # 가중평균 (NULL 제외)
    items = [(r.s_i, r.weight_within_group) for r in group_responses if r.s_i is not None]
    if not items:
        return None
    G_raw = sum(s * w for s, w in items) / sum(w for _, w in items)

    # Critical cap: critical sub_item 한 개라도 빨강이면 group cap = 45
    critical_subs = [r for r in group_responses
                     if r.sub_item.tier == 'critical' and r.s_i is not None]
    if any(r.s_i < 40 for r in critical_subs):
        G = min(G_raw, 45)
    else:
        G = G_raw

    return G
```

## 3단계: Domain Score `D_d` (0–100)

```python
def domain_score(domain_groups, domain_def, missing_evidence_penalty):
    items = [(g.G_g, g.weight) for g in domain_groups if g.G_g is not None]
    if not items:
        return None
    D_raw = sum(G * w for G, w in items) / sum(w for _, w in items)

    # 결측 페널티 적용
    D_after_penalty = max(0, D_raw + missing_evidence_penalty)

    # Critical cap: critical group 한 개라도 빨강이면 domain cap = 50
    critical_groups = [g for g in domain_groups if g.is_critical_group]
    if any(g.G_g is not None and g.G_g < 40 for g in critical_groups):
        D = min(D_after_penalty, 50)
    else:
        D = D_after_penalty

    return D
```

## 4단계: 팀 합의도 (Consensus)

같은 sub-item에 N명이 응답한 경우, 분산을 점수에 반영하지 않고 **신뢰구간**과 **토론 트리거**로만 사용한다.

```python
def consensus_for_sub_item(responses_for_sub_item):
    scores = [r.s_i for r in responses_for_sub_item if r.s_i is not None]
    N = len(scores)
    if N == 0:
        return None
    mu = mean(scores)
    sigma = stdev(scores) if N >= 2 else 0

    if sigma <= 12:
        confidence = 1.00
    elif sigma <= 18:
        confidence = 0.85
    elif sigma <= 25:
        confidence = 0.65
    else:
        confidence = 0.40

    if N >= 3:
        ci_low = mu - 1.96 * sigma / sqrt(N)
        ci_high = mu + 1.96 * sigma / sqrt(N)
        ci_low = max(0, ci_low)
        ci_high = min(100, ci_high)
    else:
        ci_low, ci_high = None, None

    needs_discussion = sigma > 18

    return {
        'reported_score': mu,
        'sigma': sigma,
        'confidence': confidence,
        'ci_95': (ci_low, ci_high),
        'needs_discussion': needs_discussion,
        'N': N,
    }
```

UI 라벨:
- `confidence == 0.40` → "이견 큼: 팀 미팅 필요"
- `confidence < 0.7` AND N >= 3 → "응답자 편차 큼"
- `N < 3` → "응답자 더 필요 (CI 산출 불가)"

## 5단계: Overall Score `S` (0–100)

```python
def overall_score(domains):
    items = [(D.score, D.weight) for D in domains if D.score is not None]
    return sum(D * w for D, w in items) / sum(w for _, w in items)
```

## 6단계: Failure Probability (Bayesian)

CB Insights 기반 prior × 빨강 critical 도메인의 LR로 베이지안 업데이트.

```python
def failure_probability(domains, org_stage, sub_item_responses, priors, LRs, critical_caps):
    # 6m / 12m 각각 계산
    results = {}
    for horizon in ['6m', '12m']:
        prior_p = priors[org_stage][f'failure_{horizon}']
        prior_odds = prior_p / (1 - prior_p)

        # 빨강 critical 도메인 식별 (D < 40)
        red_critical = [D.code for D in domains
                        if D.is_critical and D.score is not None and D.score < 40]
        
        # Likelihood ratio 곱
        LR_product = 1.0
        for code in red_critical:
            LR_product *= LRs.get(code, 1.0)

        posterior_odds = prior_odds * LR_product
        posterior_p = posterior_odds / (1 + posterior_odds)
        posterior_p = max(0.02, min(0.95, posterior_p))

        # Critical-Critical sub-item caps
        cap_floor = 0.0
        triggered_caps = []
        for cap in critical_caps:
            if evaluate_cap_condition(cap, sub_item_responses, org_stage):
                cap_floor = max(cap_floor, cap.min_p_6m if horizon == '6m' else cap.min_p_6m * 1.6)
                triggered_caps.append(cap.sub_item)
        
        # 12m은 6m cap에 1.6배 곱 (추정 — 실증으로 보정 가능)

        final_p = max(posterior_p, cap_floor)

        results[horizon] = {
            'prior': prior_p,
            'posterior': posterior_p,
            'cap_floor': cap_floor,
            'final': final_p,
            'red_critical_domains': red_critical,
            'triggered_caps': triggered_caps,
        }

    # Confidence Interval (응답자 N >= 3)
    for horizon in ['6m', '12m']:
        if N_respondents >= 3:
            samples = bootstrap_resamples(B=1000)
            results[horizon]['ci_95'] = (
                quantile(samples[horizon], 0.05),
                quantile(samples[horizon], 0.95),
            )
        else:
            results[horizon]['ci_95'] = None
            results[horizon]['ci_note'] = "응답자 더 필요 (N >= 3)"

    return results
```

### Prior 표 (question_bank.yaml에서 import)

| Stage | failure_6m | failure_12m |
|---|---|---|
| pre_seed | 0.25 | 0.45 |
| seed | 0.18 | 0.32 |
| series_a | 0.10 | 0.20 |
| series_b | 0.05 | 0.12 |

### Likelihood Ratio (빨강 critical 도메인)

| Domain | LR |
|---|---|
| A12 (런웨이) | 4.2 |
| A2 (PMF) | 3.5 |
| A7 (규제) | 3.0 |
| A11 (팀) | 2.6 |
| A5 (Unit Eco) | 2.4 |
| A1 (시장) | 2.0 |
| A3 (결제) | 1.8 |
| A4 (Activation) | 1.7 |

다른 도메인 (A6, A8, A9, A10, A13, A14)이 빨강이어도 베이지안 odds에는 반영하지 않는다 (LR = 1.0). 단, S_overall에는 반영.

### Cap 평가 예시

```python
def evaluate_cap_condition(cap, responses, stage):
    if cap.sub_item == 'A12.RUN.MONTHS' and cap.condition == 'evidence.v == 1':
        r = find_response(responses, 'A12.RUN.MONTHS')
        return r and r.evidence == 1
    
    elif cap.sub_item == 'A2.SE.40' and 'stage IN [seed, series_a]' in cap.condition:
        r = find_response(responses, 'A2.SE.40')
        return r and r.evidence <= 2 and stage in ['seed', 'series_a']
    
    # ... (15개 cap 모두 구현)
```

## 7단계: 최종 출력

```ts
type ScoreResult = {
  overall: number;                    // 0..100
  domains: Array<{
    code: string;
    name_ko: string;
    score: number | null;
    tier_label: 'red' | 'yellow' | 'green';
    confidence: number;
    ci_95: [number, number] | null;
    needs_discussion: boolean;
  }>;
  failure_probability: {
    '6m': { final: number; ci_95: [number, number] | null; triggered_caps: string[] };
    '12m': { final: number; ci_95: [number, number] | null };
  };
  red_critical_domains: string[];
  recommendations: Array<{           // 다음 단계 코칭 후보
    domain_code: string;
    severity: number;
    matched_playbook_id: string;
  }>;
};
```

## 단위 테스트 시드 (engineer가 구현 후 검증할 것)

| 시나리오 | 입력 요약 | 기대 출력 |
|---|---|---|
| 모든 도메인 perfect | 모든 sub-item B=5, E=5 | overall=100, P(6m)=stage prior |
| 런웨이 단독 빨강 | A12.RUN evidence=1, 나머지 ok | P(6m) >= 0.50 (cap), red_critical=['A12'] |
| 망상 케이스 | B=5, E=1 | sub_item s=20, gap penalty 작동 |
| 결측 케이스 | dq_req=2 evidence=null | s=null, domain -8 |
| 팀 σ=20 | 같은 sub-item에 응답 (10, 30, 50) | confidence=0.65, needs_discussion=true |
| stale evidence | days=200 | decay=0.5, flag="stale" |
| Reverse PII 사고 0건 | A7.PII.INCIDENT B=5, E=1 (1=0건) | s=100 |
| Reverse PII 사고 1건 | A7.PII.INCIDENT B=5, E=2 | s=70 (cap floor도 trigger) |
| pre-seed 빈약 | stage=pre_seed, 모든 데이터 부족 | overall=낮음, P(6m) cap=0.25 floor에서 시작 |

## 변경 이력

| 버전 | 변경 사항 |
|---|---|
| 1.0.0 | 초기 작성 — Bayesian + Critical cap + Time decay + Consensus |

## 참고 문헌

- CB Insights "Top 12 Reasons Startups Fail" (N=431)
- Sacks "The Burn Multiple" (Craft Ventures 2020)
- Bessemer State of the Cloud 2025
- 기존 KinderBoard `calculateScores` / `calculateFailureProbability` (index.html 1759, 1938)
