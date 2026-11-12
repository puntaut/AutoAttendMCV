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
      reasons: ['BLOBS', 'DOM_PARSER', 'AUDIO_PLAYBACK'],
      justification: 'Decode QR codes from photos and play confirmation chime'
    });
    await creatingOffscreenPromise;
  } catch (e) {
    // Document was created concurrently or already exists - safe to ignore
  } finally {
    creatingOffscreenPromise = null;
  }
}

// Automatically reinject content script into open Instagram tabs when extension boots or updates
async function reinjectOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.instagram.com/*' });
    for (const tab of tabs) {
      if (tab.id && tab.url && tab.url.includes('/direct/')) {
        // Inject keep_visible in MAIN world
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['keep_visible.js'],
          world: 'MAIN'
        }).catch(() => {});

        // Inject content script in ISOLATED world
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content_instagram.js']
        }).catch(() => {});
      }
    }
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(() => {
  reinjectOpenTabs();
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

    // Play cheerful confirmation chime via offscreen Web Audio
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ type: 'PLAY_CHIME' }).catch(() => {});
    }).catch(() => {});

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

  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
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
        chrome.action.setBadgeText({ text: `${hrs}h` });
      } else if (mins > 0) {
        chrome.action.setBadgeText({ text: `${mins}m` });
      } else {
        chrome.action.setBadgeText({ text: `${remainingSeconds}s` });
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
  chrome.action.setBadgeText({ text: '' });
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
