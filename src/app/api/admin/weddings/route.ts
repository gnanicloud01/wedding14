import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";


export async function POST(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        if (!env || !env.DB) {
            throw new Error("Cloudflare D1 binding (DB) is missing. Are you running with wrangler pages dev?");
        }
        const db = env.DB;
        const { name, accessCode, userId } = await req.json() as { name: string; accessCode: string; userId: string };

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        const id = crypto.randomUUID();
        const adminPassword = Math.random().toString(36).slice(-8);

        await db.prepare(
            "INSERT INTO weddings (id, name, access_code, admin_password, user_id) VALUES (?, ?, ?, ?, ?)"
        )
            .bind(id, name, accessCode.toUpperCase(), adminPassword, userId)
            .run();

        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error("POST Wedding Error:", error);
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        if (!env || !env.DB) {
            throw new Error("Cloudflare D1 binding (DB) is missing. Are you running with wrangler pages dev?");
        }
        const db = env.DB;
        const userId = req.nextUrl.searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ error: "userId required" }, { status: 401 });
        }

        // ─── Gatekeeping ──! ───
        await SubscriptionService.checkEntitlement(userId);

        // Only return weddings belonging to this user
        const result = await db.prepare("SELECT * FROM weddings WHERE user_id = ? ORDER BY created_at DESC")
            .bind(userId).all();
        const weddings = (result.results || []) as any[];

        const weddingsWithCounts = await Promise.all(weddings.map(async (w: any) => {
            try {
                const count: any = await db.prepare("SELECT COUNT(*) as total FROM videos WHERE wedding_id = ?").bind(w.id).first();
                return { ...w, videoCount: count?.total || 0 };
            } catch (e) {
                return { ...w, videoCount: 0 };
            }
        }));

        return NextResponse.json(weddingsWithCounts);
    } catch (error: any) {
        console.error("GET Wedding Error:", error);
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}


export async function DELETE(req: NextRequest) {
    let debugId = "unknown";
    try {
        console.log("🗑️ Starting Wedding DELETE...");
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };

        if (!env || !env.DB) {
            console.error("❌ DELETE: DB binding missing");
            return NextResponse.json({ error: "D1 Database binding (DB) is missing." }, { status: 500 });
        }

        const db = env.DB;
        const r2 = env.R2;

        let body;
        try {
            body = await req.json();
            debugId = body?.id || "unknown";
        } catch (e) {
            console.error("❌ DELETE: JSON parse failed");
            return NextResponse.json({ error: "Request body is empty or not valid JSON." }, { status: 400 });
        }

        const { id, userId } = body as { id: string; userId: string };
        if (!id) {
            console.error("❌ DELETE: ID missing in body");
            return NextResponse.json({ error: "Missing 'id' in DELETE request body." }, { status: 400 });
        }

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        console.log(`🗑️ Deleting Wedding: ${id}`);

        // 1. Get name for slug cleanup
        const wedding = await db.prepare("SELECT name FROM weddings WHERE id = ?").bind(id).first() as { name: string } | null;

        // 2. Fetch all video keys for this wedding before we delete the DB record (Resilient fetch)
        let videos: any[] = [];
        try {
            const result = await db.prepare(
                "SELECT r2_key, fast_stream_key, low_stream_key, thumbnail_key FROM videos WHERE wedding_id = ?"
            ).bind(id).all();
            videos = (result.results || []) as any[];
        } catch (e: any) {
            console.warn(`⚠️ Schema mismatch or fetch error during delete: ${e.message}`);
            // Fallback: we will still perform prefix-based cleanup in R2
        }

        // 3. Delete from DB (Foreign Key cascade will handle 'videos' table metadata)
        await db.prepare("DELETE FROM weddings WHERE id = ?").bind(id).run();
        console.log(`✅ DB: Wedding ${id} deleted.`);

        // 4. Storage cleanup (Background Task)
        if (r2 && wedding) {
            const slugName = wedding.name
                .replace(/[&@#$%^*()+=\[\]{};:'"<>?,./\\|`~!]/g, "")
                .replace(/\s+/g, "-")
                .trim();

            const cleanupTask = (async () => {
                try {
                    console.log(`🧹 Background cleanup started for wedding ${id}`);
                    const keysToDelete = new Set<string>();

                    // --- Strategy A: Known Files ---
                    for (const v of videos) {
                        if (v.r2_key) {
                            if (!v.r2_key.endsWith('.mp4') && !v.r2_key.endsWith('.mov') && !v.r2_key.endsWith('.m3u8')) {
                                let cursor: string | undefined;
                                do {
                                    const listed = await r2.list({ prefix: v.r2_key + '/', cursor, limit: 1000 });
                                    (listed.objects || []).forEach((obj: any) => keysToDelete.add(obj.key));
                                    cursor = listed.truncated ? (listed as any).cursor : undefined;
                                } while (cursor);
                            } else {
                                keysToDelete.add(v.r2_key);
                                if (v.r2_key.endsWith('.m3u8')) {
                                    const hlsPrefix = v.r2_key.split('/').slice(0, -1).join('/') + '/';
                                    let hCursor: string | undefined;
                                    do {
                                        const hListed = await r2.list({ prefix: hlsPrefix, cursor: hCursor, limit: 1000 });
                                        (hListed.objects || []).forEach((obj: any) => keysToDelete.add(obj.key));
                                        hCursor = hListed.truncated ? (hListed as any).cursor : undefined;
                                    } while (hCursor);
                                }
                            }
                        }
                        if (v.fast_stream_key) keysToDelete.add(v.fast_stream_key);
                        if (v.low_stream_key) keysToDelete.add(v.low_stream_key);
                        if (v.thumbnail_key) keysToDelete.add(v.thumbnail_key);
                    }

                    // --- Strategy B: Prefix-based Deep Cleanup ---
                    const prefixes = [`weddings/${id}/`, `weddings/${slugName}/`].filter(p => !!p);
                    for (const pref of prefixes) {
                        let cursor: string | undefined;
                        do {
                            const listed = await r2.list({ prefix: pref, cursor, limit: 1000 });
                            (listed.objects || []).forEach((obj: any) => keysToDelete.add(obj.key));
                            cursor = listed.truncated ? (listed as any).cursor : undefined;
                        } while (cursor);
                    }

                    const finalizeKeys = Array.from(keysToDelete).filter(k => !!k);
                    console.log(`🗑️ Found ${finalizeKeys.length} objects to delete for ${id}`);

                    if (finalizeKeys.length > 0) {
                        const CHUNK = 50;
                        for (let i = 0; i < finalizeKeys.length; i += CHUNK) {
                            const batch = finalizeKeys.slice(i, i + CHUNK);
                            await Promise.all(batch.map(k => r2.delete(k)));
                        }
                        console.log(`✅ Background cleanup finished for ${id}`);
                    }
                } catch (e: any) {
                    console.warn(`R2 cleanup background error for ${id}:`, e.message);
                }
            })();

            // Tell Cloudflare to wait for this cleanup to finish
            const cf = await getCloudflareContext();
            const ctx = (cf as any).context;
            if (ctx && ctx.waitUntil) {
                ctx.waitUntil(cleanupTask);
            } else {
                console.warn("⚠️ context.waitUntil not available, cleanup may fail");
                // Local dev fallback
                cleanupTask;
            }
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error(`❌ DELETE 500 ERROR:`, error.message);
        return NextResponse.json({
            error: error.message || "Internal Server Error",
            id: debugId
        }, { status: 403 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const { id, name, accessCode, userId, isLive, liveStreamUrl } = await req.json() as {
            id: string;
            name?: string;
            accessCode?: string;
            userId: string;
            isLive?: boolean;
            liveStreamUrl?: string;
        };

        // ─── Gatekeeping ───
        await SubscriptionService.checkEntitlement(userId);

        if (name !== undefined) {
            await db.prepare("UPDATE weddings SET name = ? WHERE id = ?").bind(name, id).run();
        }
        if (accessCode !== undefined) {
            await db.prepare("UPDATE weddings SET access_code = ? WHERE id = ?").bind(accessCode.toUpperCase(), id).run();
        }
        if (isLive !== undefined) {
            await db.prepare("UPDATE weddings SET is_live = ? WHERE id = ?").bind(isLive ? 1 : 0, id).run();
        }
        if (liveStreamUrl !== undefined) {
            await db.prepare("UPDATE weddings SET live_stream_url = ? WHERE id = ?").bind(liveStreamUrl, id).run();
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

