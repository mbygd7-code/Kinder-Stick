/**
 * 홈 (/) — 카인더스틱 OS 랜딩 페이지.
 *
 * 진단·결과·코칭이 무엇인지 한 화면에 소개하고
 * 진단 시작·내 워크리스트 두 가지 CTA 제공.
 */

const ISSUE_DATE = new Date().toISOString().slice(0, 10);

export default function Home() {
  return (
    <main className="min-h-dvh w-full">
      {/* HERO */}
      <section className="border-b-2 border-ink">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-16 sm:pt-24 pb-14 sm:pb-20">
          <div className="grid lg:grid-cols-12 gap-10 items-end">
            <div className="lg:col-span-8">
              <div className="flex items-baseline gap-3 mb-5 flex-wrap">
                <span className="kicker">Kinder Stick OS</span>
                <span className="label-mono">·</span>
                <span className="label-mono">팀이 기댈 수 있는 진단·코칭 운영</span>
              </div>
              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight break-keep">
                <span className="block">팀이 기댈 수 있는,</span>
                <span className="block mt-1">
                  <span className="italic font-light">친절한</span>{" "}
                  <span className="text-accent">진단 지팡이.</span>
                </span>
              </h1>
              <p className="mt-8 max-w-2xl text-lg sm:text-xl leading-relaxed text-ink-soft">
                점수표가 아닙니다.{" "}
                <strong className="font-semibold text-ink">
                  우리 팀이 어디서 막혔는지, 이번 주 무엇을 해결하면 되는지
                </strong>
                를 한 화면에 풀어드립니다. 추측 대신 통계에 기반한 진단과, AI
                코치가 옆에서 같이 걷는 운영 시스템.
              </p>

              <div className="mt-10 flex flex-wrap gap-3 items-center">
                <a href="/diag" className="btn-primary text-base">
                  진단 시작
                  <span className="font-mono text-xs">→</span>
                </a>
                <a href="/worklist" className="btn-secondary text-base">
                  <span className="font-mono text-xs">→</span>내 워크리스트
                </a>
                <span className="label-mono ml-2">
                  5분 안에 시작 · 25분 안에 첫 결과
                </span>
              </div>
            </div>

            <aside className="lg:col-span-4 lg:pl-8 lg:border-l border-ink-soft/40">
              <p className="kicker mb-3">이 시스템이 답하는 질문</p>
              <ul className="space-y-3">
                <Q text="어디부터 손대야 할지 모르겠다." />
                <Q text="매주 같은 문제를 고치는데 결과가 안 변한다." />
                <Q text="팀원들이 같은 문제를 다르게 보고 있다." />
              </ul>
              <p className="mt-5 label-mono">
                한국 영유아 EdTech 운영진 기준으로 설계.
              </p>
            </aside>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-16 pb-10">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="kicker">이렇게 작동합니다</span>
          <span className="label-mono">·</span>
          <span className="label-mono">3단계 루프</span>
        </div>
        <h2 className="font-display text-2xl sm:text-4xl leading-tight tracking-tight break-keep">
          응답한다 · 진단을 받는다 · 같이 풀어간다.
        </h2>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 grid grid-cols-1 md:grid-cols-3 gap-px bg-ink border-2 border-ink">
        <StepCard
          n="01"
          title="응답한다"
          time="25–35분 · 익명"
          body="팀원 각자가 같은 진단 카드 ID로 응답합니다. 같은 ID로 여러 명이 응답하면 자동 합산되고, 응답자 간 의견 차이가 큰 항목은 ‘이견 큼’으로 따로 표시됩니다."
        />
        <StepCard
          n="02"
          title="진단을 받는다"
          time="실시간 · 자동"
          body="12개 영역에 대해 신호등(빨강/노랑/초록), 6·12개월 어려움 가능성, 영역별 우선순위가 자동 산출됩니다. CB Insights 431개 실패 분석을 기반으로 한 통계적 추정."
        />
        <StepCard
          n="03"
          title="같이 풀어간다"
          time="이번 주부터"
          body="문제가 큰 영역마다 AI 도메인 코치가 ‘이번 주 할 일 3가지’를 SMART로 제안합니다. 담당자·기한 지정 후 30일 뒤 자동 재측정으로 효과를 검증합니다."
        />
      </section>

      {/* OUTCOMES */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 pt-20 pb-6">
        <div className="flex items-baseline gap-3 mb-3">
          <span className="kicker">진단을 받으면 손에 쥐는 것</span>
        </div>
        <h2 className="font-display text-2xl sm:text-4xl leading-tight tracking-tight break-keep">
          점수표가 아니라{" "}
          <span className="italic font-light">실행 가능한</span> 답변.
        </h2>
      </section>

      <section className="max-w-6xl mx-auto px-6 sm:px-10 mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
        <OutcomeCard
          n="01"
          headline="12-영역 신호등"
          desc="시장·제품·팀·운영 어느 곳이 빨강인지 30초 안에. 한 영역이 빨강이면 다른 영역이 90점이어도 그 사실을 가립니다 — 평균이 아니라 치명타를 봅니다."
        />
        <OutcomeCard
          n="02"
          headline="이번 주 할 일 3가지"
          desc="‘추측’ 말고 ‘실행’. 영역별로 ‘담당자·기한·검증 KPI’가 붙은 3개의 액션이 즉시 생성됩니다. 점수가 아닌 액션이 변화의 단위입니다."
        />
        <OutcomeCard
          n="03"
          headline="자동 follow-up"
          desc="액션 마감일에 KPI를 자동 재측정. 효과가 있으면 닫고, 없으면 코치가 다음 단계를 제안. 누군가 챙기지 않아도 루프가 돌아갑니다."
        />
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 py-20 text-center">
        <p className="kicker mb-3">시작하기</p>
        <h2 className="font-display text-3xl sm:text-5xl leading-[1.05] tracking-tight break-keep">
          25분 뒤,
          <br />
          <span className="text-accent italic">우리 팀의 첫 답</span>이 손에
          들어옵니다.
        </h2>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <a href="/diag" className="btn-primary text-base">
            진단 시작
            <span className="font-mono text-xs">→</span>
          </a>
          <a href="/worklist" className="btn-secondary text-base">
            <span className="font-mono text-xs">→</span>내 워크리스트
          </a>
        </div>
        <p className="mt-6 label-mono">
          익명으로 시작 가능 · 회원가입 없이 응답 · ID만 기억하면 언제든 복귀
        </p>
      </section>

      {/* FOOTER */}
      <footer className="max-w-6xl mx-auto px-6 sm:px-10 pb-12 border-t border-ink-soft pt-6 flex flex-wrap items-baseline justify-between gap-4">
        <p className="label-mono">
          Set in Fraunces, Pretendard &amp; JetBrains Mono.
        </p>
        <div className="flex gap-4">
          <a href="/admin/health" className="label-mono hover:text-ink">
            system health
          </a>
          <p className="label-mono">{ISSUE_DATE}</p>
        </div>
      </footer>
    </main>
  );
}

function Q({ text }: { text: string }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="font-display text-xl text-accent">·</span>
      <span className="text-base leading-relaxed">“{text}”</span>
    </li>
  );
}

function StepCard({
  n,
  title,
  time,
  body,
}: {
  n: string;
  title: string;
  time: string;
  body: string;
}) {
  return (
    <article className="bg-paper p-6 sm:p-8 flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <span className="font-display text-3xl font-medium text-accent leading-none">
          {n}
        </span>
        <span className="label-mono">{time}</span>
      </div>
      <h3 className="font-display text-2xl leading-tight font-medium">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{body}</p>
    </article>
  );
}

function OutcomeCard({
  n,
  headline,
  desc,
}: {
  n: string;
  headline: string;
  desc: string;
}) {
  return (
    <article className="area-card flex flex-col">
      <span className="kicker">
        <span className="section-num">No. </span>
        {n}
      </span>
      <h3 className="mt-3 font-display text-2xl leading-tight">{headline}</h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{desc}</p>
    </article>
  );
}
