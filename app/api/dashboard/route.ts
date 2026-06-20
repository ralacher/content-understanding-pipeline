import { NextResponse } from "next/server";
import { buildDashboardSnapshot } from "@/lib/storage";

export async function GET() {
  const payload = await buildDashboardSnapshot();
  return NextResponse.json(payload);
}
