// contentScript.js
// Uses global `io` from libs/socket.io.min.js injected via manifest
let socket;
let roomId;
let peerId;
let displayName = '';
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
        socket.on('play-video', (data) => {
            const video = getActiveVideo();
            console.log('[SYNC] Received play-video', data);
            if (video) {
                suppressEvents = true;
                video.play().catch(() => {});
                setTimeout(() => { suppressEvents = false; }, 250);
            }
            // Show system message
            if (data && data.displayName) {
                upeAppendMessage({ 
                    from: 'system', 
                    text: `${data.displayName} played the video`,
                    type: 'system'
                });
            }
        });
        socket.on('pause-video', (data) => {
            const video = getActiveVideo();
            console.log('[SYNC] Received pause-video', data);
            if (video) {
                suppressEvents = true;
                video.pause();
                setTimeout(() => { suppressEvents = false; }, 250);
            }
            // Show system message
            if (data && data.displayName) {
                upeAppendMessage({ 
                    from: 'system', 
                    text: `${data.displayName} paused the video`,
                    type: 'system'
                });
            }
        });
        socket.on('seek-video', (time, data) => {
            const video = getActiveVideo();
            console.log('[SYNC] Received seek-video', time, data);
            if (video && typeof time === 'number') {
                suppressEvents = true;
                try { video.currentTime = time; } catch {}
                setTimeout(() => { suppressEvents = false; }, 250);
            }
            // Show system message with formatted time
            if (data && data.displayName) {
                const minutes = Math.floor(time / 60);
                const seconds = Math.floor(time % 60);
                const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                upeAppendMessage({ 
                    from: 'system', 
                    text: `${data.displayName} skipped to ${timeString}`,
                    type: 'system'
                });
            }
        });
        
        // Handle system messages
        socket.on('system-message', (data) => {
            console.log('[SYNC] Received system message:', data);
            upeAppendMessage({ 
                from: 'system', 
                text: data.text,
                type: 'system'
            });
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
        
        // Show system message when joining room
        setTimeout(() => {
            upeAppendMessage({ 
                from: 'system', 
                text: 'Joined the party! Video sync is now active.',
                type: 'system'
            });
        }, 500);
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
            socket.emit('play-video', { displayName: displayName || 'You' });
        } else {
            console.warn('[SYNC] Socket not connected, cannot emit play-video');
            // Try to reconnect and emit
            if (socket) {
                socket.once('connect', () => {
                    console.log('[SYNC] Reconnected, emitting play-video');
                    socket.emit('play-video', { displayName: displayName || 'You' });
                });
                socket.connect();
            }
        }
    };
    const onPause = () => {
        if (suppressEvents) return;
        console.log('[SYNC] Emitting pause-video');
        if (socket && socket.connected) {
            socket.emit('pause-video', { displayName: displayName || 'You' });
        } else {
            console.warn('[SYNC] Socket not connected, cannot emit pause-video');
            // Try to reconnect and emit
            if (socket) {
                socket.once('connect', () => {
                    console.log('[SYNC] Reconnected, emitting pause-video');
                    socket.emit('pause-video', { displayName: displayName || 'You' });
                });
                socket.connect();
            }
        }
    };
    const onSeeked = () => {
        if (suppressEvents) return;
        console.log('[SYNC] Emitting seek-video', video.currentTime);
        if (socket && socket.connected) {
            socket.emit('seek-video', video.currentTime, { displayName: displayName || 'You' });
        } else {
            console.warn('[SYNC] Socket not connected, cannot emit seek-video');
            // Try to reconnect and emit
            if (socket) {
                socket.once('connect', () => {
                    console.log('[SYNC] Reconnected, emitting seek-video');
                    socket.emit('seek-video', video.currentTime, { displayName: displayName || 'You' });
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
                
                // Show system message for invite join
                setTimeout(() => {
                    upeAppendMessage({ 
                        from: 'system', 
                        text: 'Joined party via invite link!',
                        type: 'system'
                    });
                }, 1000);
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
chrome.storage.local.get(['roomId', 'peerId', 'pendingStartTime', 'partyActive', 'displayName'], (result) => {
    if (result.roomId && result.peerId) {
        roomId = result.roomId;
        peerId = result.peerId;
        partyActive = !!result.partyActive;
        displayName = result.displayName || '';
        if (typeof result.pendingStartTime === 'number' && isFinite(result.pendingStartTime)) {
            pendingStartTime = result.pendingStartTime;
        }
        // Initialize socket (overlay shows on playback or when room set via popup)
        initializeSocket();
        console.log('Room initialized:', { roomId, peerId, partyActive, displayName });
    } else {
        console.log('No room set yet; open the extension popup to create/join a room.');
    }
    
    // Load display name even if no room is set
    if (result.displayName) {
        displayName = result.displayName;
    }
});

// React to room/peer changes set by the popup
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.roomId) roomId = changes.roomId.newValue;
    if (changes.peerId) peerId = changes.peerId.newValue;
    if (changes.partyActive) partyActive = !!changes.partyActive.newValue;
    if (changes.pendingStartTime) pendingStartTime = changes.pendingStartTime.newValue;
    if (changes.displayName) displayName = changes.displayName.newValue || '';
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

// Add debug functions to window for console access
window.UPE = {
    checkStreamStatus,
    ensureLocalStream,
    ensurePeer,
    getPendingCalls: () => pendingCalls,
    getActivePeers: () => Object.keys(upePeers),
    getLocalStream: () => upeLocalStream
};

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
      <div class="user-info">
        <input id="upe-display-name" placeholder="Enter your name..." maxlength="20" />
        <button id="upe-set-name">Set Name</button>
      </div>
      <div class="videos">
        <video id="upe-local" autoplay muted playsinline></video>
        <div id="upe-remote-container"></div>
      </div>
      <div class="video-controls">
        <button id="upe-mute-audio" class="control-btn" title="Mute Audio">
          <span class="icon">🔊</span>
          <span class="text">Mute</span>
        </button>
        <button id="upe-mute-video" class="control-btn" title="Mute Video">
          <span class="icon">📹</span>
          <span class="text">Video</span>
        </button>
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
    
    // Add mute controls
    document.getElementById('upe-mute-audio').addEventListener('click', toggleAudioMute);
    document.getElementById('upe-mute-video').addEventListener('click', toggleVideoMute);
    
    // Add name setting functionality
    document.getElementById('upe-set-name').addEventListener('click', setDisplayName);
    document.getElementById('upe-display-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            setDisplayName();
        }
    });

    if (roomId) {
        const label = document.getElementById('upe-room-label');
        if (label) label.textContent = roomId;
    }
    
    // Populate display name input if it exists
    if (displayName) {
        const nameInput = document.getElementById('upe-display-name');
        if (nameInput) {
            nameInput.value = displayName;
        }
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
// Set display name function
function setDisplayName() {
    const nameInput = document.getElementById('upe-display-name');
    if (!nameInput) return;
    
    const newName = nameInput.value.trim();
    if (newName.length === 0) {
        upeAppendMessage({ from: 'system', text: 'Please enter a valid name' });
        return;
    }
    
    displayName = newName;
    chrome.storage.local.set({ displayName: displayName }, () => {
        upeAppendMessage({ from: 'system', text: `Name set to: ${displayName}` });
        console.log('[UPE] Display name set to:', displayName);
    });
}

// Get display name for a user
function getDisplayName(userId, msgDisplayName) {
    // If message has a display name, use it
    if (msgDisplayName) {
        return msgDisplayName;
    }
    
    // For our own messages
    if (userId === peerId || userId === 'me') {
        return displayName || 'You';
    }
    
    // For other users (fallback to peer ID)
    return userId || 'Unknown';
}

// Simple chat helpers
function upeAppendMessage(msg) {
    try {
        const box = document.getElementById('upe-messages');
        if (!box) return;
        const div = document.createElement('div');
        
        // Handle system messages differently
        if (msg.type === 'system') {
            div.className = 'msg system-msg';
            const text = document.createElement('span');
            text.textContent = msg.text || '';
            div.appendChild(text);
        } else {
            div.className = 'msg';
            const from = document.createElement('span');
            from.className = 'from';
            from.textContent = getDisplayName(msg.from, msg.displayName) + ':';
            const text = document.createElement('span');
            text.textContent = ' ' + (msg.text || '');
            div.appendChild(from);
            div.appendChild(text);
        }
        
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
            const payload = { 
                text,
                displayName: displayName || 'You'
            };
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
const pendingCalls = []; // Queue for calls that arrive before stream is ready

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
        if (!upeLocalStream) { 
            console.warn('[UPE] local stream not ready, queuing call from', call.peer);
            pendingCalls.push(call);
            
            // Set a timeout to prevent infinite queuing
            setTimeout(() => {
                const index = pendingCalls.indexOf(call);
                if (index > -1) {
                    console.warn('[UPE] Removing timed out call from', call.peer);
                    pendingCalls.splice(index, 1);
                }
            }, 30000); // 30 second timeout
            
            return; 
        }
        answerCall(call);
    });

    return upePeer;
}

function answerCall(call) {
    if (!upeLocalStream) {
        console.warn('[UPE] Cannot answer call - no local stream');
        return;
    }
    
    console.log('[UPE] Answering call from', call.peer);
    call.answer(upeLocalStream);
    call.on('stream', (s) => upeAttachRemote(s, call.peer));
    call.on('close', () => {
        console.log('[UPE] call closed', call.peer);
        if (upePeers[call.peer]) {
            delete upePeers[call.peer];
        }
    });
    upePeers[call.peer] = call;
}

function ensureLocalStream() {
    if (upeLocalStream) return Promise.resolve(upeLocalStream);
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        upeLocalStream = stream;
        const lv = document.getElementById('upe-local');
        if (lv) { lv.srcObject = stream; lv.addEventListener('loadedmetadata', () => lv.play()); }
        
        // Update mute button states
        updateMuteButtonStates();
        
        // Answer any pending calls now that stream is ready
        while (pendingCalls.length > 0) {
            const call = pendingCalls.shift();
            console.log('[UPE] Answering queued call from', call.peer);
            answerCall(call);
        }
        
        return stream;
    }).catch((error) => {
        console.error('[UPE] Failed to get user media:', error);
        throw error;
    });
}

// Check stream status for debugging
function checkStreamStatus() {
    console.log('[UPE] Stream status check:');
    console.log('- Local stream exists:', !!upeLocalStream);
    if (upeLocalStream) {
        const audioTracks = upeLocalStream.getAudioTracks();
        const videoTracks = upeLocalStream.getVideoTracks();
        console.log('- Audio tracks:', audioTracks.length);
        console.log('- Video tracks:', videoTracks.length);
        console.log('- Audio enabled:', audioTracks.length > 0 ? audioTracks[0].enabled : 'N/A');
        console.log('- Video enabled:', videoTracks.length > 0 ? videoTracks[0].enabled : 'N/A');
    }
    console.log('- Pending calls:', pendingCalls.length);
    console.log('- Active peers:', Object.keys(upePeers).length);
}

// Update mute button states based on current stream state
function updateMuteButtonStates() {
    if (!upeLocalStream) return;
    
    const audioTracks = upeLocalStream.getAudioTracks();
    const videoTracks = upeLocalStream.getVideoTracks();
    
    // Update audio button
    if (audioTracks.length > 0) {
        const audioBtn = document.getElementById('upe-mute-audio');
        if (audioBtn) {
            const icon = audioBtn.querySelector('.icon');
            const text = audioBtn.querySelector('.text');
            
            if (audioTracks[0].enabled) {
                icon.textContent = '🔊';
                text.textContent = 'Mute';
                audioBtn.title = 'Mute Audio';
                audioBtn.classList.remove('muted');
            } else {
                icon.textContent = '🔇';
                text.textContent = 'Unmute';
                audioBtn.title = 'Unmute Audio';
                audioBtn.classList.add('muted');
            }
        }
    }
    
    // Update video button
    if (videoTracks.length > 0) {
        const videoBtn = document.getElementById('upe-mute-video');
        if (videoBtn) {
            const icon = videoBtn.querySelector('.icon');
            const text = videoBtn.querySelector('.text');
            
            if (videoTracks[0].enabled) {
                icon.textContent = '📹';
                text.textContent = 'Video';
                videoBtn.title = 'Mute Video';
                videoBtn.classList.remove('muted');
            } else {
                icon.textContent = '🚫';
                text.textContent = 'Show';
                videoBtn.title = 'Show Video';
                videoBtn.classList.add('muted');
            }
        }
    }
}

function upeConnectTo(uid) {
    console.log('[UPE] Connecting to user:', uid);
    ensureLocalStream().then((stream) => {
        console.log('[UPE] Local stream ready, calling user:', uid);
        const call = ensurePeer().call(uid, stream);
        call.on('stream', (s) => {
            console.log('[UPE] Received stream from:', uid);
            upeAttachRemote(s, uid);
        });
        call.on('close', () => {
            console.log('[UPE] outbound call closed', uid);
            if (upePeers[uid]) {
                delete upePeers[uid];
            }
        });
        call.on('error', (error) => {
            console.error('[UPE] Call error with', uid, ':', error);
        });
        upePeers[uid] = call;
    }).catch((error) => {
        console.error('[UPE] Failed to connect to', uid, ':', error);
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
// Toggle audio mute
function toggleAudioMute() {
    if (!upeLocalStream) return;
    
    const audioTracks = upeLocalStream.getAudioTracks();
    if (audioTracks.length > 0) {
        const isMuted = audioTracks[0].enabled;
        audioTracks[0].enabled = !isMuted;
        
        const btn = document.getElementById('upe-mute-audio');
        const icon = btn.querySelector('.icon');
        const text = btn.querySelector('.text');
        
        if (isMuted) {
            icon.textContent = '🔇';
            text.textContent = 'Unmute';
            btn.title = 'Unmute Audio';
            btn.classList.add('muted');
        } else {
            icon.textContent = '🔊';
            text.textContent = 'Mute';
            btn.title = 'Mute Audio';
            btn.classList.remove('muted');
        }
        
        console.log('Audio', isMuted ? 'muted' : 'unmuted');
    }
}

// Toggle video mute
function toggleVideoMute() {
    if (!upeLocalStream) return;
    
    const videoTracks = upeLocalStream.getVideoTracks();
    if (videoTracks.length > 0) {
        const isMuted = videoTracks[0].enabled;
        videoTracks[0].enabled = !isMuted;
        
        const btn = document.getElementById('upe-mute-video');
        const icon = btn.querySelector('.icon');
        const text = btn.querySelector('.text');
        
        if (isMuted) {
            icon.textContent = '🚫';
            text.textContent = 'Show';
            btn.title = 'Show Video';
            btn.classList.add('muted');
        } else {
            icon.textContent = '📹';
            text.textContent = 'Video';
            btn.title = 'Mute Video';
            btn.classList.remove('muted');
        }
        
        console.log('Video', isMuted ? 'muted' : 'unmuted');
    }
}

// Ensure sidebar and peer are ready when room is set
function ensureOverlayReady() {
    console.log('[UPE] Ensuring overlay is ready...');
    ensureSidebar();
    overlayActive = true;
    ensureSocket();
    setupChat();
    ensurePeer();
    
    // Ensure local stream is ready before proceeding
    ensureLocalStream().then(() => {
        console.log('[UPE] Overlay ready with local stream');
    }).catch((error) => {
        console.error('[UPE] Failed to initialize overlay:', error);
    });
}

// Smart activation: do not auto-show overlay on room set anymore
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.roomId) roomId = changes.roomId.newValue;
    if (changes.peerId) peerId = changes.peerId.newValue;
    // Overlay will appear when playback starts via setupVideoListeners()
});

