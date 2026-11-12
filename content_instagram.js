/**
 * Auto Attendance - Instagram Content Script
 * 1. Shows on-screen floating monitoring status badge (🟢 Active / ⚪ Inactive)
 * 2. Accurately extracts the real group chat title (e.g. "จักรพรรดิ CEM2 ECNเท่านั้น", "T x CP")
 * 3. ONLY triggers on genuinely NEW incoming messages while monitoring is active!
 */

(function () {
  'use strict';

  // Prevent multiple content script instances from running concurrently in the same tab
  if (typeof window !== 'undefined') {
    if (window.__autoAttendanceActive) {
      console.log('[AutoAttendance IG] Already active in this tab, skipping duplicate initialization.');
      return;
    }
    window.__autoAttendanceActive = true;
  }

  console.log('[AutoAttendance IG] Content script active on Instagram');

  // Permanent Set: Once a link or image is seen/opened, it is NEVER re-opened automatically!
  const processed = new Set();
  let isMonitoringActive = false;
  let observer = null;

  // Cleanup handler for script unmount or context invalidation
  window.__autoAttendanceCleanup = function () {
    try {
      if (observer) observer.disconnect();
    } catch (e) {}
    const badge = document.getElementById('auto-attendance-floating-badge');
    if (badge) badge.remove();
    window.__autoAttendanceActive = false;
  };

  // Infallible check: detects when extension was reloaded in developer mode
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // Safe message sending: if extension context was invalidated, cleanly kill the observer
  function safeSendMessage(msg, callback) {
    try {
      if (!isExtensionValid()) {
        if (window.__autoAttendanceCleanup) window.__autoAttendanceCleanup();
        return;
      }
      chrome.runtime.sendMessage(msg, (res) => {
        try {
          if (chrome.runtime && chrome.runtime.lastError) return;
          if (callback) callback(res);
        } catch (e) {}
      });
    } catch (e) {
      // Context was invalidated - disconnect observer so orphaned script goes completely silent
      if (window.__autoAttendanceCleanup) window.__autoAttendanceCleanup();
    }
  }

  function getThreadIdFromUrl() {
    const match = window.location.pathname.match(/\/direct\/t\/([0-9a-zA-Z_-]+)/);
    return match ? match[1] : '';
  }

  // Extract the REAL chat title (e.g. "จักรพรรดิ CEM2 ECNเท่านั้น", "T x CP")
  function getGroupTitle() {
    const threadId = getThreadIdFromUrl();

    // Strategy 1: Find Call / Details icons in the top bar and find sibling title
    const callOrDetailsIcon = document.querySelector(
      'svg[aria-label*="Conversation"], svg[aria-label*="Details"], svg[aria-label*="Audio"], svg[aria-label*="Video"], svg[aria-label*="Call"], a[href$="/details/"], a[href*="/details"]'
    );
    if (callOrDetailsIcon) {
      let container = callOrDetailsIcon.parentElement;
      for (let i = 0; i < 7; i++) {
        if (!container || container === document.body) break;
        const candidates = container.querySelectorAll('span[dir="auto"], div[dir="auto"], h1, h2, span');
        for (const el of candidates) {
          const txt = (el.innerText || el.textContent || '').trim();
          if (
            txt &&
            !txt.startsWith('Active') &&
            !txt.startsWith('Seen') &&
            !txt.includes('•') &&
            !txt.startsWith('อาจารย์ชื่อ') &&
            txt !== 'Instagram' &&
            txt !== 'Messages' &&
            txt !== 'Chats' &&
            txt !== 'Direct' &&
            txt.length > 0 &&
            txt.length < 60
          ) {
            return txt;
          }
        }
        container = container.parentElement;
      }
    }

    // Strategy 2: Bounding Box - Top header row in the conversation view (top < 120px, left > 220px)
    const topElements = document.querySelectorAll('span[dir="auto"], div[dir="auto"], h1, h2');
    for (const el of topElements) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 120 && rect.left > 220) {
        const txt = (el.innerText || el.textContent || '').trim();
        if (
          txt &&
          !txt.startsWith('Active') &&
          !txt.startsWith('Seen') &&
          !txt.includes('•') &&
          !txt.startsWith('อาจารย์ชื่อ') &&
          txt !== 'Instagram' &&
          txt !== 'Messages' &&
          txt !== 'Chats' &&
          txt !== 'Direct' &&
          txt.length > 0 &&
          txt.length < 60
        ) {
          return txt;
        }
      }
    }

    // Strategy 3: Left sidebar link matching current thread ID
    if (threadId) {
      const activeLink = document.querySelector(`a[href*="${threadId}"]`);
      if (activeLink) {
        const img = activeLink.querySelector('img[alt]');
        if (img) {
          let alt = (img.getAttribute('alt') || '').trim();
          alt = alt.replace(/'s profile picture.*/i, '').replace(/profile picture.*/i, '').trim();
          if (alt && alt !== 'Instagram' && alt.length < 60) {
            return alt;
          }
        }

        const textNodes = activeLink.querySelectorAll('span[dir="auto"], div[dir="auto"], span');
        for (const n of textNodes) {
          const txt = (n.innerText || n.textContent || '').trim();
          if (
            txt &&
            !txt.includes('·') &&
            !txt.includes(':') &&
            !txt.startsWith('Active') &&
            txt !== 'Instagram' &&
            txt !== 'Messages' &&
            txt.length > 0 &&
            txt.length < 60
          ) {
            return txt;
          }
        }
      }
    }

    // Strategy 4: Document title cleanup
    const docTitle = document.title || '';
    const cleaned = docTitle.replace(/\s*•\s*(Direct|Chats|Messages|Instagram).*/i, '').trim();
    if (cleaned && cleaned !== 'Instagram' && cleaned !== 'Messages' && cleaned !== 'Chats') {
      return cleaned;
    }

    return threadId ? `Chat #${threadId.slice(-6)}` : 'Instagram Chat';
  }

  // Automatically detect and cache the real group title to chrome.storage.local
  let cacheTimer = null;
  function autoCacheChatTitle() {
    try {
      const threadId = getThreadIdFromUrl();
      if (!threadId) return;
      const title = getGroupTitle();
      if (title && title !== 'Instagram' && title !== 'Messages' && !title.startsWith('Chat #') && title !== 'Instagram Chat') {
        if (chrome.storage?.local) {
          chrome.storage.local.get(['cachedChatTitles'], (data) => {
            const cached = (data && data.cachedChatTitles) || {};
            if (cached[threadId] !== title) {
              cached[threadId] = title;
              chrome.storage.local.set({ cachedChatTitles: cached });
            }
          });
        }
      }
    } catch (e) {}
  }

  // Remove any legacy in-page floating badges from DOM
  function removeLegacyBadge() {
    try {
      const badge = document.getElementById('auto-attendance-pill') || document.getElementById('auto-attendance-floating-badge');
      if (badge) badge.remove();
    } catch (e) {}
  }

  function extractCoursevilleUrl(str) {
    if (!str || !str.includes('mycourseville.com')) return null;

    let target = str.replace(/&amp;/g, '&');

    // Handle Instagram redirect wrappers: l.instagram.com/?u=...
    if (target.includes('l.instagram.com') || target.includes('/?u=')) {
      const matchU = target.match(/[?&]u=([^&\s"'>]+)/);
      if (matchU) target = decodeURIComponent(matchU[1]);
    }

    // Match valid URL ASCII characters (avoids grabbing trailing Thai words or punctuation attached without spaces)
    const m = target.match(/(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)*mycourseville\.com[a-zA-Z0-9_\/?=&%.:#~+-]*/i);
    if (m) {
      let url = m[0].replace(/[.,;:!?)\]>]+$/, '');
      if (!url.startsWith('http')) url = 'https://' + url;

      // Fully decode URL components so %2F becomes / (normalizes encoded slashes)
      try {
        let prev = '';
        for (let i = 0; i < 3; i++) {
          if (prev === url) break;
          prev = url;
          url = decodeURIComponent(url);
        }
      } catch (e) {}

      // Reject bare root domain from link preview cards (e.g. "https://mycourseville.com", "https://www.mycourseville.com/")
      if (/^https?:\/\/(?:www\.)?mycourseville\.com\/?$/i.test(url)) {
        return null;
      }

      // Require actual attendance / course check-in parameters
      if (!url.includes('attendance') && !url.includes('courseville') && !url.includes('course/')) {
        return null;
      }

      return url;
    }
    return null;
  }

  // Extract candidate image URLs from a node (including forwarded cards & srcset)
  function extractImageUrls(node) {
    const urls = [];

    const imgs = node.querySelectorAll ? Array.from(node.querySelectorAll('img')) : [];
    if (node.tagName === 'IMG') imgs.push(node);

    for (const img of imgs) {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      if (alt.includes('profile picture') || alt.includes('avatar')) continue;

      let bestUrl = '';
      const srcset = img.getAttribute('srcset') || img.srcset || '';
      if (srcset) {
        const parts = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
        if (parts.length > 0) bestUrl = parts[parts.length - 1];
      }

      if (!bestUrl) {
        bestUrl = img.currentSrc || img.getAttribute('src') || img.src || '';
      }

      if (bestUrl && !bestUrl.startsWith('data:') && bestUrl.length > 15) {
        urls.push(bestUrl);
      }
    }

    const bgElements = node.querySelectorAll ? Array.from(node.querySelectorAll('[style*="background-image"], [style*="background:"]')) : [];
    if (node.style && (node.style.backgroundImage || node.style.background)) {
      bgElements.push(node);
    }

    for (const el of bgElements) {
      const style = el.getAttribute('style') || '';
      const match = style.match(/url\(['"]?([^'")]+)['"]?\)/i);
      if (match && match[1] && !match[1].startsWith('data:') && match[1].length > 15) {
        urls.push(match[1]);
      }
    }

    return urls;
  }

  // Handle a newly arrived DOM node
  function handleNode(rawNode) {
    // STRICT RULE: If extension context is dead or monitoring is NOT active, DO NOTHING!
    if (!isExtensionValid() || !isMonitoringActive) return;
    if (!rawNode) return;

    // Support both Element nodes and Text nodes
    const node = rawNode.nodeType === Node.TEXT_NODE ? rawNode.parentElement : rawNode;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    // 1. Check anchor tags in this new node
    const links = node.querySelectorAll ? Array.from(node.querySelectorAll('a[href]')) : [];
    if (node.tagName === 'A') links.push(node);

    for (const a of links) {
      const href = a.getAttribute('href') || a.href || '';
      const text = a.innerText || a.textContent || '';
      const url = extractCoursevilleUrl(href) || extractCoursevilleUrl(text);
      if (url && !processed.has(url)) {
        processed.add(url);
        const group = getGroupTitle();
        console.log('[AutoAttendance] New link in chat:', url, 'from group:', group);
        safeSendMessage({ type: 'FOUND_LINK', url, groupTitle: group });
        return;
      }
    }

    // 2. Check text in message bubble (handles plain text & forwarded text bubbles)
    const textContent = node.innerText || node.textContent || '';
    if (textContent.includes('mycourseville.com')) {
      const url = extractCoursevilleUrl(textContent);
      if (url && !processed.has(url)) {
        processed.add(url);
        const group = getGroupTitle();
        console.log('[AutoAttendance] New link in text:', url, 'from group:', group);
        safeSendMessage({ type: 'FOUND_LINK', url, groupTitle: group });
        return;
      }
    }

    // 3. Check photos in this new node for QR code (handles forwarded photos)
    const imageUrls = extractImageUrls(node);
    for (const src of imageUrls) {
      if (processed.has(src)) continue;
      processed.add(src);

      const group = getGroupTitle();
      console.log('[AutoAttendance] New photo in chat, scanning for QR code:', src.slice(0, 80));
      safeSendMessage({
        type: 'SCAN_IMAGE_FOR_QR',
        imageUrl: src,
        groupTitle: group
      });
    }
  }

  // Absorb a single DOM node into processed quietly (used when idle to seed incoming history)
  function seedNode(rawNode) {
    if (!rawNode) return;
    const node = rawNode.nodeType === Node.TEXT_NODE ? rawNode.parentElement : rawNode;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    const links = node.querySelectorAll ? Array.from(node.querySelectorAll('a[href]')) : [];
    if (node.tagName === 'A') links.push(node);
    for (const a of links) {
      const u = extractCoursevilleUrl(a.getAttribute('href') || '') || extractCoursevilleUrl(a.textContent || '');
      if (u) processed.add(u);
    }

    const text = node.innerText || node.textContent || '';
    if (text.includes('mycourseville.com')) {
      const u = extractCoursevilleUrl(text);
      if (u) processed.add(u);
    }

    const imgs = extractImageUrls(node);
    for (const src of imgs) {
      processed.add(src);
    }
  }

  // Pre-seed already existing messages so old history is NEVER opened!
  function preSeedExistingMessages() {
    if (!isExtensionValid()) return;
    const mainArea = document.querySelector('div[role="main"]') || document.body;

    // 1. Mark existing links as already processed
    const links = mainArea.querySelectorAll('a[href]');
    for (const a of links) {
      const u = extractCoursevilleUrl(a.getAttribute('href') || '') || extractCoursevilleUrl(a.textContent || '');
      if (u) processed.add(u);
    }

    // 2. Mark plain text messages containing mycourseville.com as processed
    const textEls = mainArea.querySelectorAll('span, div, p');
    for (const el of textEls) {
      if (el.children.length === 0 && el.textContent && el.textContent.includes('mycourseville.com')) {
        const u = extractCoursevilleUrl(el.textContent);
        if (u) processed.add(u);
      }
    }

    // 3. Mark existing images as processed
    const imgs = mainArea.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.currentSrc || img.src;
      if (src) processed.add(src);
      const srcset = img.getAttribute('srcset') || img.srcset;
      if (srcset) {
        const parts = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
        for (const p of parts) processed.add(p);
      }
    }

    // 4. Mark background-image elements as processed
    const bgEls = mainArea.querySelectorAll('[style*="background-image"], [style*="background:"]');
    for (const el of bgEls) {
      const style = el.getAttribute('style') || '';
      const m = style.match(/url\(['"]?([^'")]+)['"]?\)/i);
      if (m && m[1]) processed.add(m[1]);
    }

    console.log('[AutoAttendance] Pre-seeded existing messages. Known items in memory:', processed.size);
  }

  // Observe DOM for NEW incoming messages ONLY
  observer = new MutationObserver((mutations) => {
    if (!isExtensionValid()) {
      if (window.__autoAttendanceCleanup) window.__autoAttendanceCleanup();
      return;
    }

    // When idle (monitoring inactive), quietly absorb loaded history into processed so it never triggers
    if (!isMonitoringActive) {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const added of m.addedNodes) {
            seedNode(added);
          }
        }
      }
      return;
    }

    // When monitoring is ACTIVE: inspect newly arrived nodes
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const added of m.addedNodes) {
          handleNode(added);
        }
      } else if (m.type === 'attributes') {
        handleNode(m.target);
      }
    }
  });

  // Initialize DOM observation and badges as soon as document.body is available
  function initDom() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDom, { once: true });
      } else {
        setTimeout(initDom, 50);
      }
      return;
    }

    try {
      // Always observe document.body directly: React dynamically unmounts and remounts div[role="main"] on refresh!
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'style', 'href']
      });

      // Pre-seed on initial load
      preSeedExistingMessages();
      removeLegacyBadge();
      autoCacheChatTitle();
      // Secondary check after React finishes rendering top header
      setTimeout(autoCacheChatTitle, 800);
      setTimeout(autoCacheChatTitle, 2000);
    } catch (e) {}
  }
  initDom();

  // 1. Sync state immediately from storage (0 ms delay upon page refresh)
  try {
    if (chrome.storage?.local) {
      chrome.storage.local.get(['isActive', 'endTime'], (data) => {
        if (data && data.isActive && data.endTime && Date.now() < data.endTime) {
          isMonitoringActive = true;
        }
      });
    }
    // Real-time sync: when user starts or stops monitoring in popup, sync instantly across all tabs
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && ('isActive' in changes || 'endTime' in changes)) {
          chrome.storage.local.get(['isActive', 'endTime'], (data) => {
            const active = Boolean(data && data.isActive && data.endTime && Date.now() < data.endTime);
            isMonitoringActive = active;
            if (active) {
              preSeedExistingMessages();
            }
          });
        }
      });
    }
  } catch (e) {}

  // 2. Double-check status with service worker
  safeSendMessage({ type: 'GET_STATUS' }, (res) => {
    isMonitoringActive = !!(res && res.active);
    if (isMonitoringActive) {
      preSeedExistingMessages();
    }
  });

  // Listen for broadcast and popup messages
  try {
    // 1. Listen for realtime WebSocket sniffer packets from keep_visible.js (fires even in background tabs!)
    window.addEventListener('message', (event) => {
      if (!isExtensionValid() || !isMonitoringActive) return;
      if (event.source !== window || !event.data || event.data.type !== '__AUTO_ATTENDANCE_RAW_DATA__') return;

      const raw = event.data.payload || '';
      const url = extractCoursevilleUrl(raw);
      if (url && !processed.has(url)) {
        processed.add(url);
        const group = getGroupTitle();
        console.log('[AutoAttendance] New link intercepted via Realtime WebSocket:', url, 'from group:', group);
        safeSendMessage({ type: 'FOUND_LINK', url, groupTitle: group });
      }
    });

    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!isExtensionValid()) return false;

        if (msg.type === 'MONITORING_STATUS_CHANGED') {
          isMonitoringActive = !!msg.active;
          if (isMonitoringActive) {
            // When user starts monitoring, IMMEDIATELY freeze all existing chat messages as old history!
            preSeedExistingMessages();
          }
          sendResponse({ received: true });
          return true;
        }

        if (msg.type === 'GET_CHAT_INFO') {
          const title = getGroupTitle();
          const threadId = getThreadIdFromUrl();
          if (title && threadId && chrome.storage?.local) {
            chrome.storage.local.get(['cachedChatTitles'], (data) => {
              const cached = (data && data.cachedChatTitles) || {};
              cached[threadId] = title;
              chrome.storage.local.set({ cachedChatTitles: cached });
            });
          }
          sendResponse({
            title: title,
            threadId: threadId,
            url: window.location.href
          });
          return true;
        }
      });
    }
  } catch (e) {}
})();
