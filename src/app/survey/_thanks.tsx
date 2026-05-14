/**
 * Survey 제출 완료 화면 (공용).
 */

export function ThanksScreen({ message }: { message?: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <p className="kicker !text-signal-green mb-3">제출 완료</p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight mb-5">
          참여해 주셔서{" "}
          <span className="italic font-light">감사합니다.</span>
        </h1>
        <p className="text-base leading-relaxed text-ink-soft">
          {message ?? "여러분의 응답은 서비스 개선에 큰 도움이 됩니다."}
        </p>
        <p className="mt-8 label-mono text-ink-soft">
          이 창은 닫으셔도 됩니다.
        </p>
      </div>
    </main>
  );
}
