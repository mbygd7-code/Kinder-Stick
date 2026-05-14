"use client";

/**
 * Diagnosis Profile Provider — 클라이언트 사이드 컨텍스트.
 *
 * 책임:
 *   1) 워크스페이스의 OpsContext 를 가져옴 (서버 우선, localStorage 폴백)
 *   2) computeDiagnosisProfile 로 DiagnosisProfile 생성
 *   3) React context 로 자식 컴포넌트에 제공
 *   4) "ops-context:applied" 이벤트로 자동 갱신
 *   5) 사용자가 T3 카드를 ✕ 로 거부하면 rejected_codes 에 추가 (localStorage 저장)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { computeDiagnosisProfile } from "@/lib/diagnosis-profile/compute";
import type { DiagnosisProfile } from "@/lib/diagnosis-profile/types";
import { emptyDiagnosisProfile } from "@/lib/diagnosis-profile/types";
import {
  loadOpsContextFromLocalStorage,
} from "@/lib/ops-context/adapt";

interface ContextValue {
  profile: DiagnosisProfile;
  /** 사용자가 ✕ 로 거부한 added sub-item codes */
  rejectedAddedCodes: Set<string>;
  rejectAdded: (code: string) => void;
  unrejectAdded: (code: string) => void;
  /** 사용자가 펼친 비활성 카드 codes (펼친 후 답변 가능) */
  expandedInactiveCodes: Set<string>;
  toggleInactive: (code: string) => void;
}

const DiagnosisProfileCtx = createContext<ContextValue | null>(null);

const REJECTED_KEY_PREFIX = "kso-diag-profile-rejected-";
const EXPANDED_KEY_PREFIX = "kso-diag-profile-expanded-";

export function DiagnosisProfileProvider({
  workspace,
  children,
}: {
  workspace: string;
  children: ReactNode;
}) {
  const [profile, setProfile] = useState<DiagnosisProfile>(
    emptyDiagnosisProfile(),
  );
  const [rejectedAddedCodes, setRejectedAddedCodes] = useState<Set<string>>(
    new Set(),
  );
  const [expandedInactiveCodes, setExpandedInactiveCodes] = useState<
    Set<string>
  >(new Set());

  // Hydrate user choices from localStorage
  useEffect(() => {
    try {
      const r = localStorage.getItem(`${REJECTED_KEY_PREFIX}${workspace}`);
      if (r) setRejectedAddedCodes(new Set(JSON.parse(r) as string[]));
    } catch {
      // ignore
    }
    try {
      const e = localStorage.getItem(`${EXPANDED_KEY_PREFIX}${workspace}`);
      if (e) setExpandedInactiveCodes(new Set(JSON.parse(e) as string[]));
    } catch {
      // ignore
    }
  }, [workspace]);

  // Recompute profile when OpsContext changes
  const refresh = useCallback(async () => {
    let ctx = null;
    try {
      const res = await fetch(
        `/api/ops-context/${encodeURIComponent(workspace)}`,
      );
      if (res.ok) {
        const d = await res.json();
        if (d.ok && d.data && Object.keys(d.data).length > 0) {
          ctx = d.data;
        }
      }
    } catch {
      // ignore, fallback below
    }
    if (!ctx) ctx = loadOpsContextFromLocalStorage(workspace);
    setProfile(computeDiagnosisProfile(ctx));
  }, [workspace]);

  useEffect(() => {
    refresh();
    const onAny = () => refresh();
    window.addEventListener("storage", onAny);
    window.addEventListener("ops-context:applied", onAny);
    // 같은 탭 안에서 OpsContextSection draft 수정은 storage 이벤트가 발화 안 함.
    // 같은 패턴의 DiagnosisAdaptEmphasisApplier 처럼 5초 폴링 safety net 추가.
    const interval = window.setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("storage", onAny);
      window.removeEventListener("ops-context:applied", onAny);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const rejectAdded = useCallback(
    (code: string) => {
      setRejectedAddedCodes((prev) => {
        const next = new Set(prev);
        next.add(code);
        try {
          localStorage.setItem(
            `${REJECTED_KEY_PREFIX}${workspace}`,
            JSON.stringify(Array.from(next)),
          );
        } catch {
          // ignore
        }
        return next;
      });
    },
    [workspace],
  );

  const unrejectAdded = useCallback(
    (code: string) => {
      setRejectedAddedCodes((prev) => {
        const next = new Set(prev);
        next.delete(code);
        try {
          localStorage.setItem(
            `${REJECTED_KEY_PREFIX}${workspace}`,
            JSON.stringify(Array.from(next)),
          );
        } catch {
          // ignore
        }
        return next;
      });
    },
    [workspace],
  );

  const toggleInactive = useCallback(
    (code: string) => {
      setExpandedInactiveCodes((prev) => {
        const next = new Set(prev);
        if (next.has(code)) next.delete(code);
        else next.add(code);
        try {
          localStorage.setItem(
            `${EXPANDED_KEY_PREFIX}${workspace}`,
            JSON.stringify(Array.from(next)),
          );
        } catch {
          // ignore
        }
        return next;
      });
    },
    [workspace],
  );

  const value = useMemo<ContextValue>(
    () => ({
      profile,
      rejectedAddedCodes,
      rejectAdded,
      unrejectAdded,
      expandedInactiveCodes,
      toggleInactive,
    }),
    [
      profile,
      rejectedAddedCodes,
      rejectAdded,
      unrejectAdded,
      expandedInactiveCodes,
      toggleInactive,
    ],
  );

  return (
    <DiagnosisProfileCtx.Provider value={value}>
      {children}
    </DiagnosisProfileCtx.Provider>
  );
}

/** 자식 컴포넌트가 profile + 사용자 액션 핸들러를 가져오는 hook */
export function useDiagnosisProfile(): ContextValue {
  const v = useContext(DiagnosisProfileCtx);
  if (!v) {
    // provider 외부에서 사용 시 안전 default (UI 변화 없음)
    return {
      profile: emptyDiagnosisProfile(),
      rejectedAddedCodes: new Set(),
      rejectAdded: () => {},
      unrejectAdded: () => {},
      expandedInactiveCodes: new Set(),
      toggleInactive: () => {},
    };
  }
  return v;
}
