/**
 * AutoAttendMCV - Popup Controller
 * Optimized for instant (<5ms) popup opening with optimistic UI hydration,
 * zero-delay tab listing from native tabs.query, and persistent input duration.
 */

document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const countdownDisplay = document.getElementById('countdown-display');
  const timerLabel = document.getElementById('timer-label');
  const inputHr = document.getElementById('input-hr');
  const inputMin = document.getElementById('input-min');
  const inputSec = document.getElementById('input-sec');
  const btnToggle = document.getElementById('btn-toggle');
  const btnIcon = document.getElementById('btn-icon');
  const btnLabel = document.getElementById('btn-label');
  const btnRefreshTabs = document.getElementById('btn-refresh-tabs');
  const groupTabsList = document.getElementById('group-tabs-list');
  const lastOpenedCard = document.getElementById('last-opened-card');
  const lastOpenedTime = document.getElementById('last-opened-time');
  const lastOpenedGroup = document.getElementById('last-opened-group');
  const lastOpenedLink = document.getElementById('last-opened-link');

  let isRunning = false;
  let remainingSeconds = 0;
  let timerInterval = null;

  // Format total seconds into HH:MM:SS
  function formatHMS(totalSec) {
    if (totalSec <= 0) return '00:00:00';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // Get total seconds from inputs
  function getInputsTotalSeconds() {
    const h = Math.max(0, parseInt(inputHr.value, 10) || 0);
    const m = Math.max(0, parseInt(inputMin.value, 10) || 0);
    const s = Math.max(0, parseInt(inputSec.value, 10) || 0);
    return (h * 3600) + (m * 60) + s;
  }

  // Update preview when user changes inputs and remember values
  function updateInputPreview() {
    if (isRunning) return;
    const total = getInputsTotalSeconds();
    countdownDisplay.textContent = formatHMS(total);
    remainingSeconds = total;
    try {
      chrome.storage.local.set({
        savedInputHr: inputHr.value,
        savedInputMin: inputMin.value,
        savedInputSec: inputSec.value
      }).catch(() => {});
    } catch (e) {}
  }

  [inputHr, inputMin, inputSec].forEach(inp => {
    inp.addEventListener('input', updateInputPreview);
  });

  function startLocalCountdown() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      remainingSeconds--;
      if (remainingSeconds <= 0) {
        isRunning = false;
        clearInterval(timerInterval);
      }
      renderState();
    }, 1000);
  }

  // Render UI status
  function renderState() {
    countdownDisplay.textContent = formatHMS(remainingSeconds);
    if (isRunning) {
      statusBadge.className = 'status-badge active';
      statusText.textContent = 'ACTIVE';
      countdownDisplay.className = 'countdown-display active-glow';
      timerLabel.textContent = 'Working Period Remaining';

      btnToggle.className = 'btn btn-danger';
      btnIcon.textContent = '⏹';
      btnLabel.textContent = 'Stop Monitoring';

      inputHr.disabled = true;
      inputMin.disabled = true;
      inputSec.disabled = true;
    } else {
      statusBadge.className = 'status-badge inactive';
      statusText.textContent = 'IDLE';
      countdownDisplay.className = 'countdown-display';
      timerLabel.textContent = 'Selected Working Period';

      btnToggle.className = 'btn btn-primary';
      btnIcon.textContent = '▶';
      btnLabel.textContent = 'Start Monitoring';

      inputHr.disabled = false;
      inputMin.disabled = false;
      inputSec.disabled = false;
    }

    // Update live chat status dots & tags
    const dots = groupTabsList.querySelectorAll('.chat-status-dot');
    dots.forEach(dot => {
      dot.className = `chat-status-dot ${isRunning ? 'active' : 'idle'}`;
      dot.title = isRunning ? 'Actively Monitored' : 'Ready to Monitor';
    });
    const tags = groupTabsList.querySelectorAll('.tab-tag');
    tags.forEach(tag => {
      tag.className = isRunning ? 'tab-tag monitored' : 'tab-tag';
      tag.textContent = isRunning ? 'Monitored' : 'Ready';
    });
  }

  function renderLastOpened(url, group, timeMs) {
    if (!url) {
      lastOpenedCard.style.display = 'none';
      return;
    }
    lastOpenedCard.style.display = 'block';
    lastOpenedGroup.textContent = `From: ${group || 'Instagram Group'}`;
    lastOpenedLink.textContent = url;
    lastOpenedLink.href = url;
    if (timeMs) {
      const d = new Date(timeMs);
      lastOpenedTime.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  // 1. OPTIMISTIC INSTANT HYDRATION FROM STORAGE (0 ms delay upon opening popup)
  chrome.storage.local.get(
    [
      'isActive',
      'endTime',
      'lastOpenedUrl',
      'lastOpenedGroup',
      'lastOpenedTime',
      'savedInputHr',
      'savedInputMin',
      'savedInputSec'
    ],
    (data) => {
      if (data) {
        if (typeof data.savedInputHr !== 'undefined') inputHr.value = data.savedInputHr;
        if (typeof data.savedInputMin !== 'undefined') inputMin.value = data.savedInputMin;
        if (typeof data.savedInputSec !== 'undefined') inputSec.value = data.savedInputSec;
      }

      if (data && data.isActive && data.endTime) {
        const diff = Math.ceil((data.endTime - Date.now()) / 1000);
        if (diff > 0) {
          isRunning = true;
          remainingSeconds = diff;
          renderState();
          startLocalCountdown();
        } else {
          isRunning = false;
          remainingSeconds = getInputsTotalSeconds();
          renderState();
        }
      } else {
        remainingSeconds = getInputsTotalSeconds();
        renderState();
      }

      if (data && data.lastOpenedUrl) {
        renderLastOpened(data.lastOpenedUrl, data.lastOpenedGroup, data.lastOpenedTime);
      }
    }
  );

  // Background verification with service worker (non-blocking)
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    if (res.active) {
      isRunning = true;
      remainingSeconds = res.seconds;
      renderState();
      startLocalCountdown();
    } else if (isRunning && !res.active) {
      isRunning = false;
      if (timerInterval) clearInterval(timerInterval);
      remainingSeconds = getInputsTotalSeconds();
      renderState();
    }

    if (res.lastOpenedUrl) {
      renderLastOpened(res.lastOpenedUrl, res.lastOpenedGroup, res.lastOpenedTime);
    }
  });

  // Clean raw Instagram document title (e.g. "T x CP • Chats • Instagram" -> "T x CP")
  function cleanInstagramDocTitle(title) {
    if (!title) return '';
    let cleaned = title.replace(/\s*•\s*(Direct|Chats|Messages|Instagram).*/i, '').trim();
    cleaned = cleaned.replace(/\s*\(\d+\)\s*/g, '').trim(); // Remove unread count badges e.g. (3)
    if (cleaned === 'Instagram' || cleaned === 'Messages' || cleaned === 'Chats' || cleaned === 'Direct') {
      return '';
    }
    return cleaned;
  }

  // Query open Instagram tabs purely from native browser tab metadata (0 ms, zero IPC delay)
  async function loadInstagramTabs() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.instagram.com/*' });
      const directTabs = tabs.filter(t => t.url && t.url.includes('/direct/'));

      if (directTabs.length === 0) {
        groupTabsList.innerHTML = `
          <div class="empty-state">
            ⚠️ No Instagram Direct tabs detected.<br>
            Please open your Instagram group chats in this browser window.
          </div>
        `;
        return;
      }

      // Read title cache
      let cachedTitles = {};
      try {
        const cacheData = await chrome.storage.local.get(['cachedChatTitles']);
        cachedTitles = (cacheData && cacheData.cachedChatTitles) || {};
      } catch (e) {}

      const tabDetails = directTabs.map((tab, index) => {
        const matchThread = tab.url ? tab.url.match(/\/direct\/t\/([0-9a-zA-Z_-]+)/) : null;
        const threadId = matchThread ? matchThread[1] : '';

        // 1. Instant cache hit
        if (threadId && cachedTitles[threadId]) {
          return { id: tab.id, title: cachedTitles[threadId], url: tab.url };
        }

        // 2. Clean tab title fallback
        let groupTitle = cleanInstagramDocTitle(tab.title);
        if (!groupTitle || groupTitle === 'Instagram' || groupTitle === 'Messages') {
          groupTitle = threadId ? `Chat #${threadId.slice(-6)}` : `Instagram Chat #${index + 1}`;
        }

        return { id: tab.id, title: groupTitle, url: tab.url };
      });

      // Render tab rows with clean circular status dots
      groupTabsList.innerHTML = '';
      tabDetails.forEach((tab) => {
        const row = document.createElement('div');
        row.className = 'group-tab-item';
        const dotState = isRunning ? 'active' : 'idle';
        const tagText = isRunning ? 'Monitored' : 'Ready';
        const tagClass = isRunning ? 'tab-tag monitored' : 'tab-tag';
        const matchThread = tab.url ? tab.url.match(/\/direct\/t\/([0-9a-zA-Z_-]+)/) : null;
        const threadId = matchThread ? matchThread[1] : '';
        row.innerHTML = `
          <span class="chat-status-dot ${dotState}" title="${isRunning ? 'Actively Monitored' : 'Ready to Monitor'}"></span>
          <span class="tab-title" data-tab-id="${tab.id}" data-thread-id="${threadId}" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title)}</span>
          <span class="${tagClass}">${tagText}</span>
        `;
        groupTabsList.appendChild(row);
      });

      // Background query to immediately update any uncached chat name without blocking the popup
      directTabs.forEach((tab) => {
        const matchThread = tab.url ? tab.url.match(/\/direct\/t\/([0-9a-zA-Z_-]+)/) : null;
        const threadId = matchThread ? matchThread[1] : '';
        if (threadId && !cachedTitles[threadId]) {
          chrome.tabs.sendMessage(tab.id, { type: 'GET_CHAT_INFO' }, (res) => {
            if (chrome.runtime.lastError || !res || !res.title) return;
            if (res.title && res.title !== 'Instagram' && res.title !== 'Messages' && !res.title.startsWith('Chat #')) {
              cachedTitles[threadId] = res.title;
              chrome.storage.local.set({ cachedChatTitles: cachedTitles }).catch(() => {});
              const el = groupTabsList.querySelector(`.tab-title[data-tab-id="${tab.id}"]`);
              if (el) el.textContent = res.title;
            }
          });
        }
      });
    } catch (err) {
      console.warn('Could not query tabs:', err);
      groupTabsList.innerHTML = '<div class="empty-state">Could not query Instagram tabs</div>';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Toggle Start / Stop - Instant responsive feedback with zero blocking
  btnToggle.addEventListener('click', () => {
    if (isRunning) {
      isRunning = false;
      if (timerInterval) clearInterval(timerInterval);
      remainingSeconds = getInputsTotalSeconds();
      renderState();
      chrome.runtime.sendMessage({ type: 'STOP' }, () => {
        if (chrome.runtime.lastError) {}
      });
    } else {
      let sec = getInputsTotalSeconds();
      if (sec <= 0) {
        inputHr.value = 1;
        inputMin.value = 0;
        inputSec.value = 0;
        sec = 3600;
        updateInputPreview();
      }
      isRunning = true;
      remainingSeconds = sec;
      renderState();
      startLocalCountdown();
      chrome.runtime.sendMessage({ type: 'START', seconds: sec }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.seconds) {
          remainingSeconds = res.seconds;
          renderState();
        }
      });
    }
  });

  // Refresh tabs list manually
  btnRefreshTabs.addEventListener('click', () => {
    loadInstagramTabs();
  });

  // Initial non-blocking load of open Instagram tabs
  loadInstagramTabs();
});
