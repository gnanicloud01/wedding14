#!/usr/bin/env node
/**
 * HLS FOLDER UPLOADER FOR CLOUDFLARE R2
 * ─────────────────────────────────────
 * Uploads an entire ABR-encoded HLS folder (master.m3u8 + v0..v3 segment folders)
 * to your R2 bucket, maintaining the folder structure.
 *
 * Usage:
 *   node scripts/upload-hls-folder.js <local-hls-folder> <wedding-id> <video-title>
 *
 * Example:
 *   node scripts/upload-hls-folder.js /Users/yourname/Downloads/Bhaskar/ABR_FAST \
 *     3676d52d-b918-4bbb-88c6-d33ca55bfc15 "Rituals Early Morning"
 *
 * Recommended FFmpeg ABR Command (for Fix 2 & 3):
 *   ffmpeg -i input.mp4 -hls_time 6 -hls_playlist_type vod -hls_segment_filename "v%v/seg_%03d.ts" \
 *   -master_pl_name master.m3u8 -b:v:0 5000k -s:v:0 1920x1080 -b:v:1 2800k -s:v:1 1280x720 \
 *   -b:v:2 1200k -s:v:2 854x480 -map 0:v -map 0:a -map 0:v -map 0:a -map 0:v -map 0:a \
 *   -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" ABR_FAST/master.m3u8
 */

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// ── Config ─────────────────────────────────────────────────────────────────
const CONCURRENT_UPLOADS = 12;   // parallel file uploads
const BUCKET = 'wedding';

// ── MIME type map ───────────────────────────────────────────────────────────
const MIME = {
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.m4s': 'video/iso.segment',
    '.mp4': 'video/mp4',
    '.ts': 'video/MP2T',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadEnv() {
    const envPath = path.join(__dirname, '../.dev.vars');
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').filter(l => l.includes('=')).forEach(line => {
        const eqIdx = line.indexOf('=');
        const k = line.substring(0, eqIdx).trim();
        const v = line.substring(eqIdx + 1).trim().replace(/^["'](.*?)["']$/, '$1');
        env[k] = v;
    });
    return env;
}

function walkDir(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDir(fullPath));
        } else {
            results.push(fullPath);
        }
    }
    return results;
}

async function runWithConcurrency(tasks, limit) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
        const p = task().then(r => { executing.delete(p); return r; });
        executing.add(p);
        results.push(p);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    const [, , hlsFolder, weddingId, ...titleParts] = process.argv;
    const videoTitle = titleParts.join(' ') || 'Untitled Video';

    if (!hlsFolder || !weddingId) {
        console.error('Usage: node upload-hls-folder.js <hls-folder> <wedding-id> [video-title]');
        process.exit(1);
    }
    if (!fs.existsSync(hlsFolder)) {
        console.error(`❌ Folder not found: ${hlsFolder}`);
        process.exit(1);
    }

    const env = loadEnv();
    const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });

    // R2 destination prefix: weddings/<weddingId>/hls/<timestamp>/
    const timestamp = Date.now();
    const r2Prefix = `weddings/${weddingId}/hls/${timestamp}`;
    const masterKey = `${r2Prefix}/master.m3u8`;

    const allFiles = walkDir(hlsFolder);
    const total = allFiles.length;
    let uploaded = 0;
    let failed = 0;

    console.log(`\n🎬 HLS FOLDER UPLOAD TO R2`);
    console.log(`📂 Source:  ${hlsFolder}`);
    console.log(`☁️  Bucket:  ${BUCKET}/${r2Prefix}`);
    console.log(`📼 Title:   ${videoTitle}`);
    console.log(`📦 Files:   ${total} total\n`);

    const tasks = allFiles.map(localPath => async () => {
        const relativePath = path.relative(hlsFolder, localPath);
        const r2Key = `${r2Prefix}/${relativePath.replace(/\\/g, '/')}`;
        const ext = path.extname(localPath).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';

        try {
            const body = fs.readFileSync(localPath);
            await s3.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: r2Key,
                Body: body,
                ContentType: contentType,
                // Allow m3u8 and init files to be cached briefly; segments can be cached long
                CacheControl: ext === '.m3u8' ? 'no-cache' : 'public, max-age=31536000, immutable',
            }));
            uploaded++;
            process.stdout.write(`\r  ✅ ${uploaded}/${total} uploaded (${failed} failed)    `);
        } catch (err) {
            failed++;
            console.error(`\n  ❌ FAILED: ${relativePath} — ${err.message}`);
        }
    });

    await runWithConcurrency(tasks, CONCURRENT_UPLOADS);

    console.log(`\n\n📊 UPLOAD COMPLETE`);
    console.log(`   ✅ Succeeded: ${uploaded}`);
    console.log(`   ❌ Failed:    ${failed}`);
    console.log(`   🔗 Master:    ${BUCKET}/${masterKey}\n`);

    if (failed > 0) {
        console.error('⚠️  Some files failed. Re-run to retry or check your credentials.\n');
        process.exit(1);
    }

    // ── Write to D1 database ─────────────────────────────────────────
    console.log('💾 Recording HLS stream in database (D1)...');
    const { execSync } = require('child_process');
    const videoId = require('crypto').randomUUID();

    // Store: r2_key = HLS folder prefix, fast_stream_key = master.m3u8 path (playback entry)
    const sql = [
        `INSERT INTO videos`,
        `(id, wedding_id, title, description, r2_key, fast_stream_key, file_size_bytes, created_at)`,
        `VALUES`,
        `('${videoId}', '${weddingId}', '${videoTitle.replace(/'/g, "''")}',`,
        `'ABR HLS Fast-Stream — ${new Date().toISOString().split('T')[0]}',`,
        `'${r2Prefix}', '${masterKey}', 0, datetime('now'))`,
    ].join(' ');

    try {
        execSync(
            `npx wrangler d1 execute wedding --remote --command="${sql.replace(/"/g, '\\"')}"`,
            { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
        );
        console.log('\n✨ DATABASE UPDATED SUCCESSFULLY!\n');
    } catch (err) {
        console.error('\n⚠️  Database write failed (the files are in R2 though). Run the SQL manually:');
        console.error(sql);
    }

    console.log('🚀 DONE! Your HLS stream is live on R2.');
    console.log(`   Master URL key: ${masterKey}`);
    console.log(`   Paste this key in the Admin Panel → Video → HLS URL\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
