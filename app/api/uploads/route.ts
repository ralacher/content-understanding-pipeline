import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth";
import { isAuthConfigured } from "@/lib/config";
import { uploadSourceFile } from "@/lib/storage";

export async function POST(request: Request) {
  const session = await getAppSession();

  if (isAuthConfigured() && !session) {
    return NextResponse.json({ error: "Sign in is required before uploading." }, { status: 401 });
  }

  const formData = await request.formData();
  const upload = formData.get("file");

  if (!(upload instanceof File)) {
    return NextResponse.json({ error: "Select an AVI file to upload." }, { status: 400 });
  }

  const isAvi = upload.name.toLowerCase().endsWith(".avi") || upload.type === "video/x-msvideo";

  if (!isAvi) {
    return NextResponse.json(
      { error: "Only AVI uploads are accepted for the conversion workflow." },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await upload.arrayBuffer());
  const record = await uploadSourceFile({
    fileName: upload.name,
    contentType: upload.type || "video/x-msvideo",
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
