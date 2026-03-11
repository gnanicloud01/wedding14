# Oracle Transcoder Setup Guide

Follow these steps to deploy your private video transcoding microservice on your Oracle Cloud VM.

## 1. Prepare the Oracle VM
SSH into your instance and run:

```bash
# Install System Dependencies
sudo apt update
sudo apt install ffmpeg python3-pip python3-venv -y

# Setup Directory
mkdir ~/transcoder && cd ~/transcoder
```

## 2. Deploy the Worker
Copy the `app.py` and `requirements.txt` from the `oracle-worker` folder in this repository to your VM.

```bash
# Create Virtual Environment
python3 -m venv venv
source venv/bin/activate

# Install Libraries
pip install -r requirements.txt
```

## 3. Configure the Keys
Open `app.py` on the VM and update the following:
- `R2_ACCESS_KEY` & `R2_SECRET_KEY`
- `R2_ENDPOINT` (e.g., `https://<id>.r2.cloudflarestorage.com`)
- `NEXTJS_WEBHOOK_URL` (Your production URL)

## 4. Open Ports (Security List)
On the **Oracle Cloud Console**, go to your VCN and update the **Ingress Rules** for your Security List:
- **Stateless**: No
- **Source**: `0.0.0.0/0`
- **Protocol**: `TCP`
- **Destination Port Range**: `5000`

Then open the local firewall:
```bash
sudo ufw allow 5000
```

## 5. Run the Service
For production, use `gunicorn` or run it simple first:

```bash
# Simple run
python3 app.py

# Keep it running in the background (Recommended)
nohup python3 app.py > output.log 2>&1 &
```

## 6. Update the Next.js Frontend
Go to `src/app/admin/page.tsx` and update the `ORACLE_SERVER_IP` constant with your VM's Public IP address.

---
**How it works:**  
When you upload a video in the Studio Dashboard with "Production Pipeline" enabled, the browser sends the file to R2. Your Studio then tells the Oracle IP to start processing. Once FFmpeg is done, the Oracle server calls your site's webhook to finalize the video for cinematic HLS playback.
