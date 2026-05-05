import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Not Implemented", stage: "scaffolding" },
    { status: 501 },
  );
}
