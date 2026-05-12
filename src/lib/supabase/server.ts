import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Singleton clients — 매 호출마다 새 클라이언트를 만드는 대신 한 번만 생성해서
// 재사용. 페이지 SSR 사이 connection pool / fetch keepalive 도 재활용 가능.
let _anon: SupabaseClient | null = null;
let _admin: SupabaseClient | null = null;

export function supabaseAnon() {
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing in .env.local');
  }
  if (!_anon) {
    _anon = createClient(url, anonKey, { auth: { persistSession: false } });
  }
  return _anon;
}

export function supabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env.local');
  }
  if (!_admin) {
    _admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return _admin;
}
