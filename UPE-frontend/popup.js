let roomId;
let peerId;

// Update the displayed room ID
function updateRoomDisplay() {
  const el = document.getElementById('roomId');
  el.textContent = roomId ? `Room ID: ${roomId}` : '';
}

// Load any existing IDs when popup opens
chrome.storage.local.get(['roomId', 'peerId'], (res) => {
  roomId = res.roomId || '';
  peerId = res.peerId || '';
  updateRoomDisplay();
});

// Reflect changes written by content scripts or other pages
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.roomId) roomId = changes.roomId.newValue;
  if (changes.peerId) peerId = changes.peerId.newValue;
  updateRoomDisplay();
});

document.getElementById('createRoom').addEventListener('click', () => {
  // Generate a unique room ID and peer ID
  roomId = Math.random().toString(36).substring(2, 15);
  peerId = Math.random().toString(36).substring(2, 15);
  chrome.storage.local.set({ roomId, peerId });
  updateRoomDisplay();
  alert(`Room created! Share this Room ID with others: ${roomId}`);
});

document.getElementById('joinRoom').addEventListener('click', () => {
  const entered = prompt('Enter the Room ID to join:');
  if (entered) {
    roomId = String(entered);
    peerId = Math.random().toString(36).substring(2, 15);
    chrome.storage.local.set({ roomId, peerId });
    updateRoomDisplay();
    alert(`Joined Room ID: ${roomId}`);
  }
});

document.getElementById('copyInviteLink').addEventListener('click', async () => {
  if (!roomId) { alert('Create or join a room first'); return; }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.url) { alert('Open a supported streaming page first'); return; }
  try {
    const url = new URL(tab.url);
    // Use hash param to avoid interfering with site query params
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    hashParams.set('upeRoom', roomId);
    url.hash = hashParams.toString();
    await navigator.clipboard.writeText(url.toString());
    alert('Invite link copied to clipboard!');
  } catch (e) {
    console.error('Failed to copy invite link', e);
    alert('Failed to copy invite link');
  }
});

document.getElementById('startVideoChat').addEventListener('click', async () => {
  // Ensure we have IDs
  if (!roomId || !peerId) {
    const res = await new Promise((resolve) => chrome.storage.local.get(['roomId', 'peerId'], resolve));
    roomId = res.roomId || roomId;
    peerId = res.peerId || peerId;
  }
  if (!roomId || !peerId) {
    alert('Please create or join a room first.');
    return;
  }

  // Ask background to open the window (more reliable in MV3)
  chrome.runtime.sendMessage({ type: 'video-chat', roomId, peerId });
});
