import { MediaRecord } from "./domain";

const now = Date.now();

export const demoRecords: MediaRecord[] = [
  {
    id: "asset-demo-1",
    type: "mediaRecord",
    fileName: "warehouse-line-audit.avi",
    sourceBlobName: "incoming-avi/2026/06/warehouse-line-audit.avi",
    processedBlobName: "processed-mp4/2026/06/warehouse-line-audit.mp4",
    status: "completed",
    summary:
      "Operators completed the line audit, recorded two safety observations, and verified packaging accuracy.",
    createdAt: new Date(now - 1000 * 60 * 34).toISOString(),
    updatedAt: new Date(now - 1000 * 60 * 12).toISOString(),
    uploadedBy: {
      id: "demo-user",
      name: "Avery Harper",
      email: "avery.harper@contoso.com",
    },
    confidence: 0.94,
    durationSeconds: 548,
    language: "English",
    tags: ["safety", "operations", "packaging"],
    analysisSections: [
      {
        title: "Executive summary",
        summary: "The recording documents a complete warehouse line audit with no critical escalation.",
        bullets: [
          "Line stop was under 2 minutes.",
          "One missing glove was corrected on camera.",
          "Final pallet labels matched the work order.",
        ],
      },
      {
        title: "Key observations",
        summary: "The strongest themes were PPE compliance, package quality, and line readiness.",
        bullets: [
          "The team discussed PPE twice.",
          "No damaged cartons were observed.",
          "Machine status lights remained green after restart.",
        ],
      },
    ],
    timeline: [
      { status: "uploaded", at: new Date(now - 1000 * 60 * 34).toISOString() },
      { status: "converting", at: new Date(now - 1000 * 60 * 30).toISOString() },
      { status: "converted", at: new Date(now - 1000 * 60 * 24).toISOString() },
      { status: "analyzing", at: new Date(now - 1000 * 60 * 22).toISOString() },
      { status: "completed", at: new Date(now - 1000 * 60 * 12).toISOString() },
    ],
  },
  {
    id: "asset-demo-2",
    type: "mediaRecord",
    fileName: "call-center-coaching.avi",
    sourceBlobName: "incoming-avi/2026/06/call-center-coaching.avi",
    processedBlobName: "processed-mp4/2026/06/call-center-coaching.mp4",
    status: "analyzing",
    summary: "Conversion finished and the MP4 is currently in content understanding analysis.",
    createdAt: new Date(now - 1000 * 60 * 15).toISOString(),
    updatedAt: new Date(now - 1000 * 60 * 4).toISOString(),
    uploadedBy: {
      id: "demo-user-2",
      name: "Jordan Lee",
      email: "jordan.lee@contoso.com",
    },
    confidence: 0.81,
    durationSeconds: 901,
    language: "English",
    tags: ["coaching", "quality"],
    analysisSections: [
      {
        title: "Current status",
        summary: "The video is being analyzed and detailed findings will appear after completion.",
        bullets: ["Upload succeeded.", "AVI to MP4 conversion succeeded."],
      },
    ],
    timeline: [
      { status: "uploaded", at: new Date(now - 1000 * 60 * 15).toISOString() },
      { status: "converting", at: new Date(now - 1000 * 60 * 12).toISOString() },
      { status: "converted", at: new Date(now - 1000 * 60 * 7).toISOString() },
      { status: "analyzing", at: new Date(now - 1000 * 60 * 4).toISOString() },
    ],
  },
  {
    id: "asset-demo-3",
    type: "mediaRecord",
    fileName: "quality-check-overnight.avi",
    sourceBlobName: "incoming-avi/2026/06/quality-check-overnight.avi",
    status: "failed",
    summary: "The conversion container could not decode the uploaded AVI stream.",
    createdAt: new Date(now - 1000 * 60 * 55).toISOString(),
    updatedAt: new Date(now - 1000 * 60 * 50).toISOString(),
    uploadedBy: {
      id: "demo-user-3",
      name: "Morgan Tate",
      email: "morgan.tate@contoso.com",
    },
    tags: ["conversion", "review-required"],
    errorMessage: "ffmpeg exited with code 1 while probing the input stream.",
    analysisSections: [
      {
        title: "Failure summary",
        summary: "The file was uploaded successfully but could not be transcoded.",
        bullets: ["Verify the AVI container is valid.", "Retry after re-exporting the source file."],
      },
    ],
    timeline: [
      { status: "uploaded", at: new Date(now - 1000 * 60 * 55).toISOString() },
      { status: "converting", at: new Date(now - 1000 * 60 * 52).toISOString() },
      {
        status: "failed",
        at: new Date(now - 1000 * 60 * 50).toISOString(),
        note: "ffmpeg exited with code 1 while probing the input stream.",
      },
    ],
  },
  {
    id: "asset-demo-4",
    type: "mediaRecord",
    fileName: "branch-demo-reel.avi",
    sourceBlobName: "incoming-avi/2026/06/branch-demo-reel.avi",
    status: "uploaded",
    summary: "Awaiting conversion after the upload validation completed.",
    createdAt: new Date(now - 1000 * 60 * 6).toISOString(),
    updatedAt: new Date(now - 1000 * 60 * 6).toISOString(),
    uploadedBy: {
      id: "demo-user-4",
      name: "Riley Chen",
      email: "riley.chen@contoso.com",
    },
    tags: ["queued"],
    analysisSections: [
      {
        title: "Pending work",
        summary: "The source AVI is stored and waiting for the conversion worker.",
        bullets: ["Blob write confirmed.", "Queue trigger pending."],
      },
    ],
    timeline: [{ status: "uploaded", at: new Date(now - 1000 * 60 * 6).toISOString() }],
  },
];
