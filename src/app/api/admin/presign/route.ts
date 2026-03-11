import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SubscriptionService } from "@/lib/services/subscription";

// ─── AWS Signature V4 for R2 Presigned URLs ─────────────────────────
// 100% Web Crypto API — works natively on Cloudflare Workers
// No Node.js, no AWS SDK

async function hmac(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
    const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

async function sha256(msg: string): Promise<string> {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
    return hex(h);
}

function hex(buf: ArrayBuffer): string {
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sigKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
    let k = await hmac(new TextEncoder().encode("AWS4" + secret).buffer, date);
    k = await hmac(k, region);
    k = await hmac(k, "s3");
    k = await hmac(k, "aws4_request");
    return k;
}

function uriEncode(s: string): string {
    return encodeURIComponent(s).replace(/%2F/g, "/");
}

async function presignUploadPart(
    acctId: string, keyId: string, secret: string,
    bucket: string, objKey: string, uploadId: string, partNum: number
): Promise<string> {
    const host = `${acctId}.r2.cloudflarestorage.com`;
    const now = new Date();
    const ds = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "");
    const day = ds.slice(0, 8);
    const region = "auto";
    const scope = `${day}/${region}/s3/aws4_request`;

    // Path: /{bucket}/{key}
    const path = "/" + bucket + "/" + objKey.split("/").map(s => encodeURIComponent(s)).join("/");

    // Query params MUST be sorted alphabetically
    const params = [
        ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
        ["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"],
        ["X-Amz-Credential", `${keyId}/${scope}`],
        ["X-Amz-Date", ds + "Z"],
        ["X-Amz-Expires", "7200"],
        ["X-Amz-SignedHeaders", "host"],
        ["partNumber", String(partNum)],
        ["uploadId", uploadId],
    ].sort((a, b) => a[0] < b[0] ? -1 : 1);

    const qs = params.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");

    const canonReq = ["PUT", path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const strToSign = ["AWS4-HMAC-SHA256", ds + "Z", scope, await sha256(canonReq)].join("\n");
    const sk = await sigKey(secret, day, region);
    const sig = hex(await hmac(sk, strToSign));

    return `https://${host}${path}?${qs}&X-Amz-Signature=${sig}`;
}

async function presignSinglePut(
    acctId: string, keyId: string, secret: string,
    bucket: string, objKey: string
): Promise<string> {
    const host = `${acctId}.r2.cloudflarestorage.com`;
    const now = new Date();
    const ds = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "");
    const day = ds.slice(0, 8);
    const region = "auto";
    const scope = `${day}/${region}/s3/aws4_request`;

    const path = "/" + bucket + "/" + objKey.split("/").map(s => encodeURIComponent(s)).join("/");

    const params = [
        ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
        ["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"],
        ["X-Amz-Credential", `${keyId}/${scope}`],
        ["X-Amz-Date", ds + "Z"],
        ["X-Amz-Expires", "7200"],
        ["X-Amz-SignedHeaders", "host"],
    ].sort((a, b) => a[0] < b[0] ? -1 : 1);

    const qs = params.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");

    const canonReq = ["PUT", path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const strToSign = ["AWS4-HMAC-SHA256", ds + "Z", scope, await sha256(canonReq)].join("\n");
    const sk = await sigKey(secret, day, region);
    const sig = hex(await hmac(sk, strToSign));

    return `https://${host}${path}?${qs}&X-Amz-Signature=${sig}`;
}

// ─── API ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as any;
        const { action, userId } = body;
        const { env } = await getCloudflareContext() as { env: any };

        // ─── Gatekeeping ──! ───
        if (["startMultipart", "getPartUrls", "getSingleUrls"].includes(action)) {
            await SubscriptionService.checkEntitlement(userId);
        }

        const bucket = env.R2;
        if (!bucket) return NextResponse.json({ error: "R2 binding not found" }, { status: 500 });

        // ─── Start Multipart ─────────────────────────────────────────
        if (action === "startMultipart") {
            const { filename, contentType, weddingId } = body;
            const key = `weddings/${weddingId}/videos/${Date.now()}-${filename}`;

            const mp = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
            console.log("🎬 START MULTIPART:", { key, uploadId: mp.uploadId });
            return NextResponse.json({ uploadId: mp.uploadId, key });
        }

        // ─── Get Part URLs ───────────────────────────────────────────
        if (action === "getPartUrls") {
            const { key, uploadId, parts } = body;
            const acctId = env.CF_ACCOUNT_ID;
            const keyId = env.R2_ACCESS_KEY_ID;
            const secret = env.R2_SECRET_ACCESS_KEY;

            if (!acctId || !keyId || !secret) {
                return NextResponse.json({ error: "Missing R2 credentials in worker secrets" }, { status: 500 });
            }

            const urls: { partNumber: number; url: string }[] = [];
            for (const p of parts) {
                const url = await presignUploadPart(acctId, keyId, secret, "wedding", key, uploadId, p.partNumber);
                urls.push({ partNumber: p.partNumber, url });
            }
            return NextResponse.json({ urls });
        }

        // ─── Complete ────────────────────────────────────────────────
        if (action === "completeMultipart") {
            const { key, uploadId, parts } = body;
            console.log("🏁 COMPLETING MULTIPART:", { key, uploadId, partsReceived: parts.length });

            const sortedParts = parts
                .sort((a: any, b: any) => a.partNumber - b.partNumber)
                .map((p: any) => ({ partNumber: p.partNumber, etag: p.etag }));

            const mp = bucket.resumeMultipartUpload(key, uploadId);
            await mp.complete(sortedParts);
            console.log("✅ MULTIPART COMPLETE SUCCESS");
            return NextResponse.json({ success: true });
        }

        // ─── Abort ───────────────────────────────────────────────────
        if (action === "abortMultipart") {
            const { key, uploadId } = body;
            const mp = bucket.resumeMultipartUpload(key, uploadId);
            await mp.abort();
            return NextResponse.json({ success: true });
        }

        // ─── List Active (Cloud Recovery) ───────────────────────────
        if (action === "listActive") {
            const list = await bucket.listMultipartUploads();
            return NextResponse.json({ uploads: list.uploads });
        }

        // ─── Get Parts (Cloud Recovery) ──────────────────────────────
        if (action === "getUploadedParts") {
            const { key, uploadId } = body;
            const mp = bucket.resumeMultipartUpload(key, uploadId);
            const { parts } = await mp.listParts();
            return NextResponse.json({ parts });
        }

        // ─── Get Single-Part Presigned URLs ──────────────────────────
        if (action === "getSingleUrls") {
            const { keys } = body;
            const acctId = env.CF_ACCOUNT_ID;
            const keyId = env.R2_ACCESS_KEY_ID;
            const secret = env.R2_SECRET_ACCESS_KEY;

            if (!acctId || !keyId || !secret) {
                return NextResponse.json({ error: "Missing R2 credentials in worker secrets" }, { status: 500 });
            }

            const urls: { key: string; url: string }[] = [];
            for (const key of keys) {
                const url = await presignSinglePut(acctId, keyId, secret, "wedding", key);
                urls.push({ key, url });
            }
            return NextResponse.json({ urls });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error: any) {
        console.error("🚨 PRESIGN ERROR:", error?.message, error?.stack);
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
}
