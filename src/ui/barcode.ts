// JsBarcode and QRCode are loaded via CDN in index.html
declare const JsBarcode: (el: SVGElement, value: string, opts: object) => void;
declare const QRCode: new (el: HTMLElement, opts: object) => void;

export function renderBarcode(svgId: string, number: string, format: string): boolean {
  const el = document.getElementById(svgId) as SVGElement | null;
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
