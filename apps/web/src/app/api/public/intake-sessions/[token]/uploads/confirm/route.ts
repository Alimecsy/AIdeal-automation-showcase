import { NextRequest, NextResponse } from "next/server";
import { backendApiFetch } from "@/lib/backend-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const response = await backendApiFetch(
    `/public/intake-sessions/${token}/uploads/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: await request.text(),
    },
  );
  const text = await response.text();

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}
