const fs = require('fs');
const path = require('path');
const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");

// 1. Environment Parser (Safe & Simple)
function loadEnv() {
    const envPath = path.join(__dirname, '../.dev.vars');
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').filter(l => l.includes('=')).forEach(line => {
        const [k, v] = line.split('=');
        env[k.trim()] = v.trim().replace(/^["'](.*)["']$/, '$1');
    });
    return env;
}

const env = loadEnv();
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
});

const BUCKET = "wedding";
const FILE = process.argv[2] || "/Users/gnaneshwarthota/Downloads/Bhaskar/rituals.mov";
const TARGET_FOLDER = "weddings/BHASKAR/videos/";
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB Chunks

async function uploadLargeFile() {
    if (!fs.existsSync(FILE)) return console.error(`❌ File not found: ${FILE}`);

    const stats = fs.statSync(FILE);
    const fileName = path.basename(FILE);
    const key = `${TARGET_FOLDER}${Date.now()}-${fileName}`;
    const totalParts = Math.ceil(stats.size / CHUNK_SIZE);

    console.log(`\n🚀 INDUSTRY TURBO UPLOAD: ${fileName} (${(stats.size / (1024 ** 3)).toFixed(2)} GB)`);
    console.log(`📡 Cloud target: ${BUCKET}/${key}\n`);

    const createRes = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: 'video/quicktime' }));
    const uploadId = createRes.UploadId;
    const parts = [];

    try {
        const buffer = Buffer.alloc(CHUNK_SIZE);
        const fd = fs.openSync(FILE, 'r');

        for (let i = 0; i < totalParts; i++) {
            const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, i * CHUNK_SIZE);
            const partBuffer = bytesRead < CHUNK_SIZE ? buffer.subarray(0, bytesRead) : buffer;

            const uploadPartRes = await s3.send(new UploadPartCommand({
                Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: i + 1, Body: partBuffer
            }));

            parts.push({ ETag: uploadPartRes.ETag, PartNumber: i + 1 });
            process.stdout.write(`\r[PROGRESS] Slicing & Moving: ${Math.round(((i + 1) / totalParts) * 100)}% complete...`);
        }

        await s3.send(new CompleteMultipartUploadCommand({
            Bucket: BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts }
        }));

        const { execSync } = require('child_process');
        const weddingId = "3676d52d-b918-4bbb-88c6-d33ca55bfc15";
        const sql = `INSERT INTO videos (id, wedding_id, title, description, r2_key, file_size_bytes) VALUES ('${crypto.randomUUID()}', '${weddingId}', 'Rituals (Main Film)', 'Ceremony and major rituals film.', '${key}', ${stats.size})`;

        console.log(`\n💾 RECORDING IN DATABASE...`);
        execSync(`npx wrangler d1 execute wedding --remote --command="${sql.replace(/"/g, '\\"')}"`);

        console.log(`\n\n✅ CINEMATIC UPLOAD SUCCESSFUL!`);
        console.log(`✨ FILE SAVED IN R2 STORAGE AND DATABASE! ✨\n`);
        console.log(`🔗 VIEW IN ADMIN PANEL NOW!`);

    } catch (err) {
        console.error("\n❌ FAILED:", err);
        await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
    }
}

uploadLargeFile();
