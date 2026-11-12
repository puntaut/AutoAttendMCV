# Real-Time Chrome Extension Guidelines & Invariants

Guidelines, architectural invariants, and design decisions for developing, modifying, and debugging the AutoAttendMCV extension.

## 1. Zero-Bloat & Event-Driven Architecture
- **No Polling**: Never introduce `setInterval` or `setTimeout` polling loops in content scripts to scan DOM elements.
- **Pure Event-Driven**: Rely exclusively on native `MutationObserver` for DOM additions and WebSocket message events for network packets.
- **Offline & Lightweight**: Do not add heavy npm libraries, Webpack bundlers, or WebAssembly OCR engines (e.g. Tesseract). Use pure, lightweight offline decoders: native Chromium `BarcodeDetector`, `ZXing-JS` (with `HybridBinarizer` and `TRY_HARDER`), and `jsQR`.
- **Multi-Stage QR Preprocessing**: Always execute multi-stage recovery for slide photos (ROI quadrant crops, contrast stretching, Laplacian sharpening, and color inversion) before giving up on a photo.

## 2. URL Normalization & Semantic Session Fingerprinting
- **Multi-Pass URL Decoding**: Always run iterative `decodeURIComponent` (up to 3 passes) on extracted links to normalize encoded characters (e.g. `%2F` -> `/`).
- **Semantic Session Fingerprinting**: Do not deduplicate using raw URL strings alone. Extract a canonical session fingerprint (e.g. `QR-{courseId}-{sessionId}-{token}`) so minor variations in query string formatting or redirect wrappers resolve to the identical check-in action.
- **Synchronous In-Flight Locking**: Check and lock deduplication sets (`openedUrls`, `openedFingerprints`, `inFlightUrls`) **synchronously at line 1** before executing any `await` or asynchronous operations.
- **Link Preview Rejection**: Filter out bare root domains (e.g. `https://mycourseville.com/` from OpenGraph preview cards); only accept URLs containing valid check-in endpoints and parameters (`attendance`, `courseville`, `course/`).

## 3. Background Tab Visibility & Real-Time Sync
- **Main World Visibility Spoofing**: Keep `world: "MAIN"` scripts (e.g. `keep_visible.js`) active to override `document.visibilityState = 'visible'` and `document.hidden = false`, preventing React from deferring DOM updates in background tabs.
- **Network WebSocket Hooking**: Hook `window.WebSocket` in the page context to intercept raw message payloads immediately when Wi-Fi packets arrive, bypassing DOM render latency.
- **Tab Discard Prevention**: Use `chrome.tabs.update(tab.id, { autoDiscardable: false })` on monitored tabs.

## 4. User Interaction & Operational Rules
- **Full Timer Duration**: Keep monitoring active until the timer naturally counts down to `00:00:00` (do not auto-stop after the first link, allowing for multiple attendance checks in a class session).
- **Target Chat Filtering**: Strictly monitor only the chats selected/checked in the popup `TARGET CHAT` list to prevent false triggers from personal DMs.
- **MyCourseVille Handling**: Keep MyCourseVille interactions minimal: open the check-in URL directly in an active foreground tab without injecting invasive automation scripts.
- **Foreground + Alert**: Keep the opened attendance tab open in the foreground for the user to see, accompanied by an alert chime.

## 5. Lifecycle & Error Prevention
- **Self-Destruction on Context Invalidation**: In content scripts, always guard `chrome.runtime.sendMessage` and mutation handlers with `!chrome.runtime?.id`. If context is invalidated, immediately disconnect observers and unregister listeners to avoid orphan error logs.
- **Single-Instance Tab Guard**: Guard content scripts with a window-level boolean flag (`window.__autoAttendanceActive`) to prevent concurrent instances in the same tab.
- **No Top-Level Re-Injections**: Do not invoke programmatic script injection (`chrome.scripting.executeScript`) on every background service worker wake-up; only execute upon `chrome.runtime.onInstalled`.

## 6. macOS Sleep & Power Pre-requisites
- Keep MacBook connected to power adapter with "Turn display off on power adapter when inactive: Never".
- Turn screen brightness to black (F1 key) rather than closing the lid, avoiding hardware clamshell sleep when no external display is attached.
