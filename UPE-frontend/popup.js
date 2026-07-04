// popup.js — Universal Party control panel
const SUPPORTED = /(^|\.)(netflix|hulu|disneyplus|primevideo|hotstar|youtube)\.com$/i;

let roomId = '';
let peerId = '';

const $ = (id) => document.getElementById(id);
const nameInput   = $('displayName');
const startBtn    = $('startParty');
const activePanel = $('activePanel');
const roomCodeEl  = $('roomCode');
const copyBtn     = $('copyLink');
const joinInput   = $('joinLink');
const joinBtn     = $('joinParty');
const statusEl    = $('status');

const randomId = () => Math.random().toString(36).substring(2, 15);

function setStatus(msg, kind) {
  statusEl.textContent = msg || '';
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// Only pages where the content script runs can actually join a party.
function isSupported(u) {
  try {
    const url = new URL(u);
    if (url.protocol === 'file:') return true;
    if (url.hostname === 'localhost') return true;
    return SUPPORTED.test(url.hostname);
  } catch { return false; }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Read the primary video's current time/duration from the page.
async function readVideoTime(tabId) {
  try {
    const [exec] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
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
    return (exec && exec.result) || { time: null, duration: null };
  } catch {
    return { time: null, duration: null };
  }
}

function buildInviteUrl(tabUrl, room, time, duration) {
  const url = new URL(tabUrl);
  const hp = new URLSearchParams(url.hash.replace(/^#/, ''));
  hp.set('upeRoom', room);
  if (typeof time === 'number' && time > 0.25) {
    const clamped = (typeof duration === 'number' && isFinite(duration))
      ? Math.min(time, Math.max(0, duration - 0.25)) : time;
    hp.set('startTime', String(clamped.toFixed(3)));
  }
  url.hash = hp.toString();
  return url.toString();
}

function showActive(id) {
  roomId = id;
  roomCodeEl.textContent = id;
  activePanel.classList.remove('hidden');
  startBtn.innerHTML = '<span class="btn-icon">🔄</span> Start a new party';
  startBtn.classList.remove('btn-primary');
  startBtn.classList.add('btn-secondary');
}

// Build the invite link for the current tab (with a fresh timestamp) and copy it.
async function copyInvite(showMsg) {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !roomId) return false;
  const { time, duration } = await readVideoTime(tab.id);
  const link = buildInviteUrl(tab.url, roomId, time, duration);
  try {
    await navigator.clipboard.writeText(link);
    if (showMsg) setStatus('Invite link copied to clipboard!', 'ok');
    return true;
  } catch {
    if (showMsg) setStatus('Could not copy — check clipboard permissions.', 'err');
    return false;
  }
}

// ---- init ----
chrome.storage.local.get(['roomId', 'peerId', 'partyActive', 'displayName'], (res) => {
  roomId = res.roomId || '';
  peerId = res.peerId || '';
  if (res.displayName) nameInput.value = res.displayName;
  if (res.partyActive && roomId) showActive(roomId);
});

// Persist the name as soon as it's edited, so it applies even without starting.
nameInput.addEventListener('change', () => {
  chrome.storage.local.set({ displayName: nameInput.value.trim() });
});

// ---- start ----
startBtn.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !tab.url || !isSupported(tab.url)) {
      setStatus('Open a supported streaming page first, then start.', 'err');
      return;
    }
    const name = nameInput.value.trim();
    roomId = randomId();
    peerId = randomId();
    await chrome.storage.local.set({ roomId, peerId, partyActive: true, displayName: name });
    showActive(roomId);
    const copied = await copyInvite(false);
    setStatus(copied ? 'Party started — invite link copied! 🎉' : 'Party started! Use “Copy invite link”.', 'ok');
  } catch (e) {
    console.error('Start party failed', e);
    setStatus('Something went wrong starting the party.', 'err');
  }
});

// ---- copy ----
copyBtn.addEventListener('click', () => copyInvite(true));

// ---- join ----
joinBtn.addEventListener('click', async () => {
  const raw = joinInput.value.trim();
  if (!raw) { setStatus('Paste an invite link to join.', 'err'); return; }
  let target;
  try { target = new URL(raw); } catch { setStatus('That doesn’t look like a valid link.', 'err'); return; }
  const hp = new URLSearchParams(target.hash.replace(/^#/, ''));
  const room = target.searchParams.get('upeRoom') || hp.get('upeRoom');
  if (!room) { setStatus('This link has no party room in it.', 'err'); return; }
  const name = nameInput.value.trim();
  if (name) await chrome.storage.local.set({ displayName: name });
  const tab = await getActiveTab();
  if (!tab || !tab.id) { setStatus('No active tab to open the link in.', 'err'); return; }
  setStatus('Joining party…', 'ok');
  await chrome.tabs.update(tab.id, { url: raw });
  window.close();
});

joinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
