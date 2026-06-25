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

function getAnalyzerDefinition(analyzerId: string): Record<string, unknown> {
  const raw = process.env.CONTENT_UNDERSTANDING_ANALYZER_DEFINITION;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...parsed,
      analyzerId,
    };
  }

  return {
    baseAnalyzerId: process.env.CONTENT_UNDERSTANDING_BASE_ANALYZER_ID || "prebuilt-video",
    templateId: process.env.CONTENT_UNDERSTANDING_TEMPLATE_ID || "prebuilt-videoSegment",
    processingLocation: process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION || "geography",
    analyzerId,
    models: {
      completion: process.env.CONTENT_UNDERSTANDING_COMPLETION_MODEL || "gpt-4.1",
    },
    config: {
      locales: [],
      returnDetails: false,
      disableContentFiltering: true,
      disableFaceBlurring: false,
      enableSegment: false,
      omitContent: false,
    },
    fieldSchema: {
      fields: {
        summary: {
          type: "string",
          method: "generate",
          description: "Summary of the video contents",
        },
        tags: {
          type: "array",
          items: {
            type: "string",
            method: "generate",
          },
          method: "generate",
          description:
            "Return 3-8 lowercase tags for subway security/wellbeing/public-safety observations, focusing on incidents, risks, behaviors, platform safety, crowding, train operations, emergencies, and accessibility. Prefer tags from: platform-safety, crowding, altercation, pushing, fall-risk, trespassing, unattended-item, emergency-response, accessibility, suspicious-behavior, train-arrival, track-intrusion.",
        },
        numberOfPeople: {
          type: "integer",
          method: "generate",
          description: "Number of individuals identified in the video",
        },
        unsafeBehaviors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: {
                type: "string",
                method: "generate",
                description: "Description of the unsafe behavior",
              },
              timestamp: {
                type: "string",
                method: "generate",
                description: "Timestamp indicating start of the unsafe behavior",
              },
            },
            method: "generate",
          },
          method: "generate",
          description:
            "Examples include people lingering near tracks, unusual behavior, or situations that should be flagged for review",
        },
        objectData: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                method: "generate",
                description: "Name of the object",
              },
              description: {
                type: "string",
                method: "generate",
                description: "Description of the object",
              },
            },
            method: "generate",
          },
          method: "generate",
          description: "Interesting objects identified (dangerous, unusual, otherwise noteworthy items or personal effects).",
        },
        trainPassings: {
          type: "array",
          items: {
            type: "string",
            method: "generate",
          },
          method: "generate",
          description: "Timestamps when trains are observed passing by",
        },
        location: {
          type: "string",
          method: "generate",
          description: "Name of the location (best guess)",
        },
      },
      definitions: {},
    },
  };
}

async function ensureAnalyzerExists(
  endpoint: string,
  apiVersion: string,
  analyzerId: string,
  bearerToken: string,
): Promise<string> {
  const ensured =
    globalThis.__contentUnderstandingAnalyzersEnsured ||
    (globalThis.__contentUnderstandingAnalyzersEnsured = new Set<string>());

  if (ensured.has(analyzerId)) {
    return analyzerId;
  }

  const analyzerUrl = `${endpoint.replace(/\/$/, "")}/contentunderstanding/analyzers/${encodeURIComponent(analyzerId)}?api-version=${apiVersion}`;

  const expectedDefinition = getAnalyzerDefinition(analyzerId);

  const lookupResponse = await fetch(analyzerUrl, {
    method: "GET",
    headers: {
      Authorization: getBearerToken(bearerToken),
    },
  });

  if (lookupResponse.ok) {
    const existing = (await lookupResponse.json().catch(() => ({}))) as Record<string, unknown>;
    const existingFieldSchema =
      ((existing.fieldSchema as Record<string, unknown> | undefined)?.fields as Record<string, unknown> | undefined) || {};
    const expectedFieldSchema =
      ((expectedDefinition.fieldSchema as Record<string, unknown> | undefined)?.fields as Record<string, unknown> | undefined) || {};

    const requiredFieldNames = Object.keys(expectedFieldSchema);
    const missingRequiredField = requiredFieldNames.some((fieldName) => !(fieldName in existingFieldSchema));

    if (!missingRequiredField) {
      ensured.add(analyzerId);
      return analyzerId;
    }

    // Analyzer exists but is missing required fields from our schema; update in place.
    const updateResponse = await fetch(analyzerUrl, {
      method: "PUT",
      headers: {
        Authorization: getBearerToken(bearerToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(expectedDefinition),
    });

    if (!updateResponse.ok) {
      const updatePayload = await updateResponse.text().catch(() => "");

      if (updateResponse.status === 409 && updatePayload.includes("ModelExists")) {
        const fallbackAnalyzerId =
          process.env.CONTENT_UNDERSTANDING_SCHEMA_ANALYZER_ID || `${analyzerId}_schema_v2`;
        const fallbackUrl = `${endpoint.replace(/\/$/, "")}/contentunderstanding/analyzers/${encodeURIComponent(fallbackAnalyzerId)}?api-version=${apiVersion}`;
        const fallbackDefinition = getAnalyzerDefinition(fallbackAnalyzerId);
        const fallbackResponse = await fetch(fallbackUrl, {
          method: "PUT",
          headers: {
            Authorization: getBearerToken(bearerToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fallbackDefinition),
        });

        if (!fallbackResponse.ok) {
          const fallbackPayload = await fallbackResponse.text().catch(() => "");
          if (!(fallbackResponse.status === 409 && fallbackPayload.includes("ModelExists"))) {
            throw new Error(
              `Content Understanding fallback analyzer create failed (${fallbackAnalyzerId}) with ${fallbackResponse.status}${fallbackPayload ? `: ${fallbackPayload}` : "."}`,
            );
          }
        }

        ensured.add(fallbackAnalyzerId);
        return fallbackAnalyzerId;
      }

      throw new Error(
        `Content Understanding analyzer update failed (${analyzerId}) with ${updateResponse.status}${updatePayload ? `: ${updatePayload}` : "."}`,
      );
    }

    ensured.add(analyzerId);
    return analyzerId;
  }

  if (lookupResponse.status !== 404) {
    const lookupPayload = await lookupResponse.text().catch(() => "");
    throw new Error(
      `Content Understanding analyzer lookup failed (${analyzerId}) with ${lookupResponse.status}${lookupPayload ? `: ${lookupPayload}` : "."}`,
    );
  }

  const ensureResponse = await fetch(analyzerUrl, {
    method: "PUT",
    headers: {
      Authorization: getBearerToken(bearerToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(expectedDefinition),
  });

  if (!ensureResponse.ok) {
    const payload = await ensureResponse.text().catch(() => "");

    if (ensureResponse.status === 409 && payload.includes("ModelExists")) {
      ensured.add(analyzerId);
      return analyzerId;
    }

    throw new Error(
      `Content Understanding analyzer create-or-replace failed (${analyzerId}) with ${ensureResponse.status}${payload ? `: ${payload}` : "."}`,
    );
  }

  ensured.add(analyzerId);
  return analyzerId;
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

  if (!config.contentUnderstanding.endpoint || !playbackUrl) {
    return {
      summary: "Content Understanding endpoint not configured. Conversion completed without analysis.",
      keywords: ["conversion-only"],
    };
  }

  const credential = getTokenCredential();
  const token = await credential.getToken(config.contentUnderstanding.scope);
  const maxPollAttempts = getEnvNumber("CONTENT_UNDERSTANDING_MAX_POLLS", 40);
  const pollIntervalMs = getEnvNumber("CONTENT_UNDERSTANDING_POLL_INTERVAL_MS", 5000);
  const analyzerId = config.contentUnderstanding.analyzerId || "project-analyzer";

  if (!token?.token) {
    throw new Error("Unable to acquire an access token for Content Understanding.");
  }

  const resolvedAnalyzerId = await ensureAnalyzerExists(
    config.contentUnderstanding.endpoint,
    config.contentUnderstanding.apiVersion,
    analyzerId,
    token.token,
  );

  const analyzeResponse = await fetch(
    `${config.contentUnderstanding.endpoint.replace(/\/$/, "")}/contentunderstanding/analyzers/${encodeURIComponent(resolvedAnalyzerId)}:analyze?api-version=${config.contentUnderstanding.apiVersion}`,
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

  const analysisPayload = await analyzeProcessedVideo(record);
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
