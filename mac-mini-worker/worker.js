const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
require('dotenv').config();

const {
    API_URL,
    ADMIN_SECRET,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_ENDPOINT,
    TEMP_DIR = './temp_processing'
} = process.env;

const s3 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    }
});

/**
 * Main Worker Loop
 */
async function startWorker() {
    console.log('🚀 Mac mini Worker started. Polling for jobs...');

    // Ensure temp dirs exist
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

    while (true) {
        try {
            await checkAndProcessJob();
        } catch (err) {
            console.error('❌ Error in worker loop:', err);
        }
        // Wait 20 seconds before next poll
        await new Promise(r => setTimeout(r, 20000));
    }
}

async function checkAndProcessJob() {
    console.log('🔍 Checking for new jobs...');

    const response = await fetch(`${API_URL}/api/admin/jobs`, {
        headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` }
    });

    if (!response.ok) {
        console.error(`❌ API Error: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.error(`Response: ${text.substring(0, 200)}`);
        return;
    }

    const data = await response.json();

    if (!data.job) {
        console.log('😴 No pending jobs.');
        return;
    }

    const job = data.job;
    console.log(`🎬 Processing Job: ${job.id} for Video: ${job.video_id}`);

    const workDir = path.join(TEMP_DIR, job.id);
    const inputDir = path.join(workDir, 'input');
    const outputDir = path.join(workDir, 'output');

    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
    if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const inputPath = path.join(inputDir, 'source.mp4');

    try {
        // 1. Download source from R2
        console.log(`📦 Downloading: ${job.input_key}`);
        const getObj = await s3.send(new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: job.input_key
        }));

        const writeStream = fs.createWriteStream(inputPath);
        getObj.Body.pipe(writeStream);
        await new Promise((resolve) => writeStream.on('finish', resolve));

        // 2. Run FFmpeg ABR Transcoding
        console.log('🎞️ Encoding ABR HLS variants...');
        await runEncoding(inputPath, outputDir);

        // 3. Upload Output to R2
        console.log('☁️ Uploading encoded files to R2...');
        const files = getAllFiles(outputDir);
        for (const file of files) {
            const relativePath = path.relative(outputDir, file);
            const r2Key = `${job.output_prefix}/${relativePath}`;
            await uploadToR2(file, r2Key);
        }

        // 4. Update API with completion
        console.log('✅ Job completed. Notifying API...');
        await fetch(`${API_URL}/api/admin/jobs`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: job.id,
                status: 'completed',
                masterPlaylistKey: `${job.output_prefix}/master.m3u8`,
                fastStreamKey: `${job.output_prefix}/stream_0.m3u8`, // 1080p variant
                lowStreamKey: `${job.output_prefix}/stream_1.m3u8`,  // 720p variant
            })
        });

        // 5. Cleanup
        fs.rmSync(workDir, { recursive: true, force: true });
        console.log('🧹 Cleanup done.');

    } catch (err) {
        console.error(`❌ Job ${job.id} failed:`, err);
        await fetch(`${API_URL}/api/admin/jobs`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: job.id,
                status: 'failed',
                error: err.message
            })
        });
    }
}

async function runEncoding(input, outputDir) {
    const ffmpegCmd = `ffmpeg -i "${input}" \
        -filter_complex "[0:v]split=3[v1][v2][v3]; [v1]scale=3840:2160[v1out]; [v2]scale=1920:1080[v2out]; [v3]scale=1280:720[v3out]; [0:a]asplit=3[a1][a2][a3]" \
        -map "[v1out]" -map "[a1]" -c:v:0 libx264 -b:v:0 15M -c:a:0 aac -b:a:0 128k \
        -map "[v2out]" -map "[a2]" -c:v:1 libx264 -b:v:1 5M -c:a:1 aac -b:a:1 128k \
        -map "[v3out]" -map "[a3]" -c:v:2 libx264 -b:v:2 2M -c:a:2 aac -b:a:2 128k \
        -f hls -hls_time 4 -hls_playlist_type vod -hls_flags independent_segments \
        -master_pl_name master.m3u8 -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
        "${outputDir}/stream_%v.m3u8"`;

    return new Promise((resolve, reject) => {
        exec(ffmpegCmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`FFmpeg Error: ${stderr}`);
                return reject(error);
            }
            resolve();
        });
    });
}

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });
    return arrayOfFiles;
}

async function uploadToR2(filePath, key) {
    const fileStream = fs.createReadStream(filePath);
    const upload = new Upload({
        client: s3,
        params: {
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: fileStream,
            ContentType: getContentType(filePath)
        }
    });
    await upload.done();
}

function getContentType(filePath) {
    if (filePath.endsWith('.m3u8')) return 'application/x-mpegURL';
    if (filePath.endsWith('.ts')) return 'video/MP2T';
    return 'application/octet-stream';
}

startWorker();
