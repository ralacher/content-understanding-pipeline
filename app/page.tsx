export const dynamic = "force-dynamic";

import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { estimateContentUnderstandingCost } from "@/lib/cost-estimate";
import { buildDashboardSnapshot } from "@/lib/storage";
import { formatDateTime, formatDecimal, formatNumber, formatRelativeTime } from "@/lib/utils";

interface OverviewPageProps {
  searchParams?: Promise<{
    page?: string | string[];
  }>;
}

const PAGE_SIZE = 10;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getPageNumber(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsedValue = Number.parseInt(rawValue || "1", 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1;
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const dashboard = await buildDashboardSnapshot();
  const params = searchParams ? await searchParams : undefined;
  const totalItems = dashboard.allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(getPageNumber(params?.page), totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageItems = dashboard.allItems.slice(pageStart, pageStart + PAGE_SIZE);
  const estimatedCost = estimateContentUnderstandingCost({
    videoHours: dashboard.kpis.videoHours,
    contextualizationTokens: dashboard.kpis.contextualizationTokens,
    tokenUsageByModel: dashboard.kpis.tokenUsageByModel,
  });
  const usageCards = [
    {
      key: "video-hours",
      label: "Video hours",
      value: formatDecimal(dashboard.kpis.videoHours),
      detail: undefined,
    },
    {
      key: "context-tokens",
      label: "Context tokens",
      value: formatNumber(dashboard.kpis.contextualizationTokens),
      detail: undefined,
    },
    ...dashboard.kpis.tokenUsageByModel.map((usage) => ({
      key: usage.model,
      label: usage.model,
      value: formatNumber(usage.totalTokens),
      detail: `In ${formatNumber(usage.inputTokens)} | Out ${formatNumber(usage.outputTokens)}`,
    })),
    {
      key: "estimated-cost",
      label: "Estimated cost",
      value: formatCurrency(estimatedCost.totalCost),
      detail: `Extract ${formatCurrency(estimatedCost.extractionCost)} | Context ${formatCurrency(estimatedCost.contextualizationCost)} | LLM ${formatCurrency(estimatedCost.llmCost)} (docs sample rates)`,
    },
  ];

  return (
    <div className="stack-xl">
      <AutoRefresh intervalMs={10000} />
      <section className="hero-card compact">
        <div>
          <p className="eyebrow">Overview dashboard</p>
          <div className="overview-panel-metrics">
            <div className="grid kpi-grid-five">
              <article className="kpi-card">
                <span className="metric-label">Processed</span>
                <strong>{formatNumber(dashboard.kpis.processedFiles)}</strong>
              </article>
              <article className="kpi-card">
                <span className="metric-label">In flight</span>
                <strong>{formatNumber(dashboard.kpis.activeFiles)}</strong>
              </article>
              <article className="kpi-card">
                <span className="metric-label">Completed</span>
                <strong>{formatNumber(dashboard.kpis.completedFiles)}</strong>
              </article>
              <article className="kpi-card">
                <span className="metric-label">Failures</span>
                <strong>{formatNumber(dashboard.kpis.failedFiles)}</strong>
              </article>
              <article className="kpi-card">
                <span className="metric-label">Total files</span>
                <strong>{formatNumber(dashboard.kpis.totalFiles)}</strong>
              </article>
            </div>

            <div className="grid kpi-grid usage-grid">
              {usageCards.map((card) => (
                <article className="kpi-card" key={card.key}>
                  <span className="metric-label">{card.label}</span>
                  <strong>{card.value}</strong>
                  {card.detail ? <p className="muted">{card.detail}</p> : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">All items</p>
            <h2>All uploads and analysis results</h2>
          </div>
          <div className="section-actions">
            <Link className="button secondary" href="/search">
              Search analysis
            </Link>
            <Link className="button secondary" href="/upload">
              Upload video
            </Link>
          </div>
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
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No videos have been uploaded yet.
                  </td>
                </tr>
              ) : null}
              {pageItems.map((item) => (
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
        <div className="table-pagination">
          <p className="muted">
            Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, totalItems)} of {formatNumber(totalItems)} videos
          </p>
          {totalPages > 1 ? (
            <div className="section-actions">
              {currentPage > 1 ? (
                <Link className="button secondary" href={currentPage === 2 ? "/" : `/?page=${currentPage - 1}`}>
                  Previous
                </Link>
              ) : (
                <span className="button secondary" aria-disabled="true">
                  Previous
                </span>
              )}
              <span className="button ghost" aria-live="polite">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages ? (
                <Link className="button secondary" href={`/?page=${currentPage + 1}`}>
                  Next
                </Link>
              ) : (
                <span className="button secondary" aria-disabled="true">
                  Next
                </span>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
