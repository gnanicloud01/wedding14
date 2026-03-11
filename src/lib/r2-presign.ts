
async function hmac(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
    const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

async function sha256(msg: string): Promise<string> {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sigKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
    let k = await hmac(new TextEncoder().encode("AWS4" + secret).buffer, date);
    k = await hmac(k, region);
    k = await hmac(k, "s3");
    k = await hmac(k, "aws4_request");
    return k;
}

export async function generatePresignedUrl(
    acctId: string, keyId: string, secret: string,
    bucket: string, objKey: string, method: "GET" | "PUT" = "GET",
    expiresSeconds: number = 3600
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
        ["X-Amz-Expires", expiresSeconds.toString()],
        ["X-Amz-SignedHeaders", "host"],
    ].sort((a, b) => a[0] < b[0] ? -1 : 1);

    const qs = params.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");

    const canonReq = [method, path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const strToSign = ["AWS4-HMAC-SHA256", ds + "Z", scope, await sha256(canonReq)].join("\n");
    const sk = await sigKey(secret, day, region);
    const sig = [...new Uint8Array(await hmac(sk, strToSign))].map(b => b.toString(16).padStart(2, "0")).join("");

    return `https://${host}${path}?${qs}&X-Amz-Signature=${sig}`;
}
