/**
 * Camera barcode scanner — roadmap feature.
 *
 * Planned implementation:
 *   - Use the BarcodeDetector API (Chrome Android, supported on target devices)
 *   - Fallback to @zxing/browser for Safari / older Android
 *   - Opens a full-screen camera overlay with a scan-region guide
 *   - Emits scanned value back to the add-card form
 *
 * BarcodeDetector support check:
 *   'BarcodeDetector' in window && BarcodeDetector.getSupportedFormats()
 */

export interface ScanResult {
  value:  string;
  format: string;
}

export async function isSupported(): Promise<boolean> {
  return 'BarcodeDetector' in window;
}

/**
 * Start camera scan. Resolves with the first detected barcode,
 * or rejects if the user cancels / camera is unavailable.
 */
export async function scan(): Promise<ScanResult> {
  // TODO: implement camera overlay + BarcodeDetector loop
  throw new Error('Camera scanning not yet implemented');
}
