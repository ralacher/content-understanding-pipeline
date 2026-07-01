export const PROCESSING_STATUSES = [
  "uploaded",
  "converting",
  "analyzing",
  "indexing",
  "completed",
  "failed",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface AnalysisSection {
  title: string;
  summary: string;
  bullets: string[];
}

export interface UnsafeBehavior {
  description?: string;
  timestamp?: string;
}

export interface ObjectDataItem {
  name: string;
  description: string;
}

export interface AnalysisUsage {
  videoHours?: number;
  contextualizationTokens?: number;
  tokens?: Record<string, number>;
}

export interface ModelTokenKpi {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  otherTokens: number;
  totalTokens: number;
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
  indexedAt?: string;
  uploadedBy: UploadedBy;
  confidence?: number;
  durationSeconds?: number;
  language?: string;
  tags: string[];
  errorMessage?: string;
  analysisSections: AnalysisSection[];
  timeline: ProcessingEvent[];
  usage?: AnalysisUsage;
  unsafeBehaviors?: UnsafeBehavior[];
  numberOfPeople?: number;
  objectData?: ObjectDataItem[];
  trainPassings?: string[];
  location?: string;
  rawAnalysis?: unknown;
}

export interface DashboardSnapshot {
  kpis: {
    processedFiles: number;
    totalFiles: number;
    completedFiles: number;
    activeFiles: number;
    failedFiles: number;
    videoHours: number;
    contextualizationTokens: number;
    tokenUsageByModel: ModelTokenKpi[];
  };
  statusBreakdown: Array<{
    status: ProcessingStatus;
    count: number;
  }>;
  allItems: MediaRecord[];
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
  usage?: AnalysisUsage;
  unsafeBehaviors?: UnsafeBehavior[];
  numberOfPeople?: number;
  objectData?: ObjectDataItem[];
  trainPassings?: string[];
  location?: string;
}
