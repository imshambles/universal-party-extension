// Debug script for video sync testing
console.log('=== UPE Debug Script Loaded ===');

// Function to test video sync manually
function testVideoSync() {
    console.log('Testing video sync...');
    
    // Check if we have room and peer IDs
    chrome.storage.local.get(['roomId', 'peerId', 'partyActive'], (result) => {
        console.log('Current storage state:', result);
        
        if (!result.roomId || !result.peerId) {
            console.error('No room or peer ID found. Please start a party first.');
            return;
        }
        
        // Find video element
        const video = document.querySelector('video');
        if (!video) {
            console.error('No video element found on page');
            return;
        }
        
        console.log('Video element found:', video);
        console.log('Video state:', {
            currentTime: video.currentTime,
            duration: video.duration,
            paused: video.paused,
            readyState: video.readyState
        });
        
        // Test play/pause
        if (video.paused) {
            console.log('Testing play...');
            video.play().then(() => {
                console.log('Play successful');
            }).catch(err => {
                console.error('Play failed:', err);
            });
        } else {
            console.log('Testing pause...');
            video.pause();
        }
    });
}

// Function to manually join a room
function joinRoom(roomId, peerId) {
    console.log('Manually joining room:', roomId, 'with peer:', peerId);
    
    chrome.storage.local.set({
        roomId: roomId,
        peerId: peerId,
        partyActive: true
    }, () => {
        console.log('Room joined successfully');
        // Reload the page to trigger the content script
        window.location.reload();
    });
}

// Function to check socket connection
function checkSocketConnection() {
    // This will be available if the content script is loaded
    if (typeof io !== 'undefined') {
        console.log('Socket.IO is available');
        const socket = io('https://universal-party-extension.onrender.com');
        socket.on('connect', () => {
            console.log('Socket connected successfully');
        });
        socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
        });
    } else {
        console.error('Socket.IO not available');
    }
}

// Add debug functions to window
window.UPEDebug = {
    testVideoSync,
    joinRoom,
    checkSocketConnection
};

console.log('Debug functions available:');
console.log('- UPEDebug.testVideoSync() - Test video sync');
console.log('- UPEDebug.joinRoom(roomId, peerId) - Manually join a room');
console.log('- UPEDebug.checkSocketConnection() - Check socket connection');

// Auto-run some checks
setTimeout(() => {
    console.log('=== Auto-running debug checks ===');
    checkSocketConnection();
    
    chrome.storage.local.get(['roomId', 'peerId', 'partyActive'], (result) => {
        console.log('Current room state:', result);
    });
}, 1000);
