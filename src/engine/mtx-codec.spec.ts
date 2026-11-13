import { describe, expect, it } from 'vitest';
import {
  ESCAPE_TOKEN,
  MTX_ENGINE_VERSION,
  MTX_VERSION,
  MtxCorruptDataError,
  MtxEngine,
  MtxFormatCompatibilityLayer,
  MtxFormatDecoder,
  MtxFormatDetectionResult,
  MtxInvalidFormatError,
  MtxUnsupportedVersionError,
  PRECOMPILED_VOCAB,
  calculateCrc32,
  calculateCrc32Bytes,
  clearMtxCaches,
  compressToMtx,
  createMtxCompatibilityLayer,
  decodeUniversalEscapeStream,
  decompressFromMtx,
  getMtxCacheStats,
  inspectMtxHeader,
} from './mtx-codec';
import {
  compressV23Baseline,
  decompressV23Baseline,
  encodeExactV22Buffer,
  encodeReconstructedV10Buffer,
  encodeReconstructedV21Buffer,
} from '../app/mtx-workbench-fixtures';

const SAMPLE_ARABIC_TASHKEEL =
  'كَانَ الرَّجُلُ يَسِيرُ فِي طَرِيقٍ طَوِيلٍ، وَالشَّمْسُ تُلْقِي أَشِعَّتَهَا الذَّهَبِيَّةَ عَلَى الرِّمَالِ! قَالَ: «هَلْ هَذَا هُوَ الْمَكَانُ الَّذِي بَحَثْنَا عَنْهُ؟» ثُمَّ تَوَقَّفَ قَلِيلًا.';

const SAMPLE_MIXED_UNICODE =
  'مرحباً بكم في محرك MTX v2.4 🚀 — Mixed RTL/LTR: "Hello, World!" (2026) — رموز خاصة: © ® ™ € £ ¥ ∑ ∞ ≠ ≤ ≥ — إيموجي: 🌙✨📖💎 وتركيبات نادرة: گ پ چ ژ ٱ ﷽';

const SAMPLE_ENGLISH =
  'In the silent corridor of the archive, every compressed chapter preserved its exact punctuation, numbers 1234567890, and structural metadata across versions without losing a single byte. '.repeat(
    60
  );

describe('MTX v2.4 Single-File Indexed Codec Engine & Compatibility', () => {
  it('1. Preserves backward compatibility with v2.1 (reconstructed), v2.2 (exact), and v2.3 (exact)', async () => {
    const v21Lcg = encodeReconstructedV21Buffer(SAMPLE_ARABIC_TASHKEEL, 'lcg');
    const out21 = await decompressFromMtx(v21Lcg);
    expect(out21.version).toBe(21);
    expect(out21.decoderId).toBe('mtx-legacy-v2.0-v2.1');
    expect(out21.text).toBe(SAMPLE_ARABIC_TASHKEEL);
    expect(out21.isLossless).toBe(true);

    const v10 = encodeReconstructedV10Buffer(SAMPLE_ARABIC_TASHKEEL);
    const out10 = await decompressFromMtx(v10);
    expect(out10.version).toBe(10);
    expect(out10.text).toBe(SAMPLE_ARABIC_TASHKEEL);

    const v22 = encodeExactV22Buffer(SAMPLE_MIXED_UNICODE);
    const out22 = await decompressFromMtx(v22);
    expect(out22.version).toBe(22);
    expect(out22.decoderId).toBe('mtx-v2.2-fortified');
    expect(out22.text).toBe(SAMPLE_MIXED_UNICODE);
    expect(out22.isLossless).toBe(true);

    const v23Bytes = await compressV23Baseline(SAMPLE_MIXED_UNICODE, 'balanced');
    const header23 = inspectMtxHeader(v23Bytes);
    expect(header23.formatVersion).toBe(23);
    expect(header23.isCurrentFormat).toBe(false);

    const out23 = await decompressFromMtx(v23Bytes);
    expect(out23.version).toBe(23);
    expect(out23.decoderId).toBe('mtx-v2.3-unified');
    expect(out23.text).toBe(SAMPLE_MIXED_UNICODE);
    expect(out23.isLossless).toBe(true);
    expect(out23.integrityDetails.adler32Matched).toBe(true);
    expect(out23.integrityDetails.crc32Verified).toBe(true);
  });

  it('2. Compresses and decompresses using v2.4 (version=24, M4HD indexed header) with 100% lossless round-trip', async () => {
    expect(MTX_VERSION).toBe(24);
    expect(MTX_ENGINE_VERSION).toBe('2.4.0');
    expect(ESCAPE_TOKEN).toBe(255);

    const comp = await compressToMtx(SAMPLE_ARABIC_TASHKEEL, {
      title: 'اختبار v2.4',
      chapterIndex: 4,
    });
    expect(comp.version).toBe(24);
    expect(comp.engineVersion).toBe('2.4.0');
    expect(comp.isLossless).toBe(true);

    const header = inspectMtxHeader(comp.mtxBytes);
    expect(header.isCurrentFormat).toBe(true);
    expect(header.flagsDecoded.usesExtendedV24Indexing).toBe(true);

    const dec = await decompressFromMtx(comp.mtxBytes);
    expect(dec.version).toBe(24);
    expect(dec.decoderId).toBe('mtx-v2.4-indexed');
    expect(dec.text).toBe(SAMPLE_ARABIC_TASHKEEL);
    expect(dec.isLossless).toBe(true);
    expect(dec.integrityDetails.adler32Matched).toBe(true);
    expect(dec.integrityDetails.crc32Verified).toBe(true);
  });

  it('3. Streaming zero-alloc calculateCrc32 matches TextEncoder UTF-8 bytes identically', () => {
    const encoder = new TextEncoder();
    const cases = [
      '',
      'ASCII 123!',
      SAMPLE_ARABIC_TASHKEEL,
      SAMPLE_MIXED_UNICODE,
      '👨‍👩‍👧‍👦 🚀 🌙 ﷽ 日本語 Ελληνικά',
    ];
    for (const c of cases) {
      expect(calculateCrc32(c)).toBe(calculateCrc32Bytes(encoder.encode(c)));
    }
  });

  it('4. Handles Arabic, English, Unicode, empty text, and large texts without corruption or NaN', async () => {
    const emptyComp = await compressToMtx('');
    expect(emptyComp.savingsPercent).toBe(0);
    expect(Number.isNaN(emptyComp.savingsPercent)).toBe(false);
    const emptyDec = await decompressFromMtx(emptyComp.mtxBytes);
    expect(emptyDec.text).toBe('');
    expect(emptyDec.isLossless).toBe(true);

    const block =
      'في مَدِينَةِ الْأَحْلَامِ الْقَدِيمَةِ، كَانَتِ السَّمَاءُ تَتَلَأْلَأُ بِالنُّجُومِ السَّاطِعَةِ، وَالرِّيَاحُ تَحْمِلُ عَبَقَ الْيَاسَمِينِ وَالنَّارَنْجِ. قَالَ الرَّاوِي: «لَقَدْ مَرَّتْ سَنَوَاتٌ طِوَالٌ مُنْذُ ذَلِكَ الْيَوْمِ!» 🌍✨\n';
    const largeText = block.repeat(450);

    for (const sample of [SAMPLE_MIXED_UNICODE, SAMPLE_ENGLISH, largeText]) {
      const comp = await compressToMtx(sample, {}, { profile: 'maximum', useCache: false });
      const dec = await decompressFromMtx(comp.mtxBytes);
      expect(comp.isLossless).toBe(true);
      expect(dec.isLossless).toBe(true);
      expect(dec.text).toBe(sample);
    }
  });

  it('5. Rejects corrupt payloads, truncated ESCAPE_TOKEN streams, and unsupported versions (v2.5 / v3.0)', async () => {
    await expect(decompressFromMtx(new Uint8Array([0x4d, 0x54]))).rejects.toThrow(
      MtxCorruptDataError
    );

    const badMagic = new Uint8Array(24);
    badMagic.set([0x50, 0x4b, 0x03, 0x04], 0);
    await expect(decompressFromMtx(badMagic)).rejects.toThrow(MtxInvalidFormatError);

    const comp = await compressToMtx('نص تجريبي للفحص');
    const v25 = new Uint8Array(comp.mtxBytes);
    v25[4] = 25;
    await expect(decompressFromMtx(v25)).rejects.toThrow(MtxUnsupportedVersionError);

    const v30 = new Uint8Array(comp.mtxBytes);
    v30[4] = 30;
    await expect(decompressFromMtx(v30)).rejects.toThrow(MtxUnsupportedVersionError);

    const tampered = new Uint8Array(comp.mtxBytes);
    tampered[21] ^= 0xff;
    tampered[22] ^= 0xaa;
    await expect(decompressFromMtx(tampered)).rejects.toThrow(MtxCorruptDataError);

    expect(() =>
      decodeUniversalEscapeStream(new Uint8Array([ESCAPE_TOKEN, 4, 0xf0, 0x9f]), PRECOMPILED_VOCAB)
    ).toThrow(MtxCorruptDataError);
  });

  it('6. Bounded LRU cache avoids memory leaks and speeds up repeated small/medium compressions safely', async () => {
    clearMtxCaches();
    const initial = getMtxCacheStats();
    expect(initial.tokenizationEntries).toBe(0);

    await compressToMtx(SAMPLE_ARABIC_TASHKEEL, {}, { useCache: true });
    const afterFirst = getMtxCacheStats();
    expect(afterFirst.tokenizationMisses).toBe(1);
    expect(afterFirst.tokenizationEntries).toBe(1);

    await compressToMtx(SAMPLE_ARABIC_TASHKEEL, {}, { useCache: true });
    const afterSecond = getMtxCacheStats();
    expect(afterSecond.tokenizationHits).toBe(1);

    // Insert > 24 distinct entries to verify LRU eviction bounds
    for (let idx = 0; idx < 30; idx++) {
      await compressToMtx(`نص فريد رقم ${idx} للتأكد من عدم تجاوز حد الذاكرة المؤقتة`, {}, { useCache: true });
    }
    const afterMany = getMtxCacheStats();
    expect(afterMany.tokenizationEntries).toBeLessThanOrEqual(24);
    expect(afterMany.tokenizationBytes).toBeLessThanOrEqual(1_572_864);
  });

  it('7. Supports registering future format decoders (v2.5) without modifying core engine', async () => {
    const layer: MtxFormatCompatibilityLayer = createMtxCompatibilityLayer();
    const engine = new MtxEngine(layer);

    const mockV25: MtxFormatDecoder = {
      decoderId: 'mtx-v2.5-future',
      formatLabel: 'MTX v2.5 (Future)',
      supportedMagic: ['MTX2'],
      supportedVersions: [25],
      description: 'Future v2.5 plug-in decoder',
      canDecode: (d: MtxFormatDetectionResult) => d.magic === 'MTX2' && d.formatVersion === 25,
      decode: (_b: Uint8Array, d: MtxFormatDetectionResult) => ({
        text: 'FUTURE_V25_OK',
        metadata: {
          title: 'Future',
          author: 'Test',
          chapterTitle: 'Ch1',
          chapterIndex: 1,
          createdAt: '2026-11-13T00:00:00.000Z',
        },
        tokenCount: 1,
        dictionarySize: 225,
        originalUtf8Bytes: d.header.originalUtf8Bytes,
        expectedCrc32: null,
        decoderId: 'mtx-v2.5-future',
        formatLabel: 'MTX v2.5 (Future)',
      }),
    };

    engine.registerFormatDecoder(mockV25);
    const comp = await engine.compress('FUTURE_V25_OK');
    const simV25 = new Uint8Array(comp.mtxBytes);
    simV25[4] = 25;

    const dec = await engine.decompress(simV25);
    expect(dec.text).toBe('FUTURE_V25_OK');
    expect(dec.version).toBe(25);
    expect(dec.engineVersion).toBe('2.4.0');
  });

  it('8. Benchmark: Empirically compares MTX v2.3 vs MTX v2.4 across small, medium, large, mixed, and emoji workloads', async () => {
    const encoder = new TextEncoder();

    const smallArabic = SAMPLE_ARABIC_TASHKEEL; // ~330 B
    const mediumArabic = (SAMPLE_ARABIC_TASHKEEL + ' ').repeat(25); // ~8.5 KB
    const largeArabic = (
      'في مَدِينَةِ الْأَحْلَامِ الْقَدِيمَةِ، كَانَتِ السَّمَاءُ تَتَلَأْلَأُ بِالنُّجُومِ السَّاطِعَةِ، وَالرِّيَاحُ تَحْمِلُ عَبَقَ الْيَاسَمِينِ وَالنَّارَنْجِ. قَالَ الرَّاوِي: «لَقَدْ مَرَّتْ سَنَوَاتٌ طِوَالٌ مُنْذُ ذَلِكَ الْيَوْمِ!» 🌍✨\n'
    ).repeat(350); // ~120 KB
    const mixedUnicodeLarge = (SAMPLE_MIXED_UNICODE + '\n').repeat(180); // ~48 KB

    interface BenchCase {
      name: string;
      text: string;
      rounds: number;
    }

    const cases: BenchCase[] = [
      { name: 'Small Arabic', text: smallArabic, rounds: 100 },
      { name: 'Medium Arabic (~8.5KB)', text: mediumArabic, rounds: 20 },
      { name: 'Large Arabic (~158KB)', text: largeArabic, rounds: 8 },
      { name: 'Mixed RTL/LTR + Emoji (~42KB)', text: mixedUnicodeLarge, rounds: 10 },
      { name: 'English Prose (~11KB)', text: SAMPLE_ENGLISH, rounds: 20 },
    ];

    // Warmup both engines across Arabic + Escape paths to eliminate JIT compilation bias
    clearMtxCaches();
    for (const wText of [smallArabic, SAMPLE_ENGLISH, mediumArabic, mixedUnicodeLarge]) {
      const warmV23 = await compressV23Baseline(wText, 'balanced');
      await decompressV23Baseline(warmV23);
      const warmV24 = await compressToMtx(wText, {}, { profile: 'balanced', useCache: false });
      await decompressFromMtx(warmV24.mtxBytes);
    }

    const rows: Record<string, string | number>[] = [];

    const getHeapUsed = (): number => {
      const p = (globalThis as unknown as { process?: { memoryUsage: () => { heapUsed: number } } })
        .process;
      return p ? p.memoryUsage().heapUsed : 0;
    };

    for (const c of cases) {
      const utf8Bytes = encoder.encode(c.text).length;

      // Measure v2.3
      const v23StartHeap = getHeapUsed();
      const t23CompStart = performance.now();
      let v23SampleBytes: Uint8Array = new Uint8Array(0);
      for (let r = 0; r < c.rounds; r++) {
        v23SampleBytes = await compressV23Baseline(c.text, 'balanced');
      }
      const v23CompMs = (performance.now() - t23CompStart) / c.rounds;
      const v23CompMemKb = Math.max(0, Math.round((getHeapUsed() - v23StartHeap) / 1024));

      const v23DecStartHeap = getHeapUsed();
      const t23DecStart = performance.now();
      for (let r = 0; r < c.rounds; r++) {
        const out = await decompressV23Baseline(v23SampleBytes);
        expect(out.length).toBe(c.text.length);
      }
      const v23DecMs = (performance.now() - t23DecStart) / c.rounds;
      const v23DecMemKb = Math.max(0, Math.round((getHeapUsed() - v23DecStartHeap) / 1024));

      // Measure v2.4 (with useCache: false to fairly measure raw engine algorithmic speedup)
      clearMtxCaches();
      const v24StartHeap = getHeapUsed();
      const t24CompStart = performance.now();
      let v24SampleBytes: Uint8Array = new Uint8Array(0);
      for (let r = 0; r < c.rounds; r++) {
        const res = await compressToMtx(c.text, {}, { profile: 'balanced', useCache: false });
        v24SampleBytes = res.mtxBytes;
      }
      const v24CompMs = (performance.now() - t24CompStart) / c.rounds;
      const v24CompMemKb = Math.max(0, Math.round((getHeapUsed() - v24StartHeap) / 1024));

      const v24DecStartHeap = getHeapUsed();
      const t24DecStart = performance.now();
      for (let r = 0; r < c.rounds; r++) {
        const out = await decompressFromMtx(v24SampleBytes);
        expect(out.text).toBe(c.text);
      }
      const v24DecMs = (performance.now() - t24DecStart) / c.rounds;
      const v24DecMemKb = Math.max(0, Math.round((getHeapUsed() - v24DecStartHeap) / 1024));

      const compSpeedupPct = Math.round(((v23CompMs - v24CompMs) / v23CompMs) * 1000) / 10;
      const decSpeedupPct = Math.round(((v23DecMs - v24DecMs) / v23DecMs) * 1000) / 10;
      const v24CompThroughputMBs =
        Math.round((utf8Bytes / (1024 * 1024) / (v24CompMs / 1000)) * 100) / 100;
      const v24DecThroughputMBs =
        Math.round((utf8Bytes / (1024 * 1024) / (v24DecMs / 1000)) * 100) / 100;

      rows.push({
        workload: c.name,
        utf8Bytes,
        v23Bytes: v23SampleBytes.length,
        v24Bytes: v24SampleBytes.length,
        v23CompMs: Math.round(v23CompMs * 100) / 100,
        v24CompMs: Math.round(v24CompMs * 100) / 100,
        compGainPct: compSpeedupPct,
        v23DecMs: Math.round(v23DecMs * 100) / 100,
        v24DecMs: Math.round(v24DecMs * 100) / 100,
        decGainPct: decSpeedupPct,
        v24CompMBs: v24CompThroughputMBs,
        v24DecMBs: v24DecThroughputMBs,
        v23CompHeapKb: v23CompMemKb,
        v24CompHeapKb: v24CompMemKb,
        v23DecHeapKb: v23DecMemKb,
        v24DecHeapKb: v24DecMemKb,
      });
    }

    console.log('\n=== MTX v2.3 vs MTX v2.4 BENCHMARK RESULTS ===');
    console.table(rows);
    expect(rows.length).toBe(5);
  }, 30_000);
});
