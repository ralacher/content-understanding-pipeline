import { getAppSession } from "@/lib/auth";
import { isAuthConfigured } from "@/lib/config";

export async function AuthPanel() {
  const session = await getAppSession();
  const authEnabled = isAuthConfigured();

  if (!authEnabled) {
    return (
      <div className="auth-panel demo-pill" title="Microsoft Entra auth is not configured in this environment.">
        <span className="eyebrow">Demo mode</span>
        <strong>No Entra config</strong>
      </div>
    );
  }

  if (!session) {
    return (
      <a className="button secondary" href="/api/auth/login">
        Sign in with Entra ID
      </a>
    );
  }

  return (
    <div className="auth-panel">
      <div>
        <div className="eyebrow">Signed in</div>
        <strong>{session.user.name}</strong>
        <div className="muted">{session.user.email}</div>
      </div>
      <a className="button ghost" href="/api/auth/logout">
        Sign out
      </a>
    </div>
  );
}
