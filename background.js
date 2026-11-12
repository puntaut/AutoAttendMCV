/**
 * Auto Attendance - Background Service Worker
 * Manages timer, opens attendance links, broadcasts status to tabs, and handles QR decoding.
 * Includes storage persistence so Service Worker hibernation never drops incoming links!
 */

let isActive = false;
let endTime = null;
let remainingSeconds = 0;
let timerInterval = null;
const openedUrls = new Set();

// Ensure state is restored even if Chrome suspended the service worker in the background
async function isMonitoringCurrentlyActive() {
  if (isActive && endTime && Date.now() < endTime) {
    return true;
  }
  const data = await chrome.storage.local.get(['isActive', 'endTime']);
  if (data.isActive && data.endTime && Date.now() < data.endTime) {
    isActive = true;
    endTime = data.endTime;
    return true;
  }
  return false;
}

// Ensure offscreen document exists to decode QR codes from photos (with singleton promise to prevent duplicates)
let creatingOffscreenPromise = null;
async function ensureOffscreen() {
  try {
    if (chrome.offscreen?.hasDocument && (await chrome.offscreen.hasDocument())) {
      return;
    }
  } catch (e) {}

  try {
    if (chrome.runtime?.getContexts) {
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
      });
      if (existing && existing.length > 0) return;
    }
  } catch (e) {}

  if (creatingOffscreenPromise) {
    try {
      await creatingOffscreenPromise;
    } catch (e) {}
    return;
  }

  try {
    creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS', 'DOM_PARSER'],
      justification: 'Decode QR codes from photos'
    });
    await creatingOffscreenPromise;
  } catch (e) {
    // Document was created concurrently or already exists - safe to ignore
  } finally {
    creatingOffscreenPromise = null;
  }
}

// Render the mini green/gray status badge on the extension action icon
function updateActionBadge(active, text) {
  try {
    if (!chrome.action) return;
    if (active) {
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ color: '#ffffff' });
      }
      chrome.action.setBadgeText({ text: text || 'ON' });
      chrome.action.setTitle({ title: 'AutoAttendMCV: ACTIVE (Monitoring Instagram Chats)' });
    } else {
      chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ color: '#ffffff' });
      }
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setTitle({ title: 'AutoAttendMCV: IDLE (Click to start monitoring)' });
    }
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(() => {
  isMonitoringCurrentlyActive().then((active) => {
    updateActionBadge(active);
  }).catch(() => {
    updateActionBadge(false);
  });
});

chrome.runtime.onStartup?.addListener(() => {
  isMonitoringCurrentlyActive().then((active) => {
    updateActionBadge(active);
  }).catch(() => {
    updateActionBadge(false);
  });
});

// Sync action badge immediately on background service worker boot
isMonitoringCurrentlyActive().then((active) => {
  if (active && endTime) {
    const diff = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    const mins = Math.floor(diff / 60);
    updateActionBadge(true, mins > 0 ? `${mins}m` : `${diff}s`);
  } else {
    updateActionBadge(false);
  }
}).catch(() => {
  updateActionBadge(false);
});

// Prevent Chrome from putting monitored Instagram tabs to sleep
async function preventTabsFromSleeping() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.instagram.com/*' });
    for (const tab of tabs) {
      chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
    }
  } catch (e) {}
}

// Broadcast monitoring status to all open Instagram tabs
async function broadcastStatusToTabs(active, seconds) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.instagram.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'MONITORING_STATUS_CHANGED',
        active: active,
        seconds: seconds
      }).catch(() => {});
    }
  } catch (e) {}
}

// Automatically reconnect and sync when an Instagram tab is refreshed
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('instagram.com/direct/')) {
    // Prevent Chromium Memory Saver from discarding monitored chat tabs
    chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

    if (changeInfo.status === 'complete') {
      const active = await isMonitoringCurrentlyActive();
      if (active) {
        // Sync monitoring status to the refreshed tab
        chrome.tabs.sendMessage(tabId, {
          type: 'MONITORING_STATUS_CHANGED',
          active: true,
          seconds: remainingSeconds
        }).catch(() => {});
      }
    }
  }
});

// Clean and unwrap URL if Instagram wrapped it
function cleanUrl(raw) {
  if (!raw) return null;
  let url = raw.trim();

  // Replace HTML entities
  url = url.replace(/&amp;/g, '&');

  // If Instagram wrapped it: l.instagram.com/?u=...
  if (url.includes('l.instagram.com') || url.includes('/?u=')) {
    const match = url.match(/[?&]u=([^&\s"'>]+)/);
    if (match) {
      url = decodeURIComponent(match[1]);
    }
  }

  // Strip trailing punctuation like . , ; !
  url = url.replace(/[.,;:!?)\]>]+$/, '');

  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  if (!url.includes('mycourseville.com')) return null;

  // Fully unquote URL so that %2F is normalized to /
  // Handles differences like:
  // url1: ...?q=courseville/course/85489/attendance_qr_selfcheck/629458/PCCKBCD321
  // url2: ...?q=courseville%2Fcourse%2F85489%2Fattendance_qr_selfcheck%2F629458%2FPCCKBCD321
  try {
    let prev = '';
    for (let i = 0; i < 3; i++) {
      if (prev === url) break;
      prev = url;
      url = decodeURIComponent(url);
    }
  } catch (e) {}

  // Reject bare root domain (e.g. "https://mycourseville.com", "https://www.mycourseville.com/") from link preview cards!
  const isBareDomain = /^https?:\/\/(?:www\.)?mycourseville\.com\/?$/i.test(url);
  if (isBareDomain) {
    console.log('[AutoAttendance] Ignored bare domain preview:', url);
    return null;
  }

  // Must be an actual attendance / course check-in link
  if (!url.includes('attendance') && !url.includes('courseville') && !url.includes('course/')) {
    console.log('[AutoAttendance] Ignored non-attendance link:', url);
    return null;
  }

  return url;
}

// Generate unique session fingerprint to ensure identical tokens never open twice
function getAttendanceFingerprint(url) {
  if (!url) return null;
  // Matches e.g. course/85489/attendance_qr_selfcheck/629458/PCCKBCD321
  const match = url.match(/course\/(\d+)\/attendance_qr_selfcheck\/(\d+)\/([A-Za-z0-9]+)/i);
  if (match) {
    return `QR-${match[1]}-${match[2]}-${match[3]}`.toUpperCase();
  }
  return url.toLowerCase();
}

// In-flight lock and debouncing to prevent concurrent duplicate tab openings
const inFlightUrls = new Set();
const openedFingerprints = new Set();
let lastOpenedTimeMs = 0;
let lastOpenedFingerprint = '';

// Open attendance link in new tab (strictly once per unique link!)
async function openLink(rawUrl, groupTitle = '') {
  const url = cleanUrl(rawUrl);
  if (!url) return false;

  const fingerprint = getAttendanceFingerprint(url);

  // 1. SYNCHRONOUS check: Is this URL or fingerprint already opened or currently in-flight?
  if (openedUrls.has(url) || openedFingerprints.has(fingerprint) || inFlightUrls.has(fingerprint)) {
    console.log('[AutoAttendance] Already opened this attendance link, skipping duplicate:', fingerprint);
    return false;
  }

  // 2. Debounce: If ANY link was opened within the last 3 seconds with the same fingerprint
  const now = Date.now();
  if (fingerprint === lastOpenedFingerprint && (now - lastOpenedTimeMs) < 3000) {
    console.log('[AutoAttendance] Debounced duplicate link within 3s:', fingerprint);
    return false;
  }

  // Lock synchronously BEFORE any async calls!
  inFlightUrls.add(fingerprint);
  openedUrls.add(url);
  openedFingerprints.add(fingerprint);
  lastOpenedTimeMs = now;
  lastOpenedFingerprint = fingerprint;

  try {
    const active = await isMonitoringCurrentlyActive();
    if (!active) {
      console.log('[AutoAttendance] Ignored link because monitoring is not active:', url);
      return false;
    }

    console.log('[AutoAttendance] Opening link in new tab:', url, 'Fingerprint:', fingerprint, 'from group:', groupTitle);

    // Open in new tab in foreground
    chrome.tabs.create({ url: url, active: true });

    // Update popup history
    chrome.storage.local.set({
      lastOpenedUrl: url,
      lastOpenedGroup: groupTitle || 'Instagram Group',
      lastOpenedTime: Date.now()
    });

    return true;
  } finally {
    setTimeout(() => {
      inFlightUrls.delete(fingerprint);
    }, 5000);
  }
}

// Timer tick using wall-clock Date.now() to prevent drift when backgrounded
function startTimer(seconds) {
  isActive = true;
  endTime = Date.now() + (seconds * 1000);
  remainingSeconds = seconds;
  openedUrls.clear();
  openedFingerprints.clear();

  if (timerInterval) clearInterval(timerInterval);

  updateActionBadge(true, 'ON');
  ensureOffscreen();
  preventTabsFromSleeping();
  broadcastStatusToTabs(true, remainingSeconds);

  // Persist state to storage so service worker restarts never forget
  chrome.storage.local.set({ isActive: true, endTime: endTime });

  timerInterval = setInterval(() => {
    const now = Date.now();
    const diff = Math.ceil((endTime - now) / 1000);

    if (diff <= 0) {
      stopTimer();
    } else {
      remainingSeconds = diff;
      const hrs = Math.floor(remainingSeconds / 3600);
      const mins = Math.floor((remainingSeconds % 3600) / 60);
      if (hrs > 0) {
        updateActionBadge(true, `${hrs}h`);
      } else if (mins > 0) {
        updateActionBadge(true, `${mins}m`);
      } else {
        updateActionBadge(true, `${remainingSeconds}s`);
      }

      if (diff % 30 === 0) {
        preventTabsFromSleeping();
      }
    }
  }, 1000);
}

function stopTimer() {
  isActive = false;
  endTime = null;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  updateActionBadge(false);
  chrome.storage.local.set({ isActive: false, endTime: null });
  broadcastStatusToTabs(false, 0);
}

// Listen for messages from content script & popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START') {
    startTimer(msg.seconds || 1800);
    sendResponse({ active: true, seconds: remainingSeconds });
    return true;
  }

  if (msg.type === 'STOP') {
    stopTimer();
    sendResponse({ active: false });
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(['isActive', 'endTime', 'lastOpenedUrl', 'lastOpenedGroup', 'lastOpenedTime'], (data) => {
      let active = !!data.isActive;
      let secs = 0;
      if (data.isActive && data.endTime) {
        const diff = Math.ceil((data.endTime - Date.now()) / 1000);
        if (diff > 0) {
          active = true;
          secs = diff;
        } else {
          active = false;
          stopTimer();
        }
      }
      sendResponse({
        active: active,
        seconds: secs,
        lastOpenedUrl: data.lastOpenedUrl || null,
        lastOpenedGroup: data.lastOpenedGroup || null,
        lastOpenedTime: data.lastOpenedTime || null
      });
    });
    return true;
  }

  if (msg.type === 'FOUND_LINK') {
    openLink(msg.url, msg.groupTitle).then(opened => {
      sendResponse({ opened });
    });
    return true;
  }

  if (msg.type === 'SCAN_IMAGE_FOR_QR') {
    isMonitoringCurrentlyActive().then(active => {
      if (!active) {
        sendResponse({ opened: false });
        return;
      }
      ensureOffscreen().then(() => {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_DECODE', imageUrl: msg.imageUrl }, (res) => {
          if (res && res.url) {
            openLink(res.url, msg.groupTitle);
          }
        });
      });
      sendResponse({ received: true });
    });
    return true;
  }
});
