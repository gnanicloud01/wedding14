import { NextRequest, NextResponse } from "next/server";
import { SubscriptionService } from "@/lib/services/subscription";

/**
 * GET /api/subscription/plans — List all active subscription plans
 */
export async function GET() {
    try {
        const plans = await SubscriptionService.getActivePlans();
        return NextResponse.json({ plans });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
