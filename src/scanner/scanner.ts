/**
 * Camera barcode scanner.
 *
 * Uses native BarcodeDetector on Chrome Android / desktop when reliable.
 * On iOS, loads a ZBar WASM polyfill — the native API exists but does not decode
 * live video frames.
 */

export interface ScanResult {
  value:  string;
  format: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}
interface DetectedBarcode {
  rawValue:     string;
  format:       string;
  boundingBox:  DOMRectReadOnly;
  cornerPoints: { x: number; y: number }[];
}
interface BarcodeDetectorCtor {
  new (options?: BarcodeDetectorOptions): {
    detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
  };
  getSupportedFormats(): Promise<string[]>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** True when this device can open a camera for scanning. */
export async function isSupported(): Promise<boolean> {
  return !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Open the camera overlay and scan.
 *
 * Camera permission is requested FIRST — before the overlay is shown.
 * This means the browser prompt fires immediately when the user taps the
 * scan button, which is the natural moment they expect to grant access.
 *
 * If permission is denied, rejects with a NotAllowedError without ever
 * showing the overlay.
 */
export async function startScan(): Promise<ScanResult> {
  // 1. Acquire stream (triggers permission prompt) before touching the DOM
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    // Re-throw as-is — NotAllowedError, NotFoundError, etc.
    // The caller (handleScan) shows the appropriate toast.
    throw err;
  }

  // 2. Permission granted — now build and show the overlay
  return new Promise((resolve, reject) => {
    const overlay = buildOverlay();
    document.body.appendChild(overlay);

    let animFrame: number | null = null;
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    let detector:  InstanceType<BarcodeDetectorCtor> | null = null;
    let scanning = false;
    let done = false;

    function cleanup() {
      done = true;
      if (animFrame !== null) cancelAnimationFrame(animFrame);
      if (scanTimer !== null) clearTimeout(scanTimer);
      stream.getTracks().forEach(t => t.stop());
      overlay.remove();
    }

    overlay.querySelector<HTMLButtonElement>('#scanner-cancel')!
      .addEventListener('click', () => {
        cleanup();
        reject(new DOMException('Scan cancelled by user', 'AbortError'));
      });

    async function init() {
      try {
        const Detector = await resolveDetectorCtor();
        const formats  = await Detector.getSupportedFormats();
        detector = new Detector({ formats });

        const video = overlay.querySelector<HTMLVideoElement>('#scanner-video')!;
        video.srcObject = stream;
        await video.play();
        await waitForVideoReady(video);

        scheduleScan(video);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    function scheduleScan(video: HTMLVideoElement) {
      if (done) return;

      const intervalMs = usePolyfill() ? 120 : 0;

      const tick = () => {
        if (done) return;
        void runScan(video).finally(() => {
          if (done) return;
          if (intervalMs > 0) {
            scanTimer = setTimeout(tick, intervalMs);
          } else {
            animFrame = requestAnimationFrame(tick);
          }
        });
      };

      tick();
    }

    async function runScan(video: HTMLVideoElement) {
      if (done || !detector || scanning) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      scanning = true;
      try {
        const source  = await frameSource(video);
        const results = await detector.detect(source);
        if (results.length > 0) {
          const hit = results[0]!;
          cleanup();
          resolve({
            value:  hit.rawValue,
            format: normaliseFormat(hit.format),
          });
        }
      } catch {
        // Frame decode errors are normal — keep looping
      } finally {
        scanning = false;
      }
    }

    init();
  });
}

// ── Detector selection ────────────────────────────────────────────────────────

let polyfillActive = false;

function usePolyfill(): boolean {
  return isAppleMobile();
}

function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function resolveDetectorCtor(): Promise<BarcodeDetectorCtor> {
  if (!usePolyfill() && 'BarcodeDetector' in window) {
    try {
      const native = (window as Window & { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
      await native.getSupportedFormats();
      return native;
    } catch {
      // Native API present but unusable — fall through to polyfill
    }
  }

  const { BarcodeDetectorPolyfill } = await import('@undecaf/barcode-detector-polyfill');
  polyfillActive = true;
  return BarcodeDetectorPolyfill as unknown as BarcodeDetectorCtor;
}

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new DOMException('Camera preview timed out', 'TimeoutError'));
    }, 12_000);

    const onReady = () => {
      if (video.videoWidth === 0) return;
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('playing', onReady);
      resolve();
    };

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('playing', onReady);
    onReady();
  });
}

async function frameSource(video: HTMLVideoElement): Promise<ImageBitmapSource> {
  // The WASM polyfill extracts frames from <video> itself (required on iOS).
  if (polyfillActive || usePolyfill()) {
    return video;
  }

  try {
    return await createImageBitmap(video);
  } catch {
    return video;
  }
}

// ── Overlay DOM ───────────────────────────────────────────────────────────────

function buildOverlay(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'scanner-overlay';
  el.innerHTML = `
    <div id="scanner-backdrop"></div>
    <div id="scanner-inner">
      <div id="scanner-header">
        <span>Scan barcode</span>
        <button id="scanner-cancel" aria-label="Cancel">✕</button>
      </div>
      <div id="scanner-viewport">
        <video id="scanner-video" autoplay playsinline muted></video>
        <div id="scanner-guide">
          <div class="corner tl"></div>
          <div class="corner tr"></div>
          <div class="corner bl"></div>
          <div class="corner br"></div>
          <div id="scanner-laser"></div>
        </div>
      </div>
      <p id="scanner-hint">Point the camera at a barcode</p>
    </div>
  `;

  // Inject scoped styles — avoids touching index.html
  const style = document.createElement('style');
  style.textContent = `
    #scanner-overlay {
      position: fixed; inset: 0; z-index: 9000;
      display: flex; align-items: flex-end;
      animation: scannerFadeIn 0.2s ease;
    }
    @keyframes scannerFadeIn { from { opacity: 0; } to { opacity: 1; } }

    #scanner-backdrop {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }

    #scanner-inner {
      position: relative; z-index: 1;
      width: 100%; max-width: 480px; margin: 0 auto;
      background: #13131a;
      border-radius: 20px 20px 0 0;
      padding-bottom: calc(28px + env(safe-area-inset-bottom));
      overflow: hidden;
    }

    #scanner-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px 12px;
      font-size: 17px; font-weight: 600; color: #f0f0f5;
    }

    #scanner-cancel {
      width: 32px; height: 32px; border-radius: 50%;
      border: none; background: #1c1c27; color: #7070a0;
      font-size: 15px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      -webkit-tap-highlight-color: transparent;
    }

    #scanner-viewport {
      position: relative; width: 100%;
      aspect-ratio: 1 / 1;
      background: #000; overflow: hidden;
    }

    #scanner-video {
      width: 100%; height: 100%;
      object-fit: cover;
    }

    #scanner-guide {
      position: absolute;
      inset: 15%;
      pointer-events: none;
    }

    .corner {
      position: absolute;
      width: 22px; height: 22px;
      border-color: #7c6dfa;
      border-style: solid;
    }
    .corner.tl { top: 0; left: 0;  border-width: 3px 0 0 3px; border-radius: 4px 0 0 0; }
    .corner.tr { top: 0; right: 0; border-width: 3px 3px 0 0; border-radius: 0 4px 0 0; }
    .corner.bl { bottom: 0; left: 0;  border-width: 0 0 3px 3px; border-radius: 0 0 0 4px; }
    .corner.br { bottom: 0; right: 0; border-width: 0 3px 3px 0; border-radius: 0 0 4px 0; }

    #scanner-laser {
      position: absolute; left: 0; right: 0; top: 50%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #7c6dfa, #fa6d9a, #7c6dfa, transparent);
      animation: laserScan 2s ease-in-out infinite;
      opacity: 0.85;
    }
    @keyframes laserScan {
      0%   { top: 10%; opacity: 0.4; }
      50%  { top: 90%; opacity: 1;   }
      100% { top: 10%; opacity: 0.4; }
    }

    #scanner-hint {
      text-align: center;
      font-size: 13px; color: #7070a0;
      padding: 14px 20px 0;
      margin: 0;
    }
  `;
  el.appendChild(style);
  return el;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map BarcodeDetector format strings to the format names used by JsBarcode /
 * the app's card model so the format select pre-fills correctly.
 */
function normaliseFormat(raw: string): string {
  const map: Record<string, string> = {
    'ean_13':   'EAN13',
    'ean_8':    'EAN8',
    'upc_a':    'UPC',
    'upc_e':    'UPC',
    'code_128': 'CODE128',
    'code_39':  'CODE39',
    'itf':      'ITF14',
    'qr_code':  'QR',
    'data_matrix': 'QR', // treat as QR for display purposes
  };
  return map[raw.toLowerCase()] ?? 'CODE128';
}
