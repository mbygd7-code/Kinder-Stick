"use client";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="label-mono hover:text-ink"
      onClick={async () => {
        await fetch("/api/auth/pin/logout", { method: "POST" });
        window.location.href = "/auth/login";
      }}
    >
      로그아웃
    </button>
  );
}
