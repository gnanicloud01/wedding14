-- Create encoding_jobs table if it doesn't exist
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