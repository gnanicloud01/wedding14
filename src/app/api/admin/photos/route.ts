import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";

export async function POST(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const r2 = env.R2;
        const formData = await req.formData();
        const weddingId = formData.get("weddingId") as string;
        const userId = formData.get("userId") as string;
        const file = formData.get("file") as File;
        const description = formData.get("description") as string || "";

        await SubscriptionService.checkEntitlement(userId);

        // Check if there are already 50 photos
        const count: any = await db.prepare("SELECT COUNT(*) as total FROM photos WHERE wedding_id = ?").bind(weddingId).first();
        if (count?.total >= 50) {
            return NextResponse.json({ error: "Max of 50 photos allowed per wedding" }, { status: 400 });
        }

        const id = crypto.randomUUID();
        const fileExt = file.name.split('.').pop();
        const r2Key = `weddings/${weddingId}/photos/${id}.${fileExt}`;

        // Upload to R2
        await r2.put(r2Key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });

        // Save to D1
        await db.prepare(
            "INSERT INTO photos (id, wedding_id, r2_key, description) VALUES (?, ?, ?, ?)"
        )
            .bind(id, weddingId, r2Key, description)
            .run();

        return NextResponse.json({ success: true, id, r2Key });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const db = env.DB;
        const r2 = env.R2;
        const { id, userId } = await req.json();

        await SubscriptionService.checkEntitlement(userId);

        const photo: any = await db.prepare("SELECT r2_key FROM photos WHERE id = ?").bind(id).first();
        if (photo) {
            await r2.delete(photo.r2_key);
        }

        await db.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();

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

        const { results } = await db.prepare("SELECT * FROM photos WHERE wedding_id = ? ORDER BY created_at DESC").bind(weddingId).all();
        return NextResponse.json(results);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
