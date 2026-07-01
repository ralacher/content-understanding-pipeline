import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse } from "node:path";
import { spawn } from "node:child_process";
import { QueueClient } from "@azure/storage-queue";
import { normalizeAnalysisResult } from "../lib/analysis";
import { getRuntimeConfig, isCloudConfigured } from "../lib/config";
import { getTokenCredential } from "../lib/credential";
import { MediaRecord } from "../lib/domain";
import { indexMediaRecord } from "../lib/search";
import { initializeTelemetry } from "../lib/telemetry";
import {
  buildProcessedBlobName,
  buildPlaybackUrl,
  downloadSourceBlob,
  getMediaRecord,
  getMediaRecordBySourceBlobName,
  queueRecordForProcessing,
  uploadProcessedMp4,
  upsertMediaRecord,
} from "../lib/storage";

interface QueuePayload {
  recordId?: string;
  blobName?: string;
  data?: {
    url?: string;
  };
}

declare global {
  var __contentUnderstandingAnalyzersEnsured: Set<string> | undefined;
}

initializeTelemetry(process.env.APPLICATIONINSIGHTS_ROLE_NAME || "worker");

function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", ["-y", "-i", inputPath, outputPath], { stdio: "inherit" });
    process.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}`));
    });
  });
}

function decodeMessageText(messageText: string): string {
  try {
    JSON.parse(messageText);
    return messageText;
  } catch {
    // Event Grid delivers queue messages as base64-encoded JSON
    return Buffer.from(messageText, "base64").toString("utf-8");
  }
}

function extractBlobName(payload: QueuePayload): string | undefined {
  if (payload.blobName) {
    return payload.blobName;
  }

  if (payload.data?.url) {
    const url = new URL(payload.data.url);
    return url.pathname.split("/").slice(2).join("/");
  }

  return undefined;
}

function getBearerToken(token: string): string {
  return ["Bearer", token].join(" ");
}

function getEnvNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function isContentUnderstandingUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("preview api is not supported in this region") ||
    message.includes("resource not found")
  );
}

function resolveAnalyzerUrl(analyzerUrl: string): { analyzerUrl: string; apiVersion: string } {
  const url = new URL(analyzerUrl);
  const apiVersion = url.searchParams.get("api-version");

  if (!apiVersion) {
    throw new Error("Configured Content Understanding analyzer URL is missing the api-version query parameter.");
  }

  return {
    analyzerUrl: `${url.origin}${url.pathname}`,
    apiVersion,
  };
}

async function updateRecord(record: MediaRecord, patch: Partial<MediaRecord>): Promise<MediaRecord> {
  const next: MediaRecord = {
    ...record,
    ...patch,
    updatedAt: new Date().toISOString(),
    timeline: patch.status
      ? [...record.timeline, { status: patch.status, at: new Date().toISOString(), note: patch.errorMessage }]
      : record.timeline,
  };

  await upsertMediaRecord(next);
  return next;
}

async function analyzeProcessedVideo(record: MediaRecord): Promise<unknown> {
  const config = getRuntimeConfig();
  const playbackUrl = await buildPlaybackUrl(record);

  if (!config.contentUnderstanding.analyzerUrl || !playbackUrl) {
    return {
      summary: "Content Understanding analyzer URL not configured. Conversion completed without analysis.",
      keywords: ["conversion-only"],
    };
  }

  const credential = getTokenCredential();
  const token = await credential.getToken(config.contentUnderstanding.scope);
  const maxPollAttempts = getEnvNumber("CONTENT_UNDERSTANDING_MAX_POLLS", 40);
  const pollIntervalMs = getEnvNumber("CONTENT_UNDERSTANDING_POLL_INTERVAL_MS", 5000);
  const analyzerReference = resolveAnalyzerUrl(config.contentUnderstanding.analyzerUrl);

  if (!token?.token) {
    throw new Error("Unable to acquire an access token for Content Understanding.");
  }

  const analyzeResponse = await fetch(
    `${analyzerReference.analyzerUrl}:analyze?api-version=${analyzerReference.apiVersion}`,
    {
      method: "POST",
      headers: {
        Authorization: getBearerToken(token.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [
          {
            url: playbackUrl,
            mimeType: "video/mp4",
          },
        ],
      }),
    },
  );

  if (!analyzeResponse.ok) {
    const failurePayload = await analyzeResponse.text().catch(() => "");
    throw new Error(
      `Content Understanding request failed with ${analyzeResponse.status}${failurePayload ? `: ${failurePayload}` : "."}`,
    );
  }

  const operationLocation = analyzeResponse.headers.get("operation-location");

  if (!operationLocation) {
    return analyzeResponse.json();
  }

  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const pollResponse = await fetch(operationLocation, {
      headers: {
        Authorization: getBearerToken(token.token),
      },
    });

    if (!pollResponse.ok) {
      throw new Error(`Content Understanding poll failed with ${pollResponse.status}.`);
    }

    const payload = (await pollResponse.json()) as { status?: string } & Record<string, unknown>;
    const status = payload.status?.toLowerCase();

    if (status === "succeeded") {
      return payload;
    }

    if (status === "failed") {
      throw new Error("Content Understanding marked the analysis as failed.");
    }
  }

  throw new Error("Timed out while waiting for Content Understanding analysis to finish.");
}

async function processMessage(payload: QueuePayload): Promise<void> {
  const blobName = extractBlobName(payload);

  if (!blobName) {
    throw new Error("Queue message did not contain a blob name.");
  }

  let record = payload.recordId
    ? await getMediaRecord(payload.recordId)
    : await getMediaRecordBySourceBlobName(blobName);

  if (!record) {
    throw new Error(`Unable to find a media record for ${payload.recordId || blobName}.`);
  }

  record = await updateRecord(record, {
    status: "converting",
    summary: "FFmpeg conversion is in progress.",
  });

  const workDir =
    process.env.WORKER_TMP_DIR || join(tmpdir(), "content-understanding-pipeline", "worker");
  await mkdir(workDir, { recursive: true });
  const inputPath = join(workDir, basename(blobName));
  const inputPathParts = parse(inputPath);
  const outputPath = join(inputPathParts.dir, `${inputPathParts.name}.mp4`);
  const isMp4Source = inputPathParts.ext.toLowerCase() === ".mp4";
  const sourceBytes = await downloadSourceBlob(blobName);

  if (isMp4Source) {
    await uploadProcessedMp4(buildProcessedBlobName(blobName), sourceBytes);
  } else {
    await writeFile(inputPath, sourceBytes);
    await runFfmpeg(inputPath, outputPath);
    await uploadProcessedMp4(buildProcessedBlobName(blobName), await readFile(outputPath));
  }

  record = await updateRecord(record, {
    status: "analyzing",
    processedBlobName: buildProcessedBlobName(blobName),
    summary: isMp4Source
      ? "Source is already MP4. Skipping conversion and starting Content Understanding analysis."
      : "MP4 generated successfully. Content Understanding analysis is running.",
  });

  let analysisPayload: unknown;
  try {
    analysisPayload = await analyzeProcessedVideo(record);
  } catch (error) {
    if (isContentUnderstandingUnavailableError(error)) {
      await updateRecord(record, {
        status: "failed",
        summary:
          "Video conversion succeeded, but Content Understanding analysis is unavailable in this region/account configuration.",
        errorMessage: error instanceof Error ? error.message : "Content Understanding is unavailable.",
      });
      return;
    }

    await updateRecord(record, {
      status: "failed",
      summary: "Video conversion succeeded, but Content Understanding analysis failed.",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Content Understanding analysis failed.",
    });

    throw error;
  }

  const normalized = normalizeAnalysisResult(analysisPayload);
  const indexedAt = new Date().toISOString();

  const indexingRecord = await updateRecord(record, {
    status: "indexing",
    processedBlobName: buildProcessedBlobName(blobName),
    summary: normalized.summary,
    confidence: normalized.confidence,
    durationSeconds: normalized.durationSeconds,
    language: normalized.language,
    tags: normalized.tags,
    analysisSections: normalized.sections,
    usage: normalized.usage,
    unsafeBehaviors: normalized.unsafeBehaviors,
    numberOfPeople: normalized.numberOfPeople,
    objectData: normalized.objectData,
    trainPassings: normalized.trainPassings,
    location: normalized.location,
    rawAnalysis: analysisPayload,
    indexedAt,
  });

  await indexMediaRecord(indexingRecord);

  await updateRecord(indexingRecord, { status: "completed" });
}

async function runWorker(once: boolean) {
  if (!isCloudConfigured()) {
    console.log("Cloud resources are not configured. Worker is idle.");
    return;
  }

  const config = getRuntimeConfig();
  const queueServiceUrl = config.storage.accountUrl!.replace(".blob.", ".queue.");
  const queue = new QueueClient(`${queueServiceUrl}/${config.storage.queueName}`, getTokenCredential());
  const visibilityTimeout = getEnvNumber("WORKER_QUEUE_VISIBILITY_TIMEOUT", 300);
  const idlePollIntervalMs = getEnvNumber("WORKER_POLL_INTERVAL_MS", 10000);
  await queue.createIfNotExists();

  do {
    const receive = await queue.receiveMessages({
      numberOfMessages: 1,
      visibilityTimeout,
    });
    const message = receive.receivedMessageItems[0];

    if (!message?.messageText) {
      if (once) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, idlePollIntervalMs));
      continue;
    }

    try {
      const parsed = JSON.parse(decodeMessageText(message.messageText)) as QueuePayload | QueuePayload[];
      const payload = Array.isArray(parsed) ? parsed[0] : parsed;
      await processMessage(payload);
      await queue.deleteMessage(message.messageId, message.popReceipt);
    } catch (error) {
      console.error(error);
      if (message.dequeueCount >= 5) {
        await queue.deleteMessage(message.messageId, message.popReceipt);
      }
    }
  } while (!once);
}

runWorker(process.argv.includes("--once")).catch(async (error) => {
  console.error(error);
  if (process.env.WORKER_RETRY_RECORD_ID && process.env.WORKER_RETRY_BLOB_NAME) {
    await queueRecordForProcessing(process.env.WORKER_RETRY_RECORD_ID, process.env.WORKER_RETRY_BLOB_NAME);
  }
  process.exitCode = 1;
});
