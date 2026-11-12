/**
 * Keep Instagram Active & Sniff Realtime WebSockets in Background Tabs
 * Runs in "MAIN" world so it can override Page Visibility API and hook WebSocket
 */
(function () {
  'use strict';

  // 1. Force Page Visibility to report VISIBLE even when tab is in background or minimized
  try {
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true
    });
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true
    });
    Object.defineProperty(document, 'webkitHidden', {
      get: () => false,
      configurable: true
    });
    Object.defineProperty(document, 'webkitVisibilityState', {
      get: () => 'visible',
      configurable: true
    });
  } catch (e) {}

  // 2. Prevent React from pausing DOM updates when tab loses focus
  window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);

  // 3. Hook WebSocket using transparent Proxy to preserve all native static properties (WebSocket.OPEN, etc.)
  if (typeof window.WebSocket !== 'undefined') {
    try {
      window.WebSocket = new Proxy(window.WebSocket, {
        construct(target, args) {
          const ws = new target(...args);
          ws.addEventListener('message', (event) => {
            try {
              let text = '';
              if (typeof event.data === 'string') {
                text = event.data;
              } else if (event.data instanceof ArrayBuffer) {
                text = new TextDecoder('utf-8', { fatal: false }).decode(event.data);
              }
              if (text && text.includes('mycourseville.com')) {
                window.postMessage({
                  type: '__AUTO_ATTENDANCE_RAW_DATA__',
                  payload: text
                }, '*');
              }
            } catch (err) {}
          });
          return ws;
        }
      });
    } catch (e) {}
  }
})();
