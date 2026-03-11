import { NextRequest, NextResponse } from "next/server";
import { SubscriptionService } from "@/lib/services/subscription";

/**
 * GET /api/subscription/check-upload?userId=xxx — Dedicated endpoint for upload gate
 */
export async function GET(request: NextRequest) {
    try {
        const userId = request.nextUrl.searchParams.get("userId");
        if (!userId) {
            return NextResponse.json({ allowed: false, reason: "Authentication required" }, { status: 401 });
        }

        const result = await SubscriptionService.canUploadVideo(userId);
        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
