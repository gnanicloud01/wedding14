-- Add processing status to videos for the external pipeline (Oracle Server)
ALTER TABLE videos ADD COLUMN processing_status TEXT DEFAULT 'completed'; -- pending | processing | completed | failed
ALTER TABLE videos ADD COLUMN original_key TEXT; -- To keep the raw file while HLS is generated
ALTER TABLE videos ADD COLUMN job_id TEXT; -- For tracking in the external microservice
