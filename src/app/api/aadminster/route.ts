import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Master Admin API — /api/aadminster
 * 
 * Security: Every request must include x-admin-token header matching ADMIN_PASSWORD.
 * 
 * POST   — Authenticate (verify password, return token)
 * GET    — Fetch data (action param: stats, users, subscriptions, payments, weddings, content)
 * PATCH  — Update (user roles, subscription status)
 * DELETE — Remove (users, weddings, videos, photos)
 */

async function verifyAdmin(request: NextRequest): Promise<{ valid: boolean; env: CloudflareEnv }> {
    const { env } = await getCloudflareContext() as { env: CloudflareEnv };
    const token = request.headers.get("x-admin-token");
    const adminPwd = (env as any).ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
    if (!token || token !== adminPwd) return { valid: false, env };
    return { valid: true, env };
}

function unauthorized() {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ─── POST: Authenticate ──────────────────────────────────────────
export async function POST(request: NextRequest) {
    try {
        const { password } = await request.json();
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const adminPwd = (env as any).ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

        if (!password || password !== adminPwd) {
            return NextResponse.json({ error: "Invalid password" }, { status: 401 });
        }

        return NextResponse.json({ success: true, token: adminPwd });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ─── GET: Fetch Platform Data ────────────────────────────────────
export async function GET(request: NextRequest) {
    const { valid, env } = await verifyAdmin(request);
    if (!valid) return unauthorized();

    const action = request.nextUrl.searchParams.get("action");

    try {
        switch (action) {
            case "stats": {
                const [users, subscribers, weddings, videos, photos, liveEvents, revenue, storage] = await Promise.all([
                    env.DB.prepare("SELECT COUNT(*) as count FROM users").first() as Promise<{ count: number }>,
                    env.DB.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active' AND current_period_end > datetime('now')").first() as Promise<{ count: number }>,
                    env.DB.prepare("SELECT COUNT(*) as count FROM weddings").first() as Promise<{ count: number }>,
                    env.DB.prepare("SELECT COUNT(*) as count FROM videos").first() as Promise<{ count: number }>,
                    env.DB.prepare("SELECT COUNT(*) as count FROM photos").first() as Promise<{ count: number }>,
                    env.DB.prepare("SELECT COUNT(*) as count FROM live_events").first() as Promise<{ count: number }>,
                    env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE status = 'captured'").first() as Promise<{ total: number }>,
                    env.DB.prepare("SELECT COALESCE(SUM(storage_used_bytes),0) as total FROM users").first() as Promise<{ total: number }>,
                ]);
                return NextResponse.json({
                    totalUsers: users?.count || 0,
                    activeSubscribers: subscribers?.count || 0,
                    totalWeddings: weddings?.count || 0,
                    totalVideos: videos?.count || 0,
                    totalPhotos: photos?.count || 0,
                    totalLiveEvents: liveEvents?.count || 0,
                    totalRevenue: revenue?.total || 0,
                    totalStorage: storage?.total || 0,
                });
            }

            case "users": {
                const { results } = await env.DB.prepare(`
                    SELECT u.*,
                        s.status as sub_status, s.current_period_end as sub_end,
                        sp.name as plan_name
                    FROM users u
                    LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
                    LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
                    ORDER BY u.created_at DESC
                `).all();
                return NextResponse.json(results);
            }

            case "subscriptions": {
                const { results } = await env.DB.prepare(`
                    SELECT s.*, u.email, u.display_name, sp.name as plan_name, sp.price, sp.duration_months
                    FROM subscriptions s
                    JOIN users u ON s.user_id = u.id
                    JOIN subscription_plans sp ON s.plan_id = sp.id
                    ORDER BY s.created_at DESC
                `).all();
                return NextResponse.json(results);
            }

            case "payments": {
                const { results } = await env.DB.prepare(`
                    SELECT p.*, u.email, u.display_name
                    FROM payments p
                    JOIN users u ON p.user_id = u.id
                    ORDER BY p.created_at DESC
                    LIMIT 200
                `).all();
                return NextResponse.json(results);
            }

            case "weddings": {
                const { results } = await env.DB.prepare(`
                    SELECT w.*,
                        u.email as owner_email, u.display_name as owner_name,
                        (SELECT COUNT(*) FROM videos WHERE wedding_id = w.id) as video_count,
                        (SELECT COUNT(*) FROM photos WHERE wedding_id = w.id) as photo_count,
                        (SELECT COUNT(*) FROM live_events WHERE wedding_id = w.id) as live_count
                    FROM weddings w
                    LEFT JOIN users u ON w.user_id = u.id
                    ORDER BY w.created_at DESC
                `).all();
                return NextResponse.json(results);
            }

            case "content": {
                const [videoRes, photoRes] = await Promise.all([
                    env.DB.prepare(`
                        SELECT v.*, w.name as wedding_name, u.email as owner_email
                        FROM videos v
                        JOIN weddings w ON v.wedding_id = w.id
                        LEFT JOIN users u ON w.user_id = u.id
                        ORDER BY v.created_at DESC
                    `).all(),
                    env.DB.prepare(`
                        SELECT p.*, w.name as wedding_name
                        FROM photos p
                        JOIN weddings w ON p.wedding_id = w.id
                        ORDER BY p.created_at DESC
                    `).all(),
                ]);
                return NextResponse.json({ videos: videoRes.results, photos: photoRes.results });
            }

            case "settings": {
                const { results } = await env.DB.prepare("SELECT * FROM site_settings").all();
                const settings: Record<string, string> = {};
                results.forEach((r: any) => {
                    settings[r.key] = r.value;
                });
                return NextResponse.json(settings);
            }

            case "queue": {
                const { results } = await env.DB.prepare(`
                    SELECT j.*, v.title as video_title, w.name as wedding_name
                    FROM encoding_jobs j
                    JOIN videos v ON j.video_id = v.id
                    JOIN weddings w ON v.wedding_id = w.id
                    ORDER BY j.created_at DESC
                    LIMIT 100
                `).all();
                return NextResponse.json(results);
            }

            case "analytics_extended": {
                const [growth, revenueDaily, storageBreakdown] = await Promise.all([
                    // Monthly Growth (last 6 months)
                    env.DB.prepare(`
                        SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
                        FROM users
                        GROUP BY month
                        ORDER BY month DESC
                        LIMIT 6
                    `).all(),
                    // Revenue (last 30 days)
                    env.DB.prepare(`
                        SELECT strftime('%Y-%m-%d', created_at) as date, SUM(amount) as total
                        FROM payments
                        WHERE status = 'captured'
                        GROUP BY date
                        ORDER BY date DESC
                        LIMIT 30
                    `).all(),
                    // Storage Breakdown
                    env.DB.prepare(`
                        SELECT 
                            (SELECT COALESCE(SUM(file_size_bytes),0) FROM videos) as video_bytes,
                            (SELECT COUNT(*) * 1024 * 1024 FROM photos) as photo_bytes -- Estimated 1MB per photo for breakdown
                    `).first(),
                ]);
                return NextResponse.json({
                    growth: growth.results,
                    revenueDaily: revenueDaily.results,
                    storageBreakdown
                });
            }

            default:
                return NextResponse.json({ error: "Unknown action" }, { status: 400 });
        }
    } catch (error: any) {
        console.error("Admin API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ─── PATCH: Update Records ───────────────────────────────────────
export async function PATCH(request: NextRequest) {
    const { valid, env } = await verifyAdmin(request);
    if (!valid) return unauthorized();

    try {
        const body = await request.json();
        const { entity, id, ...updates } = body;

        switch (entity) {
            case "user": {
                if (updates.role) {
                    await env.DB.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?")
                        .bind(updates.role, id).run();
                }
                return NextResponse.json({ success: true });
            }

            case "subscription": {
                if (updates.status === "cancelled") {
                    await env.DB.prepare("UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
                        .bind(id).run();
                }
                if (updates.extend_months) {
                    await env.DB.prepare(`
                        UPDATE subscriptions 
                        SET current_period_end = datetime(current_period_end, '+' || ? || ' months'), updated_at = datetime('now')
                        WHERE id = ?
                    `).bind(updates.extend_months, id).run();
                }
                return NextResponse.json({ success: true });
            }

            case "settings": {
                const settingEntries = Object.entries(updates);
                for (const [key, value] of settingEntries) {
                    await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
                        .bind(key, String(value)).run();
                }
                return NextResponse.json({ success: true });
            }

            case "queue": {
                if (updates.action === "retry") {
                    await env.DB.prepare("UPDATE encoding_jobs SET status = 'pending', error = NULL, updated_at = datetime('now') WHERE id = ?")
                        .bind(id).run();
                } else if (updates.action === "abort") {
                    await env.DB.prepare("UPDATE encoding_jobs SET status = 'failed', error = 'Aborted by admin', updated_at = datetime('now') WHERE id = ?")
                        .bind(id).run();
                }
                return NextResponse.json({ success: true });
            }

            default:
                return NextResponse.json({ error: "Unknown entity" }, { status: 400 });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ─── DELETE: Remove Records ──────────────────────────────────────
export async function DELETE(request: NextRequest) {
    const { valid, env } = await verifyAdmin(request);
    if (!valid) return unauthorized();

    try {
        const body = await request.json();
        const { entity, id } = body;

        switch (entity) {
            case "user": {
                // Delete user's weddings (cascade deletes videos, photos, live_events)
                const { results: userWeddings } = await env.DB.prepare("SELECT id FROM weddings WHERE user_id = ?").bind(id).all();
                for (const w of userWeddings) {
                    await env.DB.prepare("DELETE FROM videos WHERE wedding_id = ?").bind((w as any).id).run();
                    await env.DB.prepare("DELETE FROM photos WHERE wedding_id = ?").bind((w as any).id).run();
                    await env.DB.prepare("DELETE FROM live_events WHERE wedding_id = ?").bind((w as any).id).run();
                    await env.DB.prepare("DELETE FROM weddings WHERE id = ?").bind((w as any).id).run();
                }
                await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ?").bind(id).run();
                await env.DB.prepare("DELETE FROM payments WHERE user_id = ?").bind(id).run();
                await env.DB.prepare("DELETE FROM user_access WHERE user_id = ?").bind(id).run();
                await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
                return NextResponse.json({ success: true });
            }

            case "wedding": {
                await env.DB.prepare("DELETE FROM videos WHERE wedding_id = ?").bind(id).run();
                await env.DB.prepare("DELETE FROM photos WHERE wedding_id = ?").bind(id).run();
                await env.DB.prepare("DELETE FROM live_events WHERE wedding_id = ?").bind(id).run();
                await env.DB.prepare("DELETE FROM weddings WHERE id = ?").bind(id).run();
                return NextResponse.json({ success: true });
            }

            case "video": {
                await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(id).run();
                return NextResponse.json({ success: true });
            }

            case "photo": {
                await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
                return NextResponse.json({ success: true });
            }

            default:
                return NextResponse.json({ error: "Unknown entity" }, { status: 400 });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
