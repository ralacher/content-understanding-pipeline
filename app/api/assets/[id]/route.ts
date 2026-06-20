import { NextResponse } from "next/server";
import { buildPlaybackUrl, getMediaRecord } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getMediaRecord(id);

  if (!record) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  const playbackUrl = await buildPlaybackUrl(record);
  return NextResponse.json({ ...record, playbackUrl });
}
