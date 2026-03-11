import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ weddings: [] });
        }

        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;

        // Fetch all weddings unlocked by this user
        const { results: weddings } = await db
            .prepare(`
                SELECT w.id, w.name, w.access_code, w.created_at 
                FROM weddings w
                JOIN user_access ua ON w.id = ua.wedding_id
                WHERE ua.user_id = ?
            `)
            .bind(userId)
            .all() as { results: any[] };

        return NextResponse.json({ weddings });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
