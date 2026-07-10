import JsBarcode from 'jsbarcode';
import QRCode     from 'qrcode';

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
  el.replaceChildren();
  const canvas = document.createElement('canvas');
  QRCode.toCanvas(canvas, number, {
    width:  180,
    margin: 1,
    color:  { dark: '#111', light: '#fff' },
  })
    .then(() => el.appendChild(canvas))
    .catch(() => { /* invalid value */ });
}
