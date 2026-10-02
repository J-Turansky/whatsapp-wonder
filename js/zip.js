export const MAX_ZIP_BYTES = 25 * 1024 * 1024;
export const MAX_CHAT_TEXT_BYTES = 20 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const utf8Loose = new TextDecoder('utf-8');
const U16 = (view, offset) => view.getUint16(offset, true);
const U32 = (view, offset) => view.getUint32(offset, true);
function fail(message) { throw new Error(message); }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function readEntry(bytes, view, entry) {
  if (entry.uncompressed > MAX_CHAT_TEXT_BYTES) fail('A chat text file in this ZIP exceeds the 20 MB limit. Import a smaller unzipped .txt file.');
  if (entry.localOffset + 30 > bytes.length || U32(view, entry.localOffset) !== 0x04034b50) fail('This ZIP is malformed or truncated. Import an unzipped .txt file instead.');
  if (U16(view, entry.localOffset + 6) !== entry.flags || U16(view, entry.localOffset + 8) !== entry.method) fail('This ZIP has inconsistent local and central directory headers. Import an unzipped .txt file instead.');
  const nameLength = U16(view, entry.localOffset + 26);
  const extraLength = U16(view, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressed;
  if (end > bytes.length || end < start) fail('This ZIP is malformed or truncated. Import an unzipped .txt file instead.');
  const compressed = bytes.subarray(start, end);
  let output;
  if (entry.method === 0) output = compressed.slice();
  else if (entry.method === 8) {
    if (typeof DecompressionStream !== 'function') fail('This browser cannot decompress ZIP files locally. Choose the unzipped .txt export instead.');
    let decompressor;
    try { decompressor = new DecompressionStream('deflate-raw'); }
    catch { fail('This browser does not support raw ZIP decompression. Choose the unzipped .txt export instead.'); }
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(decompressor);
      const reader = stream.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_CHAT_TEXT_BYTES || total > entry.uncompressed) {
          await reader.cancel();
          fail('The uncompressed chat text exceeds the 20 MB limit or its ZIP size declaration. Import a smaller unzipped .txt file.');
        }
        chunks.push(value);
      }
      output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    } catch (error) {
      if (error instanceof Error && /^(This browser|The uncompressed)/.test(error.message)) throw error;
      if (typeof DecompressionStream === 'function') fail('This ZIP has corrupt or truncated compressed data. Import an unzipped .txt file instead.');
      throw error;
    }
  } else fail('This ZIP uses an unsupported compression method. Import an unzipped .txt file instead.');
  if (output.length !== entry.uncompressed || crc32(output) !== entry.crc) fail('This ZIP is corrupt or truncated. Import an unzipped .txt file instead.');
  try { return decoder.decode(output); }
  catch {
    if (!entry.named) return null;
    fail('The chat text in this ZIP is not valid UTF-8. Import an unzipped .txt file instead.');
  }
}
function plausibleName(name) {
  return /(?:^|\/)_chat\.txt$/i.test(name) || /(?:^|\/)whatsapp chat with .+\.txt$/i.test(name);
}
export async function extractWhatsAppText(file) {
  if (file.size > MAX_ZIP_BYTES) fail('This ZIP exceeds the 25 MB archive limit. Import an unzipped .txt file instead.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 22) fail('This is not a complete ZIP archive. Import an unzipped .txt file instead.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const searchStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= searchStart; i -= 1) {
    if (U32(view, i) === 0x06054b50 && i + 22 + U16(view, i + 20) === bytes.length) { eocd = i; break; }
  }
  if (eocd < 0) fail('This is not a complete ZIP archive. Import an unzipped .txt file instead.');
  const disk = U16(view, eocd + 4);
  const centralDisk = U16(view, eocd + 6);
  const diskCount = U16(view, eocd + 8);
  const count = U16(view, eocd + 10);
  const centralSize = U32(view, eocd + 12);
  const centralOffset = U32(view, eocd + 16);
  if (disk || centralDisk || diskCount !== count) fail('Multi-disk ZIP archives are unsupported. Import an unzipped .txt file instead.');
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64 archives are unsupported. Import an unzipped .txt file instead.');
  if (centralOffset + centralSize > eocd || centralOffset + centralSize < centralOffset) fail('This ZIP has a malformed or truncated central directory. Import an unzipped .txt file instead.');
  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > centralOffset + centralSize || U32(view, cursor) !== 0x02014b50) fail('This ZIP has a malformed or truncated central directory. Import an unzipped .txt file instead.');
    const flags = U16(view, cursor + 8);
    const method = U16(view, cursor + 10);
    const crc = U32(view, cursor + 16);
    const compressed = U32(view, cursor + 20);
    const uncompressed = U32(view, cursor + 24);
    const nameLength = U16(view, cursor + 28);
    const extraLength = U16(view, cursor + 30);
    const commentLength = U16(view, cursor + 32);
    const diskStart = U16(view, cursor + 34);
    const localOffset = U32(view, cursor + 42);
    const attributes = U32(view, cursor + 38);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > centralOffset + centralSize) fail('This ZIP has a malformed or truncated central directory. Import an unzipped .txt file instead.');
    const name = utf8Loose.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, '/');
    cursor = end;
    if (flags & 0x41) fail('This ZIP is encrypted. Import an unzipped .txt file instead.');
    if (diskStart || compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) fail('ZIP64 and multi-disk archives are unsupported. Import an unzipped .txt file instead.');
    if (name.endsWith('/') || (attributes & 0x10) || ((attributes >>> 16) & 0xf000) === 0x4000) continue;
    if (name.toLowerCase().endsWith('.txt')) entries.push({ name, flags, method, crc, compressed, uncompressed, localOffset, named: plausibleName(name) });
  }
  if (cursor !== centralOffset + centralSize) fail('This ZIP has a malformed central directory. Import an unzipped .txt file instead.');
  let candidateText = null;
  let candidateCount = 0;
  let totalTextBytes = 0;
  for (const entry of entries) {
    if (entry.method !== 0 && entry.method !== 8) fail('This ZIP contains a text file using an unsupported compression method. Import an unzipped .txt file instead.');
    totalTextBytes += entry.uncompressed;
    if (totalTextBytes > MAX_CHAT_TEXT_BYTES) fail('The combined uncompressed text in this ZIP exceeds the 20 MB limit. Import a smaller unzipped .txt file instead.');
    const text = await readEntry(bytes, view, entry);
    if (text === null) continue;
    const hasAuthored = /(?:^|\n)\s*(?:\[)?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},\s*\d{1,2}:\d{2}[^\n]*?:\s/.test(text);
    if (entry.named || hasAuthored) {
      candidateText = text;
      candidateCount += 1;
      if (candidateCount > 1) fail('This ZIP contains more than one plausible chat text file, so the chat is ambiguous. Import one unzipped .txt file instead.');
    }
  }
  if (!candidateCount) fail('No WhatsApp chat text was found in this ZIP. Import the exported .txt file (unzipped) instead.');
  return candidateText;
}
