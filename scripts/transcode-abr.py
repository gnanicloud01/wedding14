import os
import subprocess
import sys
import argparse
from pathlib import Path

# THE SYSTEM DESIGN FOR ADAPTIVE BITRATE (ABR)
# -------------------------------------------
# 1. Take a High-Resolution 4K Master
# 2. Slice it into 3 variants (4K, 1080p, 720p)
# 3. Fragment each into 4-second .ts segments
# 4. Create a Master Playlist (.m3u8) that bridges them

def check_ffmpeg():
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except FileNotFoundError:
        return False

def generate_hls(input_file, output_dir):
    input_path = Path(input_file)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    print(f"🎬 Starting Cinematic ABR Transcoding: {input_path.name}")
    print("Step 1: Analyzing and slicing into 4K, 1080p, and 720p...")

    # Industry Standard FFmpeg Command for Multi-Bitrate HLS
    # This generates:
    # - v4k: 3840x2160 @ 15Mbps (Cinema)
    # - v1080: 1920x1080 @ 5Mbps (Standard)
    # - v720: 1280x720 @ 2Mbps (Mobile/Data Saver)
    
    command = [
        "ffmpeg", "-i", str(input_path),
        # 1. Slicing logic (Video split + Audio split)
        "-filter_complex", 
        "[0:v]split=3[v1][v2][v3]; [v1]scale=3840:2160[v1out]; [v2]scale=1920:1080[v2out]; [v3]scale=1280:720[v3out]; [0:a]asplit=3[a1][a2][a3]",
        
        # 2. Encode Variants (with their own audio tracks to prevent elementary stream conflicts)
        "-map", "[v1out]", "-map", "[a1]", "-c:v:0", "libx264", "-b:v:0", "15M", "-c:a:0", "aac", "-b:a:0", "128k",
        "-map", "[v2out]", "-map", "[a2]", "-c:v:1", "libx264", "-b:v:1", "5M", "-c:a:1", "aac", "-b:a:1", "128k",
        "-map", "[v3out]", "-map", "[a3]", "-c:v:2", "libx264", "-b:v:2", "2M", "-c:a:2", "aac", "-b:a:2", "128k",
        
        # 4. Packaging logic (HLS)
        "-f", "hls", 
        "-hls_time", "4",               # 4-second segments (Perfect balance for speed vs metadata)
        "-hls_playlist_type", "vod",     # VOD mode
        "-hls_flags", "independent_segments",
        "-master_pl_name", "master.m3u8", # The main file to point to
        "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2", # Map videos to audio
        str(output_path / "stream_%v.m3u8")
    ]

    try:
        subprocess.run(command, check=True)
        print(f"\n✅ SUCCESS! ABR Package generated in: {output_path}")
        print("\nNEXT STEPS FOR INDUSTRY PERFORMANCE:")
        print(f"1. Upload the entire '{output_dir}' folder to your Cloudflare R2 bucket.")
        print(f"2. Note the path to 'master.m3u8' (e.g. weddings/jones/videos/master.m3u8)")
        print(f"3. Paste that path into the 'HLS Adaptive Streaming' PRO slot in your Admin Panel.")
    except subprocess.CalledProcessError as e:
        print(f"❌ Transcoding failed: {e}")

if __name__ == "__main__":
    if not check_ffmpeg():
        print("❌ Error: FFmpeg not found on your system.")
        print("Please install it: 'brew install ffmpeg' (on Mac)")
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Wedding OTT: Cinematic ABR Transcoding Tool")
    parser.add_argument("input", help="Path to your 4K Master Video (.mp4 / .mov)")
    parser.add_argument("--output", default="hls_output", help="Directory to save the segments")
    
    args = parser.parse_args()
    generate_hls(args.input, args.output)
