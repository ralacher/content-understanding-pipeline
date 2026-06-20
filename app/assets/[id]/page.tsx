export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { buildPlaybackUrl, getMediaRecord } from "@/lib/storage";
import { formatDateTime, formatDuration, formatPercentage } from "@/lib/utils";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await getMediaRecord(id);

  if (!record) {
    notFound();
  }

  const playbackUrl = await buildPlaybackUrl(record);

  return (
    <div className="stack-xl">
      <section className="hero-card compact">
        <div>
          <p className="eyebrow">Detailed view</p>
          <h1>{record.fileName}</h1>
          <p className="hero-copy">{record.summary}</p>
        </div>
        <div className="hero-metrics">
          <div>
            <span className="metric-label">Status</span>
            <StatusBadge status={record.status} />
          </div>
          <div>
            <span className="metric-label">Confidence</span>
            <strong>{formatPercentage(record.confidence)}</strong>
          </div>
        </div>
      </section>

      <section className="grid detail-grid">
        <article className="card stack-lg">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Analysis</p>
              <h2>User-friendly output</h2>
            </div>
          </div>
          <div className="metadata-grid">
            <div>
              <span className="metric-label">Uploaded</span>
              <strong>{formatDateTime(record.createdAt)}</strong>
            </div>
            <div>
              <span className="metric-label">Updated</span>
              <strong>{formatDateTime(record.updatedAt)}</strong>
            </div>
            <div>
              <span className="metric-label">Duration</span>
              <strong>{formatDuration(record.durationSeconds)}</strong>
            </div>
            <div>
              <span className="metric-label">Language</span>
              <strong>{record.language || "—"}</strong>
            </div>
          </div>

          <div className="tag-list">
            {record.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>

          <div className="stack-md">
            {record.analysisSections.map((section) => (
              <section className="analysis-section" key={section.title}>
                <h3>{section.title}</h3>
                <p>{section.summary}</p>
                {section.bullets.length > 0 ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          {record.errorMessage ? (
            <div className="error-panel">
              <strong>Processing error</strong>
              <p>{record.errorMessage}</p>
            </div>
          ) : null}
        </article>

        <aside className="stack-lg">
          <article className="card stack-md">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Video</p>
                <h2>Processed MP4</h2>
              </div>
            </div>
            {playbackUrl ? (
              <video className="video-player" controls preload="metadata" src={playbackUrl} />
            ) : (
              <div className="video-placeholder">
                <strong>Playback unavailable</strong>
                <p>
                  Configure the processed MP4 container to generate secure playback URLs for this
                  screen.
                </p>
              </div>
            )}
          </article>

          <article className="card stack-md">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2>Processing lifecycle</h2>
              </div>
            </div>
            <div className="timeline-list">
              {record.timeline.map((event) => (
                <div className="timeline-item" key={`${event.status}-${event.at}`}>
                  <StatusBadge status={event.status} />
                  <div>
                    <strong>{formatDateTime(event.at)}</strong>
                    <p className="muted">{event.note || "Status recorded."}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
          <Link className="button secondary" href="/upload">
            Upload another AVI
          </Link>
        </aside>
      </section>
    </div>
  );
}
