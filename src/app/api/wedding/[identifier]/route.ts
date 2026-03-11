import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { MetadataService, StorageService } from "@/lib/services/internal";
import { generatePresignedUrl } from "@/lib/r2-presign";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ identifier: string }> }
) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const { identifier } = await params;
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        // 1. Get Wedding Info: Try ID first, then Code
        let wedding: any = await MetadataService.getWeddingById(identifier);
        if (!wedding) {
            wedding = await MetadataService.getWeddingByCode(identifier);
        }

        if (!wedding) {
            return NextResponse.json({ error: "Wedding not found" }, { status: 404 });
        }

        // 2. Security Check: Privacy is Mandatory
        // Access is granted if the user has unlocked the wedding (entry exists in user_access)
        if (!userId) {
            return NextResponse.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
        }

        const db = env.DB;
        const hasAccess = await db
            .prepare("SELECT 1 FROM user_access WHERE user_id = ? AND wedding_id = ?")
            .bind(userId, wedding.id)
            .first();

        // If no record in user_access, it's locked
        if (!hasAccess) {
            return NextResponse.json({
                error: "Access Locked",
                code: "ACCESS_LOCKED",
                weddingName: wedding.name
            }, { status: 403 });
        }

        // 3. Get Associated Content: Videos, Live Events, and Photos
        const [videos, liveEvents, photos] = await Promise.all([
            MetadataService.getVideosByWeddingId(wedding.id),
            MetadataService.getLiveEventsByWeddingId(wedding.id),
            MetadataService.getPhotosByWeddingId(wedding.id)
        ]);

        // Hide sensitive access code
        const safeWedding = { ...wedding };
        delete safeWedding.access_code;

        // 4. Process URLs via Storage Service logic
        const videosWithUrls = await Promise.all(videos.map(async (v: any) => {
            let streamUrl = StorageService.getPublicUrl(v.r2_key, env);
            let fastStreamUrl = v.fast_stream_key ? StorageService.getPublicUrl(v.fast_stream_key, env) : null;
            let lowStreamUrl = v.low_stream_key ? StorageService.getPublicUrl(v.low_stream_key, env) : null;

            // Handle Private Signing if no Public CDN is available
            if (!env.R2_PUBLIC_DOMAIN && !(v.r2_key?.endsWith('.m3u8'))) {
                const acctId = env.CF_ACCOUNT_ID;
                const keyId = env.R2_ACCESS_KEY_ID;
                const secret = env.R2_SECRET_ACCESS_KEY;

                if (acctId && keyId && secret) {
                    try {
                        streamUrl = await generatePresignedUrl(acctId, keyId, secret, "wedding", v.r2_key, "GET", 86400);
                        if (v.fast_stream_key) fastStreamUrl = await generatePresignedUrl(acctId, keyId, secret, "wedding", v.fast_stream_key, "GET", 86400);
                        if (v.low_stream_key) lowStreamUrl = await generatePresignedUrl(acctId, keyId, secret, "wedding", v.low_stream_key, "GET", 86400);
                    } catch (e) {
                        console.error("Microservice signing error:", e);
                    }
                }
            }

            return {
                ...v,
                stream_url: streamUrl,
                fast_stream_url: fastStreamUrl,
                low_stream_url: lowStreamUrl
            };
        }));

        // 5. Process Photo URLs
        const photosWithUrls = photos.map((p: any) => ({
            ...p,
            url: StorageService.getPublicUrl(p.r2_key, env),
            thumbnail_url: p.thumbnail_key ? StorageService.getPublicUrl(p.thumbnail_key, env) : null
        }));

        return NextResponse.json({
            ...safeWedding,
            videos: videosWithUrls,
            live_events: liveEvents,
            photos: photosWithUrls
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
