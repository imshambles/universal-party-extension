let roomId;
let peerId;

function updateRoomDisplay(text) {
  const el = document.getElementById('roomId');
  el.textContent = text || (roomId ? `Room ID: ${roomId}` : '');
}

// On open, ensure we have IDs and provide a one-click Start Party
chrome.storage.local.get(['roomId', 'peerId'], (res) => {
  roomId = res.roomId || '';
  peerId = res.peerId || '';
  updateRoomDisplay();
});

// Start Party: create room, activate party on page, then copy link
const startBtn = document.getElementById('startParty');
startBtn.addEventListener('click', async () => {
  try {
    // Create room/peer IDs
    roomId = Math.random().toString(36).substring(2, 15);
    peerId = Math.random().toString(36).substring(2, 15);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) { updateRoomDisplay('Open a supported streaming page'); return; }

    // Mark party active and set IDs in the page context
    await chrome.storage.local.set({ roomId, peerId, partyActive: true });
    console.log('Party started with roomId:', roomId, 'peerId:', peerId);

    // Ask the page to start party now (join + overlay) and return timestamp
    const [exec] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Read currentTime and set pending start in storage for content script
        const vids = Array.from(document.querySelectorAll('video'));
        let time = null, duration = null;
        if (vids.length) {
          const scored = vids
            .filter(v => !!(v.offsetWidth * v.offsetHeight))
            .map(v => ({ v, area: v.offsetWidth * v.offsetHeight, ready: v.readyState }));
          scored.sort((a, b) => (b.ready - a.ready) || (b.area - a.area));
          const v = (scored[0] && scored[0].v) || vids[0];
          time = (v && isFinite(v.currentTime)) ? v.currentTime : null;
          duration = (v && isFinite(v.duration)) ? v.duration : null;
        }
        return { time, duration };
      },
    });
    const time = exec?.result?.time;
    const duration = exec?.result?.duration;

    // Build invite URL with room and timestamp
    const url = new URL(tab.url);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    hashParams.set('upeRoom', roomId);
    if (typeof time === 'number' && time > 0.25) {
      const clamped = (typeof duration === 'number' && isFinite(duration)) ? Math.min(time, Math.max(0, duration - 0.25)) : time;
      hashParams.set('startTime', String(clamped.toFixed(3)));
    }
    url.hash = hashParams.toString();

    await navigator.clipboard.writeText(url.toString());
    updateRoomDisplay(`Party started! Link copied.`);
  } catch (e) {
    console.error('Start Party failed', e);
    updateRoomDisplay('Failed to start party');
  }
});
