/**
 * CRC-16/CCITT-FALSE used by Telcordia SR-4731 Cksum block.
 * Polynomial: 0x1021, Init: 0xFFFF, RefIn: false, RefOut: false, XorOut: 0x0000.
 */
export function computeCrc16CcittFalse(data: Uint8Array, length: number = data.length): number {
  let crc = 0xffff;
  for (let i = 0; i < length; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}
