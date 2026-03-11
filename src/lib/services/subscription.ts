import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * ════════════════════════════════════════════════════════════════
 *  SUBSCRIPTION SERVICE — Production-Level Microservice
 * ════════════════════════════════════════════════════════════════
 * 
 *  Plans: 6 Months (₹699), 1 Year (₹999), 2 Years (₹1,699)
 *  All plans include unlimited videos, storage, and weddings.
 */

export interface SubscriptionPlan {
    id: string;
    name: string;
    description: string;
    price: number;           // in paisa
    duration_months: number;
    max_videos: number;
    max_storage_gb: number;
    max_weddings: number;
    features: string;
    is_active: boolean;
    sort_order: number;
}

export interface UserSubscription {
    id: string;
    user_id: string;
    plan_id: string;
    status: 'active' | 'expired' | 'cancelled' | 'past_due';
    current_period_start: string;
    current_period_end: string;
    razorpay_subscription_id?: string;
    cancelled_at?: string;
    // Joined fields
    plan_name?: string;
    duration_months?: number;
    max_videos?: number;
    max_storage_gb?: number;
    max_weddings?: number;
    features?: string;
}

export interface UserProfile {
    id: string;
    email: string;
    display_name: string;
    photo_url: string;
    role: string;
    storage_used_bytes: number;
}

export const SubscriptionService = {
    // ─── User Profile Sync ────────────────────────────────────────
    async syncUser(userId: string, email: string, displayName: string, photoUrl: string) {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        await env.DB.prepare(`
            INSERT INTO users (id, email, display_name, photo_url, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                display_name = excluded.display_name,
                photo_url = excluded.photo_url,
                updated_at = datetime('now')
        `).bind(userId, email, displayName || '', photoUrl || '').run();
    },

    async getUser(userId: string): Promise<UserProfile | null> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        return await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first() as UserProfile | null;
    },

    // ─── Plan Management ──────────────────────────────────────────
    async getActivePlans(): Promise<SubscriptionPlan[]> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const { results } = await env.DB.prepare(
            "SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY sort_order ASC"
        ).all();
        return results as unknown as SubscriptionPlan[];
    },

    async getPlanById(planId: string): Promise<SubscriptionPlan | null> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        return await env.DB.prepare("SELECT * FROM subscription_plans WHERE id = ?").bind(planId).first() as SubscriptionPlan | null;
    },

    // ─── Subscription Lifecycle ───────────────────────────────────
    async getActiveSubscription(userId: string): Promise<UserSubscription | null> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const sub = await env.DB.prepare(`
            SELECT s.*, p.name as plan_name, p.duration_months, p.max_videos, p.max_storage_gb, p.max_weddings, p.features
            FROM subscriptions s
            JOIN subscription_plans p ON s.plan_id = p.id
            WHERE s.user_id = ? AND s.status = 'active' AND s.current_period_end > datetime('now')
            ORDER BY s.created_at DESC LIMIT 1
        `).bind(userId).first();
        return sub as UserSubscription | null;
    },

    async createSubscription(
        userId: string,
        planId: string,
        razorpaySubId?: string
    ): Promise<string> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };

        // Get plan to know duration
        const plan = await this.getPlanById(planId);
        if (!plan) throw new Error("Plan not found");

        const id = crypto.randomUUID();
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + plan.duration_months);

        // Cancel any existing active subscription
        await env.DB.prepare(`
            UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
            WHERE user_id = ? AND status = 'active'
        `).bind(userId).run();

        // Create new subscription
        await env.DB.prepare(`
            INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_start, current_period_end, razorpay_subscription_id)
            VALUES (?, ?, ?, 'active', ?, ?, ?)
        `).bind(id, userId, planId, now.toISOString(), periodEnd.toISOString(), razorpaySubId || null).run();

        // Update user role
        await env.DB.prepare("UPDATE users SET role = 'subscriber', updated_at = datetime('now') WHERE id = ?").bind(userId).run();

        return id;
    },

    async cancelSubscription(userId: string): Promise<void> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        await env.DB.prepare(`
            UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
            WHERE user_id = ? AND status = 'active'
        `).bind(userId).run();
        await env.DB.prepare("UPDATE users SET role = 'free', updated_at = datetime('now') WHERE id = ?").bind(userId).run();
    },

    // ─── Payment Recording ────────────────────────────────────────
    async recordPayment(data: {
        userId: string;
        subscriptionId?: string;
        amount: number;
        currency?: string;
        status: string;
        razorpayOrderId?: string;
        razorpayPaymentId?: string;
        razorpaySignature?: string;
        paymentMethod?: string;
        receipt?: string;
    }): Promise<string> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const id = crypto.randomUUID();
        await env.DB.prepare(`
            INSERT INTO payments (id, user_id, subscription_id, amount, currency, status, razorpay_order_id, razorpay_payment_id, razorpay_signature, payment_method, receipt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id, data.userId, data.subscriptionId || null, data.amount,
            data.currency || 'INR', data.status,
            data.razorpayOrderId || null, data.razorpayPaymentId || null,
            data.razorpaySignature || null, data.paymentMethod || null,
            data.receipt || null
        ).run();
        return id;
    },

    // ─── Entitlement Checks (Quota Enforcement) ───────────────────
    async canUploadVideo(userId: string): Promise<{ allowed: boolean; reason?: string; subscription?: any }> {
        const sub = await this.getActiveSubscription(userId);

        if (!sub) {
            return { allowed: false, reason: 'No active subscription. Please subscribe to upload videos.' };
        }

        // Check video count quota (if not unlimited)
        if (sub.max_videos !== undefined && sub.max_videos !== -1) {
            const { env } = await getCloudflareContext() as { env: CloudflareEnv };
            const countResult = await env.DB.prepare(`
                SELECT COUNT(*) as count FROM videos v
                JOIN weddings w ON v.wedding_id = w.id
                WHERE w.user_id = ?
            `).bind(userId).first() as { count: number };

            if (sub.max_videos > 0 && countResult.count >= sub.max_videos) {
                return {
                    allowed: false,
                    reason: `Video limit reached (${countResult.count}/${sub.max_videos}). Upgrade your plan.`,
                    subscription: sub
                };
            }
        }

        // Check storage quota (if not unlimited)
        if (sub.max_storage_gb !== undefined && sub.max_storage_gb !== -1) {
            const user = await this.getUser(userId);
            const maxBytes = sub.max_storage_gb * 1024 * 1024 * 1024;
            if (user && user.storage_used_bytes >= maxBytes) {
                return {
                    allowed: false,
                    reason: `Storage limit reached. Upgrade your plan.`,
                    subscription: sub
                };
            }
        }

        return { allowed: true, subscription: sub };
    },

    // ─── Shared Gatekeeping ──────────────────────────────────────
    async checkEntitlement(userId: string | null) {
        if (!userId) {
            throw new Error("Authentication required (userId missing)");
        }
        const { allowed, reason } = await this.canUploadVideo(userId);
        if (!allowed) {
            throw new Error(reason || "Premium subscription required");
        }
        return true;
    },

    async updateStorageUsed(userId: string, additionalBytes: number): Promise<void> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        await env.DB.prepare(
            "UPDATE users SET storage_used_bytes = storage_used_bytes + ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(additionalBytes, userId).run();
    },

    // ─── Payment History ──────────────────────────────────────────
    async getPaymentHistory(userId: string): Promise<any[]> {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const { results } = await env.DB.prepare(`
            SELECT p.*, sp.name as plan_name FROM payments p
            LEFT JOIN subscriptions s ON p.subscription_id = s.id
            LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
            WHERE p.user_id = ?
            ORDER BY p.created_at DESC
        `).bind(userId).all();
        return results;
    }
};
