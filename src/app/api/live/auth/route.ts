import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * LIVE STREAM AUTH — Called by the Oracle VM streaming server
 * Validates stream keys when OBS connects via RTMP.
 * 
 * Returns the event details if the key is valid, so the streaming server
 * knows which R2 prefix to use for HLS segments.
 */
export async function POST(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;

        // Verify internal secret
        const authHeader = req.headers.get("Authorization");
        const secret = (env as any).INTERNAL_WEBHOOK_SECRET || 'dev-secret-123';
        if (authHeader !== `Bearer ${secret}`) {
            return NextResponse.json({ valid: false, error: "Unauthorized" }, { status: 401 });
        }

        const { streamKey } = await req.json();
        if (!streamKey) {
            return NextResponse.json({ valid: false, error: "Missing streamKey" }, { status: 400 });
        }

        // Look up the live event by stream key
        const event = await db.prepare(
            "SELECT le.id, le.title, le.wedding_id, le.status FROM live_events le WHERE le.stream_key = ?"
        ).bind(streamKey).first() as any;

        if (!event) {
            return NextResponse.json({ valid: false, error: "Invalid stream key" }, { status: 404 });
        }

        // Check that the event is not already ended
        if (event.status === 'ended') {
            return NextResponse.json({ valid: false, error: "Event has ended" }, { status: 403 });
        }

        return NextResponse.json({
            valid: true,
            eventId: event.id,
            title: event.title,
            weddingId: event.wedding_id,
        });

    } catch (error: any) {
        console.error("Live Auth Error:", error);
        return NextResponse.json({ valid: false, error: error.message }, { status: 500 });
    }
}
