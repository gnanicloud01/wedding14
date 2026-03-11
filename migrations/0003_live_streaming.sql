-- ═══════════════════════════════════════════════════════════════════════
--  LIVE STREAMING INFRASTRUCTURE
--  Camera → OBS → RTMPS → Oracle VM → FFmpeg → HLS → R2 → CDN → Guests
-- ═══════════════════════════════════════════════════════════════════════

-- Create the live_events table with full streaming infrastructure
CREATE TABLE IF NOT EXISTS live_events (
    id TEXT PRIMARY KEY,
    wedding_id TEXT NOT NULL,
    title TEXT NOT NULL,
    stream_url TEXT NOT NULL DEFAULT '',
    stream_key TEXT,
    rtmp_url TEXT,
    hls_path TEXT,
    status TEXT DEFAULT 'idle',
    is_live BOOLEAN DEFAULT 0,
    started_at DATETIME,
    ended_at DATETIME,
    viewer_count INTEGER DEFAULT 0,
    max_viewers INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id) ON DELETE CASCADE
);

-- Index for fast lookup by stream key (used by streaming server auth)
CREATE INDEX IF NOT EXISTS idx_live_events_stream_key ON live_events(stream_key);

-- Photos table (if not exists)
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    wedding_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    thumbnail_key TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id) ON DELETE CASCADE
);
