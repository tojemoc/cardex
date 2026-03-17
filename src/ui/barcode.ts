// JsBarcode and QRCode are declared in src/globals.d.ts
// They are loaded via CDN <script> tags in index.html

export function renderBarcode(svgId: string, number: string, format: string): boolean {
  const el = document.getElementById(svgId);
  if (!el || !number) return false;
  try {
    JsBarcode(el, number, {
      format:       format === 'QR' ? 'CODE128' : format,
      lineColor:    '#111',
      width:        2,
      height:       80,
      displayValue: false,
      margin:       4,
    });
    return true;
  } catch {
    return false;
  }
}

export function renderQR(containerId: string, number: string): void {
  const el = document.getElementById(containerId);
  if (!el || !number) return;
  el.innerHTML = '';
  try {
    new QRCode(el, {
      text:         number,
      width:        180,
      height:       180,
      colorDark:    '#111',
      colorLight:   '#fff',
      correctLevel: 2, // QRCode.CorrectLevel.M
    });
  } catch { /* invalid value */ }
}
