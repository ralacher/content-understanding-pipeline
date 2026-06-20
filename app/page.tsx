export const dynamic = "force-dynamic";

import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { buildDashboardSnapshot } from "@/lib/storage";
import { formatDateTime, formatPercentage, formatRelativeTime } from "@/lib/utils";

export default async function OverviewPage() {
  const dashboard = await buildDashboardSnapshot();

  return (
    <div className="stack-xl">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Overview dashboard</p>
          <h1>Track ingestion, conversion, and analysis in one place.</h1>
          <p className="hero-copy">
            Monitor the full Azure pipeline from AVI upload through MP4 generation and readable
            content understanding summaries.
          </p>
        </div>
        <div className="hero-metrics">
          <div>
            <span className="metric-label">Processed</span>
            <strong>{dashboard.kpis.completedFiles}</strong>
          </div>
          <div>
            <span className="metric-label">In flight</span>
            <strong>{dashboard.kpis.activeFiles}</strong>
          </div>
        </div>
      </section>

      <section className="grid kpi-grid">
        <article className="card kpi-card">
          <span className="metric-label">Total files</span>
          <strong>{dashboard.kpis.totalFiles}</strong>
        </article>
        <article className="card kpi-card">
          <span className="metric-label">Completed</span>
          <strong>{dashboard.kpis.completedFiles}</strong>
        </article>
        <article className="card kpi-card">
          <span className="metric-label">Failures</span>
          <strong>{dashboard.kpis.failedFiles}</strong>
        </article>
        <article className="card kpi-card">
          <span className="metric-label">Average confidence</span>
          <strong>{formatPercentage(dashboard.kpis.averageConfidence)}</strong>
        </article>
      </section>

      <section className="grid dashboard-grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Pipeline health</p>
              <h2>Status breakdown</h2>
            </div>
          </div>
          <div className="status-list">
            {dashboard.statusBreakdown.map((item) => (
              <div className="status-row" key={item.status}>
                <StatusBadge status={item.status} />
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Exceptions</p>
              <h2>Needs attention</h2>
            </div>
          </div>
          {dashboard.failureItems.length === 0 ? (
            <p className="muted">No failed items right now.</p>
          ) : (
            <div className="stack-md">
              {dashboard.failureItems.map((item) => (
                <Link className="failure-item" href={`/assets/${item.id}`} key={item.id}>
                  <div>
                    <strong>{item.fileName}</strong>
                    <p className="muted">{item.errorMessage || item.summary}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </Link>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent items</p>
            <h2>Latest uploads and analysis results</h2>
          </div>
          <Link className="button secondary" href="/upload">
            Upload AVI
          </Link>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th>Updated</th>
                <th>Owner</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.recentItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="table-link" href={`/assets/${item.id}`}>
                      {item.fileName}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{formatRelativeTime(item.updatedAt)}</td>
                  <td>{item.uploadedBy.name}</td>
                  <td>{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
