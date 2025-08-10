# Universal Party Extension (UPE)

A Chrome Extension that enables synchronized playback (play/pause/seek) and peer-to-peer video chat for watch parties across popular streaming sites.

## Features
- Sync video playback across participants (play/pause/seek)
- Room-based sessions via a lightweight Socket.IO signaling server
- Peer-to-peer video chat using PeerJS (public PeerJS server by default)
- Chrome Extension (Manifest V3) with simple popup UI

## Repository Structure
- UPE-backend: Node.js Express + Socket.IO signaling server
- UPE-frontend: Chrome Extension (MV3) files

## Prerequisites
- Node.js 18+
- Google Chrome (or Chromium-based browser supporting MV3)

## Setup
### 1) Install backend dependencies
```
cd UPE-backend
npm install
```

### 2) Run the signaling server (port 3000)
```
# Dev mode with auto-restart
npm run dev

# Or plain start
npm start
```
You should see: "Signaling server running on port 3000".

### 3) Load the Chrome Extension
1. Open chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `UPE-frontend` directory

## Usage
1. Open a supported streaming site (Netflix, Hulu, Disney+, Prime Video)
2. Create or join a room:
   - Open the extension popup, click "Create Room" or "Join Room" and follow prompts
   - Alternatively, the content script will prompt for a Room ID if none is set
3. To start video chat, click "Start Video Chat" in the popup or the "Open Video Chat" button injected on the page; a window opens with local/remote video
4. Share the Room ID with others; as they join, playback will sync and video chat can connect peer-to-peer

## Notes and Limitations
- The extension connects to the local signaling server at http://localhost:3000
- PeerJS uses a public server (0.peerjs.com) by default; for production, set up your own PeerJS + TURN servers
- CORS is permissive in development; tighten for production

## Development Tips
- Content script and extension pages load Socket.IO from `UPE-frontend/libs/socket.io.min.js` (global `io`)
- PeerJS is loaded via `UPE-frontend/libs/peerjs.min.js` (global `Peer`)
- If you prefer ES module imports, add a bundler (e.g., Vite) and adjust the manifest accordingly

## Testing Checklist
- Backend:
  - Start server: `npm run dev` in UPE-backend
  - Observe connections and room join logs on client actions
- Extension:
  - Load unpacked and open a supported site
  - Create a room in popup, verify the room ID appears
  - In a second browser profile/window, join the same room
  - Verify play/pause/seek syncs between sessions
  - Open video chat windows on both and verify local preview and remote stream appear

## Security Considerations
- Anyone who knows a Room ID can join; add auth/room secrets for production use
- Consider hosting your own PeerJS server with TURN/STUN for reliability

## License
MIT
