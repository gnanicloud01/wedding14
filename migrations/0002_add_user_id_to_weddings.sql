-- Add user_id to weddings to track ownership (Studio Mode)
ALTER TABLE weddings ADD COLUMN user_id TEXT;

-- For existing records (if any), we can't easily guess the owner, 
-- but we can leave it NULL or assign a default.
-- For new records, it will be required via the API.
