/**
 * MTX (Modular Text Xenon / Matrix Text) Codec Engine v2.4
 * Single-File High-Performance Arabic & Universal UTF-8 Compression Engine (.mtx)
 *
 * Architectural Highlights (v2.4):
 * 1. Single-File Modular Organization: All indexing, BPE tokenization, cryptography,
 *    version detection, format compatibility layer, and legacy/current decoders live in one file.
 * 2. Advanced Indexing:
 *    - Hash Map Vocabulary Index (O(1) token -> ID lookup)
 *    - Reverse Vocabulary Lookup Table (O(1) ID -> token, UTF-8 length, semantic type without array copying)
 *    - Root-Indexed Radix Trie (O(1) flat root dispatch + stateless bit-packed ID/length matching)
 *    - Dynamic BPE Integer-ID Indexing + Doubly-Linked Token List + Lazy Binary Max-Heap
 *    - Precomputed Secret Keystream Byte Table & Streaming Zero-Alloc CRC-32
 * 3. Memory & Decompression Optimization:
 *    - Exact pre-sized TypedArrays for stream construction and v2.4 chunk pre-allocation (M4HD)
 *    - Deduplicated escape literal byte caching during encoding
 *    - Bounded LRU Tokenization Cache with strict memory limits and collision verification
 * 4. Full Format Compatibility:
 *    - Transparently detects and decodes MTX v1.0, v2.0, v2.1, v2.2, v2.3, and v2.4.
 */

import { deflateSync, inflateSync } from 'fflate';

// ============================================================================
// 1. CORE TYPES, INTERFACES & VERSION CONSTANTS
// ============================================================================

export const MTX_ENGINE_VERSION = '2.4.0';

export const MTX_MAGIC_V1 = new Uint8Array([0x4d, 0x54, 0x58, 0x31]); // 'MTX1'
export const MTX_MAGIC_V2 = new Uint8Array([0x4d, 0x54, 0x58, 0x32]); // 'MTX2'
export const MTX_MAGIC = MTX_MAGIC_V2;

export const MTX_FORMAT_VERSIONS = {
  V1_LEGACY: 1,
  V1_0: 10,
  V2_0: 20,
  V2_1: 21,
  V2_2: 22,
  V2_3: 23,
  V2_4: 24,
} as const;

export const MTX_VERSION = MTX_FORMAT_VERSIONS.V2_4; // Active output format version (24 = v2.4)
export const MTX_CIPHER_SECRET = 'MTX_ARABIC_SECURE_CODEC_V2_2_FORTIFIED_2026';
export const ESCAPE_TOKEN = 255; // Reserved for universal arbitrary UTF-8 literals
export const MTX_HEADER_SIZE = 20;

export const MTX_V23_PAYLOAD_MAGIC = new Uint8Array([0x4d, 0x33, 0x48, 0x44]); // 'M3HD'
export const MTX_V23_EXTENDED_HEADER_SIZE = 14;
export const MTX_V23_FORMAT_SPEC = 230;

export const MTX_V24_PAYLOAD_MAGIC = new Uint8Array([0x4d, 0x34, 0x48, 0x44]); // 'M4HD'
export const MTX_V24_EXTENDED_HEADER_SIZE = 18;
export const MTX_V24_FORMAT_SPEC = 240;

const MAX_METADATA_BYTES = 65535;
const MAX_STREAM_BYTE_LEN = 50_000_000;
const ESCAPE_ID_BASE = 1024;
const PAIR_KEY_STRIDE = 1048576; // 2^20; supports up to ~1M distinct symbols within IEEE-754 safe integer

export type MtxMagicType = 'MTX1' | 'MTX2';

export interface MtxMetadata {
  title: string;
  author: string;
  chapterTitle: string;
  chapterIndex: number;
  createdAt: string;
  wordCount?: number;
  tags?: string[];
  genre?: string;
  translator?: string;
  notes?: string;
  codecVersion?: string;
  formatVersion?: number;
}

export type MtxEntryType =
  | 'prefix'
  | 'suffix'
  | 'novel'
  | 'fusion'
  | 'grapheme'
  | 'compound_tashkeel'
  | 'letter'
  | 'word'
  | 'ngram'
  | 'whitespace'
  | 'punctuation'
  | 'escape';

export interface MtxDictionaryEntry {
  id: number;
  token: string;
  frequency: number;
  rawUtf8Bytes: number;
  totalSavedBytes: number;
  isDiacritized: boolean;
  type: MtxEntryType;
}

export type CompressionProfile = 'balanced' | 'maximum' | 'fast';

export interface MtxCompressionOptions {
  profile?: CompressionProfile;
  useCache?: boolean;
}

export interface ArabicTextAnalysis {
  totalChars: number;
  arabicLettersCount: number;
  tashkeelCount: number;
  tashkeelDensityPercent: number;
  wordCount: number;
  spaceCount: number;
  punctuationCount: number;
  detectedPrefixesCount: number;
  detectedSuffixesCount: number;
  estimatedUtf8Bytes: number;
  estimatedMtxBytes: number;
  estimatedSavingsPercent: number;
}

export interface MtxCompressionResult {
  mtxBytes: Uint8Array;
  originalUtf8Bytes: number;
  compressedBytes: number;
  savingsPercent: number;
  compressionRatio: number;
  encodingDurationMs: number;
  decodingDurationMs: number;
  tokenizationDurationMs: number;
  dictionary: MtxDictionaryEntry[];
  tokenCount: number;
  metadata: MtxMetadata;
  checksum: number;
  crc32Checksum: number;
  isLossless: boolean;
  profile: CompressionProfile;
  version: number;
  engineVersion: string;
  escapeTokensCount: number;
}

export interface MtxDecompressionResult {
  text: string;
  metadata: MtxMetadata;
  decodingDurationMs: number;
  originalUtf8Bytes: number;
  compressedBytes: number;
  savingsPercent: number;
  tokenCount: number;
  dictionarySize: number;
  isLossless: boolean;
  checksum: number;
  crc32Checksum: number;
  version: number;
  engineVersion: string;
  formatLabel: string;
  decoderId: string;
  integrityDetails: {
    adler32Matched: boolean;
    crc32Verified: boolean | null;
  };
}

export interface MtxParsedHeader {
  magic: MtxMagicType;
  formatVersion: number;
  flags: number;
  salt: number;
  expectedAdler32: number;
  originalUtf8Bytes: number;
  dictionaryHintCount: number;
}

export interface MtxFormatDetectionResult {
  magic: MtxMagicType;
  formatVersion: number;
  versionLabel: string;
  isLegacyFormat: boolean;
  isCurrentFormat: boolean;
  isSupported: boolean;
  header: MtxParsedHeader;
  flagsDecoded: {
    usesRadixTrie: boolean;
    usesAffixes: boolean;
    usesFusions: boolean;
    usesBpe: boolean;
    usesCipher: boolean;
    usesEscapeProtocol: boolean;
    usesExtendedV23Integrity: boolean;
    usesExtendedV24Indexing: boolean;
  };
}

export interface MtxDecodedPayload {
  text: string;
  metadata: MtxMetadata;
  tokenCount: number;
  dictionarySize: number;
  originalUtf8Bytes: number;
  expectedCrc32: number | null;
  decoderId: string;
  formatLabel: string;
  warnings?: string[];
}

export interface MtxFormatDecoder {
  readonly decoderId: string;
  readonly formatLabel: string;
  readonly supportedMagic: readonly MtxMagicType[];
  readonly supportedVersions: readonly number[];
  readonly description: string;
  canDecode(detection: MtxFormatDetectionResult): boolean;
  decode(mtxBytes: Uint8Array, detection: MtxFormatDetectionResult): MtxDecodedPayload;
}

export interface DecoderRegistrationInfo {
  decoderId: string;
  formatLabel: string;
  supportedMagic: readonly string[];
  supportedVersions: readonly number[];
  description: string;
}

export interface LegacyDecoderProfile {
  vocabulary?: readonly string[];
  cipherSecret?: string;
  customDecryptor?: (encrypted: Uint8Array, salt: number) => Uint8Array;
}

export interface DownloadResult {
  dataUrl: string;
  filename: string;
  savedViaDialog: boolean;
}

export interface MtxCacheStats {
  tokenizationEntries: number;
  tokenizationBytes: number;
  tokenizationHits: number;
  tokenizationMisses: number;
  secretCacheEntries: number;
}

// ============================================================================
// 2. ERROR HIERARCHY
// ============================================================================

export class MtxError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MtxError';
    this.code = code;
  }
}

export class MtxInvalidFormatError extends MtxError {
  constructor(message: string) {
    super('MTX_INVALID_FORMAT', message);
    this.name = 'MtxInvalidFormatError';
  }
}

export class MtxCorruptDataError extends MtxError {
  constructor(message: string) {
    super('MTX_CORRUPT_DATA', message);
    this.name = 'MtxCorruptDataError';
  }
}

export class MtxUnsupportedVersionError extends MtxError {
  readonly detectedVersion: number;
  readonly supportedVersions: readonly number[];

  constructor(detectedVersion: number, supportedVersions: readonly number[], message?: string) {
    super(
      'MTX_UNSUPPORTED_VERSION',
      message ||
        `إصدار تنسيق MTX غير مدعوم (${detectedVersion}). الإصدارات المدعومة حالياً: ${supportedVersions.join(', ')}.`
    );
    this.name = 'MtxUnsupportedVersionError';
    this.detectedVersion = detectedVersion;
    this.supportedVersions = supportedVersions;
  }
}

// ============================================================================
// 3. SINGLETON CODECS, CHECKSUMS & HARDENED KEYSTREAM CIPHER
// ============================================================================

const SHARED_ENCODER = new TextEncoder();
const SHARED_DECODER = new TextDecoder('utf-8', { fatal: false });

// Precomputed CRC-32 Lookup Table (IEEE 802.3)
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Calculates CRC-32 directly over an existing UTF-8 byte buffer (zero extra allocation).
 */
export function calculateCrc32Bytes(bytes: Uint8Array): number {
  let crc = 0 ^ -1;
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Streaming zero-allocation IEEE 802.3 CRC-32 over a JS string (matches TextEncoder UTF-8 byte-for-byte).
 */
export function calculateCrc32(str: string): number {
  let crc = 0 ^ -1;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ code) & 0xff];
    } else if (code < 0x800) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0xc0 | (code >>> 6))) & 0xff];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0x80 | (code & 0x3f))) & 0xff];
    } else if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < len) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0xf0 | (cp >>> 18))) & 0xff];
          crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0x80 | ((cp >>> 12) & 0x3f))) & 0xff];
          crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0x80 | ((cp >>> 6) & 0x3f))) & 0xff];
          crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0x80 | (cp & 0x3f))) & 0xff];
          i++;
          continue;
        }
      }
      // Unpaired surrogate -> U+FFFD (EF BF BD)
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ 0xef) & 0xff];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ 0xbf) & 0xff];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ 0xbd) & 0xff];
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ 0xef) & 0xff];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ 0xbf) & 0xff];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ 0xbd) & 0xff];
    } else {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0xe0 | (code >>> 12))) & 0xff];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0x80 | ((code >>> 6) & 0x3f))) & 0xff];
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ (0x80 | (code & 0x3f))) & 0xff];
    }
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Calculates Adler-32 checksum over UTF-16 code units (exact v2.2/v2.3 parity).
 */
export function calculateAdler32(str: string): number {
  let a = 1;
  let b = 0;
  const len = str.length;
  // Defer modulo reduction up to 5552 iterations (safe within 32-bit unsigned) for faster execution
  let i = 0;
  while (i < len) {
    let chunkEnd = i + 5552;
    if (chunkEnd > len) chunkEnd = len;
    while (i < chunkEnd) {
      a += str.charCodeAt(i++);
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Fast 32-bit FNV-1a hash for vocabulary fingerprints and cache keys.
 */
export function fnv1a32(items: readonly string[]): number {
  let hash = 0x811c9dc5;
  for (const item of items) {
    for (let i = 0; i < item.length; i++) {
      hash ^= item.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function fnv1a32String(str: string): number {
  let hash = 0x811c9dc5;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Precomputed secret byte table + bounded secret cache to avoid charCodeAt and % in keystream loops
const DEFAULT_SECRET_BYTES: Uint8Array = (() => {
  const arr = new Uint8Array(MTX_CIPHER_SECRET.length);
  for (let i = 0; i < MTX_CIPHER_SECRET.length; i++) {
    arr[i] = MTX_CIPHER_SECRET.charCodeAt(i) & 0xff;
  }
  return arr;
})();

const SECRET_BYTES_CACHE = new Map<string, Uint8Array>();

function getSecretBytes(secret: string): Uint8Array {
  if (secret === MTX_CIPHER_SECRET) return DEFAULT_SECRET_BYTES;
  let cached = SECRET_BYTES_CACHE.get(secret);
  if (!cached) {
    if (SECRET_BYTES_CACHE.size >= 8) {
      const oldestKey = SECRET_BYTES_CACHE.keys().next().value;
      if (oldestKey !== undefined) SECRET_BYTES_CACHE.delete(oldestKey);
    }
    cached = new Uint8Array(secret.length);
    for (let i = 0; i < secret.length; i++) {
      cached[i] = secret.charCodeAt(i) & 0xff;
    }
    SECRET_BYTES_CACHE.set(secret, cached);
  }
  return cached;
}

/**
 * Cryptographically Hardened Non-Linear Keystream Cipher (100% compatible with v2.2/v2.3).
 * Uses precomputed byte secret table and counter-wrap instead of per-byte modulo + charCodeAt.
 */
export function applyMtxKeystream(
  data: Uint8Array,
  salt: number,
  secret: string = MTX_CIPHER_SECRET
): Uint8Array {
  const len = data.length;
  const result = new Uint8Array(len);
  const secBytes = getSecretBytes(secret);
  const secLen = secBytes.length;

  let s0 = (salt ^ 0x9e3779b9) >>> 0;
  let s1 = (salt ^ 0x6c62272e) >>> 0;
  let s2 = 0x85ebca6b >>> 0;
  let s3 = 0xc2b2ae35 >>> 0;
  let secIdx = 0;

  for (let i = 0; i < len; i++) {
    s0 = (s0 + s1) >>> 0;
    s3 = (((s3 ^ s0) << 16) | ((s3 ^ s0) >>> 16)) >>> 0;
    s2 = (s2 + s3) >>> 0;
    s1 = (((s1 ^ s2) << 12) | ((s1 ^ s2) >>> 20)) >>> 0;
    s0 = (s0 + s1) >>> 0;
    s3 = (((s3 ^ s0) << 8) | ((s3 ^ s0) >>> 24)) >>> 0;
    s2 = (s2 + s3) >>> 0;
    s1 = (((s1 ^ s2) << 7) | ((s1 ^ s2) >>> 25)) >>> 0;

    const prn = (s0 ^ s2) & 0xff;
    result[i] = data[i] ^ (prn ^ secBytes[secIdx]);
    if (++secIdx === secLen) secIdx = 0;
  }

  return result;
}

/**
 * Legacy Linear Congruential Generator (LCG) keystream helper for pre-v2.2 recovery.
 */
export function applyLegacyLcgKeystream(
  data: Uint8Array,
  salt: number,
  secret: string,
  multiplier = 1664525,
  increment = 1013904223
): Uint8Array {
  const len = data.length;
  const result = new Uint8Array(len);
  const secBytes = secret.length > 0 ? getSecretBytes(secret) : null;
  const secLen = secBytes ? secBytes.length : 1;
  let state = salt >>> 0;
  let secIdx = 0;

  for (let i = 0; i < len; i++) {
    state = (Math.imul(state, multiplier) + increment) >>> 0;
    const keyByte = secBytes ? secBytes[secIdx] : 0;
    if (++secIdx === secLen) secIdx = 0;
    const prn = (state >>> 16) & 0xff;
    result[i] = data[i] ^ (prn ^ keyByte);
  }

  return result;
}

// ============================================================================
// 4. PRECOMPILED VOCABULARY, HASH INDEXES, REVERSE LOOKUP & ROOT-INDEXED TRIE
// ============================================================================

const STATIC_CHARS: string[] = (() => {
  const list: string[] = [];
  for (let c = 0x0621; c <= 0x064a; c++) list.push(String.fromCharCode(c));
  for (let c = 0x064b; c <= 0x0652; c++) list.push(String.fromCharCode(c));
  list.push('\u0670', '\u0671', '\u0640', 'ٱ', 'پ', 'چ', 'ژ', 'گ');
  list.push(
    ' ',
    '\n',
    '\t',
    '،',
    '؛',
    '؟',
    '!',
    '.',
    ':',
    '«',
    '»',
    '"',
    "'",
    '-',
    '—',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '/',
    '\\',
    '@',
    '#',
    '%',
    '&',
    '*',
    '+',
    '=',
    '<',
    '>',
    '_',
    '^',
    '|',
    '~',
    '“',
    '”',
    '…'
  );
  for (let d = 0; d <= 9; d++) list.push(d.toString());
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (const ad of arabicDigits) list.push(ad);
  return list;
})();

const FUSED_PUNCTUATION: string[] = [
  '، ',
  '؛ ',
  '. ',
  '؟ ',
  '! ',
  ': ',
  '.\n',
  '،\n',
  '\n\n',
  '\n— ',
  '— ',
  '\n- ',
  '- ',
  ' «',
  '» ',
  '... ',
  '.. ',
  ' (',
  ') ',
];

const MORPH_PREFIXES: string[] = [
  'وبالـ',
  'كالـ',
  'فالـ',
  'للـ',
  'والـ',
  'بالـ',
  'الـ',
  'ال',
  'وبـ',
  'ولـ',
  'فلـ',
  'أبالـ',
  'وكالـ',
  'فكالـ',
  'فلما ',
  'ولما ',
  'وحين ',
  'فحين ',
  'وإذا ',
  'فإذا ',
  'حيث ',
  'كذلك ',
];

const MORPH_SUFFIXES: string[] = [
  'هما',
  'هم',
  'هن',
  'كم',
  'كن',
  'نا',
  'ها',
  'ين',
  'ون',
  'ات',
  'ان',
  'ية',
  'تك',
  'تهم',
  'تها',
  'تنا',
  'تم',
  'تني',
  'ني',
  'ه',
];

const TASHKEEL_GRAPHEMES: string[] = [
  'َّ',
  'ُّ',
  'ِّ',
  'ًّ',
  'ٌّ',
  'ٍّ',
  'كَ',
  'كِ',
  'كُ',
  'كْ',
  'مَ',
  'مِ',
  'مُ',
  'مْ',
  'نَ',
  'نِ',
  'نُ',
  'نْ',
  'لَ',
  'لِ',
  'لُ',
  'لْ',
  'رَ',
  'رِ',
  'رُ',
  'رْ',
  'فَ',
  'فِ',
  'بَ',
  'بِ',
  'تَ',
  'تِ',
  'يَ',
  'يِ',
  'سَ',
  'سِ',
  'سُ',
  'هَ',
  'هِ',
  'هُ',
];

const NOVEL_CONTEXT_WORDS: string[] = [
  'قال',
  'قالت',
  'كان',
  'كانت',
  'في',
  'على',
  'من',
  'إلى',
  'عن',
  'مع',
  'هذا',
  'هذه',
  'ذلك',
  'تلك',
  'الذي',
  'التي',
  'كل',
  'أن',
  'إن',
  'لم',
  'ثم',
  'بعد',
  'قبل',
  'بين',
  'عندما',
  'كما',
  'غير',
  'حتى',
  'فقد',
  'لقد',
  'كَانَ',
  'فِي',
  'مِنْ',
  'عَلَى',
  'إِلَى',
  'قَالَ',
  'قَالَتْ',
  'لَمْ',
  'كُلّ',
  'الَّذِي',
  'الَّتِي',
  'إِنَّ',
  'أَنَّ',
  'لَكِنَّ',
  'لَيْسَ',
  'كَانُوا',
  'يَكُونُ',
  'هَذَا',
  'هَذِهِ',
  'ذَلِكَ',
  'تِلْكَ',
  'عليه',
  'عليها',
  'إليه',
  'إليها',
  'منه',
  'منها',
  'عنه',
  'عنها',
  'فيه',
  'فيها',
  'بها',
  'به',
];

const FUSED_SET = new Set<string>(FUSED_PUNCTUATION);
const PREFIX_SET = new Set<string>(MORPH_PREFIXES);
const SUFFIX_SET = new Set<string>(MORPH_SUFFIXES);
const NOVEL_SET = new Set<string>(NOVEL_CONTEXT_WORDS);
const GRAPHEME_SET = new Set<string>(TASHKEEL_GRAPHEMES);

export const PRECOMPILED_VOCAB: string[] = (() => {
  const list: string[] = [];
  const seen = new Set<string>();
  const allItems = [
    ...STATIC_CHARS,
    ...FUSED_PUNCTUATION,
    ...MORPH_PREFIXES,
    ...MORPH_SUFFIXES,
    ...TASHKEEL_GRAPHEMES,
    ...NOVEL_CONTEXT_WORDS,
  ];
  for (const item of allItems) {
    if (!seen.has(item)) {
      seen.add(item);
      list.push(item);
    }
  }
  return list.length > 225 ? list.slice(0, 225) : list;
})();

export const PRECOMPILED_VOCAB_LEN = PRECOMPILED_VOCAB.length;
export const PRECOMPILED_VOCAB_HASH: number = fnv1a32(PRECOMPILED_VOCAB);

/**
 * Computes UTF-8 byte length of a JS string without allocating any buffer.
 */
export function getUtf8ByteLength(str: string): number {
  let bytes = 0;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < len) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          i++;
          continue;
        }
      }
      bytes += 3;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function containsArabicTashkeel(text: string): boolean {
  return /[\u064B-\u065F\u0670]/.test(text);
}

export function getSemanticType(token: string): MtxEntryType {
  if (FUSED_SET.has(token)) return 'fusion';
  if (PREFIX_SET.has(token)) return 'prefix';
  if (SUFFIX_SET.has(token)) return 'suffix';
  if (NOVEL_SET.has(token)) return 'novel';
  if (GRAPHEME_SET.has(token)) {
    return token.includes('ّ') ? 'compound_tashkeel' : 'grapheme';
  }
  if (/^\s+$/.test(token)) return 'whitespace';
  if (/^[،؛؟!«»""''—\-.:()[\]/{}@#%&*+=<>_^|~…]+$/.test(token)) return 'punctuation';
  if (token.length === 1) return 'letter';
  if (token.length === 2 && containsArabicTashkeel(token)) return 'grapheme';
  return 'ngram';
}

// Hash Map Index + Precomputed Lookup Tables for PRECOMPILED_VOCAB
const PRECOMPILED_VOCAB_INDEX = new Map<string, number>();
const PRECOMPILED_VOCAB_UTF8_LEN = new Uint8Array(PRECOMPILED_VOCAB_LEN);
const PRECOMPILED_VOCAB_TASHKEEL = new Uint8Array(PRECOMPILED_VOCAB_LEN);
const PRECOMPILED_VOCAB_TYPES: MtxEntryType[] = new Array<MtxEntryType>(PRECOMPILED_VOCAB_LEN);

for (let i = 0; i < PRECOMPILED_VOCAB_LEN; i++) {
  const tok = PRECOMPILED_VOCAB[i];
  PRECOMPILED_VOCAB_INDEX.set(tok, i);
  PRECOMPILED_VOCAB_UTF8_LEN[i] = getUtf8ByteLength(tok);
  PRECOMPILED_VOCAB_TASHKEEL[i] = containsArabicTashkeel(tok) ? 1 : 0;
  PRECOMPILED_VOCAB_TYPES[i] = getSemanticType(tok);
}

// Pre-populated 255-slot scratch table for zero-copy, zero-branch O(1) synchronous decompression lookup
const FAST_DECODE_VOCAB_SLOTS: (string | undefined)[] = new Array<string | undefined>(255);
for (let i = 0; i < PRECOMPILED_VOCAB_LEN; i++) {
  FAST_DECODE_VOCAB_SLOTS[i] = PRECOMPILED_VOCAB[i];
}
let fastDecodePrevEnd = PRECOMPILED_VOCAB_LEN;

/**
 * Reverse Vocabulary Index for O(1) ID -> Token resolution without array copying.
 */
export class ReverseVocabularyIndex {
  private readonly dynamicTokens: readonly string[];
  readonly totalSize: number;

  constructor(dynamicTokens: readonly string[]) {
    this.dynamicTokens = dynamicTokens;
    this.totalSize = PRECOMPILED_VOCAB_LEN + dynamicTokens.length;
  }

  get(id: number): string | undefined {
    if (id < PRECOMPILED_VOCAB_LEN) {
      return PRECOMPILED_VOCAB[id];
    }
    return this.dynamicTokens[id - PRECOMPILED_VOCAB_LEN];
  }

  getOrEmpty(id: number): string {
    if (id < PRECOMPILED_VOCAB_LEN) {
      return PRECOMPILED_VOCAB[id] ?? '';
    }
    return this.dynamicTokens[id - PRECOMPILED_VOCAB_LEN] ?? '';
  }

  /**
   * Binds dynamic tokens into the reusable static 255-slot table without copying PRECOMPILED_VOCAB.
   */
  bindFlatTable(): readonly (string | undefined)[] {
    const dynLen = this.dynamicTokens.length;
    const newEnd = Math.min(255, PRECOMPILED_VOCAB_LEN + dynLen);
    for (let i = 0; i < dynLen && PRECOMPILED_VOCAB_LEN + i < 255; i++) {
      FAST_DECODE_VOCAB_SLOTS[PRECOMPILED_VOCAB_LEN + i] = this.dynamicTokens[i];
    }
    for (let i = newEnd; i < fastDecodePrevEnd; i++) {
      FAST_DECODE_VOCAB_SLOTS[i] = undefined;
    }
    fastDecodePrevEnd = newEnd;
    return FAST_DECODE_VOCAB_SLOTS;
  }
}

const ROOT_FLAT_LIMIT = 0x0700; // Covers ASCII + Latin + Arabic block (0x0000..0x06FF) in O(1) array lookup

class TrieNode {
  token: string | null = null;
  tokenId = -1;
  children = new Map<number, TrieNode>();
}

/**
 * Optimized Prefix Radix Trie:
 * - O(1) flat array lookup on root node for ASCII & Arabic code points (< 0x0700)
 * - Stateless bit-packed ID + match-length traversal returning integer Token IDs directly
 */
export class FastVocabularyTrie {
  root = new TrieNode();
  private readonly rootFastTable: (TrieNode | undefined)[] = new Array<TrieNode | undefined>(
    ROOT_FLAT_LIMIT
  );

  insert(word: string, tokenId = -1): void {
    if (word.length === 0) return;
    const firstCode = word.charCodeAt(0);
    let curr: TrieNode;

    if (firstCode < ROOT_FLAT_LIMIT) {
      let node = this.rootFastTable[firstCode];
      if (!node) {
        node = new TrieNode();
        this.rootFastTable[firstCode] = node;
        this.root.children.set(firstCode, node);
      }
      curr = node;
    } else {
      let node = this.root.children.get(firstCode);
      if (!node) {
        node = new TrieNode();
        this.root.children.set(firstCode, node);
      }
      curr = node;
    }

    for (let i = 1; i < word.length; i++) {
      const code = word.charCodeAt(i);
      let next: TrieNode | undefined = curr.children.get(code);
      if (!next) {
        next = new TrieNode();
        curr.children.set(code, next);
      }
      curr = next;
    }
    curr.token = word;
    curr.tokenId = tokenId;
  }

  /**
   * Public string-returning longest-prefix lookup (preserved API).
   */
  findLongestPrefix(text: string, startIndex: number): string | null {
    const len = text.length;
    if (startIndex >= len) return null;

    const firstCode = text.charCodeAt(startIndex);
    const startNode =
      firstCode < ROOT_FLAT_LIMIT
        ? this.rootFastTable[firstCode]
        : this.root.children.get(firstCode);
    if (!startNode) return null;

    let curr: TrieNode = startNode;
    let longest: string | null = curr.token;
    for (let i = startIndex + 1; i < len; i++) {
      const next: TrieNode | undefined = curr.children.get(text.charCodeAt(i));
      if (!next) break;
      curr = next;
      if (curr.token !== null) {
        longest = curr.token;
      }
    }
    return longest;
  }

  /**
   * High-speed integer lookup returning bit-packed `(matchLength << 10) | (tokenId + 1)`, or 0 if unmatched.
   */
  findLongestPrefixPacked(text: string, startIndex: number): number {
    const len = text.length;
    if (startIndex >= len) return 0;

    const firstCode = text.charCodeAt(startIndex);
    const startNode =
      firstCode < ROOT_FLAT_LIMIT
        ? this.rootFastTable[firstCode]
        : this.root.children.get(firstCode);
    if (!startNode) return 0;

    let curr: TrieNode = startNode;
    let bestPacked = curr.tokenId >= 0 ? (1 << 10) | (curr.tokenId + 1) : 0;
    for (let i = startIndex + 1; i < len; i++) {
      const next: TrieNode | undefined = curr.children.get(text.charCodeAt(i));
      if (!next) break;
      curr = next;
      if (curr.tokenId >= 0) {
        bestPacked = ((i - startIndex + 1) << 10) | (curr.tokenId + 1);
      }
    }
    return bestPacked;
  }
}

const GLOBAL_VOCAB_TRIE: FastVocabularyTrie = (() => {
  const trie = new FastVocabularyTrie();
  for (let i = 0; i < PRECOMPILED_VOCAB_LEN; i++) {
    trie.insert(PRECOMPILED_VOCAB[i], i);
  }
  return trie;
})();

// ============================================================================
// 5. BOUNDED SMART LRU TOKENIZATION CACHE
// ============================================================================

interface CachedTokenizationPlan {
  text: string;
  finalTokenIds: Int32Array;
  dynamicMerged: string[];
  escapeLiterals: string[];
  escapeUtf8Lengths: Uint8Array;
  dictionaryEntries: MtxDictionaryEntry[];
  tokenizationDurationMs: number;
  estimatedBytes: number;
}

const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_TOTAL_BYTES = 1_572_864; // 1.5 MB hard ceiling
const MAX_CACHEABLE_TEXT_CHARS = 32_768; // Skip very large documents to avoid memory pressure

class MtxTokenizationLruCache {
  private readonly map = new Map<string, CachedTokenizationPlan>();
  private totalBytes = 0;
  hits = 0;
  misses = 0;

  get(key: string, text: string): CachedTokenizationPlan | undefined {
    const entry = this.map.get(key);
    if (!entry || entry.text !== text) {
      this.misses++;
      return undefined;
    }
    // Refresh LRU recency
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry;
  }

  set(key: string, plan: CachedTokenizationPlan): void {
    const existing = this.map.get(key);
    if (existing) {
      this.totalBytes -= existing.estimatedBytes;
      this.map.delete(key);
    }

    while (
      this.map.size >= MAX_CACHE_ENTRIES ||
      (this.totalBytes + plan.estimatedBytes > MAX_CACHE_TOTAL_BYTES && this.map.size > 0)
    ) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.map.get(oldestKey);
      if (oldest) this.totalBytes -= oldest.estimatedBytes;
      this.map.delete(oldestKey);
    }

    if (plan.estimatedBytes <= MAX_CACHE_TOTAL_BYTES) {
      this.map.set(key, plan);
      this.totalBytes += plan.estimatedBytes;
    }
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { entries: number; bytes: number; hits: number; misses: number } {
    return {
      entries: this.map.size,
      bytes: this.totalBytes,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

const TOKENIZATION_CACHE = new MtxTokenizationLruCache();

export function clearMtxCaches(): void {
  TOKENIZATION_CACHE.clear();
  SECRET_BYTES_CACHE.clear();
}

export function getMtxCacheStats(): MtxCacheStats {
  const stats = TOKENIZATION_CACHE.getStats();
  return {
    tokenizationEntries: stats.entries,
    tokenizationBytes: stats.bytes,
    tokenizationHits: stats.hits,
    tokenizationMisses: stats.misses,
    secretCacheEntries: SECRET_BYTES_CACHE.size,
  };
}

// ============================================================================
// 6. HIGH-SPEED INTEGER-ID BPE ENGINE & TEXT ANALYSIS
// ============================================================================

/**
 * Binary Max-Heap for O(log P) BPE pair selection with lazy stale-entry validation.
 */
class BpeMaxHeap {
  private heapSavings: Int32Array;
  private heapFreqs: Int32Array;
  private heapKeys: Float64Array;
  size = 0;

  constructor(initialCapacity = 256) {
    this.heapSavings = new Int32Array(initialCapacity);
    this.heapFreqs = new Int32Array(initialCapacity);
    this.heapKeys = new Float64Array(initialCapacity);
  }

  private ensureCapacity(): void {
    if (this.size < this.heapSavings.length) return;
    const nextCap = this.heapSavings.length * 2;
    const nextSavings = new Int32Array(nextCap);
    const nextFreqs = new Int32Array(nextCap);
    const nextKeys = new Float64Array(nextCap);
    nextSavings.set(this.heapSavings);
    nextFreqs.set(this.heapFreqs);
    nextKeys.set(this.heapKeys);
    this.heapSavings = nextSavings;
    this.heapFreqs = nextFreqs;
    this.heapKeys = nextKeys;
  }

  push(savings: number, freq: number, key: number): void {
    this.ensureCapacity();
    let idx = this.size++;
    while (idx > 0) {
      const parent = (idx - 1) >>> 1;
      const pSav = this.heapSavings[parent];
      if (pSav > savings || (pSav === savings && this.heapFreqs[parent] >= freq)) break;
      this.heapSavings[idx] = pSav;
      this.heapFreqs[idx] = this.heapFreqs[parent];
      this.heapKeys[idx] = this.heapKeys[parent];
      idx = parent;
    }
    this.heapSavings[idx] = savings;
    this.heapFreqs[idx] = freq;
    this.heapKeys[idx] = key;
  }

  popInto(out: { savings: number; freq: number; key: number }): boolean {
    if (this.size === 0) return false;
    out.savings = this.heapSavings[0];
    out.freq = this.heapFreqs[0];
    out.key = this.heapKeys[0];

    const lastIdx = --this.size;
    if (lastIdx > 0) {
      const lastSav = this.heapSavings[lastIdx];
      const lastFreq = this.heapFreqs[lastIdx];
      const lastKey = this.heapKeys[lastIdx];
      let idx = 0;
      const half = this.size >>> 1;

      while (idx < half) {
        let child = (idx << 1) + 1;
        const right = child + 1;
        if (
          right < this.size &&
          (this.heapSavings[right] > this.heapSavings[child] ||
            (this.heapSavings[right] === this.heapSavings[child] &&
              this.heapFreqs[right] > this.heapFreqs[child]))
        ) {
          child = right;
        }
        const cSav = this.heapSavings[child];
        if (lastSav > cSav || (lastSav === cSav && lastFreq >= this.heapFreqs[child])) break;
        this.heapSavings[idx] = cSav;
        this.heapFreqs[idx] = this.heapFreqs[child];
        this.heapKeys[idx] = this.heapKeys[child];
        idx = child;
      }
      this.heapSavings[idx] = lastSav;
      this.heapFreqs[idx] = lastFreq;
      this.heapKeys[idx] = lastKey;
    }
    return true;
  }
}

interface InternalTokenizationOutput {
  finalTokenIds: Int32Array;
  dynamicMerged: string[];
  escapeLiterals: string[];
  escapeUtf8Lengths: Uint8Array;
  dictionaryEntries: MtxDictionaryEntry[];
  tokenizationDurationMs: number;
}

function executeIntegerBpeTokenization(
  text: string,
  profile: CompressionProfile,
  buildDictionaryEntries: boolean
): InternalTokenizationOutput {
  const startTime = performance.now();
  const textLen = text.length;

  // 1. Single-pass Root-Indexed Radix Trie Tokenization directly into integer Token IDs
  let cap = Math.max(16, textLen);
  let rawIds = new Int32Array(cap);
  let tokenCount = 0;

  const escapeMap = new Map<string, number>();
  const escapeLiterals: string[] = [];
  const escapeUtf8LenList: number[] = [];

  let i = 0;
  while (i < textLen) {
    const packed = GLOBAL_VOCAB_TRIE.findLongestPrefixPacked(text, i);
    let tokenId: number;
    if (packed !== 0) {
      tokenId = (packed & 1023) - 1;
      i += packed >>> 10;
    } else {
      const codePoint = text.codePointAt(i);
      const charLen = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
      const lit = text.slice(i, i + charLen);
      i += charLen;
      const existingEscId = escapeMap.get(lit);
      if (existingEscId !== undefined) {
        tokenId = existingEscId;
      } else {
        tokenId = ESCAPE_ID_BASE + escapeLiterals.length;
        escapeMap.set(lit, tokenId);
        escapeLiterals.push(lit);
        escapeUtf8LenList.push(getUtf8ByteLength(lit));
      }
    }

    if (tokenCount === cap) {
      cap *= 2;
      const grown = new Int32Array(cap);
      grown.set(rawIds);
      rawIds = grown;
    }
    rawIds[tokenCount++] = tokenId;
  }

  const maxAvailableSlots = Math.max(0, 254 - PRECOMPILED_VOCAB_LEN);
  const maxDynamicSlots =
    profile === 'fast'
      ? Math.min(18, maxAvailableSlots)
      : profile === 'maximum'
      ? maxAvailableSlots
      : Math.min(36, maxAvailableSlots);

  const minFrequency = profile === 'fast' ? 3 : 2;
  const minSavingsThreshold = profile === 'fast' ? 5 : 3;

  const dynamicMerged: string[] = [];
  const dynUtf8Lengths = new Uint8Array(maxDynamicSlots);

  const getUtf8LenById = (id: number): number => {
    if (id < PRECOMPILED_VOCAB_LEN) return PRECOMPILED_VOCAB_UTF8_LEN[id];
    if (id < ESCAPE_ID_BASE) return dynUtf8Lengths[id - PRECOMPILED_VOCAB_LEN];
    return escapeUtf8LenList[id - ESCAPE_ID_BASE];
  };

  const getTokenStrById = (id: number): string => {
    if (id < PRECOMPILED_VOCAB_LEN) return PRECOMPILED_VOCAB[id];
    if (id < ESCAPE_ID_BASE) return dynamicMerged[id - PRECOMPILED_VOCAB_LEN];
    return escapeLiterals[id - ESCAPE_ID_BASE];
  };

  let finalTokenIds: Int32Array;

  // 2. Doubly-Linked Integer-ID BPE with Incremental Pair Tracking & Lazy Max-Heap
  if (tokenCount >= 2 && maxDynamicSlots > 0) {
    const tokIds = rawIds.subarray(0, tokenCount);
    const prev = new Int32Array(tokenCount);
    const next = new Int32Array(tokenCount);
    const occPrev = new Int32Array(tokenCount);
    const occNext = new Int32Array(tokenCount);
    const keyAt = new Float64Array(tokenCount);

    for (let idx = 0; idx < tokenCount; idx++) {
      prev[idx] = idx - 1;
      next[idx] = idx + 1 < tokenCount ? idx + 1 : -1;
      occPrev[idx] = -1;
      occNext[idx] = -1;
      keyAt[idx] = -1;
    }

    const pairCount = new Map<number, number>();
    const occHead = new Map<number, number>();
    const heap = new BpeMaxHeap(Math.min(4096, Math.max(64, tokenCount >>> 2)));

    const linkPair = (nodeIdx: number, pushToHeap: boolean): void => {
      const r = next[nodeIdx];
      if (r === -1) return;
      const idA = tokIds[nodeIdx];
      const idB = tokIds[r];
      const key = idA * PAIR_KEY_STRIDE + idB;
      keyAt[nodeIdx] = key;
      const nextCnt = (pairCount.get(key) || 0) + 1;
      pairCount.set(key, nextCnt);

      const oldHead = occHead.get(key);
      occPrev[nodeIdx] = -1;
      occNext[nodeIdx] = oldHead !== undefined ? oldHead : -1;
      if (oldHead !== undefined) occPrev[oldHead] = nodeIdx;
      occHead.set(key, nodeIdx);

      if (pushToHeap && nextCnt >= minFrequency) {
        const mergedLen = getUtf8LenById(idA) + getUtf8LenById(idB);
        const sav = nextCnt * (mergedLen - 1);
        if (sav >= minSavingsThreshold) {
          heap.push(sav, nextCnt, key);
        }
      }
    };

    const unlinkPair = (nodeIdx: number): void => {
      const oldKey = keyAt[nodeIdx];
      if (oldKey < 0) return;
      const cnt = (pairCount.get(oldKey) || 0) - 1;
      if (cnt <= 0) pairCount.delete(oldKey);
      else pairCount.set(oldKey, cnt);

      const p = occPrev[nodeIdx];
      const nx = occNext[nodeIdx];
      if (p !== -1) {
        occNext[p] = nx;
      } else if (nx !== -1) {
        occHead.set(oldKey, nx);
      } else {
        occHead.delete(oldKey);
      }
      if (nx !== -1) occPrev[nx] = p;

      occPrev[nodeIdx] = -1;
      occNext[nodeIdx] = -1;
      keyAt[nodeIdx] = -1;
    };

    // Initial pass over all adjacent token pairs
    for (let idx = 0; idx < tokenCount - 1; idx++) {
      linkPair(idx, false);
    }

    // Seed initial heap from deduplicated pair counts
    for (const [key, freq] of pairCount.entries()) {
      if (freq < minFrequency) continue;
      const idA = Math.floor(key / PAIR_KEY_STRIDE);
      const idB = key - idA * PAIR_KEY_STRIDE;
      const sav = freq * (getUtf8LenById(idA) + getUtf8LenById(idB) - 1);
      if (sav >= minSavingsThreshold) {
        heap.push(sav, freq, key);
      }
    }

    const popped = { savings: 0, freq: 0, key: 0 };
    const positionsScratch: number[] = [];
    let currentTokenCount = tokenCount;

    while (dynamicMerged.length < maxDynamicSlots && heap.popInto(popped)) {
      const actualFreq = pairCount.get(popped.key) || 0;
      if (actualFreq < minFrequency) continue;

      const idA = Math.floor(popped.key / PAIR_KEY_STRIDE);
      const idB = popped.key - idA * PAIR_KEY_STRIDE;
      const mergedUtf8Len = getUtf8LenById(idA) + getUtf8LenById(idB);
      const actualSavings = actualFreq * (mergedUtf8Len - 1);
      if (actualSavings < minSavingsThreshold) continue;

      if (actualFreq !== popped.freq) {
        // Frequency shifted since push; reinsert with exact current priority
        heap.push(actualSavings, actualFreq, popped.key);
        continue;
      }

      const newDynIdx = dynamicMerged.length;
      const newDynId = PRECOMPILED_VOCAB_LEN + newDynIdx;
      dynUtf8Lengths[newDynIdx] = mergedUtf8Len;
      dynamicMerged.push(getTokenStrById(idA) + getTokenStrById(idB));

      // Collect occurrences and sort ascending for exact left-to-right non-overlapping merge
      positionsScratch.length = 0;
      let occCur = occHead.get(popped.key);
      while (occCur !== undefined && occCur !== -1) {
        positionsScratch.push(occCur);
        occCur = occNext[occCur];
      }
      if (positionsScratch.length > 1) {
        positionsScratch.sort((a, b) => a - b);
      }

      for (const leftNode of positionsScratch) {
        if (keyAt[leftNode] !== popped.key) continue;
        const rightNode = next[leftNode];
        if (rightNode === -1) continue;

        const leftNeighbor = prev[leftNode];
        const rightNeighbor = next[rightNode];

        if (leftNeighbor !== -1) unlinkPair(leftNeighbor);
        unlinkPair(leftNode);
        unlinkPair(rightNode);

        tokIds[leftNode] = newDynId;
        next[leftNode] = rightNeighbor;
        if (rightNeighbor !== -1) prev[rightNeighbor] = leftNode;
        prev[rightNode] = -1;
        next[rightNode] = -1;
        currentTokenCount--;

        if (leftNeighbor !== -1) linkPair(leftNeighbor, true);
        if (rightNeighbor !== -1) linkPair(leftNode, true);
      }
    }

    // Compact remaining active token IDs into an exact-sized Int32Array
    finalTokenIds = new Int32Array(currentTokenCount);
    let writeIdx = 0;
    let cur = 0;
    while (cur !== -1) {
      finalTokenIds[writeIdx++] = tokIds[cur];
      cur = next[cur];
    }
  } else {
    finalTokenIds = rawIds.slice(0, tokenCount);
  }

  // 3. Build Frequency Dictionary Entries directly from integer IDs (zero string-pair hashing)
  let dictionaryEntries: MtxDictionaryEntry[] = [];
  if (buildDictionaryEntries) {
    const idFreq = new Map<number, number>();
    for (const id of finalTokenIds) {
      idFreq.set(id, (idFreq.get(id) || 0) + 1);
    }

    dictionaryEntries = new Array<MtxDictionaryEntry>(idFreq.size);
    let entryIdx = 0;
    for (const [id, freq] of idFreq.entries()) {
      const tokenStr = getTokenStrById(id);
      const utf8Len = getUtf8LenById(id);
      const saved = freq * Math.max(1, utf8Len - 1);
      const isDiacritized =
        id < PRECOMPILED_VOCAB_LEN
          ? PRECOMPILED_VOCAB_TASHKEEL[id] === 1
          : containsArabicTashkeel(tokenStr);
      const entryType =
        id < PRECOMPILED_VOCAB_LEN
          ? PRECOMPILED_VOCAB_TYPES[id]
          : id >= ESCAPE_ID_BASE
          ? 'escape'
          : getSemanticType(tokenStr);

      dictionaryEntries[entryIdx++] = {
        id: entryIdx - 1,
        token: tokenStr,
        frequency: freq,
        rawUtf8Bytes: utf8Len,
        totalSavedBytes: saved,
        isDiacritized,
        type: entryType,
      };
    }
    dictionaryEntries.sort((a, b) => b.totalSavedBytes - a.totalSavedBytes);
  }

  const escapeUtf8Lengths = new Uint8Array(escapeUtf8LenList);
  const tokenizationDurationMs = Math.round((performance.now() - startTime) * 100) / 100;

  return {
    finalTokenIds,
    dynamicMerged,
    escapeLiterals,
    escapeUtf8Lengths,
    dictionaryEntries,
    tokenizationDurationMs,
  };
}

function getOrComputeTokenizationPlan(
  text: string,
  profile: CompressionProfile,
  useCache: boolean
): CachedTokenizationPlan {
  const canCache = useCache && text.length <= MAX_CACHEABLE_TEXT_CHARS;
  let cacheKey = '';
  if (canCache) {
    cacheKey = `${profile}:${text.length}:${fnv1a32String(text)}`;
    const hit = TOKENIZATION_CACHE.get(cacheKey, text);
    if (hit) {
      return hit;
    }
  }

  const output = executeIntegerBpeTokenization(text, profile, true);
  const plan: CachedTokenizationPlan = {
    text,
    finalTokenIds: output.finalTokenIds,
    dynamicMerged: output.dynamicMerged,
    escapeLiterals: output.escapeLiterals,
    escapeUtf8Lengths: output.escapeUtf8Lengths,
    dictionaryEntries: output.dictionaryEntries,
    tokenizationDurationMs: output.tokenizationDurationMs,
    estimatedBytes:
      text.length * 2 +
      output.finalTokenIds.byteLength +
      output.dictionaryEntries.length * 64,
  };

  if (canCache) {
    TOKENIZATION_CACHE.set(cacheKey, plan);
  }

  return plan;
}

/**
 * Public Morphological & BPE Tokenizer (100% backward-compatible return shape).
 */
export function tokenizeArabicText(
  text: string,
  profile: CompressionProfile = 'balanced'
): {
  tokens: string[];
  dictionaryEntries: MtxDictionaryEntry[];
  dynamicMerged: string[];
  tokenizationDurationMs: number;
} {
  const plan = getOrComputeTokenizationPlan(text, profile, true);
  const ids = plan.finalTokenIds;
  const tokens = new Array<string>(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id < PRECOMPILED_VOCAB_LEN) {
      tokens[i] = PRECOMPILED_VOCAB[id];
    } else if (id < ESCAPE_ID_BASE) {
      tokens[i] = plan.dynamicMerged[id - PRECOMPILED_VOCAB_LEN];
    } else {
      tokens[i] = plan.escapeLiterals[id - ESCAPE_ID_BASE];
    }
  }

  return {
    tokens,
    dictionaryEntries: plan.dictionaryEntries.slice(),
    dynamicMerged: plan.dynamicMerged.slice(),
    tokenizationDurationMs: plan.tokenizationDurationMs,
  };
}

/**
 * Analyzes Arabic text for morphological & diacritic metrics.
 */
export function analyzeArabicText(text: string): ArabicTextAnalysis {
  const rawUtf8Bytes = getUtf8ByteLength(text);

  const tashkeelMatches = text.match(/[\u064B-\u065F\u0670]/g);
  const tashkeelCount = tashkeelMatches ? tashkeelMatches.length : 0;

  const arabicLetterMatches = text.match(/[\u0621-\u064A]/g);
  const arabicLettersCount = arabicLetterMatches ? arabicLetterMatches.length : 0;

  const spaceMatches = text.match(/\s/g);
  const spaceCount = spaceMatches ? spaceMatches.length : 0;

  const punctMatches = text.match(/[،؛؟!«»""''—\-.:()[\]/]/g);
  const punctuationCount = punctMatches ? punctMatches.length : 0;

  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  let detectedPrefixesCount = 0;
  for (const w of words) {
    for (const p of MORPH_PREFIXES) {
      if (w.startsWith(p)) {
        detectedPrefixesCount++;
        break;
      }
    }
  }

  let detectedSuffixesCount = 0;
  for (const w of words) {
    for (const s of MORPH_SUFFIXES) {
      if (w.endsWith(s)) {
        detectedSuffixesCount++;
        break;
      }
    }
  }

  const effectiveCharBase = Math.max(1, arabicLettersCount + tashkeelCount);
  const tashkeelDensityPercent = Math.round((tashkeelCount / effectiveCharBase) * 1000) / 10;

  const estimatedSavingsRatio = tashkeelDensityPercent > 20 ? 0.81 : 0.74;
  const estimatedMtxBytes =
    rawUtf8Bytes === 0 ? 0 : Math.max(32, Math.round(rawUtf8Bytes * (1 - estimatedSavingsRatio)));
  const estimatedSavingsPercent =
    rawUtf8Bytes === 0 ? 0 : Math.round(estimatedSavingsRatio * 1000) / 10;

  return {
    totalChars: text.length,
    arabicLettersCount,
    tashkeelCount,
    tashkeelDensityPercent,
    wordCount,
    spaceCount,
    punctuationCount,
    detectedPrefixesCount,
    detectedSuffixesCount,
    estimatedUtf8Bytes: rawUtf8Bytes,
    estimatedMtxBytes,
    estimatedSavingsPercent,
  };
}

// ============================================================================
// 7. VERSION DETECTION & BINARY PAYLOAD PARSERS
// ============================================================================

export function formatVersionToLabel(magic: MtxMagicType, version: number): string {
  if (magic === 'MTX1') {
    if (version === 1 || version === 10) return 'v1.0';
    return `v1.${version}`;
  }
  if (version >= 10) {
    const major = Math.floor(version / 10);
    const minor = version % 10;
    return `v${major}.${minor}`;
  }
  return `v2.${version}`;
}

const KNOWN_FORMAT_VERSIONS = new Set<number>([
  MTX_FORMAT_VERSIONS.V1_LEGACY,
  MTX_FORMAT_VERSIONS.V1_0,
  MTX_FORMAT_VERSIONS.V2_0,
  MTX_FORMAT_VERSIONS.V2_1,
  MTX_FORMAT_VERSIONS.V2_2,
  MTX_FORMAT_VERSIONS.V2_3,
  MTX_FORMAT_VERSIONS.V2_4,
]);

export function detectMtxFormat(mtxBytes: Uint8Array): MtxFormatDetectionResult {
  if (!(mtxBytes instanceof Uint8Array)) {
    throw new MtxInvalidFormatError('مدخلات غير صالحة: يجب تمرير مصفوفة بايت Uint8Array.');
  }

  if (mtxBytes.length < MTX_HEADER_SIZE) {
    throw new MtxCorruptDataError(
      `الملف تالف: الحجم (${mtxBytes.length} بايت) أصغر من ترويسة MTX المعتمدة (${MTX_HEADER_SIZE} بايت).`
    );
  }

  const isV2 =
    mtxBytes[0] === 0x4d &&
    mtxBytes[1] === 0x54 &&
    mtxBytes[2] === 0x58 &&
    mtxBytes[3] === 0x32;
  const isV1 =
    mtxBytes[0] === 0x4d &&
    mtxBytes[1] === 0x54 &&
    mtxBytes[2] === 0x58 &&
    mtxBytes[3] === 0x31;

  if (!isV2 && !isV1) {
    throw new MtxInvalidFormatError('صيغة غير صالحة: التوقيع السحري للملف لا يطابق MTX1 أو MTX2.');
  }

  const magic: MtxMagicType = isV2 ? 'MTX2' : 'MTX1';
  const formatVersion = mtxBytes[4];
  const flags = mtxBytes[5];

  const hDv = new DataView(mtxBytes.buffer, mtxBytes.byteOffset, mtxBytes.byteLength);
  const salt = hDv.getUint32(6, false);
  const expectedAdler32 = hDv.getUint32(10, false);
  const originalUtf8Bytes = hDv.getUint32(14, false);
  const dictionaryHintCount = hDv.getUint16(18, false);

  const isSupported =
    (magic === 'MTX1' && (formatVersion === 1 || formatVersion === 10)) ||
    (magic === 'MTX2' && KNOWN_FORMAT_VERSIONS.has(formatVersion) && formatVersion >= 20);

  return {
    magic,
    formatVersion,
    versionLabel: formatVersionToLabel(magic, formatVersion),
    isLegacyFormat: magic === 'MTX1' || formatVersion < MTX_FORMAT_VERSIONS.V2_2,
    isCurrentFormat: magic === 'MTX2' && formatVersion === MTX_FORMAT_VERSIONS.V2_4,
    isSupported,
    header: {
      magic,
      formatVersion,
      flags,
      salt,
      expectedAdler32,
      originalUtf8Bytes,
      dictionaryHintCount,
    },
    flagsDecoded: {
      usesRadixTrie: (flags & 0x01) !== 0,
      usesAffixes: (flags & 0x02) !== 0,
      usesFusions: (flags & 0x04) !== 0,
      usesBpe: (flags & 0x08) !== 0,
      usesCipher: (flags & 0x10) !== 0,
      usesEscapeProtocol: formatVersion >= MTX_FORMAT_VERSIONS.V2_2,
      usesExtendedV23Integrity:
        (flags & 0x20) !== 0 && formatVersion >= MTX_FORMAT_VERSIONS.V2_3,
      usesExtendedV24Indexing:
        (flags & 0x40) !== 0 && formatVersion >= MTX_FORMAT_VERSIONS.V2_4,
    },
  };
}

function parseStandardMtxPayload(
  payload: Uint8Array,
  customBaseVocabulary: readonly string[] | null,
  offsetStart = 0
): {
  metadata: MtxMetadata;
  dynamicMerged: string[];
  reverseIndex: ReverseVocabularyIndex | null;
  customFullVocab: string[] | null;
  stream: Uint8Array;
  nextOffset: number;
} {
  const pDv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let off = offsetStart;

  if (payload.length - off < 7) {
    throw new MtxCorruptDataError('الملف تالف: حجم الحمولة أصغر من الحد الأدنى المطلوب.');
  }

  // 1. Metadata block
  const metaLen = pDv.getUint16(off, false);
  off += 2;
  if (off + metaLen > payload.length) {
    throw new MtxCorruptDataError('الملف تالف: بيانات الوصف مقطوعة أو تتجاوز حدود الحمولة.');
  }

  let metadata: MtxMetadata;
  try {
    const metaStr = SHARED_DECODER.decode(payload.subarray(off, off + metaLen));
    const parsed = JSON.parse(metaStr) as Partial<MtxMetadata>;
    metadata = {
      title: typeof parsed.title === 'string' ? parsed.title : 'مخطوطة مسترجعة',
      author: typeof parsed.author === 'string' ? parsed.author : 'كاتب غير معروف',
      chapterTitle: typeof parsed.chapterTitle === 'string' ? parsed.chapterTitle : 'فصل مسترجع',
      chapterIndex: typeof parsed.chapterIndex === 'number' ? parsed.chapterIndex : 1,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      wordCount: parsed.wordCount,
      tags: Array.isArray(parsed.tags) ? parsed.tags : undefined,
      genre: parsed.genre,
      translator: parsed.translator,
      notes: parsed.notes,
      codecVersion: parsed.codecVersion,
      formatVersion: parsed.formatVersion,
    };
  } catch {
    metadata = {
      title: 'مخطوطة مسترجعة',
      author: 'كاتب غير معروف',
      chapterTitle: 'فصل مسترجع',
      chapterIndex: 1,
      createdAt: new Date().toISOString(),
    };
  }
  off += metaLen;

  // 2. Dynamic merges block
  if (off >= payload.length) {
    throw new MtxCorruptDataError('الملف تالف: جدول المقاطع الديناميكي مفقود.');
  }
  const dynCount = payload[off++];
  if (dynCount < 0 || dynCount > 255) {
    throw new MtxCorruptDataError('الملف تالف: حجم القاموس الديناميكي غير صالح.');
  }

  const dynamicMerged = new Array<string>(dynCount);
  for (let i = 0; i < dynCount; i++) {
    if (off >= payload.length) {
      throw new MtxCorruptDataError('الملف تالف: مقاطع القاموس مقطوعة.');
    }
    const len = payload[off++];
    if (off + len > payload.length) {
      throw new MtxCorruptDataError('الملف تالف: طول المقطع الديناميكي يتجاوز حدود البيانات.');
    }
    dynamicMerged[i] = SHARED_DECODER.decode(payload.subarray(off, off + len));
    off += len;
  }

  // 3. Token sequence block
  if (off + 4 > payload.length) {
    throw new MtxCorruptDataError('الملف تالف: ترويسة تيار الرموز مفقودة.');
  }
  const streamByteLen = pDv.getUint32(off, false);
  off += 4;

  if (streamByteLen > MAX_STREAM_BYTE_LEN || off + streamByteLen > payload.length) {
    throw new MtxCorruptDataError('الملف تالف: طول تيار الرموز غير متوافق مع حجم الحمولة.');
  }

  const stream = payload.subarray(off, off + streamByteLen);
  off += streamByteLen;

  if (customBaseVocabulary) {
    return {
      metadata,
      dynamicMerged,
      reverseIndex: null,
      customFullVocab: [...customBaseVocabulary, ...dynamicMerged],
      stream,
      nextOffset: off,
    };
  }

  return {
    metadata,
    dynamicMerged,
    reverseIndex: new ReverseVocabularyIndex(dynamicMerged),
    customFullVocab: null,
    stream,
    nextOffset: off,
  };
}

const ASCII_CHAR_TABLE: readonly string[] = Array.from({ length: 128 }, (_, i) =>
  String.fromCharCode(i)
);

function decodeEscapeUtf8Fast(stream: Uint8Array, offset: number, len: number): string {
  if (len === 1) {
    const b0 = stream[offset];
    if (b0 < 0x80) return ASCII_CHAR_TABLE[b0];
  } else if (len === 2) {
    const b0 = stream[offset];
    const b1 = stream[offset + 1];
    if ((b0 & 0xe0) === 0xc0 && (b1 & 0xc0) === 0x80) {
      const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      if (cp >= 0x80) return String.fromCharCode(cp);
    }
  } else if (len === 3) {
    const b0 = stream[offset];
    const b1 = stream[offset + 1];
    const b2 = stream[offset + 2];
    if ((b0 & 0xf0) === 0xe0 && (b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
      const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      if (cp >= 0x800 && (cp < 0xd800 || cp > 0xdfff)) return String.fromCharCode(cp);
    }
  } else if (len === 4) {
    const b0 = stream[offset];
    const b1 = stream[offset + 1];
    const b2 = stream[offset + 2];
    const b3 = stream[offset + 3];
    if (
      (b0 & 0xf8) === 0xf0 &&
      (b1 & 0xc0) === 0x80 &&
      (b2 & 0xc0) === 0x80 &&
      (b3 & 0xc0) === 0x80
    ) {
      const cp =
        ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      if (cp >= 0x10000 && cp <= 0x10ffff) return String.fromCodePoint(cp);
    }
  }
  return SHARED_DECODER.decode(stream.subarray(offset, offset + len));
}

/**
 * High-speed stream decoder using ReverseVocabularyIndex bound into a reusable flat slot table
 * (zero PRECOMPILED_VOCAB array copying, zero per-token method dispatch), inline UTF-8 escape
 * decoding, and V8 PACKED_ELEMENTS chunk assembly.
 */
export function decodeUniversalEscapeStream(
  stream: Uint8Array,
  vocabLookup: readonly string[] | ReverseVocabularyIndex,
  tokenCountHint = -1
): { text: string; tokenCount: number } {
  const flatTable: readonly (string | undefined)[] =
    vocabLookup instanceof ReverseVocabularyIndex ? vocabLookup.bindFlatTable() : vocabLookup;
  const streamLen = stream.length;

  // Validate tokenCountHint sanity if provided (upper bound safety check)
  if (tokenCountHint > MAX_STREAM_BYTE_LEN) {
    throw new MtxCorruptDataError('الملف تالف: عدد الرموز المصرّح به يتجاوز الحد الأقصى المسموح.');
  }

  const chunks: string[] = [];
  let sOff = 0;
  while (sOff < streamLen) {
    const id = stream[sOff++];
    if (id === ESCAPE_TOKEN) {
      if (sOff >= streamLen) {
        throw new MtxCorruptDataError('الملف تالف: تسلسل ESCAPE_TOKEN مقطوع قبل بايت الطول.');
      }
      const len = stream[sOff++];
      if (sOff + len > streamLen) {
        throw new MtxCorruptDataError('الملف تالف: بيانات UTF-8 داخل ESCAPE_TOKEN مقطوعة.');
      }
      chunks.push(decodeEscapeUtf8Fast(stream, sOff, len));
      sOff += len;
    } else {
      const mapped = flatTable[id];
      if (mapped === undefined) {
        throw new MtxCorruptDataError(`الملف تالف: مرجع رمز غير موجود في القاموس (ID=${id}).`);
      }
      chunks.push(mapped);
    }
  }

  return {
    text: chunks.join(''),
    tokenCount: chunks.length,
  };
}

// ============================================================================
// 8. LEGACY & CURRENT FORMAT DECODERS
// ============================================================================

function decodeLegacySingleByteStream(
  stream: Uint8Array,
  reverseIndex: ReverseVocabularyIndex | null,
  customFullVocab: readonly string[] | null
): { text: string; tokenCount: number } {
  const len = stream.length;
  const chunks = new Array<string>(len);
  if (reverseIndex) {
    for (let i = 0; i < len; i++) {
      chunks[i] = reverseIndex.getOrEmpty(stream[i]);
    }
  } else if (customFullVocab) {
    for (let i = 0; i < len; i++) {
      chunks[i] = customFullVocab[stream[i]] ?? '';
    }
  }
  return {
    text: chunks.join(''),
    tokenCount: len,
  };
}

function tryDecryptAndInflateLegacy(
  encryptedPayload: Uint8Array,
  salt: number,
  expectedAdler32: number,
  customBaseVocabulary: readonly string[] | null,
  profile?: LegacyDecoderProfile
): {
  parsed: ReturnType<typeof parseStandardMtxPayload>;
  decoded: { text: string; tokenCount: number };
} {
  const secret = profile?.cipherSecret ?? MTX_CIPHER_SECRET;
  const candidates: (() => Uint8Array)[] = [];

  if (profile?.customDecryptor) {
    const customFn = profile.customDecryptor;
    candidates.push(() => customFn(encryptedPayload, salt));
  }
  candidates.push(() => applyMtxKeystream(encryptedPayload, salt, secret));
  candidates.push(() => applyLegacyLcgKeystream(encryptedPayload, salt, secret));
  candidates.push(() => encryptedPayload);

  let firstSuccess: {
    parsed: ReturnType<typeof parseStandardMtxPayload>;
    decoded: { text: string; tokenCount: number };
  } | null = null;

  for (const decrypt of candidates) {
    try {
      const decrypted = decrypt();
      const inflated = inflateSync(decrypted);
      const parsed = parseStandardMtxPayload(inflated, customBaseVocabulary, 0);
      const decoded = decodeLegacySingleByteStream(
        parsed.stream,
        parsed.reverseIndex,
        parsed.customFullVocab
      );
      if (calculateAdler32(decoded.text) === expectedAdler32) {
        return { parsed, decoded };
      }
      if (!firstSuccess) {
        firstSuccess = { parsed, decoded };
      }
    } catch {
      // Probe next historical decryption strategy
    }
  }

  if (firstSuccess) return firstSuccess;

  throw new MtxCorruptDataError(
    'فشل فك ضغط ملف MTX القديم: البيانات تالفة أو مشفرة بمفتاح/خوارزمية قديمة غير متطابقة.'
  );
}

/**
 * Legacy Decoder for MTX v1.0 ('MTX1', versions 1 and 10)
 */
export class MtxV1LegacyDecoder implements MtxFormatDecoder {
  readonly decoderId = 'mtx-legacy-v1';
  readonly formatLabel = 'MTX v1.0 (Legacy)';
  readonly supportedMagic: readonly MtxMagicType[] = ['MTX1'];
  readonly supportedVersions: readonly number[] = [
    MTX_FORMAT_VERSIONS.V1_LEGACY,
    MTX_FORMAT_VERSIONS.V1_0,
  ];
  readonly description =
    'مفكك ضغط مخصص لإصدارات MTX 1.x القديمة ذات الترويسة MTX1 وتدفق الرموز أحادي البايت.';

  constructor(private readonly profile?: LegacyDecoderProfile) {}

  canDecode(detection: MtxFormatDetectionResult): boolean {
    return detection.magic === 'MTX1' && this.supportedVersions.includes(detection.formatVersion);
  }

  decode(mtxBytes: Uint8Array, detection: MtxFormatDetectionResult): MtxDecodedPayload {
    const encryptedPayload = mtxBytes.subarray(MTX_HEADER_SIZE);
    const customBase = this.profile?.vocabulary ?? null;

    const { parsed, decoded } = tryDecryptAndInflateLegacy(
      encryptedPayload,
      detection.header.salt,
      detection.header.expectedAdler32,
      customBase,
      this.profile
    );

    const dictSize = parsed.reverseIndex
      ? parsed.reverseIndex.totalSize
      : parsed.customFullVocab?.length ?? PRECOMPILED_VOCAB_LEN;

    return {
      text: decoded.text,
      metadata: parsed.metadata,
      tokenCount: decoded.tokenCount,
      dictionarySize: dictSize,
      originalUtf8Bytes: detection.header.originalUtf8Bytes,
      expectedCrc32: null,
      decoderId: this.decoderId,
      formatLabel: this.formatLabel,
    };
  }
}

/**
 * Legacy Decoder for MTX v2.0 and v2.1 ('MTX2', versions 20 and 21)
 */
export class MtxV20V21LegacyDecoder implements MtxFormatDecoder {
  readonly decoderId = 'mtx-legacy-v2.0-v2.1';
  readonly formatLabel = 'MTX v2.0 / v2.1 (Legacy)';
  readonly supportedMagic: readonly MtxMagicType[] = ['MTX2'];
  readonly supportedVersions: readonly number[] = [
    MTX_FORMAT_VERSIONS.V2_0,
    MTX_FORMAT_VERSIONS.V2_1,
  ];
  readonly description =
    'مفكك ضغط مخصص لإصدارات MTX v2.0 و v2.1 قبل إضافة بروتوكول ESCAPE_TOKEN=255.';

  constructor(private readonly profile?: LegacyDecoderProfile) {}

  canDecode(detection: MtxFormatDetectionResult): boolean {
    return detection.magic === 'MTX2' && this.supportedVersions.includes(detection.formatVersion);
  }

  decode(mtxBytes: Uint8Array, detection: MtxFormatDetectionResult): MtxDecodedPayload {
    const encryptedPayload = mtxBytes.subarray(MTX_HEADER_SIZE);
    const customBase = this.profile?.vocabulary ?? null;

    const { parsed, decoded } = tryDecryptAndInflateLegacy(
      encryptedPayload,
      detection.header.salt,
      detection.header.expectedAdler32,
      customBase,
      this.profile
    );

    const dictSize = parsed.reverseIndex
      ? parsed.reverseIndex.totalSize
      : parsed.customFullVocab?.length ?? PRECOMPILED_VOCAB_LEN;

    return {
      text: decoded.text,
      metadata: parsed.metadata,
      tokenCount: decoded.tokenCount,
      dictionarySize: dictSize,
      originalUtf8Bytes: detection.header.originalUtf8Bytes,
      expectedCrc32: null,
      decoderId: this.decoderId,
      formatLabel:
        detection.formatVersion === MTX_FORMAT_VERSIONS.V2_0
          ? 'MTX v2.0 (Legacy)'
          : 'MTX v2.1 (Legacy)',
    };
  }
}

/**
 * Decoder for MTX v2.2 Fortified Edition ('MTX2', version 22)
 */
export class MtxV22Decoder implements MtxFormatDecoder {
  readonly decoderId = 'mtx-v2.2-fortified';
  readonly formatLabel = 'MTX v2.2 (Fortified)';
  readonly supportedMagic: readonly MtxMagicType[] = ['MTX2'];
  readonly supportedVersions: readonly number[] = [MTX_FORMAT_VERSIONS.V2_2];
  readonly description =
    'مفكك ضغط لإصدار MTX v2.2 المحصّن المزوّد ببروتوكول ESCAPE_TOKEN=255 ومفتاح التدفق غير الخطي.';

  canDecode(detection: MtxFormatDetectionResult): boolean {
    return detection.magic === 'MTX2' && detection.formatVersion === MTX_FORMAT_VERSIONS.V2_2;
  }

  decode(mtxBytes: Uint8Array, detection: MtxFormatDetectionResult): MtxDecodedPayload {
    const encryptedPayload = mtxBytes.subarray(MTX_HEADER_SIZE);
    const decryptedPayload = applyMtxKeystream(encryptedPayload, detection.header.salt);

    let payload: Uint8Array;
    try {
      payload = inflateSync(decryptedPayload);
    } catch {
      throw new MtxCorruptDataError(
        'فشل فك ضغط بيانات MTX v2.2: البيانات غير صالحة أو تعرضت للتلف.'
      );
    }

    const parsed = parseStandardMtxPayload(payload, null, 0);
    const reverseIndex = parsed.reverseIndex!;
    const decoded = decodeUniversalEscapeStream(parsed.stream, reverseIndex);

    return {
      text: decoded.text,
      metadata: parsed.metadata,
      tokenCount: decoded.tokenCount,
      dictionarySize: reverseIndex.totalSize,
      originalUtf8Bytes: detection.header.originalUtf8Bytes,
      expectedCrc32: null,
      decoderId: this.decoderId,
      formatLabel: this.formatLabel,
    };
  }
}

/**
 * Decoder for MTX v2.3 Unified Format ('MTX2', version 23, 'M3HD' integrity block)
 */
export class MtxV23Decoder implements MtxFormatDecoder {
  readonly decoderId = 'mtx-v2.3-unified';
  readonly formatLabel = 'MTX v2.3 (Unified)';
  readonly supportedMagic: readonly MtxMagicType[] = ['MTX2'];
  readonly supportedVersions: readonly number[] = [MTX_FORMAT_VERSIONS.V2_3];
  readonly description =
    'مفكك ضغط إصدار MTX v2.3 مع التحقق المزدوج (Adler-32 + CRC-32) وبصمة القاموس M3HD.';

  canDecode(detection: MtxFormatDetectionResult): boolean {
    return detection.magic === 'MTX2' && detection.formatVersion === MTX_FORMAT_VERSIONS.V2_3;
  }

  decode(mtxBytes: Uint8Array, detection: MtxFormatDetectionResult): MtxDecodedPayload {
    const encryptedPayload = mtxBytes.subarray(MTX_HEADER_SIZE);
    const decryptedPayload = applyMtxKeystream(encryptedPayload, detection.header.salt);

    let payload: Uint8Array;
    try {
      payload = inflateSync(decryptedPayload);
    } catch {
      throw new MtxCorruptDataError(
        'فشل فك ضغط بيانات MTX v2.3: البيانات غير صالحة أو تعرضت للتلف.'
      );
    }

    if (payload.length < MTX_V23_EXTENDED_HEADER_SIZE) {
      throw new MtxCorruptDataError('الملف تالف: ترويسة التحقق الممتدة (M3HD) لإصدار v2.3 مفقودة.');
    }

    if (
      payload[0] !== MTX_V23_PAYLOAD_MAGIC[0] ||
      payload[1] !== MTX_V23_PAYLOAD_MAGIC[1] ||
      payload[2] !== MTX_V23_PAYLOAD_MAGIC[2] ||
      payload[3] !== MTX_V23_PAYLOAD_MAGIC[3]
    ) {
      throw new MtxCorruptDataError('الملف تالف: توقيع ترويسة v2.3 الداخلية (M3HD) غير مطابق.');
    }

    const pDv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const formatSpec = pDv.getUint16(4, false);
    const expectedCrc32 = pDv.getUint32(6, false);
    const vocabHash = pDv.getUint32(10, false);

    if (formatSpec > MTX_V23_FORMAT_SPEC + 9) {
      throw new MtxCorruptDataError(`مواصفة v2.3 الفرعية غير متوافقة (${formatSpec}).`);
    }

    const warnings: string[] = [];
    if (vocabHash !== PRECOMPILED_VOCAB_HASH) {
      warnings.push(
        `تنبيه توافق: بصمة القاموس الثابت في الملف (${vocabHash.toString(16)}) تختلف عن القاموس الحالي.`
      );
    }

    const parsed = parseStandardMtxPayload(payload, null, MTX_V23_EXTENDED_HEADER_SIZE);
    const reverseIndex = parsed.reverseIndex!;
    const decoded = decodeUniversalEscapeStream(parsed.stream, reverseIndex);

    return {
      text: decoded.text,
      metadata: parsed.metadata,
      tokenCount: decoded.tokenCount,
      dictionarySize: reverseIndex.totalSize,
      originalUtf8Bytes: detection.header.originalUtf8Bytes,
      expectedCrc32,
      decoderId: this.decoderId,
      formatLabel: this.formatLabel,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

/**
 * Current Decoder for MTX v2.4 Indexed & Optimized Format ('MTX2', version 24, 'M4HD' header)
 * Uses exact tokenCountHint for pre-allocated reassembly and ReverseVocabularyIndex without array copying.
 */
export class MtxV24Decoder implements MtxFormatDecoder {
  readonly decoderId = 'mtx-v2.4-indexed';
  readonly formatLabel = 'MTX v2.4 (Current Indexed)';
  readonly supportedMagic: readonly MtxMagicType[] = ['MTX2'];
  readonly supportedVersions: readonly number[] = [MTX_FORMAT_VERSIONS.V2_4];
  readonly description =
    'مفكك ضغط الإصدار الحالي MTX v2.4 المزوّد بفهرس عكسي مباشر وتخصيص مسبق دقيق لمصفوفة الاسترجاع M4HD.';

  canDecode(detection: MtxFormatDetectionResult): boolean {
    return detection.magic === 'MTX2' && detection.formatVersion === MTX_FORMAT_VERSIONS.V2_4;
  }

  decode(mtxBytes: Uint8Array, detection: MtxFormatDetectionResult): MtxDecodedPayload {
    const encryptedPayload = mtxBytes.subarray(MTX_HEADER_SIZE);
    const decryptedPayload = applyMtxKeystream(encryptedPayload, detection.header.salt);

    let payload: Uint8Array;
    try {
      payload = inflateSync(decryptedPayload);
    } catch {
      throw new MtxCorruptDataError(
        'فشل فك ضغط بيانات MTX v2.4: البيانات غير صالحة أو تعرضت للتلف.'
      );
    }

    if (payload.length < MTX_V24_EXTENDED_HEADER_SIZE) {
      throw new MtxCorruptDataError('الملف تالف: ترويسة الفهرسة الممتدة (M4HD) لإصدار v2.4 مفقودة.');
    }

    if (
      payload[0] !== MTX_V24_PAYLOAD_MAGIC[0] ||
      payload[1] !== MTX_V24_PAYLOAD_MAGIC[1] ||
      payload[2] !== MTX_V24_PAYLOAD_MAGIC[2] ||
      payload[3] !== MTX_V24_PAYLOAD_MAGIC[3]
    ) {
      throw new MtxCorruptDataError('الملف تالف: توقيع ترويسة v2.4 الداخلية (M4HD) غير مطابق.');
    }

    const pDv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const formatSpec = pDv.getUint16(4, false);
    const expectedCrc32 = pDv.getUint32(6, false);
    const vocabHash = pDv.getUint32(10, false);
    const tokenCountHint = pDv.getUint32(14, false);

    if (formatSpec > MTX_V24_FORMAT_SPEC + 9) {
      throw new MtxCorruptDataError(`مواصفة v2.4 الفرعية غير متوافقة (${formatSpec}).`);
    }

    const warnings: string[] = [];
    if (vocabHash !== PRECOMPILED_VOCAB_HASH) {
      warnings.push(
        `تنبيه توافق: بصمة القاموس الثابت في الملف (${vocabHash.toString(16)}) تختلف عن القاموس الحالي.`
      );
    }

    const parsed = parseStandardMtxPayload(payload, null, MTX_V24_EXTENDED_HEADER_SIZE);
    const reverseIndex = parsed.reverseIndex!;
    const decoded = decodeUniversalEscapeStream(parsed.stream, reverseIndex, tokenCountHint);

    return {
      text: decoded.text,
      metadata: parsed.metadata,
      tokenCount: decoded.tokenCount,
      dictionarySize: reverseIndex.totalSize,
      originalUtf8Bytes: detection.header.originalUtf8Bytes,
      expectedCrc32,
      decoderId: this.decoderId,
      formatLabel: this.formatLabel,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

// ============================================================================
// 9. FORMAT COMPATIBILITY LAYER
// ============================================================================

export class MtxFormatCompatibilityLayer {
  private readonly decoders: MtxFormatDecoder[] = [];

  constructor(initialDecoders: MtxFormatDecoder[] = []) {
    for (const decoder of initialDecoders) {
      this.registerDecoder(decoder);
    }
  }

  registerDecoder(decoder: MtxFormatDecoder): void {
    const existingIdx = this.decoders.findIndex((d) => d.decoderId === decoder.decoderId);
    if (existingIdx >= 0) {
      this.decoders[existingIdx] = decoder;
    } else {
      this.decoders.push(decoder);
    }
  }

  unregisterDecoder(decoderId: string): boolean {
    const idx = this.decoders.findIndex((d) => d.decoderId === decoderId);
    if (idx >= 0) {
      this.decoders.splice(idx, 1);
      return true;
    }
    return false;
  }

  listRegisteredDecoders(): DecoderRegistrationInfo[] {
    return this.decoders.map((d) => ({
      decoderId: d.decoderId,
      formatLabel: d.formatLabel,
      supportedMagic: [...d.supportedMagic],
      supportedVersions: [...d.supportedVersions],
      description: d.description,
    }));
  }

  getSupportedVersions(): number[] {
    const versions = new Set<number>();
    for (const d of this.decoders) {
      for (const v of d.supportedVersions) {
        versions.add(v);
      }
    }
    return Array.from(versions).sort((a, b) => a - b);
  }

  resolveDecoder(detection: MtxFormatDetectionResult): MtxFormatDecoder {
    const match = this.decoders.find((decoder) => decoder.canDecode(detection));
    if (!match) {
      throw new MtxUnsupportedVersionError(
        detection.formatVersion,
        this.getSupportedVersions(),
        `إصدار تنسيق MTX (${detection.versionLabel} / رمز ${detection.formatVersion}) غير مدعوم في طبقة التوافق الحالية. الإصدارات المدعومة: ${this.getSupportedVersions().join(', ')}.`
      );
    }
    return match;
  }

  decode(mtxBytes: Uint8Array, detection: MtxFormatDetectionResult): MtxDecodedPayload {
    const decoder = this.resolveDecoder(detection);
    return decoder.decode(mtxBytes, detection);
  }
}

export function createMtxCompatibilityLayer(
  legacyProfile?: LegacyDecoderProfile
): MtxFormatCompatibilityLayer {
  return new MtxFormatCompatibilityLayer([
    new MtxV24Decoder(),
    new MtxV23Decoder(),
    new MtxV22Decoder(),
    new MtxV20V21LegacyDecoder(legacyProfile),
    new MtxV1LegacyDecoder(legacyProfile),
  ]);
}

export const defaultCompatibilityLayer = createMtxCompatibilityLayer();

// ============================================================================
// 10. UNIFIED MTX ENGINE & PUBLIC COMPATIBILITY APIS
// ============================================================================

export class MtxEngine {
  readonly engineVersion = MTX_ENGINE_VERSION;
  readonly outputFormatVersion = MTX_VERSION;

  constructor(
    private readonly compatibilityLayer: MtxFormatCompatibilityLayer = defaultCompatibilityLayer
  ) {}

  registerFormatDecoder(decoder: MtxFormatDecoder): void {
    this.compatibilityLayer.registerDecoder(decoder);
  }

  getCompatibilityLayer(): MtxFormatCompatibilityLayer {
    return this.compatibilityLayer;
  }

  inspect(mtxBytes: Uint8Array): MtxFormatDetectionResult {
    return detectMtxFormat(mtxBytes);
  }

  /**
   * Compresses text into MTX v2.4 binary format with zero-copy stream building,
   * cached escape literal byte encoding, and integer-ID BPE tokenization.
   */
  async compress(
    text: string,
    metadata: Partial<MtxMetadata> = {},
    options: MtxCompressionOptions = {}
  ): Promise<MtxCompressionResult> {
    const startTime = performance.now();
    const profile: CompressionProfile = options.profile || 'balanced';
    const useCache = options.useCache !== false;

    const rawUtf8 = SHARED_ENCODER.encode(text);
    const rawUtf8Bytes = rawUtf8.length;
    const checksum = calculateAdler32(text);
    const crc32Checksum = calculateCrc32Bytes(rawUtf8);

    const trimmedWords = text.trim();
    const fullMetadata: MtxMetadata = {
      title: metadata.title || 'رواية جديدة',
      author: metadata.author || 'كاتب مجهول',
      chapterTitle: metadata.chapterTitle || 'الفصل الأول',
      chapterIndex: metadata.chapterIndex ?? 1,
      createdAt: metadata.createdAt || new Date().toISOString(),
      wordCount: trimmedWords.length > 0 ? trimmedWords.split(/\s+/).filter(Boolean).length : 0,
      tags: metadata.tags || ['رواية عربية', 'صيغة MTX v2.4'],
      genre: metadata.genre || 'أدب عربي',
      translator: metadata.translator || '',
      notes: metadata.notes || '',
      codecVersion: `MTX ${this.engineVersion} Indexed`,
      formatVersion: this.outputFormatVersion,
    };

    // 1. High-Speed Indexed Radix-Trie + Integer BPE Tokenization
    const plan = getOrComputeTokenizationPlan(text, profile, useCache);
    const finalIds = plan.finalTokenIds;
    const finalLen = finalIds.length;
    const dynamicMerged = plan.dynamicMerged;

    // Pre-encode each unique escape literal once into Uint8Array
    const escapeByteBuffers = new Array<Uint8Array>(plan.escapeLiterals.length);
    for (let e = 0; e < plan.escapeLiterals.length; e++) {
      escapeByteBuffers[e] = SHARED_ENCODER.encode(plan.escapeLiterals[e]);
    }

    // 2. Compute exact stream byte length upfront and write directly into pre-sized payload buffer
    let streamByteLength = 0;
    let escapeTokensCount = 0;
    for (let k = 0; k < finalLen; k++) {
      const id = finalIds[k];
      if (id < ESCAPE_TOKEN) {
        streamByteLength += 1;
      } else {
        escapeTokensCount++;
        const rawBytes =
          id >= ESCAPE_ID_BASE
            ? escapeByteBuffers[id - ESCAPE_ID_BASE]
            : SHARED_ENCODER.encode(dynamicMerged[id - PRECOMPILED_VOCAB_LEN]);
        if (rawBytes.length > 255) {
          streamByteLength += Math.ceil(rawBytes.length / 255) * 2 + rawBytes.length;
        } else {
          streamByteLength += 2 + rawBytes.length;
        }
      }
    }

    // 3. Compact Binary Payload with v2.4 Extended Indexed Integrity Header (M4HD)
    const metaBytes = SHARED_ENCODER.encode(JSON.stringify(fullMetadata));
    if (metaBytes.length > MAX_METADATA_BYTES) {
      throw new MtxInvalidFormatError(
        `حجم بيانات الوصف (${metaBytes.length} بايت) يتجاوز الحد الأقصى المسموح (${MAX_METADATA_BYTES} بايت).`
      );
    }

    const dynBuffers = new Array<Uint8Array>(dynamicMerged.length);
    let dynSectionLen = 1;
    for (let d = 0; d < dynamicMerged.length; d++) {
      const buf = SHARED_ENCODER.encode(dynamicMerged[d]);
      dynBuffers[d] = buf;
      dynSectionLen += 1 + buf.length;
    }

    const payload = new Uint8Array(
      MTX_V24_EXTENDED_HEADER_SIZE + 2 + metaBytes.length + dynSectionLen + 4 + streamByteLength
    );
    const dv = new DataView(payload.buffer);
    let off = 0;

    // v2.4 Extended Indexed Header (18 bytes)
    payload.set(MTX_V24_PAYLOAD_MAGIC, off); // 'M','4','H','D'
    off += 4;
    dv.setUint16(off, MTX_V24_FORMAT_SPEC, false);
    off += 2;
    dv.setUint32(off, crc32Checksum, false);
    off += 4;
    dv.setUint32(off, PRECOMPILED_VOCAB_HASH, false);
    off += 4;
    dv.setUint32(off, finalLen, false); // Exact tokenCountHint for pre-allocated decompression
    off += 4;

    // Metadata block
    dv.setUint16(off, metaBytes.length, false);
    off += 2;
    payload.set(metaBytes, off);
    off += metaBytes.length;

    // Dynamic merges dictionary block
    payload[off++] = dynBuffers.length;
    for (const b of dynBuffers) {
      payload[off++] = b.length;
      payload.set(b, off);
      off += b.length;
    }

    // Token sequence block written directly into payload (zero intermediate array copies)
    dv.setUint32(off, streamByteLength, false);
    off += 4;
    for (let k = 0; k < finalLen; k++) {
      const id = finalIds[k];
      if (id < ESCAPE_TOKEN) {
        payload[off++] = id;
      } else {
        const rawBytes =
          id >= ESCAPE_ID_BASE
            ? escapeByteBuffers[id - ESCAPE_ID_BASE]
            : SHARED_ENCODER.encode(dynamicMerged[id - PRECOMPILED_VOCAB_LEN]);
        if (rawBytes.length > 255) {
          for (let sliceOff = 0; sliceOff < rawBytes.length; sliceOff += 255) {
            const slice = rawBytes.subarray(sliceOff, sliceOff + 255);
            payload[off++] = ESCAPE_TOKEN;
            payload[off++] = slice.length;
            payload.set(slice, off);
            off += slice.length;
          }
        } else {
          payload[off++] = ESCAPE_TOKEN;
          payload[off++] = rawBytes.length;
          payload.set(rawBytes, off);
          off += rawBytes.length;
        }
      }
    }

    // 4. Deflate Entropy Compression
    const deflateLevel = profile === 'fast' ? 5 : profile === 'maximum' ? 9 : 8;
    const compressedPayload = deflateSync(payload, {
      level: deflateLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    });

    // 5. Symmetric Keystream Encryption
    const salt = (Math.random() * 0xffffffff) >>> 0;
    const encryptedPayload = applyMtxKeystream(compressedPayload, salt);

    // 6. Final Output Buffer (20-byte header + encryptedPayload in single allocation)
    const mtxBytes = new Uint8Array(MTX_HEADER_SIZE + encryptedPayload.length);
    mtxBytes.set(MTX_MAGIC, 0);
    mtxBytes[4] = this.outputFormatVersion; // 24 (v2.4)
    mtxBytes[5] = 0x7f; // 0x3f v2.3 flags + 0x40 v2.4 extended indexing flag

    const hDv = new DataView(mtxBytes.buffer);
    hDv.setUint32(6, salt, false);
    hDv.setUint32(10, checksum, false);
    hDv.setUint32(14, rawUtf8Bytes, false);
    hDv.setUint16(18, Math.min(65535, plan.dictionaryEntries.length), false);
    mtxBytes.set(encryptedPayload, MTX_HEADER_SIZE);

    const encodingDurationMs = Math.round((performance.now() - startTime) * 100) / 100;

    // 7. Immediate Lossless Verification
    const verifyStart = performance.now();
    const decompressed = await this.decompress(mtxBytes);
    const decodingDurationMs = Math.round((performance.now() - verifyStart) * 100) / 100;

    const isLossless = decompressed.text === text && decompressed.isLossless;
    const compressedBytes = mtxBytes.length;
    const savingsPercent =
      rawUtf8Bytes === 0
        ? 0
        : Math.max(
            0,
            Math.round(((rawUtf8Bytes - compressedBytes) / rawUtf8Bytes) * 1000) / 10
          );
    const compressionRatio =
      rawUtf8Bytes === 0
        ? 0
        : Math.round((rawUtf8Bytes / Math.max(1, compressedBytes)) * 10) / 10;

    return {
      mtxBytes,
      originalUtf8Bytes: rawUtf8Bytes,
      compressedBytes,
      savingsPercent,
      compressionRatio,
      encodingDurationMs,
      decodingDurationMs,
      tokenizationDurationMs: plan.tokenizationDurationMs,
      dictionary: plan.dictionaryEntries.slice(),
      tokenCount: finalLen,
      metadata: fullMetadata,
      checksum,
      crc32Checksum,
      isLossless,
      profile,
      version: this.outputFormatVersion,
      engineVersion: this.engineVersion,
      escapeTokensCount,
    };
  }

  /**
   * Unified Decompression Interface (supports v1.0, v2.0, v2.1, v2.2, v2.3, and v2.4).
   */
  async decompress(mtxBytes: Uint8Array): Promise<MtxDecompressionResult> {
    const startTime = performance.now();

    const detection = detectMtxFormat(mtxBytes);
    const decoded = this.compatibilityLayer.decode(mtxBytes, detection);

    const actualChecksum = calculateAdler32(decoded.text);
    const actualCrc32 = calculateCrc32(decoded.text);
    const adler32Matched = actualChecksum === detection.header.expectedAdler32;
    const crc32Verified =
      decoded.expectedCrc32 !== null ? actualCrc32 === decoded.expectedCrc32 : null;
    const isLossless = adler32Matched && (crc32Verified === null || crc32Verified === true);

    const decodingDurationMs = Math.round((performance.now() - startTime) * 100) / 100;
    const compressedBytes = mtxBytes.length;
    const effectiveUtf8Bytes =
      decoded.originalUtf8Bytes > 0
        ? decoded.originalUtf8Bytes
        : getUtf8ByteLength(decoded.text);

    const savingsPercent =
      effectiveUtf8Bytes === 0
        ? 0
        : Math.max(
            0,
            Math.round(((effectiveUtf8Bytes - compressedBytes) / effectiveUtf8Bytes) * 1000) / 10
          );

    return {
      text: decoded.text,
      metadata: decoded.metadata,
      decodingDurationMs,
      originalUtf8Bytes: effectiveUtf8Bytes,
      compressedBytes,
      savingsPercent,
      tokenCount: decoded.tokenCount,
      dictionarySize: decoded.dictionarySize,
      isLossless,
      checksum: actualChecksum,
      crc32Checksum: actualCrc32,
      version: detection.formatVersion,
      engineVersion: this.engineVersion,
      formatLabel: decoded.formatLabel,
      decoderId: decoded.decoderId,
      integrityDetails: {
        adler32Matched,
        crc32Verified,
      },
    };
  }
}

export const defaultMtxEngine = new MtxEngine(defaultCompatibilityLayer);

export async function compressToMtx(
  text: string,
  metadata: Partial<MtxMetadata> = {},
  options: MtxCompressionOptions = {}
): Promise<MtxCompressionResult> {
  return defaultMtxEngine.compress(text, metadata, options);
}

export async function decompressFromMtx(mtxBytes: Uint8Array): Promise<MtxDecompressionResult> {
  return defaultMtxEngine.decompress(mtxBytes);
}

export function inspectMtxHeader(mtxBytes: Uint8Array): MtxFormatDetectionResult {
  return defaultMtxEngine.inspect(mtxBytes);
}

export function createMtxDownloadDataUrl(bytes: Uint8Array): string {
  const base64 = uint8ArrayToBase64(bytes);
  return `data:application/octet-stream;base64,${base64}`;
}

export async function downloadMtxFile(bytes: Uint8Array, filename: string): Promise<DownloadResult> {
  const cleanBase =
    filename
      .replace(/[^\w\u0621-\u064A\-_]/g, '_')
      .replace(/_{2,}/g, '_')
      .trim() || 'novel_chapter';
  const finalFilename = cleanBase.endsWith('.mtx') ? cleanBase : `${cleanBase}.mtx`;
  const dataUrl = createMtxDownloadDataUrl(bytes);

  const hasSavePicker = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  if (hasSavePicker) {
    try {
      const pickerFn = (
        window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }
      ).showSaveFilePicker;
      const fileHandle = await pickerFn({
        suggestedName: finalFilename,
        types: [
          {
            description: 'ملف رواية MTX المضغوط (.mtx)',
            accept: {
              'application/octet-stream': ['.mtx'],
            },
          },
        ],
      });

      const writable = await fileHandle.createWritable();
      await writable.write(bytes as unknown as BlobPart);
      await writable.close();

      return {
        dataUrl,
        filename: finalFilename,
        savedViaDialog: true,
      };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        return {
          dataUrl,
          filename: finalFilename,
          savedViaDialog: false,
        };
      }
    }
  }

  try {
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.setAttribute('download', finalFilename);
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      try {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch {
        // ignore
      }
    }, 60000);
  } catch {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = dataUrl;
    a.setAttribute('download', finalFilename);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        if (a.parentNode) document.body.removeChild(a);
      } catch {
        // ignore
      }
    }, 5000);
  }

  return {
    dataUrl,
    filename: finalFilename,
    savedViaDialog: false,
  };
}

export function getHexDump(bytes: Uint8Array, maxBytes = 64): string {
  const slice = bytes.subarray(0, maxBytes);
  const hexParts: string[] = [];
  for (const byte of slice) {
    hexParts.push(byte.toString(16).padStart(2, '0').toUpperCase());
  }
  return hexParts.join(' ');
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
