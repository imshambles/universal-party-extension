# Contributing to Universal Party

Thanks for your interest in improving Universal Party! This is a small,
dependency-light project, so getting started is quick.

## Getting set up

1. Fork and clone the repo.
2. Run the signaling server:
   ```bash
   cd UPE-backend && npm install && npm run dev
   ```
3. Load `UPE-frontend/` as an unpacked extension at `chrome://extensions`
   (enable Developer mode → Load unpacked).
4. For local testing, point the extension at your local server — see the
   "Development" section of the [README](./README.md).

## Project layout

- `UPE-frontend/contentScript.js` — the heart of it: video hooking, sync,
  sidebar overlay, chat, and PeerJS video.
- `UPE-frontend/popup.{html,js}` — the toolbar popup (start / copy link / join).
- `UPE-frontend/sidebar.css` — styles for the injected overlay.
- `UPE-backend/server.js` — the Socket.IO relay / signaling server.

## Guidelines

- **Keep it vanilla.** No build step or framework is required; match the
  existing plain-JS style and formatting of the file you're editing.
- **Preserve the JS hooks.** The sidebar markup and code share element IDs — if
  you restyle, keep the IDs so behavior keeps working.
- **Sanity-check before pushing:**
  ```bash
  node --check UPE-frontend/contentScript.js
  node --check UPE-frontend/popup.js
  node --check UPE-backend/server.js
  ```
- **Test with two browser profiles** (or two machines) — start a party in one,
  join via the invite link in the other, and verify play/pause/seek, chat, and
  video all work both ways.
- Keep commits focused and write a clear message describing the change.

## Reporting bugs / ideas

Open an issue describing what you expected, what happened, and the steps to
reproduce (site, browser, and console logs help a lot).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
