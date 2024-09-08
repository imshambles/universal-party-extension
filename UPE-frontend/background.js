// background.js

// Log when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('Party Extension installed or updated');
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);

  if (message.type === 'video-chat') {
    console.log('Opening video chat window');
    chrome.windows.create({
      url: `video-chat.html?roomId=${encodeURIComponent(message.roomId)}&peerId=${encodeURIComponent(message.peerId)}`,
      type: 'popup',
      width: 400,
      height: 500
    }, (window) => {
      if (chrome.runtime.lastError) {
        console.error('Error opening window:', chrome.runtime.lastError);
      } else {
        console.log('Video chat window opened successfully');
      }
    });
  }

  // Always return true if you want to send a response asynchronously
  return true;
});

// Keep the service worker alive
chrome.runtime.onConnect.addListener(function(port) {
  port.onDisconnect.addListener(function() {
    chrome.runtime.reload();
  });
});