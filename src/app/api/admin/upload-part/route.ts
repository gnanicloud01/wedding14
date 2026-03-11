import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const key = url.searchParams.get("key");
        const uploadId = url.searchParams.get("uploadId");
        const partNumber = parseInt(url.searchParams.get("partNumber") || "0");
        const userId = url.searchParams.get("userId");

        if (!key || !uploadId || !partNumber) {
            return NextResponse.json({ error: "Missing key, uploadId, or partNumber" }, { status: 400 });
        }

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        const { env } = await getCloudflareContext() as { env: any };
        const bucket = env.R2;

        if (!bucket) {
            return NextResponse.json({ error: "R2 bucket binding not found" }, { status: 500 });
        }

        // Resume the multipart upload and upload this part
        const multipart = bucket.resumeMultipartUpload(key, uploadId);

        // Read the chunk into an ArrayBuffer (5MB chunks are safe for 128MB worker memory)
        const body = await req.arrayBuffer();
        const uploadedPart = await multipart.uploadPart(partNumber, body);

        return NextResponse.json({
            etag: uploadedPart.etag,
            partNumber: uploadedPart.partNumber,
        });
    } catch (error: any) {
        console.error("🚨 UPLOAD PART ERROR:", error?.message, error?.stack);
        return NextResponse.json(
            { error: error.message || "Upload part failed" },
            { status: 403 }
        );
    }
}

