#!/bin/bash

# --- Oracle Linux 9 Live Streaming Setup Script ---
# Run this INSIDE your Oracle VM (opc@140.245.213.135)

echo "🚀 Starting Live Streaming Server Setup..."

# 1. Update and Install Dependencies
sudo dnf install -y epel-release
sudo dnf install -y ffmpeg

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# 2. Setup Firewall (Oracle Linux uses firewalld)
echo "🛡️ Configuring Firewall..."
sudo firewall-cmd --permanent --add-port=1935/tcp
sudo firewall-cmd --permanent --add-port=8443/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-all

# 3. Setup Project Directory
mkdir -p ~/wedding-streaming/streaming-server
echo "✅ Environment prepared."
echo "👉 Now: Copy the 'streaming-server' folder from your Mac to ~/wedding-streaming/ on this VM."
echo "👉 Then: run 'npm install' and 'node server.js' inside the folder."
