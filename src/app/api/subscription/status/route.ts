import { NextRequest, NextResponse } from "next/server";
import { SubscriptionService } from "@/lib/services/subscription";

/**
 * GET  /api/subscription/status?userId=xxx — Get user subscription + upload status
 * POST /api/subscription/status — Cancel subscription
 */
export async function GET(request: NextRequest) {
    try {
        const userId = request.nextUrl.searchParams.get("userId");
        if (!userId) {
            return NextResponse.json({ error: "userId is required" }, { status: 400 });
        }

        const user = await SubscriptionService.getUser(userId);
        const subscription = await SubscriptionService.getActiveSubscription(userId);
        const canUpload = await SubscriptionService.canUploadVideo(userId);

        return NextResponse.json({
            user,
            subscription,
            canUpload: canUpload.allowed,
            uploadBlockReason: canUpload.reason || null,
        });
    } catch (error: any) {
        console.error("Subscription status error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action, userId } = body;

        if (action === 'cancel') {
            if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
            await SubscriptionService.cancelSubscription(userId);
            return NextResponse.json({ success: true, message: "Subscription cancelled" });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error: any) {
        console.error("Subscription action error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
