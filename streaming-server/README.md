# Wedding OTT — Live Streaming Server

Deploy this on your **Oracle Cloud VM** alongside the existing transcoder (`app.py`).

## Architecture

```
Camera → OBS Studio → RTMP → Oracle VM → FFmpeg → HLS → Cloudflare R2 → CDN → Guests
                              ┌────────────────────┐
                              │   Oracle Cloud VM   │
                              │                     │
 OBS ──RTMP──→ port 1935 ──→ │  node-media-server  │
                              │        ↓            │
                              │     FFmpeg          │
                              │  (3-quality HLS)    │
                              │        ↓            │
                              │    r2-sync.js       │──→ Cloudflare R2
                              │        ↓            │
                              │   webhook notify    │──→ Wedding OTT API
                              └────────────────────┘
```

## Quick Start

### 1. Install on Oracle VM

```bash
# SSH into your Oracle VM
ssh ubuntu@YOUR_ORACLE_IP

# Navigate to your working directory
mkdir -p ~/wedding-streaming && cd ~/wedding-streaming

# Copy the streaming-server folder contents here...

# Install Node.js 20 & FFmpeg for Oracle Linux 9
sudo dnf install -y epel-release
sudo dnf install -y ffmpeg
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Verify versions
node -v
ffmpeg -version

# Install dependencies
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
nano .env
```

Update these values:
- `R2_ACCESS_KEY` — Your Cloudflare R2 Key
- `R2_SECRET_KEY` — Your Cloudflare R2 Secret
- `R2_ENDPOINT` — Your R2 Endpoint URL
- `NEXTJS_API_URL` — https://wedding.gtsounds.com (or your production URL)
- `WEBHOOK_SECRET` — Your Internal Secret

### 3. Open Ports

On the **Oracle Cloud Console**, add Ingress Rules for ports **1935** and **8443**.

Then open the local firewall on the VM:
```bash
sudo firewall-cmd --permanent --add-port=1935/tcp
sudo firewall-cmd --permanent --add-port=8443/tcp
sudo firewall-cmd --reload
```

### 4. Run the Server

```bash
# Simple run
node server.js

# Background (production)
nohup node server.js > stream.log 2>&1 &

# Or use PM2 (recommended)
npm install -g pm2
pm2 start server.js --name "wedding-stream"
pm2 save
pm2 startup
```

### 5. Update Next.js (One-Time)

In the live-events API, the RTMP URL is now set to:

```typescript
// src/app/api/admin/live-events/route.ts
const rtmpUrl = `rtmp://140.245.213.135:1935/live`;
```

## Usage (Videographer Workflow)

### Step 1: Admin Creates Stream (Web Dashboard)
1. Go to **Admin Panel → Manage Wedding → ⚡ (Zap icon)**
2. Enter event title (e.g., "Main Ceremony")
3. Click **Create Stream**
4. Copy the **Server URL** and **Stream Key**

### Step 2: OBS Setup (Videographer)
1. Open **OBS Studio**
2. Go to **Settings → Stream**
3. Service: **Custom...**
4. Server: `rtmp://140.245.213.135:1935/live`
5. Stream Key: `sk_XXXXXXXXXXXXXXXXXXXX` (from Step 1)
6. Click **Start Streaming**

### Step 3: Guests Watch (Automatic)
- When OBS connects, the streaming server:
  1. Validates the stream key
  2. Starts FFmpeg multi-bitrate transcoding (1080p/720p/480p)
  3. Uploads HLS segments to Cloudflare R2 in real-time
  4. Notifies the Wedding OTT API → sets `is_live = true`
- The watch page auto-switches to "LIVE" mode
- Guests see the live ceremony with ~8-12 second delay

### Step 4: End Stream
- The videographer clicks **Stop Streaming** in OBS
- or the admin clicks **⬛ End** in the dashboard
- The stream stops, guests see the recorded videos again

## Monitoring

```bash
# Health check
curl http://localhost:8443/health

# List active streams
curl http://localhost:8443/streams

# View logs
tail -f stream.log
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| OBS can't connect | Check firewall (port 1935), verify stream key |
| "Invalid stream key" | Ensure the event exists and hasn't ended |
| High latency | Reduce `HLS_SEGMENT_DURATION` to 2 (in `.env`) |
| Segments not appearing | Check R2 credentials, verify R2 bucket exists |
| Stream stops unexpectedly | Check FFmpeg logs, ensure Oracle VM has enough CPU/RAM |

## System Requirements

- **CPU**: 4+ cores recommended (FFmpeg multi-bitrate encoding is CPU-intensive)
- **RAM**: 4GB minimum
- **Storage**: 2GB free (for temporary HLS segments)
- **Network**: 15+ Mbps upload (for 3 quality levels)
