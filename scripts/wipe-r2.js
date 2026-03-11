const { S3Client, ListObjectsV2Command, DeleteObjectsCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");
const fs = require('fs');
const path = require('path');

// Manually parse .dev.vars
const varsPath = path.join(__dirname, '..', '.dev.vars');
const vars = fs.readFileSync(varsPath, 'utf8').split('\n').reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val) acc[key.trim()] = val.join('=').trim();
    return acc;
}, {});

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${vars.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: vars.R2_ACCESS_KEY_ID,
        secretAccessKey: vars.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET = "wedding";

async function main() {
    try {
        // 1. Abort multipart uploads
        console.log("🔍 Checking for stuck multipart uploads...");
        const multi = await s3.send(new ListMultipartUploadsCommand({ Bucket: BUCKET }));
        if (multi.Uploads && multi.Uploads.length > 0) {
            console.log(`⚠️ Found ${multi.Uploads.length} stuck uploads. Aborting...`);
            for (const u of multi.Uploads) {
                console.log(`   - Aborting: ${u.Key}`);
                await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: u.Key, UploadId: u.UploadId }));
            }
            console.log("✅ All stuck uploads aborted.");
        } else {
            console.log("✨ No stuck uploads found.");
        }

        // 2. Delete objects
        console.log("🔍 Listing all objects...");
        let list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
        if (list.Contents && list.Contents.length > 0) {
            const keys = list.Contents.map(o => ({ Key: o.Key }));
            console.log(`🗑️ Deleting ${keys.length} objects...`);
            await s3.send(new DeleteObjectsCommand({
                Bucket: BUCKET,
                Delete: { Objects: keys }
            }));
            console.log("✅ All objects deleted.");
        } else {
            console.log("✨ Bucket is already empty.");
        }

        console.log("\n🚀 DATABASE & STORAGE FULLY WIPED!");
    } catch (err) {
        console.error("❌ Error during wipe:", err.message);
    }
}

main();
