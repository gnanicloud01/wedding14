import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * PRODUCTION PIPELINE WEBHOOK (Microservices Architecture)
 * This endpoint is called by your external "Oracle Server" once FFmpeg processing is complete.
 */
export async function POST(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;

        // 1. Verify Secret / Auth (In production, use a shared secret/API key)
        // 1. Verify Secret / Auth
        const authHeader = req.headers.get("Authorization");
        const secret = (env as any).INTERNAL_WEBHOOK_SECRET || 'dev-secret-123';

        if (authHeader !== `Bearer ${secret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const {
            videoId,
            status,             // 'completed' | 'failed'
            hlsPlaylistKey,     // The new master.m3u8 path
            fastStreamKey,      // 1080p path
            lowStreamKey,       // 720p path
            thumbnailKey,
            fileSize,           // Total size of HLS bundle
            errorMessage
        } = body;

        if (!videoId || !status) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        if (status === 'completed') {
            // Update video record with the new cinematic assets
            await db.prepare(`
                UPDATE videos 
                SET processing_status = 'completed',
                    r2_key = ?,
                    fast_stream_key = ?,
                    low_stream_key = ?,
                    thumbnail_key = ?,
                    file_size_bytes = ?,
                    updated_at = DATETIME('now')
                WHERE id = ?
            `).bind(
                hlsPlaylistKey,
                fastStreamKey || null,
                lowStreamKey || null,
                thumbnailKey || null,
                fileSize || 0,
                videoId
            ).run();

            console.log(`✅ Webhook: Video ${videoId} marked as COMPLETED by Oracle Server.`);
        } else {
            await db.prepare(`
                UPDATE videos 
                SET processing_status = 'failed',
                    description = description || ' (Processing failed: ' || ? || ')'
                WHERE id = ?
            `).bind(errorMessage || 'Unknown Error', videoId).run();

            console.error(`❌ Webhook: Video ${videoId} marked as FAILED by Oracle Server.`);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("🚨 Webhook Error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
