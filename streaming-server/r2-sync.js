/**
 * ═══════════════════════════════════════════════════════════════════════
 *  R2 Sync — Watches local HLS directory, uploads segments to R2 in real-time
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Key design decisions:
 *  1. Upload .ts segments immediately when they appear (low latency)
 *  2. Upload .m3u8 playlists AFTER segments (so players never reference missing files)
 *  3. Use a debounce on playlists (they update every HLS_SEGMENT_DURATION seconds)
 *  4. Track uploaded files to avoid duplicate uploads
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

// ─── R2 Client ────────────────────────────────────────────────────────
const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    },
});

const R2_BUCKET = process.env.R2_BUCKET || 'wedding';

/**
 * Upload a single file to R2
 */
async function uploadToR2(localPath, r2Key) {
    try {
        const fileContent = fs.readFileSync(localPath);
        const contentType = localPath.endsWith('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : localPath.endsWith('.ts')
                ? 'video/mp2t'
                : 'application/octet-stream';

        await s3.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: fileContent,
            ContentType: contentType,
            // Short cache for live content — segments cached for 4s, playlists not cached
            CacheControl: localPath.endsWith('.m3u8')
                ? 'no-cache, no-store'  // Playlists must always be fresh
                : 'public, max-age=60', // Segments can be cached longer
        }));

        return true;
    } catch (err) {
        console.error(`❌ R2 upload failed for ${r2Key}: ${err.message}`);
        return false;
    }
}

/**
 * Start watching an HLS output directory and sync to R2
 * @param {string} hlsDir - Local directory where FFmpeg writes HLS segments
 * @param {string} r2Prefix - R2 key prefix (e.g., "live/EVENT_ID")
 * @returns {object} sync handle with watcher reference for cleanup
 */
function startR2Sync(hlsDir, r2Prefix) {
    const uploadedFiles = new Set();
    const pendingPlaylists = new Map(); // path → debounce timer
    let isRunning = true;

    console.log(`📤 R2 Sync started: ${hlsDir} → ${r2Prefix}/`);

    const watcher = chokidar.watch(hlsDir, {
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
            stabilityThreshold: 500, // Wait 500ms after last write
            pollInterval: 100,
        },
    });

    watcher.on('add', (filePath) => handleFile(filePath));
    watcher.on('change', (filePath) => handleFile(filePath));

    async function handleFile(filePath) {
        if (!isRunning) return;

        const relativePath = path.relative(hlsDir, filePath);
        const r2Key = `${r2Prefix}/${relativePath}`;

        if (filePath.endsWith('.ts')) {
            // Upload transport stream segments immediately
            if (!uploadedFiles.has(filePath)) {
                uploadedFiles.add(filePath);
                const ok = await uploadToR2(filePath, r2Key);
                if (ok) {
                    console.log(`  ✅ Segment: ${relativePath}`);
                }
            }
        } else if (filePath.endsWith('.m3u8')) {
            // Debounce playlist uploads (they change rapidly)
            if (pendingPlaylists.has(filePath)) {
                clearTimeout(pendingPlaylists.get(filePath));
            }

            pendingPlaylists.set(filePath, setTimeout(async () => {
                const ok = await uploadToR2(filePath, r2Key);
                if (ok) {
                    console.log(`  📋 Playlist: ${relativePath}`);
                }
                pendingPlaylists.delete(filePath);
            }, 300)); // 300ms debounce
        }
    }

    return {
        watcher,
        stop: () => {
            isRunning = false;
        },
        // Final flush — upload all remaining playlists one last time
        flush: async () => {
            console.log(`📤 Final flush for ${r2Prefix}...`);
            // Upload all .m3u8 files one last time
            const walkFiles = (dir) => {
                if (!fs.existsSync(dir)) return [];
                const files = [];
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        files.push(...walkFiles(full));
                    } else if (entry.name.endsWith('.m3u8')) {
                        files.push(full);
                    }
                }
                return files;
            };

            const playlistFiles = walkFiles(hlsDir);
            for (const pf of playlistFiles) {
                const rel = path.relative(hlsDir, pf);
                const r2Key = `${r2Prefix}/${rel}`;
                await uploadToR2(pf, r2Key);
                console.log(`  📋 Final flush: ${rel}`);
            }
        }
    };
}

/**
 * Stop the R2 sync gracefully
 */
async function stopR2Sync(syncHandle) {
    if (!syncHandle) return;

    syncHandle.stop();

    // Final flush to ensure all playlists are uploaded
    if (syncHandle.flush) {
        await syncHandle.flush();
    }

    if (syncHandle.watcher) {
        await syncHandle.watcher.close();
    }

    console.log('🛑 R2 Sync stopped');
}

module.exports = { startR2Sync, stopR2Sync };
