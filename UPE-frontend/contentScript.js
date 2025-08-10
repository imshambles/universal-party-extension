// contentScript.js
// Uses global `io` from libs/socket.io.min.js injected via manifest
let socket;
let roomId;
let peerId;
let initialized = false;
let listenersSetup = false;
let suppressEvents = false;
let currentVideo = null;

function ensureSocket() {
    if (socket && socket.connected) return;
    if (!socket) {
        // Use deployed signaling server
        socket = io('https://universal-party-extension.onrender.com');

        socket.on('connect', () => {
            console.log('Connected to Socket.IO server');
            joinRoom();
        });

        socket.on('connect_error', (error) => {
            console.error('Socket.IO connection error:', error);
        });

        // Receive sync events
        socket.on('play-video', () => {
            const video = document.querySelector('video');
            console.log('[SYNC] Received play-video');
            if (video) {
                suppressEvents = true;
                video.play();
                setTimeout(() => { suppressEvents = false; }, 200);
            }
        });
        socket.on('pause-video', () => {
            const video = document.querySelector('video');
            console.log('[SYNC] Received pause-video');
            if (video) {
                suppressEvents = true;
                video.pause();
                setTimeout(() => { suppressEvents = false; }, 200);
            }
        });
        socket.on('seek-video', (time) => {
            const video = document.querySelector('video');
            console.log('[SYNC] Received seek-video', time);
            if (video && typeof time === 'number') {
                suppressEvents = true;
                video.currentTime = time;
                setTimeout(() => { suppressEvents = false; }, 200);
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

    // Listen for sync events
    socket.on('play-video', () => {
        const video = document.querySelector('video');
        if (video) video.play();
    });

    socket.on('pause-video', () => {
        const video = document.querySelector('video');
        if (video) video.pause();
    });

    socket.on('seek-video', (time) => {
        const video = document.querySelector('video');
        if (video) video.currentTime = time;
    });
}

// Function to join or create a room
function joinRoom() {
    if (roomId && peerId && socket && socket.connected) {
        // Distinguish control sockets so chat clients can ignore these IDs
        const controlId = String(peerId).startsWith('control-') ? String(peerId) : `control-${String(peerId)}`;
        console.log(`Joining room ${roomId} with CONTROL ID ${controlId}`);
        socket.emit('join-room', roomId, controlId);
        setupVideoListeners();
    }
}

// Function to set up video event listeners
function setupVideoListeners() {
    if (listenersSetup) return;
    const video = document.querySelector('video');
    if (video) {
        listenersSetup = true;
        currentVideo = video;
        video.addEventListener('play', () => {
            if (suppressEvents) return;
            console.log('[SYNC] Emitting play-video');
            socket.emit('play-video');
        });

        video.addEventListener('pause', () => {
            if (suppressEvents) return;
            console.log('[SYNC] Emitting pause-video');
            socket.emit('pause-video');
        });

        video.addEventListener('seeked', () => {
            if (suppressEvents) return;
            console.log('[SYNC] Emitting seek-video', video.currentTime);
            socket.emit('seek-video', video.currentTime);
        });
    } else {
        // Retry once if video not found yet
        setTimeout(setupVideoListeners, 1500);
    }
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
        if (url.hash) {
            const hp = new URLSearchParams(url.hash.replace(/^#/, ''));
            fromHash = hp.get('upeRoom');
        }
        const inviteRoom = fromSearch || fromHash;
        if (inviteRoom) {
            roomId = String(inviteRoom);
            peerId = Math.random().toString(36).substring(2, 15);
            chrome.storage.local.set({ roomId, peerId }, () => {
                initializeSocket();
                ensureSocket();
                joinRoom();
            });
        }
    } catch (e) {
        console.warn('Failed to parse invite link', e);
    }
})();

// Main initialization
chrome.storage.local.get(['roomId', 'peerId'], (result) => {
    if (result.roomId && result.peerId) {
        roomId = result.roomId;
        peerId = result.peerId;
        // Set up socket sync listeners and bring up the overlay immediately
        initializeSocket();
        ensureOverlayReady();
    } else {
        // No prompt here; popup drives room creation/joining
        console.log('No room set yet; open the extension popup to create/join a room.');
    }
});

// React to room/peer changes set by the popup
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.roomId) roomId = changes.roomId.newValue;
    if (changes.peerId) peerId = changes.peerId.newValue;
    if (roomId && peerId) {
        initializeSocket();
        ensureSocket();
        joinRoom();
    }
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
    ensureSocket();
    setupChat();
    ensurePeer();
    ensureLocalStream();
}

// When we know room, bring up overlay
if (roomId) ensureOverlayReady();
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.roomId) roomId = changes.roomId.newValue;
    if (changes.peerId) peerId = changes.peerId.newValue;
    if (roomId) ensureOverlayReady();
});

