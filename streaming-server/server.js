/**
 * ═══════════════════════════════════════════════════════════════════════
 *  WEDDING OTT — Live Streaming Server
 *  Runs on Oracle Cloud VM alongside the transcoder (app.py)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  FLOW:
 *  Camera → OBS → RTMP → This Server → FFmpeg → HLS → R2 → CDN → Guests
 *
 *  OBS pushes to:  rtmp://ORACLE_VM_IP:1935/live/{STREAM_KEY}
 *  FFmpeg creates local HLS segments
 *  r2-sync.js watches & uploads segments to Cloudflare R2
 *  Guests watch via: https://R2_PUBLIC_DOMAIN/live/{eventId}/master.m3u8
 */

require('dotenv').config();
const NodeMediaServer = require('node-media-server');
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { startR2Sync, stopR2Sync } = require('./r2-sync');

// ─── Config ───────────────────────────────────────────────────────────
const RTMP_PORT = parseInt(process.env.RTMP_PORT || '1935');
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8443');
const HLS_SEGMENT_DURATION = parseInt(process.env.HLS_SEGMENT_DURATION || '4');
const NEXTJS_API_URL = process.env.NEXTJS_API_URL || 'https://ott.gtsounds.com';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'dev-secret-123';
const MEDIA_ROOT = path.join(__dirname, 'media');

// Active streams registry
const activeStreams = new Map(); // streamKey → { ffmpegProcess, r2SyncInterval, eventId }

// ─── Express API (Status & Control) ───────────────────────────────────
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        activeStreams: activeStreams.size,
        streams: Array.from(activeStreams.entries()).map(([key, val]) => ({
            streamKey: key.substring(0, 8) + '...',
            eventId: val.eventId,
            uptime: Math.round((Date.now() - val.startedAt) / 1000) + 's'
        }))
    });
});

// Manual stop endpoint (used by admin panel)
app.post('/stream/stop', async (req, res) => {
    const { streamKey } = req.body;
    if (!streamKey) return res.status(400).json({ error: 'streamKey required' });

    const stream = activeStreams.get(streamKey);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });

    await stopStream(streamKey);
    res.json({ success: true, message: 'Stream stopped' });
});

// List active streams
app.get('/streams', (req, res) => {
    res.json(Array.from(activeStreams.entries()).map(([key, val]) => ({
        streamKey: key,
        eventId: val.eventId,
        startedAt: val.startedAt
    })));
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`🌐 Streaming Control API on port ${HTTP_PORT}`);
});

// ─── Node-Media-Server (RTMP Ingest) ─────────────────────────────────
const nmsConfig = {
    rtmp: {
        port: RTMP_PORT,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
    },
    http: {
        port: HTTP_PORT + 1,  // Internal HTTP for NMS admin
        allow_origin: '*',
    },
};

const nms = new NodeMediaServer(nmsConfig);

/**
 * Auth Hook — Validates stream key against D1 database via Next.js API
 */
nms.on('prePublish', async (id, StreamPath, args) => {
    console.log(`📡 Stream attempting to publish: ${StreamPath}`);

    // StreamPath = /live/STREAM_KEY
    const parts = StreamPath.split('/');
    const streamKey = parts[parts.length - 1];

    if (!streamKey) {
        console.log(`❌ No stream key provided, rejecting.`);
        const session = nms.getSession(id);
        if (session) session.reject();
        return;
    }

    try {
        // Validate stream key against the Wedding OTT API
        const response = await fetch(`${NEXTJS_API_URL}/api/live/auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${WEBHOOK_SECRET}`
            },
            body: JSON.stringify({ streamKey })
        });

        const data = await response.json();

        if (!response.ok || !data.valid) {
            console.log(`❌ Invalid stream key: ${streamKey.substring(0, 8)}...`);
            const session = nms.getSession(id);
            if (session) session.reject();
            return;
        }

        console.log(`✅ Stream authenticated for event: ${data.eventId} (${data.title})`);

        // Start FFmpeg transcoding + R2 sync
        await startFFmpegPipeline(streamKey, data.eventId, data.weddingId);

        // Notify the Next.js app that the stream is now live
        await notifyStreamStatus(data.eventId, 'live', streamKey, data.weddingId);

    } catch (err) {
        console.error(`❌ Auth failed:`, err.message);
        const session = nms.getSession(id);
        if (session) session.reject();
    }
});

/**
 * Stream ended — Cleanup
 */
nms.on('donePublish', async (id, StreamPath, args) => {
    console.log(`📴 Stream ended: ${StreamPath}`);
    const parts = StreamPath.split('/');
    const streamKey = parts[parts.length - 1];

    await stopStream(streamKey);
});

nms.run();
console.log(`📡 RTMP Server listening on port ${RTMP_PORT}`);
console.log(`   OBS should push to: rtmp://YOUR_ORACLE_IP:${RTMP_PORT}/live/{STREAM_KEY}`);

// ─── FFmpeg Pipeline ──────────────────────────────────────────────────

/**
 * Starts FFmpeg to transcode the incoming RTMP stream to multi-bitrate HLS
 */
async function startFFmpegPipeline(streamKey, eventId, weddingId) {
    const hlsOutputDir = path.join(MEDIA_ROOT, eventId);

    // Create output directories
    fs.mkdirSync(path.join(hlsOutputDir, 'v0'), { recursive: true }); // 1080p
    fs.mkdirSync(path.join(hlsOutputDir, 'v1'), { recursive: true }); // 720p
    fs.mkdirSync(path.join(hlsOutputDir, 'v2'), { recursive: true }); // 480p

    const rtmpInput = `rtmp://127.0.0.1:${RTMP_PORT}/live/${streamKey}`;

    // FFmpeg Multi-bitrate HLS pipeline (3 quality levels for ABR)
    const ffmpegArgs = [
        '-i', rtmpInput,
        '-filter_complex',
        '[0:v]split=3[v1,v2,v3]; [v1]scale=1920:1080[v1out]; [v2]scale=1280:720[v2out]; [v3]scale=854:480[v3out]',

        // 1080p stream
        '-map', '[v1out]', '-c:v:0', 'libx264',
        '-b:v:0', '5000k', '-maxrate:v:0', '5350k', '-bufsize:v:0', '7500k',
        '-preset', 'veryfast', '-g', '48', '-keyint_min', '48',

        // 720p stream
        '-map', '[v2out]', '-c:v:1', 'libx264',
        '-b:v:1', '2800k', '-maxrate:v:1', '3000k', '-bufsize:v:1', '4000k',
        '-preset', 'veryfast', '-g', '48', '-keyint_min', '48',

        // 480p stream
        '-map', '[v3out]', '-c:v:2', 'libx264',
        '-b:v:2', '1200k', '-maxrate:v:2', '1350k', '-bufsize:v:2', '2000k',
        '-preset', 'veryfast', '-g', '48', '-keyint_min', '48',

        // Audio for all 3 streams
        '-map', '0:a', '-c:a:0', 'aac', '-b:a:0', '128k',
        '-map', '0:a', '-c:a:1', 'aac', '-b:a:1', '96k',
        '-map', '0:a', '-c:a:2', 'aac', '-b:a:2', '64k',

        // HLS output
        '-f', 'hls',
        '-hls_time', String(HLS_SEGMENT_DURATION),
        '-hls_list_size', '10',
        '-hls_flags', 'delete_segments+append_list+independent_segments',
        '-hls_segment_type', 'mpegts',
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', 'v:0,a:0 v:1,a:1 v:2,a:2',
        '-hls_segment_filename', path.join(hlsOutputDir, 'v%v/segment_%03d.ts'),
        path.join(hlsOutputDir, 'v%v/stream.m3u8'),
    ];

    console.log(`🎬 Starting FFmpeg for event ${eventId}`);

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    ffmpegProcess.stderr.on('data', (data) => {
        const line = data.toString();
        // Only log important lines (filter out the per-frame noise)
        if (line.includes('Error') || line.includes('error') || line.includes('Opening')) {
            console.log(`[FFmpeg ${eventId}] ${line.trim()}`);
        }
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`[FFmpeg ${eventId}] Process exited with code ${code}`);
    });

    // Start R2 Sync (watches HLS directory and uploads segments to Cloudflare R2)
    const r2SyncHandle = startR2Sync(hlsOutputDir, `live/${eventId}`);

    // Register active stream
    activeStreams.set(streamKey, {
        ffmpegProcess,
        r2SyncHandle,
        eventId,
        weddingId,
        startedAt: Date.now(),
        hlsOutputDir
    });

    console.log(`✅ Stream pipeline active for event ${eventId}`);
}

/**
 * Stop a stream cleanly — kills FFmpeg, stops R2 sync, notifies API
 */
async function stopStream(streamKey) {
    const stream = activeStreams.get(streamKey);
    if (!stream) return;

    console.log(`🛑 Stopping stream for event ${stream.eventId}`);

    // 1. Kill FFmpeg
    if (stream.ffmpegProcess && !stream.ffmpegProcess.killed) {
        stream.ffmpegProcess.kill('SIGTERM');
    }

    // 2. Stop R2 sync (but do a final flush first)
    if (stream.r2SyncHandle) {
        stopR2Sync(stream.r2SyncHandle);
    }

    // 3. Notify Next.js API that stream has ended
    await notifyStreamStatus(stream.eventId, 'ended', streamKey, stream.weddingId);

    // 4. Cleanup after a delay (keep files for a bit in case of reconnect)
    setTimeout(() => {
        try {
            if (fs.existsSync(stream.hlsOutputDir)) {
                fs.rmSync(stream.hlsOutputDir, { recursive: true, force: true });
                console.log(`🧹 Cleaned up local HLS files for ${stream.eventId}`);
            }
        } catch (e) {
            console.warn(`⚠️ Cleanup error: ${e.message}`);
        }
    }, 30000); // 30 second delay before delete

    activeStreams.delete(streamKey);
}

/**
 * Notify the Next.js Wedding OTT API about stream status changes
 */
async function notifyStreamStatus(eventId, status, streamKey, weddingId) {
    try {
        const hlsUrl = `https://${process.env.R2_PUBLIC_DOMAIN}/live/${eventId}/master.m3u8`;

        const response = await fetch(`${NEXTJS_API_URL}/api/live/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${WEBHOOK_SECRET}`
            },
            body: JSON.stringify({
                eventId,
                status,         // 'live' | 'ended'
                streamKey,
                weddingId,
                hlsUrl
            })
        });

        const data = await response.json();
        console.log(`📨 Webhook ${status}: ${response.status}`, data);
    } catch (err) {
        console.error(`❌ Webhook notify error:`, err.message);
    }
}
