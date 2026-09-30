import { deflateSync } from 'node:zlib';

/** Small deterministic PNG for protocol testing, generated without files or downloads. */
export function fixtureImage(): Uint8Array {
  const width = 192;
  const height = 96;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  const colors = [
    [58, 150, 230],
    [255, 170, 60],
    [70, 180, 130],
    [180, 90, 205],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colors[(Math.floor(x / 24) + Math.floor(y / 24)) % colors.length];
      for (let channel = 0; channel < 3; channel++)
        pixels[y * (width * 3 + 1) + 1 + x * 3 + channel] = color?.[channel] ?? 0;
    }
  }
  const chunk = (name: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
