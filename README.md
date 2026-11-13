# AutoAttendMCV

Cross-platform Chromium extension that monitors Instagram direct messages for MyCourseVille attendance links and QR codes, opening check-in pages automatically. Compatible with any modern Chromium browser (Chrome, Brave, Edge, Arc) on macOS, Windows, and Linux.

## Detection Pipeline

```
                  Incoming Instagram Chat Event
                                |
        +-----------------------+-----------------------+
        |                                               |
  [Text / Link]                                   [Image / Photo]
        |                                               |
+-------+-------+                               Inspect <img>, srcset,
|               |                               & CSS background-image
WebSocket     DOM Mutation                              |
Sniffer       (Text / <a> tags)                 Offscreen Decoding
(0 ms)          |                               - Stage 1: Full-res optimal pass
|               |                               - Stage 2: Quadrant ROI cropping
+-------+-------+                               - Stage 3: Contrast stretching
        |                                       - Stage 4: Unsharp sharpening
        v                                       - Stage 5: Color inversion
URL Extraction & Normalization                  (Engines: BarcodeDetector,
(Unwrap redirect, decode %2F,                    ZXing-JS with HybridBinarizer,
 reject bare root domains)                       and jsQR)
        |                                               |
        +-----------------------+-----------------------+
                                |
                                v
                Session Fingerprinting & Deduplication
                - Key: QR-<courseId>-<sessionId>-<token>
                - Synchronous in-flight lock rejects duplicates
                                |
                                v
                            Execution
                - Opens check-in URL in foreground tab
```

## Features

- Real-time link extraction from text, previews, and forwarded messages.
- Multi-engine offline QR decoder (Chromium BarcodeDetector, ZXing-JS, jsQR).
- Computer vision preprocessing: contrast stretching, unsharp sharpening, inversion, and quadrant ROI crops.
- Background tab visibility spoofing and WebSocket sniffing.
- Session fingerprinting to prevent duplicate tab openings.
- Toolbar icon status badge showing active monitoring countdown.
- Configurable countdown timer with persistent settings.

## Installation

1. Open your browser's extension management page:
   - Google Chrome / Chromium: `chrome://extensions`
   - Brave: `brave://extensions`
   - Microsoft Edge: `edge://extensions`
   - Vivaldi: `vivaldi://extensions`
   - Opera: `opera://extensions`
   - Helium: `helium://extensions`
   - Arc: Extensions > Manage Extensions
2. Enable "Developer mode" (toggle in the top-right or top-left corner).
3. Click "Load unpacked" and select this repository folder.

## Usage

1. Sign in to MyCourseVille in your browser.
2. Open target Instagram chat tabs (`instagram.com/direct/t/...`).
3. Click the extension icon, set your desired monitoring duration (hours : mins : secs), and click "Start Monitoring".
