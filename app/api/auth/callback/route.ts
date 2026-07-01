import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_STATE_COOKIE,
  AppSession,
  authRedirectUri,
  createMsalClient,
  createSessionToken,
  sessionCookieName,
  shouldUseSecureCookies,
} from "@/lib/auth";
import { getRuntimeConfig, isAuthConfigured } from "@/lib/config";

export async function GET(request: NextRequest) {
  const config = getRuntimeConfig();

  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/", config.app.baseUrl));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(AUTH_STATE_COOKIE)?.value;

  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/upload?authError=state", config.app.baseUrl));
  }

  const client = createMsalClient();
  const token = await client.acquireTokenByCode({
    code,
    redirectUri: authRedirectUri(),
    scopes: ["openid", "profile", "email", "offline_access"],
  });

  if (!token?.account) {
    return NextResponse.redirect(new URL("/upload?authError=account", config.app.baseUrl));
  }

  const session: AppSession = {
    user: {
      id: token.account.homeAccountId,
      name: token.account.name || "Signed-in user",
      email: token.account.username,
    },
    expiresAt:
      token.expiresOn?.toISOString() ||
      (() => {
        const fallbackExpiry = new Date();
        fallbackExpiry.setHours(fallbackExpiry.getHours() + 1);
        return fallbackExpiry.toISOString();
      })(),
  };

  const response = NextResponse.redirect(new URL("/", config.app.baseUrl));
  response.cookies.set(sessionCookieName(), await createSessionToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    expires: new Date(session.expiresAt),
  });
  response.cookies.delete(AUTH_STATE_COOKIE);
  return response;
}
