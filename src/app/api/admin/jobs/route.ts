import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * GET /api/admin/jobs
 * Poll for pending encoding jobs (used by Mac mini worker)
 */
export async function GET(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;

        // Find one pending job
        const job = await db.prepare(
            "SELECT * FROM encoding_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
        ).first();

        if (!job) {
            return NextResponse.json({ job: null });
        }

        // Mark it as processing immediately so other workers don't grab it
        await db.prepare(
            "UPDATE encoding_jobs SET status = 'processing', updated_at = DATETIME('now') WHERE id = ?"
        ).bind(job.id).run();

        return NextResponse.json({ job });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * PATCH /api/admin/jobs
 * Update job status and final video metadata (used by Mac mini worker)
 */
export async function PATCH(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const body = await req.json();

        const {
            jobId,
            status,
            error,
            masterPlaylistKey,
            fastStreamKey,
            lowStreamKey,
            fastStreamSize,
            lowStreamSize
        } = body;

        if (!jobId || !status) {
            return NextResponse.json({ error: "Missing jobId or status" }, { status: 400 });
        }

        // 1. Update the Job record
        await db.prepare(
            "UPDATE encoding_jobs SET status = ?, error = ?, updated_at = DATETIME('now') WHERE id = ?"
        ).bind(status, error || null, jobId).run();

        // 2. If completed, update the Video record with the new HLS keys
        if (status === 'completed') {
            const job = await db.prepare("SELECT video_id FROM encoding_jobs WHERE id = ?").bind(jobId).first() as { video_id: string };

            if (job) {
                await db.prepare(
                    `UPDATE videos SET 
                        r2_key = ?, 
                        fast_stream_key = ?, 
                        low_stream_key = ?, 
                        fast_stream_size = ?,
                        low_stream_size = ?,
                        processing_status = 'completed' 
                     WHERE id = ?`
                ).bind(
                    masterPlaylistKey,
                    fastStreamKey || null,
                    lowStreamKey || null,
                    fastStreamSize || null,
                    lowStreamSize || null,
                    job.video_id
                ).run();
            }
        } else if (status === 'failed') {
            const job = await db.prepare("SELECT video_id FROM encoding_jobs WHERE id = ?").bind(jobId).first() as { video_id: string };
            if (job) {
                await db.prepare("UPDATE videos SET processing_status = 'failed' WHERE id = ?")
                    .bind(job.video_id).run();
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
