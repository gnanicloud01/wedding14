import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Metadata Service (D1)
 * Handles all database interactions for weddings and videos.
 */
export const MetadataService = {
    async getWeddingByCode(code: string) {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        return await env.DB
            .prepare("SELECT id, name, access_code, live_stream_url, is_live, created_at FROM weddings WHERE access_code = ?")
            .bind(code)
            .first();
    },

    async getWeddingById(id: string) {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        return await env.DB
            .prepare("SELECT id, name, access_code, live_stream_url, is_live, created_at FROM weddings WHERE id = ?")
            .bind(id)
            .first();
    },

    async getVideosByWeddingId(weddingId: string) {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const { results } = await env.DB
            .prepare("SELECT * FROM videos WHERE wedding_id = ? ORDER BY created_at DESC")
            .bind(weddingId)
            .all();
        return results;
    },

    async getLiveEventsByWeddingId(weddingId: string) {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const { results } = await env.DB
            .prepare("SELECT * FROM live_events WHERE wedding_id = ? ORDER BY created_at ASC")
            .bind(weddingId)
            .all();
        return results;
    },

    async getPhotosByWeddingId(weddingId: string) {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const { results } = await env.DB
            .prepare("SELECT * FROM photos WHERE wedding_id = ? ORDER BY created_at DESC LIMIT 50")
            .bind(weddingId)
            .all();
        return results;
    },

    async recordUserAccess(userId: string, weddingId: string) {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        return await env.DB
            .prepare("INSERT OR IGNORE INTO user_access (user_id, wedding_id) VALUES (?, ?)")
            .bind(userId, weddingId)
            .run();
    }
};

/**
 * Storage Service (R2)
 * Handles object storage operations and URL signing.
 */
export const StorageService = {
    getPublicUrl(key: string, env: CloudflareEnv) {
        const r2PublicDomain = env.R2_PUBLIC_DOMAIN || (env as any).NEXT_PUBLIC_R2_URL;
        if (r2PublicDomain) {
            return `https://${r2PublicDomain.replace(/^https?:\/\//, "")}/${key}`;
        }
        return `/api/r2/${key}`;
    }
};
