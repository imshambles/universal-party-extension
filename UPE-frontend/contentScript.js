// contentScript.js
// Uses global `io` from libs/socket.io.min.js injected via manifest
let socket;
let roomId;
let peerId;
let initialized = false;
let listenersSetup = false;
let suppressEvents = false;
let currentVideo = null;

let overlayActive = false; // whether sidebar overlay is shown
let cleanupVideoHandlers = null; // to detach listeners from previous video
let pendingStartTime = null; // seconds from invite link to seek on first playback

let partyActive = false; // only join & show overlay when true


function ensureSocket() {
    if (socket && socket.connected) return;
    if (!socket) {
        // Use deployed signaling server
        socket = io('https://universal-party-extension.onrender.com');

        socket.on('connect', () => {
            console.log('Connected to Socket.IO server');
            // Auto-join room if we have room and peer IDs
            if (roomId && peerId) {
                console.log('Auto-joining room on connect:', roomId, peerId);
                joinRoom();
            }
        });

        socket.on('connect_error', (error) => {
            console.error('Socket.IO connection error:', error);
        });

        // Receive sync events with suppression to avoid loops
        const getActiveVideo = () => currentVideo || findPrimaryVideo();
        socket.on('play-video', () => {
            const video = getActiveVideo();
            console.log('[SYNC] Received play-video');
            if (video) {
                suppressEvents = true;
                video.play().catch(() => {});
                setTimeout(() => { suppressEvents = false; }, 250);
            }
        });
        socket.on('pause-video', () => {
            const video = getActiveVideo();
            console.log('[SYNC] Received pause-video');
            if (video) {
                suppressEvents = true;
                video.pause();
                setTimeout(() => { suppressEvents = false; }, 250);
            }
        });
        socket.on('seek-video', (time) => {
            const video = getActiveVideo();
            console.log('[SYNC] Received seek-video', time);
            if (video && typeof time === 'number') {
                suppressEvents = true;
                try { video.currentTime = time; } catch {}
                setTimeout(() => { suppressEvents = false; }, 250);
            }
        });
    } else if (!socket.connected) {
        try { socket.connect(); } catch (e) { console.warn('Socket connect error', e); }
    }
}

// Function to initialize Socket.IO connection
function initializeSocket() {
    if (initialized) return;
    initialized = true;
    ensureSocket();
    // Sync event listeners are attached in ensureSocket() with suppression logic.
}

// Function to join or create a room
function joinRoom() {
    if (roomId && peerId && socket && socket.connected) {
        // Distinguish control sockets so chat clients can ignore these IDs
        const controlId = String(peerId).startsWith('control-') ? String(peerId) : `control-${String(peerId)}`;
        console.log(`Joining room ${roomId} with CONTROL ID ${controlId}`);
        socket.emit('join-room', roomId, controlId);
        setupVideoListeners();
    } else {
        console.log('Cannot join room yet:', { 
            roomId: !!roomId, 
            peerId: !!peerId, 
            socket: !!socket, 
            connected: socket ? socket.connected : false 
        });
    }
}

// Choose the primary playable video element on the page
function findPrimaryVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    // Prefer the largest visible video that has readyState > 0
    const scored = videos
        .filter(v => !!(v.offsetWidth * v.offsetHeight) && !v.disablePictureInPicture)
        .map(v => ({ v, area: v.offsetWidth * v.offsetHeight, ready: v.readyState }));
    scored.sort((a, b) => (b.ready - a.ready) || (b.area - a.area));
    return (scored[0] && scored[0].v) || videos[0];
}

// Function to set up video event listeners (smart activation)
function setupVideoListeners() {
    const video = findPrimaryVideo();
    if (!video) {
        console.log('No video found, retrying in 1.5s...');
        if (overlayActive) teardownOverlay();
        setTimeout(setupVideoListeners, 1500);
        return;
    }
    
    console.log('Setting up video listeners for:', video);
    console.log('Video state:', {
        currentTime: video.currentTime,
        duration: video.duration,
        paused: video.paused,
        readyState: video.readyState,
        src: video.src || video.currentSrc
    });

    if (currentVideo === video && listenersSetup) return;

    if (cleanupVideoHandlers) try { cleanupVideoHandlers(); } catch {}

    currentVideo = video;
    listenersSetup = true;

    const maybeApplyPendingStart = () => {
        if (typeof pendingStartTime === 'number' && isFinite(pendingStartTime)) {
            const t = Math.max(0, pendingStartTime);
            console.log('[INVITE] Applying start time:', t);
            suppressEvents = true;
            try {
                if (isFinite(video.duration)) {
                    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.25));
                } else {
                    video.currentTime = t;
                }
                video.play().catch(() => {});
            } catch {}
            setTimeout(() => { suppressEvents = false; }, 300);
            pendingStartTime = null;
        }
    };

    const onPlay = () => {
        // Always activate room/overlay when we have roomId and peerId
        if (roomId && peerId) {
            if (!overlayActive) ensureOverlayReady();
            ensureRoomAndOverlay();
        }
        if (suppressEvents) return;
        console.log('[SYNC] Emitting play-video');
        if (socket && socket.connected) {
            socket.emit('play-video');
        } else {
            console.warn('[SYNC] Socket not connected, cannot emit play-video');
            // Try to reconnect and emit
            if (socket) {
                socket.once('connect', () => {
                    console.log('[SYNC] Reconnected, emitting play-video');
                    socket.emit('play-video');
                });
                socket.connect();
            }
        }
    };
    const onPause = () => {
        if (suppressEvents) return;
        console.log('[SYNC] Emitting pause-video');
        if (socket && socket.connected) {
            socket.emit('pause-video');
        } else {
            console.warn('[SYNC] Socket not connected, cannot emit pause-video');
            // Try to reconnect and emit
            if (socket) {
                socket.once('connect', () => {
                    console.log('[SYNC] Reconnected, emitting pause-video');
                    socket.emit('pause-video');
                });
                socket.connect();
            }
        }
    };
    const onSeeked = () => {
        if (suppressEvents) return;
        console.log('[SYNC] Emitting seek-video', video.currentTime);
        if (socket && socket.connected) {
            socket.emit('seek-video', video.currentTime);
        } else {
            console.warn('[SYNC] Socket not connected, cannot emit seek-video');
            // Try to reconnect and emit
            if (socket) {
                socket.once('connect', () => {
                    console.log('[SYNC] Reconnected, emitting seek-video');
                    socket.emit('seek-video', video.currentTime);
                });
                socket.connect();
            }
        }
    };

    video.addEventListener('loadedmetadata', maybeApplyPendingStart, { once: true });
    video.addEventListener('canplay', maybeApplyPendingStart, { once: true });
    if (video.readyState >= 1) maybeApplyPendingStart();
    
    // Also try to apply pending start time periodically for invite links
    if (typeof pendingStartTime === 'number' && isFinite(pendingStartTime)) {
        const checkInterval = setInterval(() => {
            if (video.readyState >= 1 && isFinite(video.duration)) {
                maybeApplyPendingStart();
                clearInterval(checkInterval);
            }
        }, 500);
        // Clear interval after 10 seconds to avoid infinite checking
        setTimeout(() => clearInterval(checkInterval), 10000);
    }

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);

    cleanupVideoHandlers = () => {
        if (!currentVideo) return;
        currentVideo.removeEventListener('play', onPlay);
        currentVideo.removeEventListener('pause', onPause);
        currentVideo.removeEventListener('seeked', onSeeked);
        listenersSetup = false;
    };

    if (!overlayActive && (video.currentTime > 0 || !video.paused)) {
        ensureOverlayReady();
    }
}

// Remove overlay sidebar if present
function teardownOverlay() {
    try {
        const sidebar = document.getElementById('upe-sidebar');
        if (sidebar) sidebar.remove();
    } catch {}
    overlayActive = false;
}

// Ensure we are connected to the room and overlay UI is shown
function ensureRoomAndOverlay() {
    if (!roomId || !peerId) {
        console.log('Cannot ensure room - missing roomId or peerId');
        return; // user must create/join via popup or invite
    }
    console.log('Ensuring room and overlay:', { roomId, peerId });
    ensureSocket();
    if (socket && !socket.connected) {
        console.log('Socket not connected, attempting to connect...');
        try { socket.connect(); } catch (e) { console.error('Socket connect error:', e); }
        if (socket && socket.once) {
            socket.once('connect', () => {
                console.log('Socket connected, joining room...');
                joinRoom();
                ensureOverlayReady();
            });
            return;
        }
    }
    joinRoom();
    ensureOverlayReady();
}


// Function to open video chat window
function openVideoChatWindow() {
    chrome.runtime.sendMessage({
        type: 'video-chat',
        roomId: roomId,
        peerId: peerId
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error opening video chat:', chrome.runtime.lastError);
        } else {
            console.log('Video chat window opened');
        }
    });
}

// Detect invite link param and auto-join
(function handleInviteLink() {
    try {
        const url = new URL(window.location.href);
        const fromSearch = url.searchParams.get('upeRoom');
        let fromHash = null;
        let startTime = null;
        if (url.hash) {
            const hp = new URLSearchParams(url.hash.replace(/^#/, ''));
            fromHash = hp.get('upeRoom');
            const st = hp.get('startTime');
            if (st != null) startTime = parseFloat(st);
        }
        const inviteRoom = fromSearch || fromHash;
        if (inviteRoom) {
            roomId = String(inviteRoom);
            peerId = Math.random().toString(36).substring(2, 15);
            partyActive = true; // invited sessions should activate immediately
            const payload = { roomId, peerId, partyActive };
            if (typeof startTime === 'number' && isFinite(startTime)) {
                pendingStartTime = startTime;
                payload.pendingStartTime = startTime;
            }
            chrome.storage.local.set(payload, () => {
                console.log('[INVITE] Room joined via invite link:', { roomId, peerId, startTime });
                // Join room and show overlay right away
                initializeSocket();
                ensureSocket();
                joinRoom();
                ensureOverlayReady();
                // Try to move from title page to player and start playback
                attemptAutoStartFromInvite();
            });
        }
    } catch (e) {
        console.warn('Failed to parse invite link', e);
    }
})();
// Attempt to move from title/details page to player and auto-start
function attemptAutoStartFromInvite() {
    // Generic helper: click any element whose text contains keywords
    const clickByText = (root, keywords = []) => {
        const els = root.querySelectorAll('button, a, [role="button"], div, span');
        for (const el of els) {
            const t = (el.textContent || '').trim().toLowerCase();
            if (!t) continue;
            if (keywords.some(k => t.includes(k))) {
                try { el.click(); return true; } catch {}
            }
        }
        return false;
    };

    try {
        const href = location.href;
        // First, try generic keywords
        if (clickByText(document, ['continue watching', 'watch now', 'play', 'resume', 'start over'])) {
            // clicked
        }
        // Prime Video specific fallbacks
        if (/primevideo\.com/.test(href)) {
            const selectors = [
                'button[aria-label*="Watch" i]',
                'button[aria-label*="Resume" i]',
                'button[aria-label*="Continue" i]',
                '[data-automation-id*="play" i]',
                'a[href*="/play" i]',
            ];
            for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn) { try { btn.click(); } catch {} break; }
            }
        }
        if (/netflix\.com/.test(href)) {
            const btn = document.querySelector('[data-uia="previewModal--player-container"] [aria-label*="Play" i], button[aria-label*="Play" i]');
            if (btn) { try { btn.click(); } catch {} }
        }
        if (/disneyplus\.com/.test(href)) {
            const btn = document.querySelector('button[data-testid="play-button"], button[aria-label*="Play" i]');
            if (btn) { try { btn.click(); } catch {} }
        }
        if (/hulu\.com/.test(href)) {
            const btn = document.querySelector('button[aria-label*="Play" i], button[data-testid*="play" i]');
            if (btn) { try { btn.click(); } catch {} }
        }
    } catch (e) { console.warn('auto-start heuristics failed', e); }

    // After possible navigation to the player, re-run listener attachment soon
    const tryApply = () => {
        setupVideoListeners();
        const v = currentVideo || findPrimaryVideo();
        if (v && typeof pendingStartTime === 'number' && isFinite(pendingStartTime)) {
            suppressEvents = true;
            try {
                // temporarily mute to help bypass autoplay restrictions
                const prevMuted = v.muted;
                v.muted = true;
                if (isFinite(v.duration)) {
                    v.currentTime = Math.min(Math.max(0, pendingStartTime), Math.max(0, v.duration - 0.25));
                } else {
                    v.currentTime = Math.max(0, pendingStartTime);
                }
                v.play().catch(() => {});
                // unmute after a short delay
                setTimeout(() => { v.muted = prevMuted; }, 800);
            } catch {}
            setTimeout(() => { suppressEvents = false; }, 350);
            pendingStartTime = null;
        }
    };
    setTimeout(tryApply, 800);
    setTimeout(tryApply, 1800);
}


// Main initialization
chrome.storage.local.get(['roomId', 'peerId', 'pendingStartTime', 'partyActive'], (result) => {
    if (result.roomId && result.peerId) {
        roomId = result.roomId;
        peerId = result.peerId;
        partyActive = !!result.partyActive;
        if (typeof result.pendingStartTime === 'number' && isFinite(result.pendingStartTime)) {
            pendingStartTime = result.pendingStartTime;
        }
        // Initialize socket (overlay shows on playback or when room set via popup)
        initializeSocket();
        console.log('Room initialized:', { roomId, peerId, partyActive });
    } else {
        console.log('No room set yet; open the extension popup to create/join a room.');
    }
});

// React to room/peer changes set by the popup
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.roomId) roomId = changes.roomId.newValue;
    if (changes.peerId) peerId = changes.peerId.newValue;
    if (changes.partyActive) partyActive = !!changes.partyActive.newValue;
    if (changes.pendingStartTime) pendingStartTime = changes.pendingStartTime.newValue;
    // Do not join until user starts party or invite has a timestamp; on play we activate
    initializeSocket();
    ensureSocket();
});

// Add a button to open video chat
const chatButton = document.createElement('button');
chatButton.textContent = 'Open Video Chat';
chatButton.style.position = 'fixed';
chatButton.style.top = '10px';
chatButton.style.right = '10px';
chatButton.style.zIndex = '9999';
chatButton.addEventListener('click', openVideoChatWindow);
document.body.appendChild(chatButton);

// Observe DOM changes to attach listeners when video appears
try {
    const observer = new MutationObserver(() => {
        if (!listenersSetup) setupVideoListeners();
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
} catch (e) {
    console.warn('MutationObserver not available', e);
}

// Inject sidebar overlay for video chat and text chat
function ensureSidebar() {
    if (document.getElementById('upe-sidebar')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('sidebar.css');
    document.head.appendChild(link);

    const sidebar = document.createElement('div');
    sidebar.id = 'upe-sidebar';
    sidebar.innerHTML = `
      <header>
        <div class="title">Universal Party – Room <span id="upe-room-label"></span></div>
        <div class="controls">
          <button id="upe-copy-link">Copy Link</button>
          <button id="upe-minimize">_</button>
          <button id="upe-close">×</button>
        </div>
      </header>
      <div class="videos">
        <video id="upe-local" autoplay muted playsinline></video>
        <div id="upe-remote-container"></div>
      </div>
      <div class="chat">
        <div id="upe-messages" class="messages"></div>
        <div class="compose">
          <input id="upe-input" placeholder="Type a message..." />
          <button id="upe-send">Send</button>
        </div>
      </div>
    `;
    document.body.appendChild(sidebar);

    document.getElementById('upe-copy-link').addEventListener('click', copyInviteLink);
    document.getElementById('upe-minimize').addEventListener('click', () => {
        sidebar.classList.toggle('minimized');
    });
    document.getElementById('upe-close').addEventListener('click', () => {
        sidebar.remove();
    });

    if (roomId) {
        const label = document.getElementById('upe-room-label');
        if (label) label.textContent = roomId;
    }
async function copyInviteLink() {
    try {
        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
        hashParams.set('upeRoom', roomId);
        // Extract current time from active video
        const vid = currentVideo || findPrimaryVideo();
        if (vid && isFinite(vid.currentTime)) {
            const t = vid.currentTime;
            const dur = isFinite(vid.duration) ? vid.duration : null;
            const clamped = dur ? Math.min(t, Math.max(0, dur - 0.25)) : t;
            if (clamped > 0.25) hashParams.set('startTime', String(clamped.toFixed(3)));
        }
        url.hash = hashParams.toString();
        await navigator.clipboard.writeText(url.toString());
        upeAppendMessage({ from: 'system', text: 'Invite link copied to clipboard' });
    } catch (e) {
        console.warn('Failed to copy invite link', e);
    }
}

}
// Simple chat helpers
function upeAppendMessage(msg) {
    try {
        const box = document.getElementById('upe-messages');
        if (!box) return;
        const div = document.createElement('div');
        div.className = 'msg';
        const from = document.createElement('span');
        from.className = 'from';
        from.textContent = (msg.from || 'me') + ':';
        const text = document.createElement('span');
        text.textContent = ' ' + (msg.text || '');
        div.appendChild(from);
        div.appendChild(text);
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    } catch (e) { console.warn('appendMessage failed', e); }
}


// Hook chat UI events and socket messages
function setupChat() {
    if (!socket) return;
    // outbound
    const sendBtn = document.getElementById('upe-send');
    const input = document.getElementById('upe-input');
    if (sendBtn && input) {
        sendBtn.onclick = () => {
            const text = input.value.trim();
            if (!text) return;
            const payload = { text };
            socket.emit('chat-message', payload);
            upeAppendMessage({ from: 'me', text });
            input.value = '';
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendBtn.click();
        });
    }
    // inbound
    socket.off && socket.off('chat-message');
    socket.on('chat-message', (msg) => {
        upeAppendMessage(msg);
    });
}


// PeerJS video inside sidebar
let upePeer;
let upeLocalStream;
const upePeers = {};

function ensurePeer() {
    if (upePeer) return upePeer;
    upePeer = new Peer(undefined, { host: '0.peerjs.com', port: 443, secure: true });
    upePeer.on('open', (id) => {
        console.log('[UPE] Peer open', id, 'joining room for chat overlay');
        // Join the same room with peer id so backend recognizes as peer participant
        if (socket && roomId) socket.emit('join-room', String(roomId), id);
        // Ask backend who is already present
        if (socket) {
            socket.on('existing-peers', (users) => {
                users.forEach((uid) => { if (uid && uid !== id) upeConnectTo(uid); });
            });
            socket.on('peer-connected', (uid) => {
                if (uid && uid !== id) upeConnectTo(uid);
            });
            socket.on('peer-disconnected', (uid) => {
                if (upePeers[uid]) { try { upePeers[uid].close(); } catch {} delete upePeers[uid]; }
            });
        }
    });

    upePeer.on('call', (call) => {
        if (!upeLocalStream) { console.warn('[UPE] local stream not ready, delaying answer'); return; }
        call.answer(upeLocalStream);
        call.on('stream', (s) => upeAttachRemote(s, call.peer));
        call.on('close', () => console.log('[UPE] call closed', call.peer));

    });

    return upePeer;
}

function ensureLocalStream() {
    if (upeLocalStream) return Promise.resolve(upeLocalStream);
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        upeLocalStream = stream;
        const lv = document.getElementById('upe-local');
        if (lv) { lv.srcObject = stream; lv.addEventListener('loadedmetadata', () => lv.play()); }
        return stream;
    });
}

function upeConnectTo(uid) {
    ensureLocalStream().then((stream) => {
        const call = ensurePeer().call(uid, stream);
        call.on('stream', (s) => upeAttachRemote(s, uid));
        call.on('close', () => console.log('[UPE] outbound call closed', uid));
        upePeers[uid] = call;
    });
}

function upeAttachRemote(stream, uid) {
    const container = document.getElementById('upe-remote-container');
    if (!container) return;
    let v = container.querySelector(`video[data-uid="${uid}"]`);
    if (!v) {
        v = document.createElement('video');
        v.setAttribute('data-uid', uid || Math.random().toString(36).slice(2));
        v.autoplay = true;
        v.playsInline = true;
        container.appendChild(v);
    }
    v.srcObject = stream;
    v.addEventListener('loadedmetadata', () => v.play());
}
// Ensure sidebar and peer are ready when room is set
function ensureOverlayReady() {
    ensureSidebar();
    overlayActive = true;
    ensureSocket();
    setupChat();
    ensurePeer();
    ensureLocalStream();
}

// Smart activation: do not auto-show overlay on room set anymore
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.roomId) roomId = changes.roomId.newValue;
    if (changes.peerId) peerId = changes.peerId.newValue;
    // Overlay will appear when playback starts via setupVideoListeners()
});

