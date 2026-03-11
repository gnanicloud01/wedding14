import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";


export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const key = url.searchParams.get("key");
        const contentType = url.searchParams.get("contentType") || "image/jpeg";
        const userId = url.searchParams.get("userId");

        if (!key) {
            return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
        }

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        const { env } = await getCloudflareContext() as { env: any };
        const bucket = env.R2;

        if (!bucket) {
            return NextResponse.json({ error: "R2 bucket binding not found" }, { status: 500 });
        }

        // Efficiently put to R2. We use arrayBuffer for small HLS chunks to avoid stream issues in some environments.
        console.log(`📤 Uploading to R2: ${key} (${contentType})`);

        let body;
        try {
            body = await req.arrayBuffer();
        } catch (e: any) {
            console.error(`❌ Body parse failed for ${key}:`, e.message);
            return NextResponse.json({ error: `Body read failed: ${e.message}` }, { status: 400 });
        }

        if (!body || body.byteLength === 0) {
            console.error(`❌ Empty body for ${key}`);
            return NextResponse.json({ error: "Empty request body" }, { status: 400 });
        }

        try {
            await bucket.put(key, body, {
                httpMetadata: { contentType }
            });
            console.log(`✅ Upload complete: ${key}`);
        } catch (e: any) {
            console.error(`❌ R2 Put failed for ${key}:`, e.message);
            throw e; // Rethrow to hit main catch
        }

        return NextResponse.json({ success: true, key });
    } catch (error: any) {
        console.error("🚨 UPLOAD FILE API CRASH:", error.message);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 403 });
    }
}

