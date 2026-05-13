# Supabase 이메일 OTP 6자리 코드 활성화 가이드

## 문제

로그인 페이지에서 6자리 코드 입력 UI 는 활성화됐는데, **사용자에게 도착하는 메일에는 매직링크만 있고 6자리 숫자 코드는 없는** 경우.

## 원인

Supabase 의 기본 "Magic Link" 이메일 템플릿은 `{{ .ConfirmationURL }}`(링크) 만 포함하고 `{{ .Token }}`(코드) 변수는 빠져 있습니다.

`signInWithOtp()` API 자체는 항상 OTP 토큰을 생성하지만, 메일에 그 토큰을 노출하려면 템플릿을 직접 수정해야 합니다.

## 해결 (5분)

### 1단계: Supabase Dashboard 접속

해당 프로젝트의 Dashboard 로 이동:

```
https://supabase.com/dashboard/project/{프로젝트-id}/auth/templates
```

`Authentication → Email Templates` 메뉴.

### 2단계: "Magic Link" 템플릿 편집

기본 템플릿은 다음 같이 생겼습니다:

```html
<h2>Magic Link</h2>
<p>Follow this link to login:</p>
<p><a href="{{ .ConfirmationURL }}">Log In</a></p>
```

### 3단계: `{{ .Token }}` 변수 추가

아래 내용으로 교체 (또는 추가):

```html
<h2>Kinder Stick OS 로그인</h2>

<p style="font-size:16px; color:#444;">
  아래 <strong>6자리 코드</strong>를 로그인 페이지에 입력하세요:
</p>

<p style="
  font-size:32px;
  font-weight:bold;
  letter-spacing:0.4em;
  font-family:'Courier New', monospace;
  padding:16px 24px;
  background:#f5f1e8;
  border:2px solid #2d2920;
  display:inline-block;
  margin:16px 0;
">
  {{ .Token }}
</p>

<p style="font-size:14px; color:#666; margin-top:24px;">
  또는 아래 링크를 클릭하면 자동으로 로그인됩니다 (코드 입력 불필요):
</p>
<p>
  <a href="{{ .ConfirmationURL }}" style="
    display:inline-block;
    padding:10px 20px;
    background:#2d2920;
    color:#fff;
    text-decoration:none;
    font-size:14px;
  ">
    로그인 →
  </a>
</p>

<p style="font-size:12px; color:#999; margin-top:32px;">
  이 메일이 본인이 요청한 것이 아니면 무시하세요.
  코드는 60분 후 만료됩니다.
</p>
```

### 4단계: 저장 + 검증

1. "Save changes" 클릭
2. 로그인 페이지에서 다시 코드 받기
3. 메일에 6자리 코드가 큰 글씨로 표시되는지 확인

## 양쪽 모두 동작

템플릿에 코드와 링크를 모두 포함하면 사용자가 선택 가능:

- **빠른 흐름**: 메일에서 코드 복사 → 로그인 페이지에 입력 (1초)
- **편한 흐름**: 메일의 로그인 링크 클릭 → 자동 인증

코드 측에서는 `/auth/login` 페이지가 OTP 검증, `/auth/callback` 페이지가 매직링크 검증을 각각 처리하므로 어느 쪽이든 동작합니다.

## SMS 도 활성화하려면

선택 사항 — 휴대폰 번호로 OTP 받기:

```
Authentication → Settings → SMS Provider (Twilio 등) 연결
```

코드 변경 없이 `signInWithOtp({ phone })` 호출만 추가하면 됩니다.

## 변수 참조

Supabase 이메일 템플릿에서 사용 가능한 변수:

| 변수 | 의미 |
|---|---|
| `{{ .Token }}` | 6자리 OTP 코드 |
| `{{ .ConfirmationURL }}` | 매직링크 URL (자동 인증) |
| `{{ .SiteURL }}` | 프로젝트 site URL |
| `{{ .Email }}` | 수신자 이메일 |
| `{{ .Data }}` | 사용자 메타데이터 |

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 코드가 메일에 안 보임 | 템플릿에 `{{ .Token }}` 누락 — 추가하고 저장 |
| 코드 입력 시 "Token has expired" | OTP 60분 만료 — 새 코드 받기 |
| 코드 입력 시 "Invalid token" | 코드 오타 — 6자리 숫자만 |
| 매직링크 클릭 시 callback 에러 | `Site URL` 설정 확인 (Dashboard → Settings → URL Configuration) |
| 메일이 안 옴 | Supabase free tier 의 SMTP rate limit — 직접 SMTP (Resend·SendGrid) 설정 |
