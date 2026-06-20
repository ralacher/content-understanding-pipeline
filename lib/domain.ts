export const PROCESSING_STATUSES = [
  "uploaded",
  "converting",
  "converted",
  "analyzing",
  "completed",
  "failed",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface AnalysisSection {
  title: string;
  summary: string;
  bullets: string[];
}

export interface ProcessingEvent {
  status: ProcessingStatus;
  at: string;
  note?: string;
}

export interface UploadedBy {
  id: string;
  name: string;
  email: string;
}

export interface MediaRecord {
  id: string;
  type: "mediaRecord";
  fileName: string;
  sourceBlobName: string;
  processedBlobName?: string;
  status: ProcessingStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  uploadedBy: UploadedBy;
  confidence?: number;
  durationSeconds?: number;
  language?: string;
  tags: string[];
  errorMessage?: string;
  analysisSections: AnalysisSection[];
  timeline: ProcessingEvent[];
  rawAnalysis?: unknown;
}

export interface DashboardSnapshot {
  kpis: {
    totalFiles: number;
    completedFiles: number;
    activeFiles: number;
    failedFiles: number;
    averageConfidence: number;
  };
  statusBreakdown: Array<{
    status: ProcessingStatus;
    count: number;
  }>;
  recentItems: MediaRecord[];
  failureItems: MediaRecord[];
}

export interface ContentUnderstandingSummary {
  summary: string;
  confidence?: number;
  language?: string;
  durationSeconds?: number;
  tags: string[];
  sections: AnalysisSection[];
}
