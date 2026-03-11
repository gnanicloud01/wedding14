import { NextRequest, NextResponse } from "next/server";
import { SubscriptionService } from "@/lib/services/subscription";

/**
 * POST /api/user/sync — Sync Firebase user to D1 on login
 * Called from the client after Firebase authentication
 */
export async function POST(request: NextRequest) {
    try {
        const { userId, email, displayName, photoUrl } = await request.json();

        if (!userId || !email) {
            return NextResponse.json({ error: "userId and email are required" }, { status: 400 });
        }

        await SubscriptionService.syncUser(userId, email, displayName || '', photoUrl || '');

        // Fetch complete profile
        const user = await SubscriptionService.getUser(userId);
        const subscription = await SubscriptionService.getActiveSubscription(userId);

        return NextResponse.json({
            success: true,
            user,
            subscription,
            isSubscriber: !!subscription,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
