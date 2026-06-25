import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth";
import { isAuthConfigured } from "@/lib/config";
import { uploadSourceFile } from "@/lib/storage";

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".wmv",
  ".mpeg",
  ".mpg",
  ".m4v",
  ".ogv",
  ".ogg",
  ".3gp",
]);

function getFileExtension(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  const dotIndex = lowerName.lastIndexOf(".");
  return dotIndex >= 0 ? lowerName.slice(dotIndex) : "";
}

export async function POST(request: Request) {
  const session = await getAppSession();

  if (isAuthConfigured() && !session) {
    return NextResponse.json({ error: "Sign in is required before uploading." }, { status: 401 });
  }

  const formData = await request.formData();
  const upload = formData.get("file");

  if (!(upload instanceof File)) {
    return NextResponse.json({ error: "Select a video file to upload." }, { status: 400 });
  }

  const extension = getFileExtension(upload.name);
  const isVideoMimeType = upload.type.startsWith("video/");
  const isSupported = SUPPORTED_VIDEO_EXTENSIONS.has(extension) || isVideoMimeType;

  if (!isSupported) {
    return NextResponse.json(
      {
        error:
          "Unsupported file format. Upload a common video file such as AVI, MP4, MOV, MKV, WEBM, OGV, or OGG.",
      },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await upload.arrayBuffer());
  const record = await uploadSourceFile({
    fileName: upload.name,
    contentType: upload.type || "application/octet-stream",
    bytes,
    uploadedBy: session?.user || {
      id: "anonymous-demo",
      name: "Demo reviewer",
      email: "demo.user@local.test",
    },
  });

  return NextResponse.json({
    id: record.id,
    message: "Upload accepted. The conversion and analysis pipeline will continue asynchronously.",
  });
}
