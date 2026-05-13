"use client";

/**
 * ScrollToTopButton — 페이지 우측 하단에 떠 있는 "맨 위로" 버튼.
 *
 * 스크롤 위치가 일정 이상 내려가면 페이드인 등장.
 * 클릭하면 부드럽게 최상단으로 스크롤.
 */

import { useEffect, useState } from "react";

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 600);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const onClick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="페이지 맨 위로 스크롤"
      title="맨 위로"
      className={`fixed bottom-6 right-6 z-40 flex flex-col items-center justify-center gap-0.5 px-3 py-2 min-w-[3.25rem] border-2 border-ink bg-paper text-ink shadow-lg hover:bg-ink hover:text-paper transition-all ${
        visible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-2 pointer-events-none"
      }`}
    >
      <span className="font-mono text-base leading-none">↑</span>
      <span className="font-mono text-[10px] uppercase tracking-widest leading-none">
        Top
      </span>
      <span className="sr-only">맨 위로</span>
    </button>
  );
}
