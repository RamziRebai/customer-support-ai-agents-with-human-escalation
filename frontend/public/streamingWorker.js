// Simple Web Worker for character-by-character streaming
// This worker runs in a separate thread, allowing streaming to continue
// even if the main browser tab is inactive or in the background.

self.onmessage = function(e) {
  const { messageId, fullText, speed } = e.data;
  let index = 0;
  
  const intervalId = setInterval(() => {
    if (index < fullText.length) {
      self.postMessage({
        type: 'update',
        messageId,
        contentPart: fullText.substring(0, index + 1),
      });
      index++;
    } else {
      clearInterval(intervalId);
      self.postMessage({
        type: 'done',
        messageId,
        fullText, // Send full text on done to ensure consistency
      });
    }
  }, speed || 50); // Default speed if not provided
};
