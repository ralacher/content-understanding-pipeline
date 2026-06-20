import { AnalysisSection, ContentUnderstandingSummary } from "@/lib/domain";

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text || (item as Record<string, unknown>).label;
        return typeof text === "string" ? text : undefined;
      }

      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

function makeSection(title: string, summary: string, bullets: string[]): AnalysisSection | null {
  if (!summary && bullets.length === 0) {
    return null;
  }

  return {
    title,
    summary,
    bullets,
  };
}

export function normalizeAnalysisResult(payload: unknown): ContentUnderstandingSummary {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const result = root.result && typeof root.result === "object" ? (root.result as Record<string, unknown>) : root;
  const transcript = result.transcript && typeof result.transcript === "object"
    ? (result.transcript as Record<string, unknown>)
    : undefined;
  const transcriptSegments = transcript?.segments && Array.isArray(transcript.segments)
    ? transcript.segments
    : [];

  const summary =
    (typeof result.summary === "string" && result.summary) ||
    (typeof result.overview === "string" && result.overview) ||
    (typeof transcript?.summary === "string" && transcript.summary) ||
    "Content Understanding completed successfully.";

  const transcriptBullets = transcriptSegments
    .map((segment) => {
      if (!segment || typeof segment !== "object") {
        return undefined;
      }

      const text = (segment as Record<string, unknown>).text;
      return typeof text === "string" ? text : undefined;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 5);

  const keywordBullets = coerceStringArray(result.keywords).slice(0, 6);
  const topicBullets = coerceStringArray(result.topics).slice(0, 6);

  const sections = [
    makeSection("Executive summary", summary, []),
    makeSection(
      "Transcript highlights",
      transcriptBullets.length > 0
        ? "Representative spoken moments extracted from the recording."
        : "No transcript highlights were returned.",
      transcriptBullets,
    ),
    makeSection(
      "Detected themes",
      topicBullets.length > 0
        ? "Common themes identified in the analysis response."
        : keywordBullets.length > 0
          ? "Keywords were identified from the recording."
          : "No explicit themes were returned.",
      topicBullets.length > 0 ? topicBullets : keywordBullets,
    ),
  ].filter((item): item is AnalysisSection => Boolean(item));

  const confidence =
    typeof result.confidence === "number"
      ? result.confidence
      : typeof result.score === "number"
        ? result.score
        : undefined;

  const durationSeconds =
    typeof result.durationSeconds === "number"
      ? result.durationSeconds
      : typeof result.durationInSeconds === "number"
        ? result.durationInSeconds
        : undefined;

  const language =
    typeof result.language === "string"
      ? result.language
      : typeof transcript?.language === "string"
        ? transcript.language
        : undefined;

  const tags = Array.from(new Set([...topicBullets, ...keywordBullets])).slice(0, 8);

  return {
    summary,
    confidence,
    durationSeconds,
    language,
    tags,
    sections,
  };
}
