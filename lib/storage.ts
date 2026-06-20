import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CosmosClient } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  SASProtocol,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { QueueClient } from "@azure/storage-queue";
import { getRuntimeConfig, isCloudConfigured } from "@/lib/config";
import { demoRecords } from "@/lib/demo-data";
import { DashboardSnapshot, MediaRecord } from "@/lib/domain";
import { slugifyFileName, sortRecords } from "@/lib/utils";

const DEMO_DB_PATH = "/tmp/content-understanding-pipeline/demo-records.json";
const DEMO_UPLOAD_PATH = "/tmp/content-understanding-pipeline/uploads";

function getCredential(): DefaultAzureCredential {
  return new DefaultAzureCredential();
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

async function ensureDemoStore(): Promise<void> {
  await mkdir(dirname(DEMO_DB_PATH), { recursive: true });

  try {
    await readFile(DEMO_DB_PATH, "utf8");
  } catch {
    await writeFile(DEMO_DB_PATH, JSON.stringify(demoRecords, null, 2), "utf8");
  }
}

async function readDemoStore(): Promise<MediaRecord[]> {
  await ensureDemoStore();
  const contents = await readFile(DEMO_DB_PATH, "utf8");
  return JSON.parse(contents) as MediaRecord[];
}

async function writeDemoStore(records: MediaRecord[]): Promise<void> {
  await ensureDemoStore();
  await writeFile(DEMO_DB_PATH, JSON.stringify(sortRecords(records), null, 2), "utf8");
}

export function buildSourceBlobName(fileName: string, id: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return `${stamp}/${id}-${slugifyFileName(fileName)}`;
}

export function buildProcessedBlobName(sourceBlobName: string): string {
  return sourceBlobName.replace(/\.avi$/i, ".mp4");
}

export async function listMediaRecords(limit = 25): Promise<MediaRecord[]> {
  if (!isCloudConfigured()) {
    return sortRecords(await readDemoStore()).slice(0, limit);
  }

  const container = getCosmosContainer();
  const { resources } = await container.items
    .query<MediaRecord>({
      query: "SELECT * FROM c WHERE c.type = @type ORDER BY c.createdAt DESC",
      parameters: [{ name: "@type", value: "mediaRecord" }],
    })
    .fetchAll();

  return sortRecords(resources).slice(0, limit);
}

export async function getMediaRecord(id: string): Promise<MediaRecord | null> {
  if (!isCloudConfigured()) {
    const records = await readDemoStore();
    return records.find((record) => record.id === id) || null;
  }

  const container = getCosmosContainer();
  const { resources } = await container.items
    .query<MediaRecord>({
      query: "SELECT * FROM c WHERE c.id = @id AND c.type = @type",
      parameters: [
        { name: "@id", value: id },
        { name: "@type", value: "mediaRecord" },
      ],
    })
    .fetchAll();

  return resources[0] || null;
}

export async function getMediaRecordBySourceBlobName(blobName: string): Promise<MediaRecord | null> {
  if (!isCloudConfigured()) {
    const records = await readDemoStore();
    return records.find((record) => record.sourceBlobName === blobName) || null;
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
    const records = await readDemoStore();
    const next = [...records.filter((item) => item.id !== record.id), record];
    await writeDemoStore(next);
    return record;
  }

  const container = getCosmosContainer();
  const response = await container.items.upsert(record);
  return (response.resource as MediaRecord | undefined) || record;
}

export async function buildDashboardSnapshot(): Promise<DashboardSnapshot> {
  const records = await listMediaRecords(40);
  const completed = records.filter((record) => record.status === "completed");
  const failed = records.filter((record) => record.status === "failed");
  const active = records.filter(
    (record) => !["completed", "failed"].includes(record.status),
  );
  const confidenceValues = completed
    .map((record) => record.confidence)
    .filter((value): value is number => typeof value === "number");
  const averageConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;

  const breakdownOrder = ["uploaded", "converting", "converted", "analyzing", "completed", "failed"] as const;

  return {
    kpis: {
      totalFiles: records.length,
      completedFiles: completed.length,
      activeFiles: active.length,
      failedFiles: failed.length,
      averageConfidence,
    },
    statusBreakdown: breakdownOrder.map((status) => ({
      status,
      count: records.filter((record) => record.status === status).length,
    })),
    recentItems: records.slice(0, 6),
    failureItems: failed.slice(0, 3),
  };
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
    summary: isCloudConfigured()
      ? "Upload completed and waiting for the containerized conversion worker."
      : "Demo upload captured locally. Configure Azure resources to enable automatic conversion.",
    createdAt: now,
    updatedAt: now,
    uploadedBy: input.uploadedBy,
    tags: ["queued"],
    analysisSections: [
      {
        title: "Upload accepted",
        summary: "The AVI file was accepted and stored successfully.",
        bullets: [
          isCloudConfigured()
            ? "The storage-triggered worker will pick up the file automatically."
            : "This environment is running in demo mode with local file persistence.",
        ],
      },
    ],
    timeline: [{ status: "uploaded", at: now }],
  };

  if (!isCloudConfigured()) {
    await mkdir(DEMO_UPLOAD_PATH, { recursive: true });
    await writeFile(join(DEMO_UPLOAD_PATH, `${id}-${slugifyFileName(input.fileName)}`), input.bytes);
    await upsertMediaRecord(record);
    return record;
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
    return;
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
