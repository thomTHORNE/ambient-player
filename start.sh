#!/bin/bash
# Simple script to start the YouTube Audio Playlist app

echo "🎵 Starting YouTube Audio Playlist..."
echo "📡 Server will run on http://localhost:8000"
echo "🌐 Opening browser..."
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Open browser after a short delay
(sleep 2 && open http://localhost:8000/index.html) &

# Start the server
python3 -m http.server 8000

