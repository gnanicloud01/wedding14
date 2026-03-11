import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";

/**
 * POST /api/payment — Create order or verify payment
 * 
 * Actions:
 *   create-order: Creates a Razorpay order for a plan
 *   verify: Verifies payment and activates subscription
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action } = body;

        if (action === "create-order") {
            return await handleCreateOrder(body);
        }

        if (action === "verify") {
            return await handleVerifyPayment(body);
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error: any) {
        console.error("Payment API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function handleCreateOrder(body: any) {
    const { userId, planId } = body;

    if (!userId || !planId) {
        return NextResponse.json({ error: "userId and planId are required" }, { status: 400 });
    }

    // Get plan details
    const plan = await SubscriptionService.getPlanById(planId);
    if (!plan) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const amount = plan.price; // already in paisa
    const receipt = `rcpt_${Date.now()}_${userId.slice(0, 8)}`;

    // Get Razorpay credentials from environment
    const { env } = await getCloudflareContext() as { env: CloudflareEnv };
    const keyId = (env as any).RAZORPAY_KEY_ID;
    const keySecret = (env as any).RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        return NextResponse.json({ error: "Payment gateway not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your environment." }, { status: 500 });
    }

    // Create Razorpay Order via REST API (Cloudflare Workers compatible)
    const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Basic " + btoa(`${keyId}:${keySecret}`),
        },
        body: JSON.stringify({
            amount,
            currency: "INR",
            receipt,
            notes: {
                user_id: userId,
                plan_id: planId,
                plan_name: plan.name,
                duration_months: plan.duration_months,
            },
        }),
    });

    if (!orderResponse.ok) {
        const err = await orderResponse.json();
        console.error("Razorpay order creation failed:", err);
        return NextResponse.json({ error: err.error?.description || "Failed to create payment order" }, { status: 500 });
    }

    const order = await orderResponse.json();

    // Record payment as 'created'
    await SubscriptionService.recordPayment({
        userId,
        amount,
        status: "created",
        razorpayOrderId: order.id,
        receipt,
    });

    return NextResponse.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId, // Public key for frontend checkout
        plan: {
            id: plan.id,
            name: plan.name,
            description: plan.description,
            duration_months: plan.duration_months,
        },
    });
}

async function handleVerifyPayment(body: any) {
    const { userId, planId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;

    if (!userId || !planId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return NextResponse.json({ error: "Missing required payment verification fields" }, { status: 400 });
    }

    // Get Razorpay secret for HMAC verification
    const { env } = await getCloudflareContext() as { env: CloudflareEnv };
    const keySecret = (env as any).RAZORPAY_KEY_SECRET;

    if (!keySecret) {
        return NextResponse.json({ error: "Payment gateway not configured" }, { status: 500 });
    }

    // ─── HMAC SHA-256 Signature Verification (Production Security) ────
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        encoder.encode(keySecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const data = encoder.encode(`${razorpayOrderId}|${razorpayPaymentId}`);
    const signature = await globalThis.crypto.subtle.sign("HMAC", key, data);
    const expectedSignature = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

    if (expectedSignature !== razorpaySignature) {
        await SubscriptionService.recordPayment({
            userId,
            amount: 0,
            status: "failed",
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
        });
        return NextResponse.json({ error: "Payment verification failed. Signature mismatch." }, { status: 400 });
    }

    // ─── Payment Verified! Activate Subscription ──────────────────
    const plan = await SubscriptionService.getPlanById(planId);

    const subscriptionId = await SubscriptionService.createSubscription(userId, planId);

    // Record successful payment
    await SubscriptionService.recordPayment({
        userId,
        subscriptionId,
        amount: plan?.price || 0,
        status: "captured",
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
    });

    return NextResponse.json({
        success: true,
        message: "Payment verified. Subscription activated!",
        subscriptionId,
    });
}
