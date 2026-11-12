/**
 * Auto Attendance - Popup Controller
 * Manages hr:min:sec inputs, tab querying for real group chat names, and timer.
 */

document.addEventListener('DOMContentLoaded', async () => {
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

  // Update preview when user changes inputs
  function updateInputPreview() {
    if (isRunning) return;
    const total = getInputsTotalSeconds();
    countdownDisplay.textContent = formatHMS(total);
    remainingSeconds = total;
  }

  [inputHr, inputMin, inputSec].forEach(inp => {
    inp.addEventListener('input', updateInputPreview);
  });

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
  }

  // Injected directly into Instagram tabs to extract the real group chat name (e.g. "จักรพรรดิ CEM2 ECNเท่านั้น", "T x CP")
  function extractTabGroupName() {
    const matchThread = window.location.pathname.match(/\/direct\/t\/([0-9a-zA-Z_-]+)/);
    const threadId = matchThread ? matchThread[1] : '';

    // Strategy 1: Find Call / Details icons in the top bar and look at sibling text
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

    return '';
  }

  // Query open Instagram tabs and extract real group chat names (e.g. "T x CP")
  async function loadInstagramTabs() {
    groupTabsList.innerHTML = '<div class="loading-text">Querying group names from open tabs...</div>';

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

      // Query real group chat name from each tab using scripting execution
      const tabDetails = await Promise.all(
        directTabs.map(async (tab, index) => {
          let groupTitle = '';

          // 1. Try direct DOM execution via chrome.scripting (works even on tabs open before extension reload)
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: extractTabGroupName
            });
            if (results && results[0] && results[0].result) {
              groupTitle = results[0].result.trim();
            }
          } catch (e) {
            // Scripting might fail if tab restricted
          }

          // 2. Fallback to message passing
          if (!groupTitle) {
            try {
              const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CHAT_INFO' });
              if (res && res.title) {
                groupTitle = res.title.trim();
              }
            } catch (e) {}
          }

          // 3. Clean up generic titles
          if (
            !groupTitle ||
            groupTitle === 'Instagram' ||
            groupTitle === 'Messages' ||
            groupTitle === 'Instagram • Messages'
          ) {
            const matchThread = tab.url ? tab.url.match(/\/direct\/t\/([0-9a-zA-Z_-]+)/) : null;
            groupTitle = matchThread ? `Chat #${matchThread[1].slice(-6)}` : `Instagram Chat #${index + 1}`;
          }

          return {
            id: tab.id,
            title: groupTitle,
            url: tab.url
          };
        })
      );

      // Render tab rows with checkboxes and real group names
      groupTabsList.innerHTML = '';
      tabDetails.forEach((tab) => {
        const row = document.createElement('div');
        row.className = 'group-tab-item';
        row.innerHTML = `
          <input type="checkbox" id="tab-${tab.id}" class="tab-checkbox" data-id="${tab.id}" checked>
          <span class="tab-title" title="${tab.url}">${escapeHtml(tab.title)}</span>
          <span class="tab-tag">Group</span>
        `;
        groupTabsList.appendChild(row);
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

  // Toggle Start / Stop
  btnToggle.addEventListener('click', () => {
    if (isRunning) {
      chrome.runtime.sendMessage({ type: 'STOP' }, () => {
        isRunning = false;
        if (timerInterval) clearInterval(timerInterval);
        remainingSeconds = getInputsTotalSeconds();
        renderState();
      });
    } else {
      const sec = getInputsTotalSeconds();
      if (sec <= 0) {
        alert('Please enter a monitoring duration (e.g. 1 hr or 30 min) before starting!');
        return;
      }
      chrome.runtime.sendMessage({ type: 'START', seconds: sec }, (res) => {
        isRunning = true;
        remainingSeconds = sec;
        renderState();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
          remainingSeconds--;
          if (remainingSeconds <= 0) {
            isRunning = false;
            clearInterval(timerInterval);
          }
          renderState();
        }, 1000);
      });
    }
  });

  // Refresh tabs list
  btnRefreshTabs.addEventListener('click', () => {
    loadInstagramTabs();
  });

  // Query background status on popup open
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (res && res.active) {
      isRunning = true;
      remainingSeconds = res.seconds;
      renderState();
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
          isRunning = false;
          clearInterval(timerInterval);
        }
        renderState();
      }, 1000);
    } else {
      remainingSeconds = getInputsTotalSeconds();
      renderState();
    }

    if (res && res.lastOpenedUrl) {
      lastOpenedCard.style.display = 'block';
      lastOpenedGroup.textContent = `From: ${res.lastOpenedGroup || 'Instagram Group'}`;
      lastOpenedLink.textContent = res.lastOpenedUrl;
      lastOpenedLink.href = res.lastOpenedUrl;
      if (res.lastOpenedTime) {
        const d = new Date(res.lastOpenedTime);
        lastOpenedTime.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
  });

  // Initial load of open Instagram tabs
  await loadInstagramTabs();
});
