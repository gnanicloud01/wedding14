import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function DELETE(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const userId = req.nextUrl.searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ error: "userId required" }, { status: 400 });
        }

        // ─── GDPR / Right to be Forgotten ───
        // In a production app, you would:
        // 1. Delete their subscription records
        // 2. Delete their unlocked wedding access
        // 3. Mark their owned weddings as 'deleted' or remove them
        // 4. Cleanup R2 files if necessary

        // For now, we wipe their database associations
        await db.batch([
            db.prepare("DELETE FROM user_access WHERE user_id = ?").bind(userId),
            db.prepare("DELETE FROM subscriptions WHERE user_id = ?").bind(userId),
            // Note: We don't automatically delete 'weddings' yet to prevent accidental loss
            // of video content that guests might be watching, but we revoke ownership.
            db.prepare("UPDATE weddings SET user_id = 'DELETED_USER' WHERE user_id = ?").bind(userId)
        ]);

        return NextResponse.json({ success: true, message: "Account data scheduled for deletion." });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
