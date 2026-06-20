import { NextResponse } from "next/server";
import { logoutUrl, sessionCookieName } from "@/lib/auth";
import { getRuntimeConfig, isAuthConfigured } from "@/lib/config";

export async function GET() {
  const config = getRuntimeConfig();
  const response = NextResponse.redirect(
    isAuthConfigured() ? logoutUrl() : new URL("/", config.app.baseUrl),
  );
  response.cookies.delete(sessionCookieName());
  return response;
}
