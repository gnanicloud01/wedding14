import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * LIVE STREAM WEBHOOK — Called by the Oracle VM streaming server
 * Notifies when a stream goes live or ends.
 * Updates the D1 database so the watch page can detect live status.
 */
export async function POST(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;

        // Verify internal secret
        const authHeader = req.headers.get("Authorization");
        const secret = (env as any).INTERNAL_WEBHOOK_SECRET || 'dev-secret-123';
        if (authHeader !== `Bearer ${secret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { eventId, status, hlsUrl, weddingId } = await req.json();

        if (!eventId || !status) {
            return NextResponse.json({ error: "Missing eventId or status" }, { status: 400 });
        }

        if (status === 'live') {
            // Stream just went live
            await db.prepare(`
                UPDATE live_events 
                SET status = 'live',
                    is_live = 1,
                    stream_url = ?,
                    started_at = DATETIME('now')
                WHERE id = ?
            `).bind(hlsUrl || '', eventId).run();

            // Also update the parent wedding's is_live flag for backward compat
            if (weddingId) {
                await db.prepare(
                    "UPDATE weddings SET is_live = 1, live_stream_url = ? WHERE id = ?"
                ).bind(hlsUrl || '', weddingId).run();
            }

            console.log(`🔴 LIVE: Event ${eventId} is now broadcasting`);

        } else if (status === 'ended') {
            // Stream ended
            await db.prepare(`
                UPDATE live_events 
                SET status = 'ended',
                    is_live = 0,
                    ended_at = DATETIME('now')
                WHERE id = ?
            `).bind(eventId).run();

            // Check if there are any other live events for this wedding
            if (weddingId) {
                const otherLive = await db.prepare(
                    "SELECT COUNT(*) as count FROM live_events WHERE wedding_id = ? AND is_live = 1"
                ).bind(weddingId).first() as any;

                // Only set wedding offline if no other events are live
                if (!otherLive || otherLive.count === 0) {
                    await db.prepare(
                        "UPDATE weddings SET is_live = 0 WHERE id = ?"
                    ).bind(weddingId).run();
                }
            }

            console.log(`⬛ ENDED: Event ${eventId} stream stopped`);
        }

        return NextResponse.json({ success: true, status });

    } catch (error: any) {
        console.error("Live Webhook Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
