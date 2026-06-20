import { cookies } from "next/headers";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { JWTPayload, jwtVerify, SignJWT } from "jose";
import { getRuntimeConfig, isAuthConfigured } from "@/lib/config";

const SESSION_COOKIE = "content-understanding-session";
export const AUTH_STATE_COOKIE = "content-understanding-auth-state";

export interface AppSession {
  user: {
    id: string;
    name: string;
    email: string;
  };
  expiresAt: string;
  isDemo: boolean;
}

function getSecret(): Uint8Array {
  const config = getRuntimeConfig();
  return new TextEncoder().encode(
    config.auth.sessionSecret || "content-understanding-demo-session-secret",
  );
}

function msalAuthority(): string {
  const config = getRuntimeConfig();
  return `https://login.microsoftonline.com/${config.auth.tenantId}`;
}

export function createMsalClient(): ConfidentialClientApplication {
  const config = getRuntimeConfig();
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.auth.clientId!,
      clientSecret: config.auth.clientSecret!,
      authority: msalAuthority(),
    },
  });
}

export function authRedirectUri(): string {
  const config = getRuntimeConfig();
  return `${config.app.baseUrl}/api/auth/callback`;
}

export function shouldUseSecureCookies(): boolean {
  return authRedirectUri().startsWith("https://");
}

export function getDemoSession(): AppSession {
  return {
    user: {
      id: "demo-user",
      name: "Demo reviewer",
      email: "demo.user@local.test",
    },
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
    isDemo: true,
  };
}

export async function createSessionToken(session: AppSession): Promise<string> {
  return new SignJWT({
    sub: session.user.id,
    name: session.user.name,
    email: session.user.email,
    demo: session.isDemo,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(session.expiresAt)
    .sign(getSecret());
}

function payloadToSession(payload: JWTPayload): AppSession | null {
  if (!payload.sub || typeof payload.name !== "string" || typeof payload.email !== "string") {
    return null;
  }

  return {
    user: {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
    },
    expiresAt:
      typeof payload.exp === "number"
        ? new Date(payload.exp * 1000).toISOString()
        : new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    isDemo: payload.demo === true,
  };
}

export async function getAppSession(): Promise<AppSession | null> {
  if (!isAuthConfigured()) {
    return getDemoSession();
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payloadToSession(payload);
  } catch {
    return null;
  }
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function logoutUrl(): string {
  const config = getRuntimeConfig();
  return `${msalAuthority()}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(
    config.app.baseUrl,
  )}`;
}
