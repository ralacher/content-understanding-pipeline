import { MediaRecord, ProcessingStatus } from "./domain";

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatRelativeTime(value: string): string {
  const deltaSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  for (const [unit, amount] of divisions) {
    if (Math.abs(deltaSeconds) >= amount || unit === "minute") {
      return formatter.format(Math.round(deltaSeconds / amount), unit);
    }
  }

  return formatter.format(deltaSeconds, "second");
}

export function formatPercentage(value?: number): string {
  if (typeof value !== "number") {
    return "—";
  }

  return `${Math.round(value * 100)}%`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds) {
    return "—";
  }

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }

  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }

  return `${secs}s`;
}

export function statusTone(status: ProcessingStatus): string {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "uploaded":
    case "converting":
    case "converted":
    case "analyzing":
      return "warning";
    default:
      return "neutral";
  }
}

export function statusLabel(status: ProcessingStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function slugifyFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  const name = lastDot >= 0 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot >= 0 ? fileName.slice(lastDot) : "";

  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${normalized || "upload"}${ext.toLowerCase()}`;
}

export function sortRecords(records: MediaRecord[]): MediaRecord[] {
  return [...records].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}
