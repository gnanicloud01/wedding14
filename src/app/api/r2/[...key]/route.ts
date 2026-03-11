import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";


export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ key: string[] }> }
) {
    try {
        const { env } = await getCloudflareContext() as { env: CloudflareEnv };
        const r2 = env.R2;
        const { key } = await params;
        const objectKey = key.join("/");

        // 🚀 OPTIMIZATION: Redirect to Public R2 Domain if configured
        // This bypasses Worker limits (CPU/Memory) and uses Cloudflare's Edge Cache.
        const r2PublicDomain = env.R2_PUBLIC_DOMAIN || (env as any).NEXT_PUBLIC_R2_URL;

        if (r2PublicDomain) {
            const publicUrl = `https://${r2PublicDomain.replace(/^https?:\/\//, '')}/${objectKey}`;
            return NextResponse.redirect(publicUrl, { status: 302 });
        }

        // 1. Handle Range Header for better video streaming
        const rangeHeader = request.headers.get("Range");
        let range: any;

        if (rangeHeader && rangeHeader.startsWith("bytes=")) {
            const part = rangeHeader.split("=")[1];
            const [start, end] = part.split("-");
            if (start || end) {
                range = {};
                if (start) range.offset = parseInt(start, 10);
                if (end) range.length = parseInt(end, 10) - (range.offset || 0) + 1;
            }
        }

        // Check cache first for common segments
        const isSegment = objectKey.endsWith(".ts") || objectKey.endsWith(".m4s");

        let object: any = await r2.get(objectKey, { range });

        // Fallback to Production R2 for local development
        if (!object && (process.env.NODE_ENV === "development" || !env.CF_PAGES)) {
            // ... (keep fallback logic for local dev)
            const accountId = env.CF_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
            const accessKeyId = env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
            const secretAccessKey = env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;

            if (accountId && accessKeyId && secretAccessKey) {
                const publicUrl = `https://${accountId}.r2.cloudflarestorage.com/wedding/${objectKey}`;
                // In local dev, we might still want to proxy or redirect
                // Let's keep the existing S3 client logic for now as it handles credentials
                const s3 = new S3Client({
                    region: "auto",
                    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
                    credentials: { accessKeyId, secretAccessKey },
                });

                try {
                    const response = await s3.send(new GetObjectCommand({
                        Bucket: "wedding",
                        Key: objectKey,
                        Range: rangeHeader || undefined,
                    }));

                    if (response.Body) {
                        const headers: Record<string, string> = {
                            "Content-Type": response.ContentType || "application/octet-stream",
                            "Cache-Control": isSegment ? "public, max-age=31536000, immutable" : "public, max-age=3600",
                        };
                        if (response.ContentRange) headers["Content-Range"] = response.ContentRange;
                        if (response.ContentLength) headers["Content-Length"] = response.ContentLength.toString();

                        return new Response(response.Body as any, {
                            status: rangeHeader ? 206 : 200,
                            headers,
                        });
                    }
                } catch (e: any) {
                    console.error("Production R2 fallback failed:", e);
                }
            }
        }

        if (!object) {
            return new Response("Object Not Found", { status: 404 });
        }

        const responseHeaders = new Headers();
        if (objectKey.endsWith(".m3u8")) {
            responseHeaders.set("Content-Type", "application/x-mpegURL");
        } else if (objectKey.endsWith(".ts")) {
            responseHeaders.set("Content-Type", "video/MP2T");
        } else if (object.httpMetadata && object.httpMetadata.contentType) {
            responseHeaders.set("Content-Type", object.httpMetadata.contentType);
        }

        responseHeaders.set("etag", object.httpEtag);
        // High performance caching for segments
        responseHeaders.set("Cache-Control", isSegment ? "public, max-age=31536000, immutable" : "public, max-age=3600");
        responseHeaders.set("Accept-Ranges", "bytes");

        if (range) {
            responseHeaders.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.size - 1}/${object.range.total || object.size}`);
            responseHeaders.set("Content-Length", object.size.toString());
            return new Response(object.body as any, {
                status: 206,
                headers: responseHeaders,
            });
        }

        return new Response(object.body as any, {
            headers: responseHeaders,
        });
    } catch (error: any) {
        return new Response(error.message, { status: 500 });
    }
}
