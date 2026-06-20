export const dynamic = "force-dynamic";

import { UploadForm } from "@/components/upload-form";
import { getAppSession } from "@/lib/auth";
import { isCloudConfigured } from "@/lib/config";

export default async function UploadPage() {
  const session = await getAppSession();
  const cloudConfigured = isCloudConfigured();

  return (
    <div className="stack-xl">
      <section className="hero-card compact">
        <div>
          <p className="eyebrow">Upload screen</p>
          <h1>Upload AVI files for review, conversion, and analysis.</h1>
          <p className="hero-copy">
            Manual uploads are intended for validation and spot checks while the backend automation
            handles conversion, content understanding, and persistence.
          </p>
        </div>
      </section>

      <section className="grid upload-grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Upload</p>
              <h2>Submit a source AVI</h2>
            </div>
          </div>
          <UploadForm />
        </article>

        <article className="card stack-md">
          <div>
            <p className="eyebrow">Environment</p>
            <h2>Pipeline readiness</h2>
          </div>
          <div className="callout-list">
            <div className="callout">
              <strong>Identity</strong>
              <p>
                {session?.isDemo
                  ? "Demo session active."
                  : session
                    ? `Signed in as ${session.user.email}.`
                    : "Sign in with Entra ID to authorize uploads."}
              </p>
            </div>
            <div className="callout">
              <strong>Storage and Cosmos</strong>
              <p>
                {cloudConfigured
                  ? "Azure resources are configured. Uploads will be written to Blob Storage and tracked in Cosmos DB."
                  : "Azure resources are not configured yet. Uploads are stored locally in /tmp for demo purposes."}
              </p>
            </div>
            <div className="callout">
              <strong>Worker behavior</strong>
              <p>
                The FFmpeg worker listens for new upload events, converts AVI to MP4, then persists
                readable analysis output.
              </p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
