import { NextResponse, type NextRequest } from "next/server";
import { supabaseServerCtx } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sb = await supabaseServerCtx();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/diag", req.url));
}

export async function POST(req: NextRequest) {
  return GET(req);
}
