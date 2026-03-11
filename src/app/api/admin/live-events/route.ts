import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";

/**
 * Generate a secure, unique stream key
 * Format: sk_XXXXXXXXXXXXXXXXXXXX (24 chars, URL-safe)
 */
function generateStreamKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'sk_';
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    for (let i = 0; i < 24; i++) {
        result += chars[array[i] % chars.length];
    }
    return result;
}

export async function POST(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const { weddingId, title, streamUrl, isLive, userId } = await req.json();

        await SubscriptionService.checkEntitlement(userId);

        const id = crypto.randomUUID();
        const streamKey = generateStreamKey();

        // Determine the RTMP URL for the streaming server
        const rtmpUrl = `rtmp://140.245.213.135:1935/live`;

        await db.prepare(
            `INSERT INTO live_events (id, wedding_id, title, stream_url, is_live, stream_key, rtmp_url, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
            .bind(
                id, weddingId, title,
                streamUrl || '',
                isLive ? 1 : 0,
                streamKey,
                rtmpUrl,
                'idle'
            )
            .run();

        return NextResponse.json({
            success: true,
            id,
            streamKey,
            rtmpUrl,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const { id, userId, title, streamUrl, isLive, status, regenerateKey } = await req.json();

        await SubscriptionService.checkEntitlement(userId);

        if (!id) {
            return NextResponse.json({ error: "Event ID required" }, { status: 400 });
        }

        // Update fields that were provided
        if (title !== undefined) {
            await db.prepare("UPDATE live_events SET title = ? WHERE id = ?").bind(title, id).run();
        }
        if (streamUrl !== undefined) {
            await db.prepare("UPDATE live_events SET stream_url = ? WHERE id = ?").bind(streamUrl, id).run();
        }
        if (isLive !== undefined) {
            await db.prepare("UPDATE live_events SET is_live = ? WHERE id = ?").bind(isLive ? 1 : 0, id).run();

            // Also update the status field
            if (isLive) {
                await db.prepare("UPDATE live_events SET status = 'waiting' WHERE id = ?").bind(id).run();
            }
        }
        if (status !== undefined) {
            await db.prepare("UPDATE live_events SET status = ? WHERE id = ?").bind(status, id).run();

            if (status === 'ended') {
                await db.prepare("UPDATE live_events SET is_live = 0, ended_at = DATETIME('now') WHERE id = ?").bind(id).run();
            }
        }

        // Regenerate stream key if requested
        let newStreamKey = null;
        if (regenerateKey) {
            newStreamKey = generateStreamKey();
            await db.prepare("UPDATE live_events SET stream_key = ? WHERE id = ?").bind(newStreamKey, id).run();
        }

        return NextResponse.json({ success: true, ...(newStreamKey ? { streamKey: newStreamKey } : {}) });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const { id, userId } = await req.json();

        await SubscriptionService.checkEntitlement(userId);

        await db.prepare("DELETE FROM live_events WHERE id = ?").bind(id).run();

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const weddingId = req.nextUrl.searchParams.get("weddingId");

        if (!weddingId) return NextResponse.json({ error: "weddingId required" }, { status: 400 });

        const { results } = await db.prepare(
            "SELECT * FROM live_events WHERE wedding_id = ? ORDER BY created_at ASC"
        ).bind(weddingId).all();

        return NextResponse.json(results);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
