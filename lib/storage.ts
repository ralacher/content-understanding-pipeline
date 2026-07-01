import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CosmosClient } from "@azure/cosmos";
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  SASProtocol,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { QueueClient } from "@azure/storage-queue";
import { getRuntimeConfig, isCloudConfigured } from "./config";
import { getTokenCredential } from "./credential";
import { DashboardSnapshot, MediaRecord, ModelTokenKpi } from "./domain";
import { slugifyFileName, sortRecords } from "./utils";

type ModelTokenAggregate = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  otherTokens: number;
};

function getCredential() {
  return getTokenCredential();
}

function getEnvNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function getBlobServiceClient(): BlobServiceClient {
  const config = getRuntimeConfig();
  return new BlobServiceClient(config.storage.accountUrl!, getCredential());
}

function getContainerClient(containerName: string): ContainerClient {
  return getBlobServiceClient().getContainerClient(containerName);
}

function getQueueClient(): QueueClient {
  const config = getRuntimeConfig();
  const queueServiceUrl = config.storage.accountUrl!.replace(".blob.", ".queue.");
  return new QueueClient(`${queueServiceUrl}/${config.storage.queueName}`, getCredential());
}

function getCosmosContainer() {
  const config = getRuntimeConfig();
  const cosmos = new CosmosClient({
    endpoint: config.cosmos.endpoint!,
    aadCredentials: getCredential(),
  });

  return cosmos.database(config.cosmos.database!).container(config.cosmos.container!);
}

export function buildSourceBlobName(fileName: string, id: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return `${stamp}/${id}-${slugifyFileName(fileName)}`;
}

export function buildProcessedBlobName(sourceBlobName: string): string {
  if (/\.[^/.]+$/.test(sourceBlobName)) {
    return sourceBlobName.replace(/\.[^/.]+$/, ".mp4");
  }

  return `${sourceBlobName}.mp4`;
}

export async function listMediaRecords(limit?: number): Promise<MediaRecord[]> {
  if (!isCloudConfigured()) {
    const records: MediaRecord[] = [];
    return typeof limit === "number" ? records.slice(0, limit) : records;
  }

  const container = getCosmosContainer();
  const { resources } = await container.items
    .query<MediaRecord>({
      query: "SELECT * FROM c WHERE c.type = @type ORDER BY c.createdAt DESC",
      parameters: [{ name: "@type", value: "mediaRecord" }],
    })
    .fetchAll();

  const records = sortRecords(resources);
  return typeof limit === "number" ? records.slice(0, limit) : records;
}

export async function getMediaRecord(id: string): Promise<MediaRecord | null> {
  if (!isCloudConfigured()) {
    return null;
  }

  const container = getCosmosContainer();
  // Prefer a point-read with partition key for reliability and lower latency.
  try {
    const response = await container.item(id, id).read<MediaRecord>();
    if (response.resource?.type === "mediaRecord") {
      return response.resource;
    }
  } catch (error) {
    const statusCode = (error as { code?: number; statusCode?: number } | undefined)?.statusCode
      ?? (error as { code?: number; statusCode?: number } | undefined)?.code;
    if (statusCode && statusCode !== 404) {
      throw error;
    }
  }

  const { resources } = await container.items
    .query<MediaRecord>({
      query: "SELECT * FROM c WHERE c.id = @id AND c.type = @type",
      parameters: [
        { name: "@id", value: id },
        { name: "@type", value: "mediaRecord" },
      ],
    })
    .fetchAll();

  if (resources[0]) {
    return resources[0];
  }

  // Final fallback: when point-read/query edge cases occur, scan known media records once.
  const records = await listMediaRecords();
  return records.find((record) => record.id === id) || null;
}

export async function getMediaRecordBySourceBlobName(blobName: string): Promise<MediaRecord | null> {
  if (!isCloudConfigured()) {
    return null;
  }

  const container = getCosmosContainer();
  const { resources } = await container.items
    .query<MediaRecord>({
      query: "SELECT * FROM c WHERE c.sourceBlobName = @blobName AND c.type = @type",
      parameters: [
        { name: "@blobName", value: blobName },
        { name: "@type", value: "mediaRecord" },
      ],
    })
    .fetchAll();

  return resources[0] || null;
}

export async function upsertMediaRecord(record: MediaRecord): Promise<MediaRecord> {
  if (!isCloudConfigured()) {
    throw new Error("Azure storage and Cosmos DB must be configured before records can be written.");
  }

  const container = getCosmosContainer();
  const response = await container.items.upsert(record);
  return (response.resource as MediaRecord | undefined) || record;
}

export async function buildDashboardSnapshot(): Promise<DashboardSnapshot> {
  const records = await listMediaRecords();
  const completed = records.filter((record) => record.status === "completed");
  const failed = records.filter((record) => record.status === "failed");
  const processed = records.filter((record) => ["completed", "failed"].includes(record.status));
  const active = records.filter(
    (record) => !["completed", "failed"].includes(record.status),
  );
  const videoHours = completed.reduce((sum, record) => sum + (record.usage?.videoHours || 0), 0);
  const contextualizationTokens = completed.reduce(
    (sum, record) => sum + (record.usage?.contextualizationTokens || 0),
    0,
  );
  const tokenUsageByModel = buildTokenUsageByModel(completed);

  const breakdownOrder = ["uploaded", "converting", "analyzing", "completed", "failed"] as const;

  return {
    kpis: {
      processedFiles: processed.length,
      totalFiles: records.length,
      completedFiles: completed.length,
      activeFiles: active.length,
      failedFiles: failed.length,
      videoHours,
      contextualizationTokens,
      tokenUsageByModel,
    },
    statusBreakdown: breakdownOrder.map((status) => ({
      status,
      count: records.filter((record) => record.status === status).length,
    })),
    allItems: records,
    recentItems: records.slice(0, 6),
    failureItems: failed.slice(0, 3),
  };
}

function buildTokenUsageByModel(records: MediaRecord[]): ModelTokenKpi[] {
  const aggregate = new Map<string, ModelTokenAggregate>();

  for (const record of records) {
    if (!record.usage?.tokens) {
      continue;
    }

    for (const [key, value] of Object.entries(record.usage.tokens)) {
      if (typeof value !== "number" || value <= 0) {
        continue;
      }

      const { model, kind } = parseTokenMetricKey(key);
      const next = aggregate.get(model) || {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        otherTokens: 0,
      };

      if (kind === "input") {
        next.inputTokens += value;
      } else if (kind === "output") {
        next.outputTokens += value;
      } else if (kind === "cachedInput") {
        next.cachedInputTokens += value;
      } else {
        next.otherTokens += value;
      }

      aggregate.set(model, next);
    }
  }

  return Array.from(aggregate.entries())
    .map(([model, metrics]) => ({
      model,
      ...metrics,
      totalTokens:
        metrics.inputTokens + metrics.outputTokens + metrics.cachedInputTokens + metrics.otherTokens,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

function parseTokenMetricKey(metricKey: string): {
  model: string;
  kind: "input" | "output" | "cachedInput" | "other";
} {
  const lowercase = metricKey.toLowerCase();
  if (lowercase.endsWith("-cached-input")) {
    return { model: metricKey.slice(0, -"-cached-input".length), kind: "cachedInput" };
  }

  if (lowercase.endsWith("-cachedinput")) {
    return { model: metricKey.slice(0, -"-cachedinput".length), kind: "cachedInput" };
  }

  if (lowercase.endsWith("-input")) {
    return { model: metricKey.slice(0, -"-input".length), kind: "input" };
  }

  if (lowercase.endsWith("-output")) {
    return { model: metricKey.slice(0, -"-output".length), kind: "output" };
  }

  return { model: metricKey, kind: "other" };
}

export async function uploadSourceFile(input: {
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadedBy: MediaRecord["uploadedBy"];
}): Promise<MediaRecord> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const sourceBlobName = buildSourceBlobName(input.fileName, id);
  const record: MediaRecord = {
    id,
    type: "mediaRecord",
    fileName: input.fileName,
    sourceBlobName,
    status: "uploaded",
    summary: "Upload completed and waiting for the containerized conversion worker.",
    createdAt: now,
    updatedAt: now,
    uploadedBy: input.uploadedBy,
    tags: ["queued"],
    analysisSections: [
      {
        title: "Upload accepted",
        summary: "The AVI file was accepted and stored successfully.",
        bullets: [
          "The storage-triggered worker will pick up the file automatically.",
        ],
      },
    ],
    timeline: [{ status: "uploaded", at: now }],
  };

  if (!isCloudConfigured()) {
    throw new Error("Azure storage, queue, and Cosmos resources must be configured before uploads are allowed.");
  }

  const config = getRuntimeConfig();
  const uploadContainer = getContainerClient(config.storage.uploadContainer!);
  await uploadContainer.createIfNotExists();
  await uploadContainer.getBlockBlobClient(sourceBlobName).uploadData(input.bytes, {
    blobHTTPHeaders: {
      blobContentType: input.contentType,
    },
  });

  await upsertMediaRecord(record);

  if (config.storage.enqueueOnUpload) {
    await queueRecordForProcessing(record.id, sourceBlobName);
  }

  return record;
}

export async function queueRecordForProcessing(recordId: string, blobName: string): Promise<void> {
  if (!isCloudConfigured()) {
    throw new Error("Azure storage and queue resources must be configured before queueing work.");
  }

  const queue = getQueueClient();
  await queue.createIfNotExists();
  await queue.sendMessage(JSON.stringify({ recordId, blobName }));
}

export async function uploadProcessedMp4(blobName: string, bytes: Buffer): Promise<void> {
  const config = getRuntimeConfig();
  const container = getContainerClient(config.storage.processedContainer!);
  await container.createIfNotExists();
  const blobClient = container.getBlockBlobClient(blobName);
  await blobClient.deleteIfExists();
  await blobClient.uploadData(bytes, {
    blobHTTPHeaders: {
      blobContentType: "video/mp4",
    },
  });
}

export async function downloadSourceBlob(blobName: string): Promise<Buffer> {
  const config = getRuntimeConfig();
  const client = getContainerClient(config.storage.uploadContainer!).getBlobClient(blobName);
  const response = await client.download();
  const chunks: Buffer[] = [];

  for await (const chunk of response.readableStreamBody || []) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function buildPlaybackUrl(record: MediaRecord): Promise<string | null> {
  if (!record.processedBlobName || !isCloudConfigured()) {
    return null;
  }

  const config = getRuntimeConfig();
  const startOffsetMinutes = getEnvNumber("PLAYBACK_SAS_START_OFFSET_MINUTES", 5);
  const ttlMinutes = getEnvNumber("PLAYBACK_SAS_TTL_MINUTES", 60);
  const startsOn = new Date(Date.now() - startOffsetMinutes * 60 * 1000);
  const expiresOn = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const serviceClient = getBlobServiceClient();
  const userDelegationKey = await serviceClient.getUserDelegationKey(startsOn, expiresOn);
  const accountName = new URL(config.storage.accountUrl!).hostname.split(".")[0];
  const sas = generateBlobSASQueryParameters(
    {
      containerName: config.storage.processedContainer!,
      blobName: record.processedBlobName,
      startsOn,
      expiresOn,
      permissions: BlobSASPermissions.parse("r"),
      protocol: SASProtocol.Https,
    },
    userDelegationKey,
    accountName,
  ).toString();

  return `${getContainerClient(config.storage.processedContainer!).getBlobClient(record.processedBlobName).url}?${sas}`;
}
