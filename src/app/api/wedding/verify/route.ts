import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get("code");
        const userId = searchParams.get("userId");

        if (!code) {
            return NextResponse.json({ error: "Code is required" }, { status: 400 });
        }

        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;

        // 1. Verify code exists
        const wedding: any = await db
            .prepare("SELECT id, name FROM weddings WHERE access_code = ?")
            .bind(code)
            .first();

        if (!wedding) {
            return NextResponse.json({ error: "Invalid access code" }, { status: 404 });
        }

        // 2. If userId provided, link it in user_access
        if (userId) {
            await db
                .prepare("INSERT OR IGNORE INTO user_access (user_id, wedding_id) VALUES (?, ?)")
                .bind(userId, wedding.id)
                .run();
        }

        return NextResponse.json({ success: true, wedding });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
