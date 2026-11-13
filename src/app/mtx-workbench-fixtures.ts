/**
 * Workbench Fixtures & v2.3 Baseline Reference for A/B Benchmarking
 * Strictly separate from the single-file MTX v2.4 engine (src/engine/mtx-codec.ts).
 */

import { deflateSync, inflateSync } from 'fflate';
import {
  CompressionProfile,
  ESCAPE_TOKEN,
  MTX_CIPHER_SECRET,
  MTX_HEADER_SIZE,
  MTX_MAGIC_V1,
  MTX_MAGIC_V2,
  MTX_V23_EXTENDED_HEADER_SIZE,
  MTX_V23_FORMAT_SPEC,
  MTX_V23_PAYLOAD_MAGIC,
  MtxMetadata,
  PRECOMPILED_VOCAB,
  PRECOMPILED_VOCAB_HASH,
  applyLegacyLcgKeystream,
  calculateAdler32,
  calculateCrc32,
  getUtf8ByteLength,
} from '../engine/mtx-codec';

// ---------------------------------------------------------------------------
// Authentic MTX v2.3 Baseline Implementation (pre-v2.4 optimization baseline)
// ---------------------------------------------------------------------------

class V23BaselineTrieNode {
  token: string | null = null;
  children = new Map<number, V23BaselineTrieNode>();
}

const V23_TRIE: { findLongestPrefix: (text: string, start: number) => string | null } = (() => {
  const root = new V23BaselineTrieNode();
  for (const word of PRECOMPILED_VOCAB) {
    let curr = root;
    for (let i = 0; i < word.length; i++) {
      const code = word.charCodeAt(i);
      let next = curr.children.get(code);
      if (!next) {
        next = new V23BaselineTrieNode();
        curr.children.set(code, next);
      }
      curr = next;
    }
    curr.token = word;
  }
  return {
    findLongestPrefix(text: string, startIndex: number): string | null {
      let curr = root;
      let longest: string | null = null;
      const len = text.length;
      for (let i = startIndex; i < len; i++) {
        const next = curr.children.get(text.charCodeAt(i));
        if (!next) break;
        curr = next;
        if (curr.token !== null) longest = curr.token;
      }
      return longest;
    },
  };
})();

function applyV23Keystream(data: Uint8Array, salt: number): Uint8Array {
  const result = new Uint8Array(data.length);
  const secret = MTX_CIPHER_SECRET;
  const secLen = secret.length;
  let s0 = (salt ^ 0x9e3779b9) >>> 0;
  let s1 = (salt ^ 0x6c62272e) >>> 0;
  let s2 = 0x85ebca6b >>> 0;
  let s3 = 0xc2b2ae35 >>> 0;
  for (let i = 0; i < data.length; i++) {
    s0 = (s0 + s1) >>> 0;
    s3 = (((s3 ^ s0) << 16) | ((s3 ^ s0) >>> 16)) >>> 0;
    s2 = (s2 + s3) >>> 0;
    s1 = (((s1 ^ s2) << 12) | ((s1 ^ s2) >>> 20)) >>> 0;
    s0 = (s0 + s1) >>> 0;
    s3 = (((s3 ^ s0) << 8) | ((s3 ^ s0) >>> 24)) >>> 0;
    s2 = (s2 + s3) >>> 0;
    s1 = (((s1 ^ s2) << 7) | ((s1 ^ s2) >>> 25)) >>> 0;
    const keyByte = secret.charCodeAt(i % secLen);
    const prn = (s0 ^ s2) & 0xff;
    result[i] = data[i] ^ (prn ^ keyByte);
  }
  return result;
}

function tokenizeV23Baseline(
  text: string,
  profile: CompressionProfile
): { tokens: string[]; dynamicMerged: string[] } {
  let i = 0;
  const initialTokens: string[] = [];
  const textLen = text.length;
  while (i < textLen) {
    const match = V23_TRIE.findLongestPrefix(text, i);
    if (match !== null) {
      initialTokens.push(match);
      i += match.length;
    } else {
      const cp = text.codePointAt(i);
      const charLen = cp !== undefined && cp > 0xffff ? 2 : 1;
      initialTokens.push(text.slice(i, i + charLen));
      i += charLen;
    }
  }

  const maxAvailableSlots = Math.max(0, 254 - PRECOMPILED_VOCAB.length);
  const maxDynamicSlots =
    profile === 'fast'
      ? Math.min(18, maxAvailableSlots)
      : profile === 'maximum'
      ? maxAvailableSlots
      : Math.min(36, maxAvailableSlots);
  const minFrequency = profile === 'fast' ? 3 : 2;
  const minSavingsThreshold = profile === 'fast' ? 5 : 3;

  const dynamicMerged: string[] = [];
  let currentTokens = initialTokens;

  while (dynamicMerged.length < maxDynamicSlots) {
    const pairFreq = new Map<string, number>();
    const tokensLen = currentTokens.length;
    for (let j = 0; j < tokensLen - 1; j++) {
      const pair = currentTokens[j] + currentTokens[j + 1];
      pairFreq.set(pair, (pairFreq.get(pair) || 0) + 1);
    }
    let bestPair: string | null = null;
    let maxSavings = 0;
    for (const [pair, freq] of pairFreq.entries()) {
      const utf8Len = getUtf8ByteLength(pair);
      const savings = freq * (utf8Len - 1);
      if (savings > maxSavings && freq >= minFrequency) {
        maxSavings = savings;
        bestPair = pair;
      }
    }
    if (!bestPair || maxSavings < minSavingsThreshold) break;
    dynamicMerged.push(bestPair);

    const nextTokens: string[] = [];
    for (let j = 0; j < tokensLen; j++) {
      if (j < tokensLen - 1 && currentTokens[j] + currentTokens[j + 1] === bestPair) {
        nextTokens.push(bestPair);
        j++;
      } else {
        nextTokens.push(currentTokens[j]);
      }
    }
    currentTokens = nextTokens;
  }

  return { tokens: currentTokens, dynamicMerged };
}

export async function compressV23Baseline(
  text: string,
  profile: CompressionProfile = 'balanced'
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const rawUtf8Bytes = encoder.encode(text).length;
  const checksum = calculateAdler32(text);
  const crc32Checksum = calculateCrc32(text);
  const trimmedWords = text.trim();
  const fullMetadata: MtxMetadata = {
    title: 'رواية جديدة',
    author: 'كاتب مجهول',
    chapterTitle: 'الفصل الأول',
    chapterIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    wordCount: trimmedWords.length > 0 ? trimmedWords.split(/\s+/).filter(Boolean).length : 0,
    tags: ['رواية عربية', 'صيغة MTX v2.3'],
    genre: 'أدب عربي',
    translator: '',
    notes: '',
    codecVersion: 'MTX 2.3.0 Unified',
    formatVersion: 23,
  };

  const { tokens, dynamicMerged } = tokenizeV23Baseline(text, profile);
  const fullVocab = [...PRECOMPILED_VOCAB, ...dynamicMerged];
  const vocabMap = new Map<string, number>();
  for (let i = 0; i < fullVocab.length; i++) vocabMap.set(fullVocab[i], i);

  const streamChunks: number[] = [];
  for (const token of tokens) {
    const id = vocabMap.get(token);
    if (id !== undefined && id < ESCAPE_TOKEN) {
      streamChunks.push(id);
    } else {
      streamChunks.push(ESCAPE_TOKEN);
      const rawBytes = encoder.encode(token);
      streamChunks.push(rawBytes.length);
      for (const b of rawBytes) streamChunks.push(b);
    }
  }
  const stream = new Uint8Array(streamChunks);

  const metaBytes = encoder.encode(JSON.stringify(fullMetadata));
  const dynBuffers = dynamicMerged.map((d) => encoder.encode(d));
  let dynSectionLen = 1;
  for (const b of dynBuffers) dynSectionLen += 1 + b.length;

  const payload = new Uint8Array(
    MTX_V23_EXTENDED_HEADER_SIZE + 2 + metaBytes.length + dynSectionLen + 4 + stream.length
  );
  const dv = new DataView(payload.buffer);
  let off = 0;
  payload.set(MTX_V23_PAYLOAD_MAGIC, off);
  off += 4;
  dv.setUint16(off, MTX_V23_FORMAT_SPEC, false);
  off += 2;
  dv.setUint32(off, crc32Checksum, false);
  off += 4;
  dv.setUint32(off, PRECOMPILED_VOCAB_HASH, false);
  off += 4;

  dv.setUint16(off, metaBytes.length, false);
  off += 2;
  payload.set(metaBytes, off);
  off += metaBytes.length;

  payload[off++] = dynamicMerged.length;
  for (const b of dynBuffers) {
    payload[off++] = b.length;
    payload.set(b, off);
    off += b.length;
  }

  dv.setUint32(off, stream.length, false);
  off += 4;
  payload.set(stream, off);

  const deflateLevel = profile === 'fast' ? 5 : profile === 'maximum' ? 9 : 8;
  const compressedPayload = deflateSync(payload, {
    level: deflateLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  });

  const salt = (Math.random() * 0xffffffff) >>> 0;
  const encryptedPayload = applyV23Keystream(compressedPayload, salt);
  const header = new Uint8Array(MTX_HEADER_SIZE);
  header.set(MTX_MAGIC_V2, 0);
  header[4] = 23;
  header[5] = 0x3f;
  const hDv = new DataView(header.buffer);
  hDv.setUint32(6, salt, false);
  hDv.setUint32(10, checksum, false);
  hDv.setUint32(14, rawUtf8Bytes, false);
  hDv.setUint16(18, 0, false);

  const mtxBytes = new Uint8Array(header.length + encryptedPayload.length);
  mtxBytes.set(header, 0);
  mtxBytes.set(encryptedPayload, header.length);
  return mtxBytes;
}

export async function decompressV23Baseline(mtxBytes: Uint8Array): Promise<string> {
  const hDv = new DataView(mtxBytes.buffer, mtxBytes.byteOffset, mtxBytes.byteLength);
  const salt = hDv.getUint32(6, false);
  const decryptedPayload = applyV23Keystream(mtxBytes.subarray(MTX_HEADER_SIZE), salt);
  const payload = inflateSync(decryptedPayload);
  const decoder = new TextDecoder('utf-8');
  const pDv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let off = MTX_V23_EXTENDED_HEADER_SIZE;
  const metaLen = pDv.getUint16(off, false);
  off += 2;
  JSON.parse(decoder.decode(payload.subarray(off, off + metaLen)));
  off += metaLen;

  const dynCount = payload[off++];
  const dynamicMerged: string[] = new Array(dynCount);
  for (let i = 0; i < dynCount; i++) {
    const len = payload[off++];
    dynamicMerged[i] = decoder.decode(payload.subarray(off, off + len));
    off += len;
  }
  const fullVocabulary = [...PRECOMPILED_VOCAB, ...dynamicMerged];
  const streamByteLen = pDv.getUint32(off, false);
  off += 4;
  const stream = payload.subarray(off, off + streamByteLen);

  const chunks: string[] = [];
  let sOff = 0;
  while (sOff < stream.length) {
    const id = stream[sOff++];
    if (id === ESCAPE_TOKEN) {
      const len = stream[sOff++];
      chunks.push(decoder.decode(stream.subarray(sOff, sOff + len)));
      sOff += len;
    } else {
      chunks.push(fullVocabulary[id] || '');
    }
  }
  const text = chunks.join('');
  calculateAdler32(text);
  calculateCrc32(text);
  return text;
}

// ---------------------------------------------------------------------------
// Legacy Test Fixture Generators (v2.2 Exact, v2.1 Reconstructed, v1.0 Reconstructed)
// ---------------------------------------------------------------------------

export function encodeExactV22Buffer(
  text: string,
  metadata: Partial<MtxMetadata> = {}
): Uint8Array {
  const encoder = new TextEncoder();
  const rawUtf8Bytes = encoder.encode(text).length;
  const checksum = calculateAdler32(text);
  const fullMetadata: MtxMetadata = {
    title: metadata.title || 'رواية اختبار v2.2',
    author: metadata.author || 'كاتب',
    chapterTitle: metadata.chapterTitle || 'الفصل الأول',
    chapterIndex: metadata.chapterIndex ?? 1,
    createdAt: metadata.createdAt || '2026-01-01T00:00:00.000Z',
    codecVersion: 'MTX 2.2 Fortified',
  };
  const { tokens, dynamicMerged } = tokenizeV23Baseline(text, 'balanced');
  const fullVocab = [...PRECOMPILED_VOCAB, ...dynamicMerged];
  const vocabMap = new Map<string, number>();
  for (let i = 0; i < fullVocab.length; i++) vocabMap.set(fullVocab[i], i);

  const streamChunks: number[] = [];
  for (const token of tokens) {
    const id = vocabMap.get(token);
    if (id !== undefined && id < ESCAPE_TOKEN) {
      streamChunks.push(id);
    } else {
      streamChunks.push(ESCAPE_TOKEN);
      const rawBytes = encoder.encode(token);
      streamChunks.push(rawBytes.length);
      for (const b of rawBytes) streamChunks.push(b);
    }
  }
  const stream = new Uint8Array(streamChunks);
  const metaBytes = encoder.encode(JSON.stringify(fullMetadata));
  const dynBuffers = dynamicMerged.map((d) => encoder.encode(d));
  let dynSectionLen = 1;
  for (const b of dynBuffers) dynSectionLen += 1 + b.length;

  const payload = new Uint8Array(2 + metaBytes.length + dynSectionLen + 4 + stream.length);
  const dv = new DataView(payload.buffer);
  let off = 0;
  dv.setUint16(off, metaBytes.length, false);
  off += 2;
  payload.set(metaBytes, off);
  off += metaBytes.length;
  payload[off++] = dynamicMerged.length;
  for (const b of dynBuffers) {
    payload[off++] = b.length;
    payload.set(b, off);
    off += b.length;
  }
  dv.setUint32(off, stream.length, false);
  off += 4;
  payload.set(stream, off);

  const compressedPayload = deflateSync(payload, { level: 8 });
  const salt = 0x12345678;
  const encryptedPayload = applyV23Keystream(compressedPayload, salt);
  const header = new Uint8Array(MTX_HEADER_SIZE);
  header.set(MTX_MAGIC_V2, 0);
  header[4] = 22;
  header[5] = 0x1f;
  const hDv = new DataView(header.buffer);
  hDv.setUint32(6, salt, false);
  hDv.setUint32(10, checksum, false);
  hDv.setUint32(14, rawUtf8Bytes, false);
  hDv.setUint16(18, 0, false);

  const out = new Uint8Array(header.length + encryptedPayload.length);
  out.set(header, 0);
  out.set(encryptedPayload, header.length);
  return out;
}

export function encodeReconstructedV21Buffer(
  text: string,
  cipherMode: 'lcg' | 'nonlinear' = 'lcg',
  metadata: Partial<MtxMetadata> = {}
): Uint8Array {
  const encoder = new TextEncoder();
  const rawUtf8Bytes = encoder.encode(text).length;
  const checksum = calculateAdler32(text);
  const fullMetadata: MtxMetadata = {
    title: metadata.title || 'مخطوطة v2.1',
    author: metadata.author || 'كاتب',
    chapterTitle: metadata.chapterTitle || 'الفصل الأول',
    chapterIndex: metadata.chapterIndex ?? 1,
    createdAt: metadata.createdAt || '2025-11-01T00:00:00.000Z',
    codecVersion: 'MTX 2.1 (Reconstructed)',
  };
  const { tokens, dynamicMerged } = tokenizeV23Baseline(text, 'balanced');
  const fullVocab = [...PRECOMPILED_VOCAB, ...dynamicMerged];
  const vocabMap = new Map<string, number>();
  for (let i = 0; i < fullVocab.length; i++) vocabMap.set(fullVocab[i], i);

  const streamChunks: number[] = [];
  for (const token of tokens) {
    const id = vocabMap.get(token);
    if (id !== undefined && id < 255) streamChunks.push(id);
  }
  const stream = new Uint8Array(streamChunks);
  const metaBytes = encoder.encode(JSON.stringify(fullMetadata));
  const dynBuffers = dynamicMerged.map((d) => encoder.encode(d));
  let dynSectionLen = 1;
  for (const b of dynBuffers) dynSectionLen += 1 + b.length;

  const payload = new Uint8Array(2 + metaBytes.length + dynSectionLen + 4 + stream.length);
  const dv = new DataView(payload.buffer);
  let off = 0;
  dv.setUint16(off, metaBytes.length, false);
  off += 2;
  payload.set(metaBytes, off);
  off += metaBytes.length;
  payload[off++] = dynamicMerged.length;
  for (const b of dynBuffers) {
    payload[off++] = b.length;
    payload.set(b, off);
    off += b.length;
  }
  dv.setUint32(off, stream.length, false);
  off += 4;
  payload.set(stream, off);

  const compressedPayload = deflateSync(payload, { level: 6 });
  const salt = 0xabcdef01;
  const encryptedPayload =
    cipherMode === 'lcg'
      ? applyLegacyLcgKeystream(compressedPayload, salt, MTX_CIPHER_SECRET)
      : applyV23Keystream(compressedPayload, salt);

  const header = new Uint8Array(MTX_HEADER_SIZE);
  header.set(MTX_MAGIC_V2, 0);
  header[4] = 21;
  header[5] = 0x0f;
  const hDv = new DataView(header.buffer);
  hDv.setUint32(6, salt, false);
  hDv.setUint32(10, checksum, false);
  hDv.setUint32(14, rawUtf8Bytes, false);
  hDv.setUint16(18, 0, false);

  const out = new Uint8Array(header.length + encryptedPayload.length);
  out.set(header, 0);
  out.set(encryptedPayload, header.length);
  return out;
}

export function encodeReconstructedV10Buffer(text: string): Uint8Array {
  const buf = encodeReconstructedV21Buffer(text, 'lcg', {
    codecVersion: 'MTX 1.0 (Reconstructed)',
  });
  buf.set(MTX_MAGIC_V1, 0);
  buf[4] = 10;
  return buf;
}
