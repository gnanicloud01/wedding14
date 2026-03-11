from flask import Flask, request, jsonify
import boto3
import subprocess
import os
import threading
import requests
import logging

app = Flask(__name__)

# --- CONFIGURATION (UPDATE THESE ON YOUR ORACLE VM) ---
# Tip: Use environment variables in production!
R2_ACCESS_KEY = "YOUR_R2_ACCESS_KEY"
R2_SECRET_KEY = "YOUR_R2_SECRET_KEY"
R2_ENDPOINT = "https://YOUR_ID.r2.cloudflarestorage.com"
R2_BUCKET = "wedding"
NEXTJS_WEBHOOK_URL = "https://your-wedding-ott.pages.dev/api/admin/videos/webhook"
WEBHOOK_SECRET = "dev-secret-123"

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("OracleTranscoder")

s3 = boto3.client('s3', 
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY
)

def transcode_and_notify(video_id, original_key):
    try:
        logger.info(f"🎬 Starting Transcode Task for {video_id}...")
        
        # Paths
        work_dir = f"work_{video_id}"
        os.makedirs(work_dir, exist_ok=True)
        input_path = os.path.join(work_dir, "input.mp4")
        output_dir = os.path.join(work_dir, "hls")
        os.makedirs(output_dir, exist_ok=True)

        # 1. Download from R2
        logger.info(f"📥 Downloading {original_key} from R2...")
        s3.download_file(R2_BUCKET, original_key, input_path)

        # 2. Run FFmpeg (ABR HLS Generation)
        # This creates 3 variants: 1080p, 720p, 480p
        logger.info("⚙️ Running FFmpeg Multi-Bitrate Encoding...")
        ffmpeg_cmd = [
            'ffmpeg', '-i', input_path,
            '-filter_complex', '[0:v]split=3[v1,v2,v3]; [v1]scale=1920:1080[v1out]; [v2]scale=1280:720[v2out]; [v3]scale=854:480[v3out]',
            '-map', '[v1out]', '-c:v:0', 'libx264', '-b:v:0', '5000k', '-maxrate:v:0', '5350k', '-bufsize:v:0', '7500k',
            '-map', '[v2out]', '-c:v:1', 'libx264', '-b:v:1', '2800k', '-maxrate:v:1', '3000k', '-bufsize:v:1', '4000k',
            '-map', '[v3out]', '-c:v:2', 'libx264', '-b:v:2', '1200k', '-maxrate:v:2', '1350k', '-bufsize:v:2', '2000k',
            '-map', '0:a', '-c:a', 'aac', '-b:a', '128k', # Audio for quality 0
            '-map', '0:a', '-c:a', 'aac', '-b:a', '128k', # Audio for quality 1
            '-map', '0:a', '-c:a', 'aac', '-b:a', '128k', # Audio for quality 2
            '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
            '-master_pl_name', 'master.m3u8',
            '-var_stream_map', 'v:0,a:0 v:1,a:1 v:2,a:2',
            os.path.join(output_dir, 'v%v', 'stream.m3u8')
        ]
        
        process = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if process.returncode != 0:
            raise Exception(f"FFmpeg failed: {process.stderr}")

        # 3. Upload HLS Bundle to R2
        logger.info("📤 Uploading HLS bundle to R2...")
        # Define the base folder in R2 for the HLS files
        hls_folder_prefix = f"processed/{video_id}/hls"
        
        for root, dirs, files in os.walk(output_dir):
            for file in files:
                local_path = os.path.join(root, file)
                # Calculate remote path maintaining structure
                rel_path = os.path.relpath(local_path, output_dir)
                remote_key = f"{hls_folder_prefix}/{rel_path}"
                
                content_type = "application/x-mpegURL" if file.endswith(".m3u8") else "video/MP2T"
                s3.upload_file(local_path, R2_BUCKET, remote_key, ExtraArgs={'ContentType': content_type})

        # 4. Notify Next.js Webhook
        logger.info("🔔 Sending completion webhook...")
        webhook_payload = {
            "videoId": video_id,
            "status": "completed",
            "hlsPlaylistKey": f"{hls_folder_prefix}/master.m3u8",
            "fastStreamKey": f"{hls_folder_prefix}/v0/stream.m3u8", # 1080p
            "lowStreamKey": f"{hls_folder_prefix}/v1/stream.m3u8",  # 720p
            "fileSize": os.path.getsize(input_path) # Simplified size tracking
        }
        
        resp = requests.post(
            NEXTJS_WEBHOOK_URL, 
            json=webhook_payload, 
            headers={"Authorization": f"Bearer {WEBHOOK_SECRET}"}
        )
        logger.info(f"Webhook response: {resp.status_code}")

    except Exception as e:
        logger.error(f"❌ Transcoding Error for {video_id}: {str(e)}")
        # Notify failure
        try:
            requests.post(
                NEXTJS_WEBHOOK_URL,
                json={"videoId": video_id, "status": "failed", "errorMessage": str(e)},
                headers={"Authorization": f"Bearer {WEBHOOK_SECRET}"}
            )
        except:
            pass
    finally:
        # Cleanup (Optional: uncomment to save disk space on Oracle VM)
        # import shutil
        # shutil.rmtree(work_dir)
        pass

@app.route('/process', methods=['POST'])
def handle_process():
    data = request.json
    video_id = data.get('videoId')
    original_key = data.get('originalKey')

    if not video_id or not original_key:
        return jsonify({"error": "Missing videoId or originalKey"}), 400

    # Start transcoding in a background thread to return response instantly
    thread = threading.Thread(target=transcode_and_notify, args=(video_id, original_key))
    thread.start()

    return jsonify({"success": True, "message": "Processing started in background."})

if __name__ == '__main__':
    # Listen on all interfaces so Next.js can reach it via Public IP
    app.run(host='0.0.0.0', port=5000)
