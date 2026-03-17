/**
 * Minimal CBOR decoder — only the subset needed for WebAuthn attestationObject
 * and COSE public keys. Supports: uint, negint, bytes, text, array, map.
 */

// Interface breaks the circular reference that a type alias cannot express
export type CborPrimitive = number | string | Uint8Array;
export interface CborMap extends Record<string | number, CborValue> {}
export interface CborArray extends Array<CborValue> {}
export type CborValue = CborPrimitive | CborArray | CborMap;

export function cborDecode(buf: Uint8Array): CborValue {
  const dv     = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let   offset = 0;

  function readItem(): CborValue {
    const byte      = dv.getUint8(offset++);
    const majorType = byte >> 5;
    const addInfo   = byte & 0x1f;

    let len = addInfo;
    if      (addInfo === 24) { len = dv.getUint8(offset++); }
    else if (addInfo === 25) { len = dv.getUint16(offset); offset += 2; }
    else if (addInfo === 26) { len = dv.getUint32(offset); offset += 4; }

    switch (majorType) {
      case 0: return len;                                                        // uint
      case 1: return -1 - len;                                                  // negint
      case 2: {                                                                  // bytes
        const b = new Uint8Array(buf.buffer, buf.byteOffset + offset, len);
        offset += len;
        return b;
      }
      case 3: {                                                                  // text
        const b = new Uint8Array(buf.buffer, buf.byteOffset + offset, len);
        offset += len;
        return new TextDecoder().decode(b);
      }
      case 4: {                                                                  // array
        const arr: CborValue[] = [];
        for (let i = 0; i < len; i++) arr.push(readItem());
        return arr;
      }
      case 5: {                                                                  // map
        const map: Record<string | number, CborValue> = {};
        for (let i = 0; i < len; i++) {
          const k = readItem() as string | number;
          map[k]  = readItem();
        }
        return map;
      }
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`);
    }
  }

  return readItem();
}
