'use strict';

/* SSE writes with backpressure: a client that cannot keep up (slow mobile link, suspended tab) must not make the server buffer
 * every quote for it. Past `maxBuffered` queued bytes the connection is dropped; the browser's EventSource reconnects
 * and resumes from the current state, which is what a market feed wants. Returns true when the chunk was queued. */
const MAX_BUFFERED = 512 * 1024;

function sseWrite(response, chunk, maxBuffered = MAX_BUFFERED) {
  try {
    if (!response || response.destroyed || response.writableEnded) return false;
    if (Number(response.writableLength) > maxBuffered) { response.destroy(); return false; }
    response.write(chunk);
    return true;
  } catch (_) { return false; }
}

function sseEvent(response, event, data, maxBuffered) {
  return sseWrite(response, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, maxBuffered);
}

module.exports = { sseWrite, sseEvent, MAX_BUFFERED };
