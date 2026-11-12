/**
 * AutoAttendMCV - Golden Standard Offline QR Code Scanner
 * Multi-Engine Architecture with Computer Vision Preprocessing & Strategic ROI Multi-Crop.
 *
 * Engines:
 * 1. Native Chromium BarcodeDetector (Hardware-accelerated)
 * 2. ZXing-JS (Google's Zebra Crossing engine with HybridBinarizer & TRY_HARDER)
 * 3. jsQR (Pure JS with normal & inverted scanning)
 *
 * Preprocessing & Fallbacks:
 * - Strategic Quadrant ROI Cropping (recovers small QR codes on giant 4K presentation slides)
 * - Dynamic Range & Contrast Normalization (recovers washed-out projector slides)
 * - Laplacian 3x3 Unsharp Sharpening (recovers blurred/out-of-focus camera photos)
 * - Color Inversion (recovers dark mode slides)
 */

// Helper: Check if string contains a valid MyCourseVille link or check-in token
function isAttendanceResult(text) {
  if (!text || typeof text !== 'string') return false;
  return text.includes('mycourseville.com');
}

// Core Engine Runner on a given HTMLCanvasElement
async function tryEnginesOnCanvas(canvas) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

  // Engine 1: Native Chromium BarcodeDetector (fastest, hardware accelerated)
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(canvas);
      for (const c of codes) {
        if (isAttendanceResult(c.rawValue)) {
          console.log('[AutoAttendMCV] QR decoded via native BarcodeDetector:', c.rawValue);
          return c.rawValue;
        }
      }
    } catch (e) {}
  }

  // Engine 2: ZXing with HybridBinarizer & TRY_HARDER (Industry standard for mobile camera photos)
  if (typeof ZXing !== 'undefined') {
    try {
      const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE]);
      const reader = new ZXing.QRCodeReader();

      // Pass 2A: HybridBinarizer (adaptive 8x8 block thresholding for shadows and glare)
      try {
        const hybridBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
        const res = reader.decode(hybridBitmap, hints);
        if (res && isAttendanceResult(res.getText())) {
          console.log('[AutoAttendMCV] QR decoded via ZXing (HybridBinarizer):', res.getText());
          return res.getText();
        }
      } catch (e) {}

      // Pass 2B: GlobalHistogramBinarizer fallback
      try {
        const globalBitmap = new ZXing.BinaryBitmap(new ZXing.GlobalHistogramBinarizer(source));
        const res = reader.decode(globalBitmap, hints);
        if (res && isAttendanceResult(res.getText())) {
          console.log('[AutoAttendMCV] QR decoded via ZXing (GlobalHistogram):', res.getText());
          return res.getText();
        }
      } catch (e) {}
    } catch (e) {}
  }

  // Engine 3: Bundled jsQR with normal & inverted scan
  if (typeof jsQR === 'function') {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, canvas.width, canvas.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (code && isAttendanceResult(code.data)) {
        console.log('[AutoAttendMCV] QR decoded via jsQR:', code.data);
        return code.data;
      }
    } catch (e) {}
  }

  return null;
}

// Create an optimal scaled canvas from an ImageBitmap
function createScaledCanvas(bitmap, maxDim = 1600) {
  let targetW = bitmap.width;
  let targetH = bitmap.height;

  if (targetW > maxDim || targetH > maxDim) {
    const scale = Math.min(maxDim / targetW, maxDim / targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  return canvas;
}

// Preprocessing 1: Contrast Stretching (Min-Max Normalization for washed-out projector slides)
function applyContrastStretch(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;

    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }

    if (max - min < 25 || (min < 15 && max > 240)) return null; // Already balanced

    const scale = 255 / (max - min);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = canvas.width;
    outCanvas.height = canvas.height;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    const outImg = outCtx.createImageData(canvas.width, canvas.height);
    const od = outImg.data;

    for (let i = 0; i < d.length; i += 4) {
      od[i] = (d[i] - min) * scale;
      od[i + 1] = (d[i + 1] - min) * scale;
      od[i + 2] = (d[i + 2] - min) * scale;
      od[i + 3] = d[i + 3];
    }

    outCtx.putImageData(outImg, 0, 0);
    return outCanvas;
  } catch (e) {
    return null;
  }
}

// Preprocessing 2: 3x3 Laplacian Unsharp Mask Sharpening (for blurry camera photos)
function applySharpen(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const src = imgData.data;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    const outImg = outCtx.createImageData(w, h);
    const dst = outImg.data;

    // Kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const top = ((y - 1) * w + x) * 4 + c;
          const bottom = ((y + 1) * w + x) * 4 + c;
          const left = (y * w + (x - 1)) * 4 + c;
          const right = (y * w + (x + 1)) * 4 + c;
          const val = 5 * src[idx + c] - src[top] - src[bottom] - src[left] - src[right];
          dst[idx + c] = val < 0 ? 0 : (val > 255 ? 255 : val);
        }
        dst[idx + 3] = 255;
      }
    }

    outCtx.putImageData(outImg, 0, 0);
    return outCanvas;
  } catch (e) {
    return null;
  }
}

// Preprocessing 3: Color Inversion (for white-on-dark presentation slides)
function applyInversion(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = canvas.width;
    outCanvas.height = canvas.height;
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    const outImg = outCtx.createImageData(canvas.width, canvas.height);
    const od = outImg.data;

    for (let i = 0; i < d.length; i += 4) {
      od[i] = 255 - d[i];
      od[i + 1] = 255 - d[i + 1];
      od[i + 2] = 255 - d[i + 2];
      od[i + 3] = d[i + 3];
    }

    outCtx.putImageData(outImg, 0, 0);
    return outCanvas;
  } catch (e) {
    return null;
  }
}

// Strategic Region-of-Interest (ROI) Multi-Crop for small QR codes on large presentation slides
function getRoiCanvases(originalBitmap) {
  const w = originalBitmap.width;
  const h = originalBitmap.height;
  if (w < 800 || h < 600) return []; // Small photos don't need ROI crop

  const crops = [
    // 1. Bottom-Right Quadrant (~70% of presentation slides put attendance QR code here)
    { name: 'bottom-right', x: Math.floor(w * 0.35), y: Math.floor(h * 0.35), cw: Math.floor(w * 0.65), ch: Math.floor(h * 0.65) },
    // 2. Center Region
    { name: 'center', x: Math.floor(w * 0.2), y: Math.floor(h * 0.2), cw: Math.floor(w * 0.6), ch: Math.floor(h * 0.6) },
    // 3. Bottom-Left Quadrant
    { name: 'bottom-left', x: 0, y: Math.floor(h * 0.35), cw: Math.floor(w * 0.65), ch: Math.floor(h * 0.65) },
    // 4. Top-Right Quadrant
    { name: 'top-right', x: Math.floor(w * 0.35), y: 0, cw: Math.floor(w * 0.65), ch: Math.floor(h * 0.65) }
  ];

  return crops.map(c => {
    // Cap crop resolution at max 1200px to maintain native module density while staying fast
    const scale = Math.min(1, 1200 / Math.max(c.cw, c.ch));
    const targetW = Math.round(c.cw * scale);
    const targetH = Math.round(c.ch * scale);
    const cvs = document.createElement('canvas');
    cvs.width = targetW;
    cvs.height = targetH;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(originalBitmap, c.x, c.y, c.cw, c.ch, 0, 0, targetW, targetH);
    cvs.dataset.roi = c.name;
    return cvs;
  });
}

/**
 * Main Golden Standard QR Decoder Pipeline
 */
async function decodeQR(imageUrl) {
  try {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    // ============================================================
    // STAGE 1: Standard Full Image Pass (Optimal Resolution <= 1600px)
    // ============================================================
    const mainCanvas = createScaledCanvas(bitmap, 1600);
    let result = await tryEnginesOnCanvas(mainCanvas);
    if (result) return result;

    // ============================================================
    // STAGE 2: Strategic Quadrant ROI Cropping (Small QR on Big Slide)
    // ============================================================
    const roiCanvases = getRoiCanvases(bitmap);
    for (const roiCanvas of roiCanvases) {
      result = await tryEnginesOnCanvas(roiCanvas);
      if (result) {
        console.log(`[AutoAttendMCV] QR found in ROI crop: ${roiCanvas.dataset.roi}`);
        return result;
      }
    }

    // ============================================================
    // STAGE 3: Contrast Stretching (Washed-out / Dim Projector)
    // ============================================================
    const contrastCanvas = applyContrastStretch(mainCanvas);
    if (contrastCanvas) {
      result = await tryEnginesOnCanvas(contrastCanvas);
      if (result) {
        console.log('[AutoAttendMCV] QR found after contrast stretch enhancement');
        return result;
      }
    }

    // ============================================================
    // STAGE 4: Laplacian Sharpening (Out-of-Focus / Lens Blur)
    // ============================================================
    const sharpCanvas = applySharpen(mainCanvas);
    if (sharpCanvas) {
      result = await tryEnginesOnCanvas(sharpCanvas);
      if (result) {
        console.log('[AutoAttendMCV] QR found after unsharp mask sharpening');
        return result;
      }
    }

    // ============================================================
    // STAGE 5: Color Inversion (White-on-Dark Presentation Slides)
    // ============================================================
    const invertedCanvas = applyInversion(mainCanvas);
    if (invertedCanvas) {
      result = await tryEnginesOnCanvas(invertedCanvas);
      if (result) {
        console.log('[AutoAttendMCV] QR found after color inversion');
        return result;
      }
    }

    // ============================================================
    // STAGE 6: High-Resolution Native Retry (Full Unscaled Bitmap)
    // ============================================================
    if (bitmap.width !== mainCanvas.width || bitmap.height !== mainCanvas.height) {
      const fullCanvas = createScaledCanvas(bitmap, Math.max(bitmap.width, bitmap.height));
      result = await tryEnginesOnCanvas(fullCanvas);
      if (result) {
        console.log('[AutoAttendMCV] QR found on full-resolution unscaled canvas');
        return result;
      }
    }
  } catch (err) {
    console.warn('[AutoAttendMCV] QR decode error:', err);
  }

  return null;
}

// Synthesize pleasant confirmation chime (E5 -> B5 chord, 0 KB, pure Web Audio)
function playSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Note 1: E5 (659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Note 2: B5 (987.77 Hz) - cheerful confirmation tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, now + 0.12);
    gain2.gain.setValueAtTime(0.22, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.65);
  } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_DECODE') {
    decodeQR(msg.imageUrl).then(url => {
      sendResponse({ url: url || null });
    });
    return true; // async response
  }

  if (msg.type === 'PLAY_CHIME') {
    playSuccessChime();
    sendResponse({ played: true });
    return true;
  }
});
