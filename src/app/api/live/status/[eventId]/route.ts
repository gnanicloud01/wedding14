import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * PUBLIC LIVE STATUS — Polled by the watch page to detect live stream changes
 * No auth required (public guest endpoint).
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ eventId: string }> }
) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const { eventId } = await params;

        const event = await db.prepare(
            "SELECT id, title, stream_url, is_live, status, started_at FROM live_events WHERE id = ?"
        ).bind(eventId).first() as any;

        if (!event) {
            return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }

        return NextResponse.json({
            id: event.id,
            title: event.title,
            streamUrl: event.stream_url,
            isLive: !!event.is_live,
            status: event.status,
            startedAt: event.started_at,
        }, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            }
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
