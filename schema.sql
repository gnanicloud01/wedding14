-- Weddings table to store client info and access codes
CREATE TABLE IF NOT EXISTS weddings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    access_code TEXT UNIQUE NOT NULL,
    admin_password TEXT NOT NULL, -- To manage individual weddings if needed
    user_id TEXT, -- Owner of the wedding
    live_stream_url TEXT, -- Global live stream URL for the wedding
    is_live BOOLEAN DEFAULT 0, -- Whether the wedding is currently live
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Videos table to store metadata and R2 keys
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    wedding_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    r2_key TEXT NOT NULL, -- Path in R2 bucket (Final Master Playlist)
    file_size_bytes INTEGER,
    duration TEXT,
    thumbnail_key TEXT, -- Path in R2 bucket
    fast_stream_key TEXT, -- Path to 1080p version in R2
    fast_stream_size INTEGER,
    low_stream_key TEXT, -- Path to 720p version in R2
    low_stream_size INTEGER,
    is_public BOOLEAN DEFAULT 0,
    chapters TEXT, -- JSON array of {label, time}
    processing_status TEXT DEFAULT 'completed', -- pending | processing | completed | failed
    job_id TEXT, -- Reference to encoding_jobs
    original_key TEXT, -- R2 key for the original uploaded file
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id) ON DELETE CASCADE
);

-- Encoding Jobs for Mac mini worker
CREATE TABLE IF NOT EXISTS encoding_jobs (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- pending | processing | completed | failed
    input_key TEXT NOT NULL,
    output_prefix TEXT NOT NULL,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

-- User Access table to store which Firebase users have unlocked which weddings
CREATE TABLE IF NOT EXISTS user_access (
    user_id TEXT NOT NULL, -- Firebase UID
    wedding_id TEXT NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, wedding_id),
    FOREIGN KEY (wedding_id) REFERENCES weddings(id) ON DELETE CASCADE
);

-- Live Events table for multiple live streams
CREATE TABLE IF NOT EXISTS live_events (
    id TEXT PRIMARY KEY,
    wedding_id TEXT NOT NULL,
    title TEXT NOT NULL,
    stream_url TEXT NOT NULL,
    stream_key TEXT,
    rtmp_url TEXT,
    hls_path TEXT,
    status TEXT DEFAULT 'idle',     -- idle | waiting | live | ended
    is_live BOOLEAN DEFAULT 0,
    started_at DATETIME,
    ended_at DATETIME,
    viewer_count INTEGER DEFAULT 0,
    max_viewers INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id) ON DELETE CASCADE
);

-- Photos table (up to 50 photos)
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    wedding_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    thumbnail_key TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════
--  SUBSCRIPTION & PAYMENTS SYSTEM
-- ═══════════════════════════════════════════════════════════════════════

-- Users table (synced from Firebase Auth on first login)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,         -- Firebase UID
    email TEXT NOT NULL,
    display_name TEXT,
    photo_url TEXT,
    role TEXT DEFAULT 'free',    -- free | subscriber | admin
    storage_used_bytes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,           -- Price in paisa (INR * 100)
    duration_months INTEGER NOT NULL,  -- Duration in months
    max_videos INTEGER DEFAULT -1,     -- -1 = unlimited
    max_storage_gb INTEGER DEFAULT -1,
    max_weddings INTEGER DEFAULT -1,
    features TEXT,                     -- JSON array of feature strings
    is_active BOOLEAN DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User Subscriptions (state machine: active → expired | cancelled)
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    status TEXT DEFAULT 'active',       -- active | expired | cancelled | past_due
    current_period_start DATETIME NOT NULL,
    current_period_end DATETIME NOT NULL,
    razorpay_subscription_id TEXT,
    cancelled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

-- Payment History (Full audit trail)
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    subscription_id TEXT,
    amount INTEGER NOT NULL,             -- Amount in paisa
    currency TEXT DEFAULT 'INR',
    status TEXT DEFAULT 'created',       -- created | authorized | captured | failed | refunded
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    payment_method TEXT,                 -- card | upi | netbanking | wallet
    receipt TEXT,
    notes TEXT,                          -- JSON metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

-- Seed default plans
INSERT OR IGNORE INTO subscription_plans (id, name, description, price, duration_months, max_videos, max_storage_gb, max_weddings, features, sort_order)
VALUES 
  ('plan_6month', '6 Months', 'Perfect for recent weddings', 69900, 6, -1, -1, -1, '["Unlimited Videos","Unlimited Storage","Unlimited Weddings","4K + ABR Streaming","HD Downloads","Priority Support"]', 1),
  ('plan_1year', '1 Year', 'Best value for your memories', 99900, 12, -1, -1, -1, '["Unlimited Videos","Unlimited Storage","Unlimited Weddings","4K + ABR Streaming","HD Downloads","Priority Support","Custom Branding","Shareable Links"]', 2),
  ('plan_2year', '2 Years', 'Long-term cinematic archive', 169900, 24, -1, -1, -1, '["Unlimited Videos","Unlimited Storage","Unlimited Weddings","4K + ABR Streaming","HD Downloads","24/7 Priority Support","Custom Branding","Shareable Links","White Label","API Access"]', 3);

-- ═══════════════════════════════════════════════════════════════════════
--  SITE CONFIGURATION & BROADCASTS
-- ═══════════════════════════════════════════════════════════════════════

-- Site Settings for global configuration (limits, maintenance, etc.)
CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Announcements for platform-wide broadcasts
CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info', -- info | warning | success | error
    is_active BOOLEAN DEFAULT 1,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Initial settings
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('max_video_size_gb', '5');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('max_videos_per_wedding', '5');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('max_photos_per_wedding', '50');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('maintenance_mode', 'false');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('broadcast_message', '');
INSERT OR IGNORE INTO site_settings (key, value) VALUES ('broadcast_enabled', 'false');

