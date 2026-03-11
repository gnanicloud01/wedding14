import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";


export async function POST(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const body = await req.json();
        const {
            weddingId,
            title,
            description,
            r2Key,
            thumbnailKey,
            fileSize,
            fastStreamKey,
            fastStreamSize,
            lowStreamKey,
            lowStreamSize,
            chapters,
            userId,
            processingStatus,
            jobId,
            originalKey
        } = body as {
            weddingId: string;
            title: string;
            description: string;
            r2Key: string;
            thumbnailKey?: string;
            fileSize: number;
            fastStreamKey?: string;
            fastStreamSize?: number;
            lowStreamKey?: string;
            lowStreamSize?: number;
            chapters?: string;
            userId: string;
            processingStatus?: string;
            jobId?: string;
            originalKey?: string;
        };

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        const videoId = crypto.randomUUID();
        const finalProcessingStatus = processingStatus || 'completed';

        // Handle Job Creation for Mac mini Worker
        let activeJobId = jobId;
        if (finalProcessingStatus === 'pending') {
            activeJobId = crypto.randomUUID();
            // Prefix where HLS segments will live
            const outputPrefix = `weddings/${weddingId}/videos/${videoId}`;

            await db.prepare(
                "INSERT INTO encoding_jobs (id, video_id, status, input_key, output_prefix) VALUES (?, ?, ?, ?, ?)"
            )
                .bind(activeJobId, videoId, 'pending', originalKey || r2Key, outputPrefix)
                .run();
        }

        await db.prepare(
            "INSERT INTO videos (id, wedding_id, title, description, r2_key, thumbnail_key, file_size_bytes, fast_stream_key, fast_stream_size, low_stream_key, low_stream_size, chapters, processing_status, job_id, original_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
            .bind(videoId, weddingId, title, description, r2Key, thumbnailKey || null, fileSize, fastStreamKey || null, fastStreamSize || null, lowStreamKey || null, lowStreamSize || null, chapters || null, finalProcessingStatus, activeJobId || null, originalKey || null)
            .run();

        // Update storage used
        const totalSize = fileSize + (fastStreamSize || 0) + (lowStreamSize || 0);
        await SubscriptionService.updateStorageUsed(userId, totalSize);

        return NextResponse.json({ success: true, id: videoId, jobId: activeJobId });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const weddingId = req.nextUrl.searchParams.get("weddingId");
        const userId = req.nextUrl.searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ error: "userId required" }, { status: 401 });
        }

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        let stmt;

        if (weddingId) {
            // Filter by specific wedding (In production, also verify userId owns this weddingId)
            stmt = db.prepare(
                "SELECT v.*, w.name as wedding_name FROM videos v LEFT JOIN weddings w ON v.wedding_id = w.id WHERE v.wedding_id = ? ORDER BY v.created_at DESC"
            ).bind(weddingId);
        } else {
            // Multi-user "Studio Mode": Only return videos from weddings owned by this user
            stmt = db.prepare(
                `SELECT v.*, w.name as wedding_name 
                 FROM videos v 
                 JOIN weddings w ON v.wedding_id = w.id 
                 WHERE w.user_id = ? 
                 ORDER BY v.created_at DESC`
            ).bind(userId);
        }

        const result = await stmt.all();
        return NextResponse.json(result.results || []);
    } catch (error: any) {
        console.error("GET Videos Error:", error);
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}


export async function DELETE(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };

        if (!env || !env.DB) {
            return NextResponse.json({ error: "Cloudflare D1 binding (DB) is missing." }, { status: 500 });
        }

        const db = env.DB;
        const r2 = (env as any).R2;

        let body;
        try {
            body = await req.json();
        } catch (e) {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { id, userId } = body as { id: string; userId: string };
        if (!id) {
            return NextResponse.json({ error: "Missing video ID" }, { status: 400 });
        }

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        // ── 1. Fetch the video row BEFORE deleting (need keys for R2 cleanup) ──
        const video = await db
            .prepare("SELECT r2_key, fast_stream_key, low_stream_key, thumbnail_key, file_size_bytes, fast_stream_size, low_stream_size FROM videos WHERE id = ?")
            .bind(id).first() as {
                r2_key: string | null;
                fast_stream_key: string | null;
                low_stream_key: string | null;
                thumbnail_key: string | null;
                file_size_bytes: number;
                fast_stream_size: number | null;
                low_stream_size: number | null;
            } | null;

        // ── 2. Delete from DB first — always succeeds regardless of R2 ─────────
        await db.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();

        // ── 3. Update storage usage (Subtract)
        if (video) {
            const totalSize = (video.file_size_bytes || 0) + (video.fast_stream_size || 0) + (video.low_stream_size || 0);
            await SubscriptionService.updateStorageUsed(userId, -totalSize);
        }

        // ── 4. R2 cleanup — best effort, never blocks the response ────────────
        if (video && r2) {
            (async () => {
                try {
                    const keysToDelete: string[] = [];

                    // HLS folder prefix → list all segment keys
                    if (video.r2_key && !video.r2_key.endsWith('.mp4') && !video.r2_key.endsWith('.mov') && !video.r2_key.endsWith('.m3u8')) {
                        let cursor: string | undefined;
                        do {
                            const listed = await r2.list({ prefix: video.r2_key + '/', cursor, limit: 1000 });
                            for (const obj of (listed.objects || [])) keysToDelete.push(obj.key);
                            cursor = listed.truncated ? (listed as any).cursor : undefined;
                        } while (cursor);
                    } else if (video.r2_key) {
                        keysToDelete.push(video.r2_key);
                    }

                    // Individual stream / thumbnail keys
                    if (video.fast_stream_key) keysToDelete.push(video.fast_stream_key);
                    if (video.low_stream_key) keysToDelete.push(video.low_stream_key);
                    if (video.thumbnail_key) keysToDelete.push(video.thumbnail_key);

                    const unique = [...new Set(keysToDelete)].filter(k => !!k);
                    if (unique.length > 0) {
                        const CHUNK_SIZE = 20;
                        for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
                            const chunk = unique.slice(i, i + CHUNK_SIZE);
                            await Promise.all(chunk.map((key: string) => r2.delete(key)));
                        }
                    }
                    console.log(`🗑️ R2: deleted ${unique.length} objects for video ${id}`);
                } catch (r2Err) {
                    console.warn(`⚠️ R2 cleanup failed for video ${id} (DB already deleted):`, r2Err);
                }
            })();
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Delete error:", error);
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}


export async function PATCH(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const { id, title, description, chapters, r2Key, fastStreamKey, lowStreamKey, userId } = await req.json() as {
            id: string; title?: string; description?: string; chapters?: string;
            r2Key?: string; fastStreamKey?: string; lowStreamKey?: string; userId: string;
        };

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        const queryParts = [];
        const params = [];
        if (title) { queryParts.push("title = ?"); params.push(title); }
        if (description !== undefined) { queryParts.push("description = ?"); params.push(description); }
        if (chapters !== undefined) { queryParts.push("chapters = ?"); params.push(chapters); }
        if (r2Key !== undefined) { queryParts.push("r2_key = ?"); params.push(r2Key); }
        if (fastStreamKey !== undefined) { queryParts.push("fast_stream_key = ?"); params.push(fastStreamKey); }
        if (lowStreamKey !== undefined) { queryParts.push("low_stream_key = ?"); params.push(lowStreamKey); }

        if (queryParts.length > 0) {
            params.push(id);
            await db.prepare(`UPDATE videos SET ${queryParts.join(", ")} WHERE id = ?`)
                .bind(...params).run();
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

