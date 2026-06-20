import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AUTH_STATE_COOKIE, authRedirectUri, createMsalClient, shouldUseSecureCookies } from "@/lib/auth";
import { getRuntimeConfig, isAuthConfigured } from "@/lib/config";

export async function GET() {
  const config = getRuntimeConfig();

  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/upload", config.app.baseUrl));
  }

  const state = randomUUID();
  const client = createMsalClient();
  const authUrl = await client.getAuthCodeUrl({
    redirectUri: authRedirectUri(),
    responseMode: "query",
    scopes: ["openid", "profile", "email", "offline_access"],
    state,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(AUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
