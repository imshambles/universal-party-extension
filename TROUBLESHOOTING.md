# Video Sync Troubleshooting Guide

## Quick Fixes

### 1. Backend Server Status
The deployed server at `https://universal-party-extension.onrender.com` is working for video calls and chat.

**Note**: The 404 response for the root endpoint is normal for Socket.IO servers.

### 2. Extension Configuration
The extension is configured to use the deployed server:
- Check `contentScript.js` line 20: should be `socket = io('https://universal-party-extension.onrender.com');`

### 3. Invite Link Issues Fixed
- **Timestamp not applied**: Added multiple event listeners (`loadedmetadata`, `canplay`) and periodic checking
- **Sync not working**: Fixed room joining logic and added reconnection attempts
- **Auto-join**: Room now joins immediately when socket connects

## Step-by-Step Debugging

### Step 1: Check Backend Server
```bash
# Test if deployed server is accessible
curl https://universal-party-extension.onrender.com/socket.io/
# Should return: {"code":0,"message":"Transport unknown"}
```

### Step 2: Load Extension
1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `UPE-frontend` folder

### Step 3: Test with Local Page
1. Open `UPE-frontend/test-sync.html` in Chrome (better for sync testing)
2. Open Developer Tools (F12)
3. Check console for extension logs
4. Use "Test Invite Link" button to simulate invite link functionality

### Step 4: Start a Party
1. Click the extension icon
2. Click "Start Party"
3. Check console for logs like:
   - "Party started with roomId: ..."
   - "Connected to Socket.IO server"
   - "Joining room ..."

### Step 5: Test Video Sync
1. Open the test page in two different browser windows/tabs
2. Start a party in both
3. Use the same room ID for both
4. Play/pause video in one window
5. Check if the other window syncs

## Common Issues

### Issue 1: "No room set yet"
**Cause**: Extension popup hasn't been used to create a room
**Solution**: Click extension icon → "Start Party"

### Issue 2: "Socket not connected"
**Cause**: Backend server not accessible or network issues
**Solution**: Check network connection and try refreshing the page

### Issue 3: "No video found"
**Cause**: Content script can't find video element
**Solution**: 
- Make sure you're on a supported site (Netflix, YouTube, etc.)
- Try refreshing the page
- Check if video is loaded

### Issue 4: Video events not firing
**Cause**: Video element not properly detected
**Solution**:
- Check browser console for video detection logs
- Try manually triggering: `UPEDebug.testVideoSync()`

### Issue 5: Invite link timestamp not working
**Cause**: Video not ready when timestamp is applied
**Solution**: 
- Extension now tries multiple times to apply timestamp
- Check console for `[INVITE] Applying start time:` logs
- Video should seek to timestamp when ready

### Issue 6: Sync not working between users
**Cause**: Room not properly joined or socket disconnected
**Solution**:
- Check console for "Joining room" and "Socket connected" logs
- Extension now auto-reconnects and retries failed sync events
- Ensure both users are in the same room

## Debug Commands

In browser console, you can use these debug functions:

```javascript
// Test video sync manually
UPEDebug.testVideoSync()

// Manually join a room
UPEDebug.joinRoom('test-room-123', 'test-peer-456')

// Check socket connection
UPEDebug.checkSocketConnection()
```

## Manual Testing

### Test 1: Basic Video Detection
```javascript
// In browser console
const video = document.querySelector('video');
console.log('Video found:', video);
console.log('Video state:', {
    currentTime: video.currentTime,
    duration: video.duration,
    paused: video.paused
});
```

### Test 2: Socket Connection
```javascript
// In browser console
const socket = io('https://universal-party-extension.onrender.com');
socket.on('connect', () => console.log('Connected!'));
socket.on('connect_error', (err) => console.error('Error:', err));
```

### Test 3: Room Joining
```javascript
// In browser console
chrome.storage.local.set({
    roomId: 'test-room',
    peerId: 'test-peer',
    partyActive: true
}, () => {
    console.log('Room set, reloading...');
    window.location.reload();
});
```

## Expected Console Output

When working correctly, you should see:

```
Connected to Socket.IO server
Room initialized: {roomId: "...", peerId: "...", partyActive: true}
Setting up video listeners for: <video>
Video state: {currentTime: 0, duration: 120, paused: true, readyState: 1}
Auto-joining room on connect: ... ...
Joining room ... with CONTROL ID control-...
[SYNC] Emitting play-video
[SYNC] Received play-video
```

## Still Not Working?

1. **Check Network Tab**: Look for failed requests to `localhost:3000`
2. **Check Console Errors**: Look for JavaScript errors
3. **Try Different Browser**: Test in incognito mode
4. **Check Extension Permissions**: Make sure extension has access to the page
5. **Restart Everything**: Close browser, restart backend, reload extension

## Contact Support

If you're still having issues:
1. Check the browser console for error messages
2. Note the exact steps that aren't working
3. Include any error messages in your report
