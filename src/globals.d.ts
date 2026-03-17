// Declarations for libraries loaded via CDN <script> tags in index.html

declare function JsBarcode(
  element: Element | string,
  value:   string,
  options?: {
    format?:       string;
    lineColor?:    string;
    width?:        number;
    height?:       number;
    displayValue?: boolean;
    margin?:       number;
    [key: string]: unknown;
  },
): void;

declare class QRCode {
  constructor(
    element: HTMLElement | string,
    options: {
      text:          string;
      width?:        number;
      height?:       number;
      colorDark?:    string;
      colorLight?:   string;
      correctLevel?: number;
    },
  );
  static CorrectLevel: { L: 1; M: 0; Q: 3; H: 2 };
}
