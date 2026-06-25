export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { VideoTimestamp } from "@/components/video-timestamp";
import { buildPlaybackUrl, getMediaRecord } from "@/lib/storage";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { ProcessingStatus } from "@/lib/domain";

const BASE_PIPELINE_STAGES: Array<{ key: "uploaded" | "converting" | "analyzing" | "indexing"; label: string }> = [
  { key: "uploaded", label: "Uploaded" },
  { key: "converting", label: "Converting" },
  { key: "analyzing", label: "Analyzing" },
  { key: "indexing", label: "Indexing" },
];

function statusReached(stage: "uploaded" | "converting" | "analyzing" | "indexing" | "completed" | "failed", status: ProcessingStatus): boolean {
  if (stage === "uploaded") {
    return true;
  }

  if (stage === "failed") {
    return status === "failed";
  }

  const rank: Record<ProcessingStatus, number> = {
    uploaded: 0,
    converting: 1,
    converted: 1,
    analyzing: 2,
    indexing: 3,
    completed: 4,
    failed: 4,
  };
  const stageRank: Record<"converting" | "analyzing" | "indexing" | "completed", number> = {
    converting: 1,
    analyzing: 2,
    indexing: 3,
    completed: 4,
  };

  return rank[status] >= stageRank[stage];
}

function getContentFieldStrings(rawAnalysis: unknown): { summary?: string; highlights?: string } {
  const root = rawAnalysis && typeof rawAnalysis === "object" ? (rawAnalysis as Record<string, unknown>) : {};
  const result = root.result && typeof root.result === "object" ? (root.result as Record<string, unknown>) : root;
  const contents = Array.isArray(result.contents) ? result.contents : [];
  const firstContent = contents[0] && typeof contents[0] === "object"
    ? (contents[0] as Record<string, unknown>)
    : undefined;
  const fields = firstContent?.fields && typeof firstContent.fields === "object"
    ? (firstContent.fields as Record<string, unknown>)
    : undefined;
  const summaryField = fields?.summary && typeof fields.summary === "object"
    ? (fields.summary as Record<string, unknown>)
    : undefined;
  const highlightsField = fields?.highlights && typeof fields.highlights === "object"
    ? (fields.highlights as Record<string, unknown>)
    : undefined;

  return {
    summary: typeof summaryField?.valueString === "string" ? summaryField.valueString : undefined,
    highlights: typeof highlightsField?.valueString === "string" ? highlightsField.valueString : undefined,
  };
}

function getStructuredFieldsFromRawAnalysis(rawAnalysis: unknown): {
  unsafeBehaviors?: Array<{ description: string; timestamp?: string }>;
  numberOfPeople?: number;
  objectData?: Array<{ name: string; description: string }>;
  trainPassings?: string[];
  location?: string;
} {
  const root = rawAnalysis && typeof rawAnalysis === "object" ? (rawAnalysis as Record<string, unknown>) : {};
  const result = root.result && typeof root.result === "object" ? (root.result as Record<string, unknown>) : root;
  const contents = Array.isArray(result.contents) ? result.contents : [];
  const firstContent = contents[0] && typeof contents[0] === "object"
    ? (contents[0] as Record<string, unknown>)
    : undefined;
  const fields = firstContent?.fields && typeof firstContent.fields === "object"
    ? (firstContent.fields as Record<string, unknown>)
    : undefined;
  const unsafeBehaviorsField = fields?.unsafeBehaviors && typeof fields.unsafeBehaviors === "object"
    ? (fields.unsafeBehaviors as Record<string, unknown>)
    : undefined;
  const legacyUnsafeBehaviorField = fields?.unsafeBehavior && typeof fields.unsafeBehavior === "object"
    ? (fields.unsafeBehavior as Record<string, unknown>)
    : undefined;
  const numberOfPeopleField = fields?.numberOfPeople && typeof fields.numberOfPeople === "object"
    ? (fields.numberOfPeople as Record<string, unknown>)
    : undefined;
  const objectDataField = fields?.objectData && typeof fields.objectData === "object"
    ? (fields.objectData as Record<string, unknown>)
    : undefined;
  const trainPassingsField = fields?.trainPassings && typeof fields.trainPassings === "object"
    ? (fields.trainPassings as Record<string, unknown>)
    : undefined;
  const legacyTrainPassingField = fields?.trainPassing && typeof fields.trainPassing === "object"
    ? (fields.trainPassing as Record<string, unknown>)
    : undefined;
  const locationField = fields?.location && typeof fields.location === "object"
    ? (fields.location as Record<string, unknown>)
    : undefined;

  const objectData = Array.isArray(objectDataField?.valueArray)
    ? objectDataField.valueArray
        .map((entry): { name: string; description: string } | undefined => {
          if (!entry || typeof entry !== "object") {
            return undefined;
          }

          const item = entry as Record<string, unknown>;
          const valueObject = item.valueObject && typeof item.valueObject === "object"
            ? (item.valueObject as Record<string, unknown>)
            : item;
          const name = typeof valueObject.name === "string" ? valueObject.name : undefined;
          const description = typeof valueObject.description === "string" ? valueObject.description : undefined;
          return name && description ? { name, description } : undefined;
        })
        .filter((item): item is { name: string; description: string } => Boolean(item))
    : [];

  const trainPassingsSource = Array.isArray(trainPassingsField?.valueArray)
    ? trainPassingsField.valueArray
    : Array.isArray(legacyTrainPassingField?.valueArray)
      ? legacyTrainPassingField.valueArray
      : [];

  const trainPassings = trainPassingsSource.length > 0
    ? trainPassingsSource
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }

          if (entry && typeof entry === "object") {
            const item = entry as Record<string, unknown>;
            if (typeof item.valueString === "string") {
              return item.valueString;
            }
            if (typeof item.time === "string") {
              return item.time;
            }
            if (typeof item.timestamp === "string") {
              return item.timestamp;
            }
          }

          return undefined;
        })
        .filter((item): item is string => Boolean(item))
    : undefined;

  const numberOfPeople = typeof numberOfPeopleField?.valueInt === "number"
    ? numberOfPeopleField.valueInt
    : typeof numberOfPeopleField?.valueNumber === "number"
      ? numberOfPeopleField.valueNumber
      : undefined;

  const unsafeBehaviorsSource = Array.isArray(unsafeBehaviorsField?.valueArray)
    ? unsafeBehaviorsField.valueArray
    : Array.isArray(legacyUnsafeBehaviorField?.valueArray)
      ? legacyUnsafeBehaviorField.valueArray
      : [];

  const unsafeBehaviors = unsafeBehaviorsSource.length > 0
    ? unsafeBehaviorsSource
        .map((entry): { description: string; timestamp?: string } | undefined => {
          if (!entry || typeof entry !== "object") {
            return undefined;
          }

          const item = entry as Record<string, unknown>;
          const valueObject = item.valueObject && typeof item.valueObject === "object"
            ? (item.valueObject as Record<string, unknown>)
            : item;
          const descriptionField = valueObject?.description && typeof valueObject.description === "object"
            ? (valueObject.description as Record<string, unknown>)
            : undefined;
          const timestampField = valueObject?.timestamp && typeof valueObject.timestamp === "object"
            ? (valueObject.timestamp as Record<string, unknown>)
            : undefined;
          const description = typeof descriptionField?.valueString === "string"
            ? descriptionField.valueString
            : typeof item.description === "string"
              ? item.description
              : undefined;
          const timestamp = typeof timestampField?.valueString === "string"
            ? timestampField.valueString
            : typeof item.timestamp === "string"
              ? item.timestamp
              : undefined;

          return description ? { description, timestamp } : undefined;
        })
        .filter((item): item is { description: string; timestamp?: string } => Boolean(item))
    : [];

  return {
    unsafeBehaviors,
    numberOfPeople,
    objectData,
    trainPassings,
    location: typeof locationField?.valueString === "string" ? locationField.valueString : undefined,
  };
}

function getUnsafeBehaviorsFromRawAnalysis(rawAnalysis: unknown): Array<{ description: string; timestamp?: string }> {
  const root = rawAnalysis && typeof rawAnalysis === "object" ? (rawAnalysis as Record<string, unknown>) : {};
  const result = root.result && typeof root.result === "object" ? (root.result as Record<string, unknown>) : root;
  const contents = Array.isArray(result.contents) ? result.contents : [];
  const firstContent = contents[0] && typeof contents[0] === "object"
    ? (contents[0] as Record<string, unknown>)
    : undefined;
  const fields = firstContent?.fields && typeof firstContent.fields === "object"
    ? (firstContent.fields as Record<string, unknown>)
    : undefined;
  const unsafeField = fields?.unsafeBehaviors && typeof fields.unsafeBehaviors === "object"
    ? (fields.unsafeBehaviors as Record<string, unknown>)
    : undefined;
  const legacyUnsafeField = fields?.unsafeBehavior && typeof fields.unsafeBehavior === "object"
    ? (fields.unsafeBehavior as Record<string, unknown>)
    : undefined;
  const valueArray = unsafeField?.valueArray || legacyUnsafeField?.valueArray;

  if (!Array.isArray(valueArray)) {
    return [];
  }

  const mappedUnsafeBehaviors = valueArray
    .map((entry): { description: string; timestamp?: string } | undefined => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }

      const item = entry as Record<string, unknown>;
      const valueObject = item.valueObject && typeof item.valueObject === "object"
        ? (item.valueObject as Record<string, unknown>)
        : undefined;
      const descriptionField = valueObject?.description && typeof valueObject.description === "object"
        ? (valueObject.description as Record<string, unknown>)
        : undefined;
      const timestampField = valueObject?.timestamp && typeof valueObject.timestamp === "object"
        ? (valueObject.timestamp as Record<string, unknown>)
        : undefined;
      const description = typeof descriptionField?.valueString === "string"
        ? descriptionField.valueString
        : typeof item.description === "string"
          ? item.description
          : undefined;
      const timestamp = typeof timestampField?.valueString === "string"
        ? timestampField.valueString
        : typeof item.timestamp === "string"
          ? item.timestamp
          : undefined;

      return description ? { description, timestamp } : undefined;
    })
    .filter((item): item is { description: string; timestamp?: string } => Boolean(item));

  return mappedUnsafeBehaviors;
}

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

  const asset = record!;

  const playbackUrl = await buildPlaybackUrl(asset);
  const contentFields = getContentFieldStrings(asset.rawAnalysis);
  const structuredFields = getStructuredFieldsFromRawAnalysis(asset.rawAnalysis);
  const unsafeBehaviors = asset.unsafeBehaviors && asset.unsafeBehaviors.length > 0
    ? asset.unsafeBehaviors.filter((item): item is { description: string; timestamp?: string } => Boolean(item?.description))
    : getUnsafeBehaviorsFromRawAnalysis(asset.rawAnalysis);
  // Keep polling until the pipeline reaches a terminal state, even if playback becomes available early.
  const shouldPoll = !["completed", "failed"].includes(asset.status);
  const hiddenStructuredSectionTitles = new Set([
    "transcript highlights",
    "detected themes",
    "unsafe behavior",
    "unsafe behaviors",
    "people count",
    "objects",
    "train passing",
    "train passings",
    "location",
    "generated fields",
    "executive summary",
  ]);
  const visibleSections = asset.analysisSections.filter((section) => {
    const title = section.title.toLowerCase();
    return !hiddenStructuredSectionTitles.has(title);
  });
  const stageTimestamps = new Map(asset.timeline.map((event) => [event.status, event.at] as const));
  const terminalStage = asset.status === "failed"
    ? { key: "failed" as const, label: "Failed" }
    : { key: "completed" as const, label: "Completed" };
  const pipelineStages = [...BASE_PIPELINE_STAGES, terminalStage];
  const trainPassingItems = asset.trainPassings ?? structuredFields.trainPassings ?? [];

  return (
    <div className="stack-xl">
      <AutoRefresh intervalMs={10000} enabled={shouldPoll} />
      <section className="card stack-md">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Asset</p>
              <h2>{asset.fileName}</h2>
          </div>
          <Link className="button secondary" href="/upload">
            Upload another video
          </Link>
        </div>
        <div className="lifecycle-grid">
          {pipelineStages.map((stage) => {
            const reached = statusReached(stage.key, asset.status);
            const isFailed = stage.key === "failed" && asset.status === "failed";
            const isCompleted = reached && !isFailed;
            const cssClass = isFailed ? "failed" : isCompleted ? "completed" : "pending";
            const indexingFallbackTimestamp =
              stage.key === "indexing"
                ? stageTimestamps.get("indexing") || asset.indexedAt || stageTimestamps.get("completed")
                : undefined;
            const timestamp =
              stage.key === "uploaded"
                ? stageTimestamps.get("uploaded") || asset.createdAt
                : stage.key === "indexing"
                  ? indexingFallbackTimestamp
                  : stageTimestamps.get(stage.key as ProcessingStatus);

            return (
              <article className={`lifecycle-stage ${cssClass}`} key={stage.key}>
                <span className="metric-label">{stage.label}</span>
                <strong>{timestamp ? formatDateTime(timestamp) : "Not reached"}</strong>
              </article>
            );
          })}
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
              <strong>{formatDateTime(asset.createdAt)}</strong>
            </div>
            <div>
              <span className="metric-label">Updated</span>
              <strong>{formatDateTime(asset.updatedAt)}</strong>
            </div>
          </div>

          <div className="tag-list">
            {asset.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>

          <div className="structured-fields-grid">
            <article className="field-card">
              <span className="metric-label">Unsafe behaviors</span>
              <strong>{formatNumber(unsafeBehaviors.length)}</strong>
            </article>
            <article className="field-card">
              <span className="metric-label">People count</span>
              <strong>{asset.numberOfPeople ?? structuredFields.numberOfPeople ?? "—"}</strong>
            </article>
            <article className="field-card">
              <span className="metric-label">Location</span>
              <strong>{asset.location || structuredFields.location || "—"}</strong>
            </article>
            <article className="field-card">
              <span className="metric-label">Train passings</span>
              <strong>{formatNumber(trainPassingItems.length)}</strong>
            </article>
          </div>

          {contentFields.summary ? (
            <section className="analysis-section">
              <h3>Executive summary</h3>
              <p>{contentFields.summary}</p>
            </section>
          ) : null}

          {unsafeBehaviors.length > 0 ? (
            <section className="analysis-section unsafe-behaviors-section">
              <h3>Unsafe behaviors</h3>
              <p>The following safety observations were detected in the analysis.</p>
              <ul>
                {unsafeBehaviors.map((behavior, index) => (
                  <li key={`${behavior.description}-${index}`}>
                    <strong>{behavior.description}</strong>
                    {behavior.timestamp ? (
                      <div className="behavior-timestamp">
                        <small>at <VideoTimestamp timestamp={behavior.timestamp} /></small>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {asset.objectData && asset.objectData.length > 0 ? (
            <section className="analysis-section">
              <h3>Objects</h3>
              <ul>
                {asset.objectData.map((item) => (
                  <li key={`${item.name}-${item.description}`}>
                    <strong>{item.name}</strong> {item.description}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {trainPassingItems.length > 0 ? (
            <section className="analysis-section">
              <h3>Train passings</h3>
              <p>Detected train passing times from the video timeline.</p>
              <div className="timestamp-list">
                {trainPassingItems.map((timestamp, index) => (
                  <VideoTimestamp key={`${timestamp}-${index}`} timestamp={timestamp} />
                ))}
              </div>
            </section>
          ) : null}

          <div className="stack-md">
            {visibleSections.map((section) => (
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

          {asset.errorMessage ? (
            <div className="error-panel">
              <strong>Processing error</strong>
              <p>{asset.errorMessage}</p>
            </div>
          ) : null}
        </article>

        <aside className="stack-lg">
          <article className="card stack-md video-panel-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Video</p>
                <h2>Processed MP4</h2>
              </div>
            </div>
            {playbackUrl ? (
              <div className="video-interaction-layer">
                <video
                  id="video-player"
                  className="video-player"
                  controls
                  preload="metadata"
                  crossOrigin="anonymous"
                  playsInline
                >
                  <source src={playbackUrl} type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
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
        </aside>
      </section>
    </div>
  );
}
