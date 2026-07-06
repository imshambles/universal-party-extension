# Universal Party

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)

Watch anything together, in sync. Universal Party is a Chrome extension that keeps **play / pause / seek in sync** across everyone in a room, with **group video chat** and **text chat**, on Netflix, Prime Video, Disney+, Hulu, Hotstar, and YouTube.
![Uploading image.png…]()


- 🎬 **Synced playback** — play, pause and seek propagate to everyone, aligned to the same timestamp (no drift)
- 🎥 **Group video chat** — peer-to-peer webcam/mic via WebRTC (PeerJS)
- 💬 **Text chat** — in an on-page sidebar overlay
- 🔗 **Invite links** — drop friends into the same video at your exact timestamp
- 🎨 **Neo-brutalist UI** — bold, high-contrast popup and sidebar

## How it works

```
┌────────────────────┐   Socket.IO (sync + signaling)   ┌────────────────────┐
│  Browser A          │ <──────────────────────────────> │  Browser B          │
│  content script     │                                  │  content script     │
│  • hooks <video>    │        ┌──────────────────┐       │  • hooks <video>    │
│  • sidebar overlay  │ <────> │  Signaling server │ <───> │  • sidebar overlay  │
│  • PeerJS (WebRTC)  │        │  (Express + IO)   │       │  • PeerJS (WebRTC)  │
└────────────────────┘        └──────────────────┘        └────────────────────┘
         └──────────────  WebRTC media (peer-to-peer)  ──────────────┘
```

- **`UPE-frontend/`** — the Chrome extension (Manifest V3). A content script hooks the page's `<video>` element, relays play/pause/seek over Socket.IO, and renders the sidebar (video tiles + chat).
- **`UPE-backend/`** — a small Express + Socket.IO server that relays sync events and acts as the WebRTC signaling channel. It keeps no state and stores no media.

## Install (users)

The extension isn't on the Chrome Web Store yet, so it loads unpacked:

1. Download the latest packaged zip (or build it — see below) and unzip it.
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `UPE-frontend` folder.

Full end-user steps (start a party, invite, join) are in [`INSTALL.md`](./INSTALL.md).

## Development

### Backend (signaling server)

```bash
cd UPE-backend
npm install
npm run dev   # nodemon, or: npm start
# → "Signaling server running on port 3000"
```

### Frontend (extension)

Load `UPE-frontend/` as an unpacked extension (steps above). By default the
extension talks to the hosted signaling server. To point it at your local
server during development, edit the `io(...)` URL in
[`UPE-frontend/contentScript.js`](./UPE-frontend/contentScript.js) (in
`ensureSocket()`) to `http://localhost:3000`, and add `http://localhost:3000`
to `connect-src` in [`manifest.json`](./UPE-frontend/manifest.json).

### Package a shareable build

```bash
./scripts/package-extension.sh
# → dist/universal-party-extension-v<version>.zip
```

The script bundles only the runnable extension files (no dev/test cruft) plus `INSTALL.md`.

## Deploying the backend

Any Node host works. On [Render](https://render.com):

- **Root Directory:** `UPE-backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Branch:** `main`

Then set the extension's signaling URL (in `contentScript.js`) to your service
URL, and add it to `connect-src` in `manifest.json`. The server reads `PORT`
from the environment where available.

## Tech stack

- **Extension:** vanilla JS, Chrome Manifest V3, [Socket.IO client], [PeerJS]
- **Backend:** Node.js, Express, [Socket.IO]

[Socket.IO]: https://socket.io/
[Socket.IO client]: https://socket.io/docs/v4/client-api/
[PeerJS]: https://peerjs.com/

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Vishwas Latiyan
