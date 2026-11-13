import { describe, expect, it } from 'vitest';
import {
  ESCAPE_TOKEN,
  EXT_BANK_TOKEN,
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
  analyzeMultilingualText,
  buildLinkedChapterManifest,
  calculateCrc32,
  calculateCrc32Bytes,
  clearMtxCaches,
  compressChapterEdition,
  compressToMtx,
  createMtxCompatibilityLayer,
  decodeUniversalEscapeStream,
  decompressFromMtx,
  decompressMtxBlock,
  decompressMtxParagraphRange,
  defaultVocabularyRegistry,
  detectTextLanguageProfile,
  getMtxCacheStats,
  inspectMtxChunkIndex,
  inspectMtxHeader,
  tokenizeArabicText,
} from './mtx-codec';
import {
  compressV23Baseline,
  compressV24Baseline,
  encodeExactV22Buffer,
  encodeReconstructedV10Buffer,
  encodeReconstructedV21Buffer,
} from '../app/mtx-workbench-fixtures';

// Realistic varied novel samples (Arabic, English, Mixed, Rare, Unicode)
const ARABIC_NOVEL_PARAGRAPHS = [
  'كَانَ الرَّجُلُ يَسِيرُ فِي طَرِيقٍ طَوِيلٍ، وَالشَّمْسُ تُلْقِي أَشِعَّتَهَا الذَّهَبِيَّةَ عَلَى الرِّمَالِ! قَالَ: «هَلْ هَذَا هُوَ الْمَكَانُ الَّذِي بَحَثْنَا عَنْهُ؟» ثُمَّ تَوَقَّفَ قَلِيلًا وَتَأَمَّلَ الْأُفُقَ بِهُدُوءٍ.',
  'في صباحٍ شتويٍّ غائم، جلس طارق أمام نافذة المكتبة القديمة يقلّب أوراق المخطوطة السادسة والعشرين، بينما كانت عقارب الساعة النحاسية تدقّ ببطءٍ شديد. سألت ليلى: «هل تأكّدت من تطابق الهمزات أ إ آ ء ؤ ئ والتاء المربوطة والهاء والألف المقصورة والياء؟»',
  'أجابها بصوتٍ خافت: "نعم، كلّ الأرقام الهندية ٠١٢٣٤٥٦٧٨٩ والعربية 0123456789 وعلامات الترقيم؛ الفاصلة، والفاصلة المنقوطة؛ وعلامة الاستفهام؟ محفوظة حرفياً دون حذف أيّ فراغٍ أو مسافةٍ مزدوجة  أو سطرٍ جديد."',
  'اندفع الفرسان نحو البوابة الشمالية عند منتصف الليل، حيث تعالت أصوات الرياح بين المآذن والحجارة العتيقة، ولم يتبقَّ سوى أثرٍ باهتٍ لرسالةٍ مختومةٍ بالشمع الأحمر.',
];

const ENGLISH_NOVEL_PARAGRAPHS = [
  'Chapter 15: "I\'m certain Alexander didn\'t leave the manuscript here," Elizabeth whispered, glancing toward the rain-streaked window. Well-known scholars had searched Cairo\'s old archive for decades without finding a single page.',
  'He paused beside the mahogany desk, where candlelight flickered across ink-stained margins and half-erased dates (1894–1926). "We can\'t ignore the footnote on page forty-seven," Thomas replied quietly. "Whoever translated these chapters preserved every contraction, hyphenated phrase, and rare proper noun."',
  'Down in the courtyard, footsteps echoed over wet cobblestones—steady, deliberate, and unmistakable. Lady Genevieve clutched her leather satchel tighter; she wouldn\'t surrender the chronicle to Lord Blackwood\'s mercenaries, no matter what price they offered.',
  'Across seventeen kingdoms from Valenholm to Qasr al-Nujum, chroniclers debated whether the twin editions held identical secrets or deliberately diverged in rhythm, metaphor, and dialogue.',
];

const MIXED_NOVEL_PARAGRAPHS = [
  'فتح طارق الملف الرقمي وقال لزميلته: «انظري إلى هذا السطر: "System check: Chapter 15 (ar/en) passed with 100% accuracy!" ثمّ أضاف: "I\'m checking الهمزات والتشكيل الذَّهَبِيَّ alongside well-known terms."»',
  'In the Cairo reading room, Nadia pointed at the marginalia written in crisp Naskh script: «الْمَخْطُوطَةُ الْأُولَى — Manuscript #402», noting how seamlessly the RTL dialogue transitioned into technical English notes without losing spacing or punctuation.',
  'كتب المحرّر ملاحظةً عاجلة: Don\'t alter "قَالَ الرَّاوِي" or normalize \'أحمد\' to \'احمد\'—preserve every diacritic، كل فاصلة؛ وكلّ مسافة مزدوجة  داخل النصّ المختلط (RTL + LTR) لعام 2026!',
];

const RARE_VOCAB_PARAGRAPHS = [
  'Sailing past Archipelago-X9 and Zephyria’s obsidian monoliths, Dr. Kaelen-Vance logged coordinates 31°14\'52"N 29°57\'18"E while deciphering Al-Khwarizmi’s astrolabe inscriptions: «قُطْرُ الزَّاوِيَةِ السَّمْتِيَّةِ ٧٤٫٨٥°» beside cryptographic checksum 0x9F4A2B1C.',
  'استعرض البروفيسور "عبدالرحمن بن خلدون الإشبيلي" مصطلحاتٍ نادرة مثل: الإسطرلابيّات، الزبرجد، السفسطائيّة، والنوادر البلاغيّة، مقارناً إياها بمفردات مثل pneumonoultramicroscopicsilicovolcanoconiosis وsesquipedalianism وquixotic-labyrinthine في الملحق ٣٨٩.',
];

const UNICODE_EMOJI_PARAGRAPHS = [
  'مرحباً بكم في محرك MTX v2.5 🚀 — Mixed RTL/LTR: "Hello, World!" (2026) — رموز خاصة: © ® ™ € £ ¥ ∑ ∞ ≠ ≤ ≥ — إيموجي عائلي مركّب: 👨‍👩‍👧‍👦 🌙✨📖💎 وتركيبات نادرة: گ پ چ ژ ٱ ﷽ こんにちは Ελληνικά',
  'اختبار الرموز الرياضية والعلمية واللغوية: ∀x ∈ ℝ, ∃y : √(x² + y²) ≥ 0 — الأسهم ⇄ ⇪ ⇒ — الزخارف ۞ ۩ ﴿ ﴾ — والمحارف الخاصة دون أي تحريفٍ في البايتات 🧪🔬⚙️📜',
];

function buildVariedCorpus(paragraphs: readonly string[], repeatCount: number): string {
  const out: string[] = [];
  for (let i = 0; i < repeatCount; i++) {
    const base = paragraphs[i % paragraphs.length];
    out.push(`[§${i + 1}] ${base}`);
  }
  return out.join('\n');
}

describe('MTX v2.5 Universal Multilingual Codec Engine', () => {
  it('1. Preserves backward compatibility with v1.0, v2.1, v2.2, v2.3, v2.4, and v2.5', async () => {
    const sampleAr = ARABIC_NOVEL_PARAGRAPHS[0];
    const sampleMixed = MIXED_NOVEL_PARAGRAPHS[0];

    const v10 = encodeReconstructedV10Buffer(sampleAr);
    const out10 = await decompressFromMtx(v10);
    expect(out10.version).toBe(10);
    expect(out10.text).toBe(sampleAr);

    const v21 = encodeReconstructedV21Buffer(sampleAr, 'lcg');
    const out21 = await decompressFromMtx(v21);
    expect(out21.version).toBe(21);
    expect(out21.decoderId).toBe('mtx-legacy-v2.0-v2.1');
    expect(out21.text).toBe(sampleAr);

    const v22 = encodeExactV22Buffer(sampleMixed);
    const out22 = await decompressFromMtx(v22);
    expect(out22.version).toBe(22);
    expect(out22.decoderId).toBe('mtx-v2.2-fortified');
    expect(out22.text).toBe(sampleMixed);

    const v23Bytes = await compressV23Baseline(sampleMixed, 'balanced');
    const out23 = await decompressFromMtx(v23Bytes);
    expect(out23.version).toBe(23);
    expect(out23.decoderId).toBe('mtx-v2.3-unified');
    expect(out23.text).toBe(sampleMixed);
    expect(out23.integrityDetails.crc32Verified).toBe(true);

    const v24Bytes = await compressV24Baseline(sampleMixed, 'balanced');
    const h24 = inspectMtxHeader(v24Bytes);
    expect(h24.formatVersion).toBe(24);
    expect(h24.isCurrentFormat).toBe(false);
    const out24 = await decompressFromMtx(v24Bytes);
    expect(out24.version).toBe(24);
    expect(out24.decoderId).toBe('mtx-v2.4-indexed');
    expect(out24.text).toBe(sampleMixed);
    expect(out24.integrityDetails.crc32Verified).toBe(true);
  });

  it('2. Losslessly preserves Arabic (Tashkeel/Hamza), English (Case/Contractions), Mixed RTL/LTR, Whitespace, Emoji & Empty', async () => {
    expect(MTX_VERSION).toBe(25);
    expect(MTX_ENGINE_VERSION).toBe('2.5.0');
    expect(EXT_BANK_TOKEN).toBe(254);
    expect(ESCAPE_TOKEN).toBe(255);

    const exactCases = [
      '',
      '   \n\t  \n\n  ',
      ARABIC_NOVEL_PARAGRAPHS.join('\n'),
      ENGLISH_NOVEL_PARAGRAPHS.join('\n'),
      MIXED_NOVEL_PARAGRAPHS.join('\n'),
      RARE_VOCAB_PARAGRAPHS.join('\n'),
      UNICODE_EMOJI_PARAGRAPHS.join('\n'),
      'Mixed Case & Spacing:   "I\'m NOT changing   a  SINGLE   space!" — أ إ آ ى ي ة ه ٠١٢٣٤٥٦٧٨٩',
    ];

    for (const src of exactCases) {
      const comp = await compressToMtx(src, {}, { profile: 'maximum', useCache: false });
      expect(comp.version).toBe(25);
      expect(comp.isLossless).toBe(true);
      expect(Number.isNaN(comp.savingsPercent)).toBe(false);

      const dec = await decompressFromMtx(comp.mtxBytes);
      expect(dec.version).toBe(25);
      expect(dec.decoderId).toBe('mtx-v2.5-multilingual');
      expect(dec.text).toBe(src);
      expect(dec.isLossless).toBe(true);
      expect(dec.integrityDetails.adler32Matched).toBe(true);
      expect(dec.integrityDetails.crc32Verified).toBe(true);
    }
  });

  it('3. Selects optimal language bank independently without cross-language interference & supports independent chapter editions', async () => {
    const arText = ARABIC_NOVEL_PARAGRAPHS.join('\n');
    const enText = ENGLISH_NOVEL_PARAGRAPHS.join('\n');
    const mixedText = MIXED_NOVEL_PARAGRAPHS.join('\n');

    expect(detectTextLanguageProfile(arText).recommendedBankCode).toBe('ar');
    expect(detectTextLanguageProfile(enText).recommendedBankCode).toBe('en');
    expect(detectTextLanguageProfile(mixedText).recommendedBankCode).toBe('mixed');

    const analysis = analyzeMultilingualText(mixedText);
    expect(analysis.languageProfile.dominantLanguage).toBe('mixed');
    expect(analysis.englishLettersCount).toBeGreaterThan(20);
    expect(analysis.arabicLettersCount).toBeGreaterThan(20);
    expect(analysis.normalizedSearchPreview.length).toBeGreaterThan(10);

    // Independent chapter 15 editions (different lengths/word counts)
    const arEdition = await compressChapterEdition(
      arText,
      { chapterId: 15, languageCode: 'ar', chapterTitle: 'الفصل الخامس عشر', title: 'ملحمة النيل' },
      { profile: 'balanced', useCache: false }
    );
    const enEdition = await compressChapterEdition(
      enText,
      { chapterId: 15, languageCode: 'en', chapterTitle: 'Chapter Fifteen', title: 'Epic of the Nile' },
      { profile: 'balanced', useCache: false }
    );

    expect(arEdition.bankId).toBe(0);
    expect(enEdition.bankId).toBe(1);
    expect(arEdition.metadata.chapterId).toBe(15);
    expect(enEdition.metadata.chapterId).toBe(15);

    const manifest = buildLinkedChapterManifest(15, [arEdition, enEdition], 'novel-nile-ch15');
    expect(manifest.editions['ar'].languageCode).toBe('ar');
    expect(manifest.editions['en'].languageCode).toBe('en');
    expect(manifest.editions['ar'].crc32Checksum).not.toBe(manifest.editions['en'].crc32Checksum);

    // Decompress each independently
    expect((await decompressFromMtx(arEdition.mtxBytes)).text).toBe(arText);
    expect((await decompressFromMtx(enEdition.mtxBytes)).text).toBe(enText);

    // Public tokenizeArabicText preserves API and handles English
    const tokEn = tokenizeArabicText(enText, 'balanced', 'en');
    expect(tokEn.tokens.join('')).toBe(enText);
  });

  it('4. Supports paragraph-aligned partial chunk indexing & O(1)-block extraction on long novel chapters', async () => {
    const longChapter = buildVariedCorpus(ARABIC_NOVEL_PARAGRAPHS, 180); // ~60KB+ UTF-8, 180 paragraphs
    const comp = await compressToMtx(
      longChapter,
      { chapterId: 42, languageCode: 'ar' },
      { profile: 'balanced', enableChunkIndex: true, targetChunkBytes: 16_384, useCache: false }
    );

    expect(comp.chunkCount).toBeGreaterThanOrEqual(3);
    expect(comp.isLossless).toBe(true);

    const idx = inspectMtxChunkIndex(comp.mtxBytes);
    expect(idx.isChunked).toBe(true);
    expect(idx.chunkCount).toBe(comp.chunkCount);
    expect(idx.chunks.length).toBe(comp.chunkCount);

    // Verify full decompression matches character-for-character
    const fullDec = await decompressFromMtx(comp.mtxBytes);
    expect(fullDec.text).toBe(longChapter);

    // Verify single-block independent decompression
    const midBlock = Math.floor(idx.chunkCount / 2);
    const midMeta = idx.chunks[midBlock];
    const blockText = await decompressMtxBlock(comp.mtxBytes, midBlock);
    expect(blockText).toBe(longChapter.slice(midMeta.charStart, midMeta.charStart + midMeta.charLength));

    // Verify paragraph-range extraction accesses only overlapping block(s)
    const targetParaStart = midMeta.paragraphStart;
    const targetParaEnd = Math.min(
      midMeta.paragraphStart + 2,
      midMeta.paragraphStart + midMeta.paragraphCount - 1
    );
    const partial = await decompressMtxParagraphRange(comp.mtxBytes, targetParaStart, targetParaEnd);
    expect(partial.accessedBlocks).toBe(1);
    expect(partial.totalBlocks).toBe(idx.chunkCount);
    const expectedSlice = longChapter.split('\n').slice(targetParaStart, targetParaEnd + 1).join('\n');
    expect(partial.text).toBe(expectedSlice);
  });

  it('5. Streaming zero-alloc calculateCrc32 matches TextEncoder UTF-8 bytes & rejects corrupt/unsupported payloads', async () => {
    const encoder = new TextEncoder();
    for (const c of ['', 'ASCII 123!', ARABIC_NOVEL_PARAGRAPHS[0], UNICODE_EMOJI_PARAGRAPHS[0]]) {
      expect(calculateCrc32(c)).toBe(calculateCrc32Bytes(encoder.encode(c)));
    }

    await expect(decompressFromMtx(new Uint8Array([0x4d, 0x54]))).rejects.toThrow(
      MtxCorruptDataError
    );

    const badMagic = new Uint8Array(24);
    badMagic.set([0x50, 0x4b, 0x03, 0x04], 0);
    await expect(decompressFromMtx(badMagic)).rejects.toThrow(MtxInvalidFormatError);

    const comp = await compressToMtx('نص تجريبي للفحص — Checksum validation');
    const v26 = new Uint8Array(comp.mtxBytes);
    v26[4] = 26;
    await expect(decompressFromMtx(v26)).rejects.toThrow(MtxUnsupportedVersionError);

    const tampered = new Uint8Array(comp.mtxBytes);
    tampered[21] ^= 0xff;
    tampered[22] ^= 0xaa;
    await expect(decompressFromMtx(tampered)).rejects.toThrow(MtxCorruptDataError);

    expect(() =>
      decodeUniversalEscapeStream(new Uint8Array([ESCAPE_TOKEN, 4, 0xf0, 0x9f]), PRECOMPILED_VOCAB)
    ).toThrow(MtxCorruptDataError);
  });

  it('6. Bounded LRU cache, custom future language bank registration, and v2.6 decoder extensibility work cleanly', async () => {
    clearMtxCaches();
    await compressToMtx(ENGLISH_NOVEL_PARAGRAPHS[0], {}, { useCache: true });
    expect(getMtxCacheStats().tokenizationMisses).toBe(1);
    await compressToMtx(ENGLISH_NOVEL_PARAGRAPHS[0], {}, { useCache: true });
    expect(getMtxCacheStats().tokenizationHits).toBe(1);

    for (let idx = 0; idx < 30; idx++) {
      await compressToMtx(`Unique chapter entry #${idx} — نص فريد`, {}, { useCache: true });
    }
    expect(getMtxCacheStats().tokenizationEntries).toBeLessThanOrEqual(24);
    expect(getMtxCacheStats().tokenizationBytes).toBeLessThanOrEqual(1_572_864);

    // Extensible language pack registration without engine rewrite
    const customFrBank = defaultVocabularyRegistry.register({
      bankId: 3,
      code: 'fr',
      label: 'French Novel Pack',
      primaryTokens: [
        ' ', '\n', '.', ',', '!', '?', "'", '-', 'e', 'a', 's', 't', 'i', 'n', 'r', 'u', 'l', 'o',
        'd', 'c', 'm', 'p', 'v', 'é', 'è', 'ê', 'à', 'ç', 'le ', 'la ', 'de ', 'et ', 'est ', 'les ',
      ],
      extendedTokens: ['L', 'E', 'C', 'h', 'b', 'g', 'f', 'q', 'j', 'y', 'x', 'z', 'k', 'w', 'ô', 'î'],
    });
    expect(customFrBank.bankId).toBe(3);

    const frText = 'Le chapitre est dans la ville et les étoiles brillent.';
    const frComp = await compressToMtx(frText, {}, { languageHint: 'fr', useCache: false });
    expect(frComp.bankId).toBe(3);
    expect((await decompressFromMtx(frComp.mtxBytes)).text).toBe(frText);

    // Future format decoder v2.6 extensibility
    const layer: MtxFormatCompatibilityLayer = createMtxCompatibilityLayer();
    const engine = new MtxEngine(layer);
    const mockV26: MtxFormatDecoder = {
      decoderId: 'mtx-v2.6-future',
      formatLabel: 'MTX v2.6 (Future)',
      supportedMagic: ['MTX2'],
      supportedVersions: [26],
      description: 'Future v2.6 plug-in decoder',
      canDecode: (d: MtxFormatDetectionResult) => d.magic === 'MTX2' && d.formatVersion === 26,
      decode: (_b: Uint8Array, d: MtxFormatDetectionResult) => ({
        text: 'FUTURE_V26_OK',
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
        decoderId: 'mtx-v2.6-future',
        formatLabel: 'MTX v2.6 (Future)',
      }),
    };
    engine.registerFormatDecoder(mockV26);
    const comp = await engine.compress('FUTURE_V26_OK');
    const simV26 = new Uint8Array(comp.mtxBytes);
    simV26[4] = 26;
    const dec = await engine.decompress(simV26);
    expect(dec.text).toBe('FUTURE_V26_OK');
    expect(dec.version).toBe(26);
  });

  it('7. Benchmark Suite (9 Workloads): Empirically compares MTX v2.4 vs MTX v2.5 across Arabic, English, Mixed, Long Novels, Bilingual Chapters, Repetition, Rare Words, and Unicode/Emoji', async () => {
    const encoder = new TextEncoder();

    const highRepetitionText = (
      'قال الملك شاهين للوزير منصور: «احفظ المخطوطة!» — King Shahin told Vizier Mansour: "Guard the chronicle!"\n'
    ).repeat(120);

    const cases: { name: string; text: string; rounds: number }[] = [
      { name: '1. Arabic Only (~10KB)', text: buildVariedCorpus(ARABIC_NOVEL_PARAGRAPHS, 28), rounds: 6 },
      { name: '2. English Only (~11KB)', text: buildVariedCorpus(ENGLISH_NOVEL_PARAGRAPHS, 40), rounds: 6 },
      { name: '3. Mixed RTL/LTR (~10KB)', text: buildVariedCorpus(MIXED_NOVEL_PARAGRAPHS, 32), rounds: 6 },
      { name: '4. Long Arabic Novel (~68KB)', text: buildVariedCorpus(ARABIC_NOVEL_PARAGRAPHS, 185), rounds: 2 },
      { name: '5. Long English Novel (~65KB)', text: buildVariedCorpus(ENGLISH_NOVEL_PARAGRAPHS, 240), rounds: 2 },
      {
        name: '6. Bilingual Ch.15 (AR+EN ~12KB)',
        text: `${buildVariedCorpus(ARABIC_NOVEL_PARAGRAPHS, 16)}\n${buildVariedCorpus(ENGLISH_NOVEL_PARAGRAPHS, 20)}`,
        rounds: 5,
      },
      { name: '7. High Repetition (~14KB)', text: highRepetitionText, rounds: 6 },
      { name: '8. Rare Vocab (~11KB)', text: buildVariedCorpus(RARE_VOCAB_PARAGRAPHS, 36), rounds: 5 },
      { name: '9. Unicode & Emoji (~12KB)', text: buildVariedCorpus(UNICODE_EMOJI_PARAGRAPHS, 40), rounds: 5 },
    ];

    // Warmup V8 JIT thoroughly for both v2.4 and v2.5 across Arabic, English, and Mixed scripts
    clearMtxCaches();
    const warmupSamples = [
      ARABIC_NOVEL_PARAGRAPHS.join('\n'),
      ENGLISH_NOVEL_PARAGRAPHS.join('\n'),
      MIXED_NOVEL_PARAGRAPHS.join('\n'),
    ];
    for (let round = 0; round < 3; round++) {
      for (const w of warmupSamples) {
        const b24 = await compressV24Baseline(w, 'balanced');
        await decompressFromMtx(b24);
        const b25 = await compressToMtx(w, {}, { profile: 'balanced', useCache: false });
        await decompressFromMtx(b25.mtxBytes);
      }
    }

    const getHeapUsed = (): number => {
      const p = (globalThis as unknown as { process?: { memoryUsage: () => { heapUsed: number } } })
        .process;
      return p ? p.memoryUsage().heapUsed : 0;
    };

    const rows: Record<string, string | number>[] = [];

    for (const c of cases) {
      const utf8Bytes = encoder.encode(c.text).length;

      // v2.4 Benchmark
      const h24c0 = getHeapUsed();
      const t24c0 = performance.now();
      let b24: Uint8Array = new Uint8Array(0);
      for (let r = 0; r < c.rounds; r++) {
        b24 = await compressV24Baseline(c.text, 'balanced');
      }
      const v24CompMs = (performance.now() - t24c0) / c.rounds;
      const v24CompHeapKb = Math.max(0, Math.round((getHeapUsed() - h24c0) / 1024));

      const t24d0 = performance.now();
      for (let r = 0; r < c.rounds; r++) {
        const d24 = await decompressFromMtx(b24);
        expect(d24.text.length).toBe(c.text.length);
      }
      const v24DecMs = (performance.now() - t24d0) / c.rounds;

      // v2.5 Benchmark (useCache: false for pure raw engine measurement)
      clearMtxCaches();
      const h25c0 = getHeapUsed();
      const t25c0 = performance.now();
      let b25: Uint8Array = new Uint8Array(0);
      let tokMsSum = 0;
      let idxMsSum = 0;
      let chunks = 1;
      for (let r = 0; r < c.rounds; r++) {
        const res = await compressToMtx(c.text, {}, { profile: 'balanced', useCache: false });
        b25 = res.mtxBytes;
        tokMsSum += res.tokenizationDurationMs;
        idxMsSum += res.indexingDurationMs;
        chunks = res.chunkCount;
      }
      const v25CompMs = (performance.now() - t25c0) / c.rounds;
      const v25CompHeapKb = Math.max(0, Math.round((getHeapUsed() - h25c0) / 1024));

      const t25d0 = performance.now();
      for (let r = 0; r < c.rounds; r++) {
        const d25 = await decompressFromMtx(b25);
        expect(d25.text).toBe(c.text);
      }
      const v25DecMs = (performance.now() - t25d0) / c.rounds;

      const v24Ratio = Math.round((utf8Bytes / Math.max(1, b24.length)) * 100) / 100;
      const v25Ratio = Math.round((utf8Bytes / Math.max(1, b25.length)) * 100) / 100;
      const sizeDeltaPct = Math.round(((b24.length - b25.length) / b24.length) * 1000) / 10;
      const compGainPct = Math.round(((v24CompMs - v25CompMs) / v24CompMs) * 1000) / 10;
      const decGainPct = Math.round(((v24DecMs - v25DecMs) / v24DecMs) * 1000) / 10;

      rows.push({
        workload: c.name,
        utf8Bytes,
        v24Bytes: b24.length,
        v25Bytes: b25.length,
        sizeSavedPct: sizeDeltaPct,
        v24Ratio,
        v25Ratio,
        v24CompMs: Math.round(v24CompMs * 100) / 100,
        v25CompMs: Math.round(v25CompMs * 100) / 100,
        compGainPct,
        v24DecMs: Math.round(v24DecMs * 100) / 100,
        v25DecMs: Math.round(v25DecMs * 100) / 100,
        decGainPct,
        tokMs: Math.round((tokMsSum / c.rounds) * 100) / 100,
        idxMs: Math.round((idxMsSum / c.rounds) * 100) / 100,
        v25CompMBs: Math.round((utf8Bytes / (1024 * 1024) / (v25CompMs / 1000)) * 100) / 100,
        v25DecMBs: Math.round((utf8Bytes / (1024 * 1024) / (v25DecMs / 1000)) * 100) / 100,
        v24HeapKb: v24CompHeapKb,
        v25HeapKb: v25CompHeapKb,
        chunks,
      });
    }

    console.log('\n=== MTX v2.4 vs MTX v2.5 MULTILINGUAL BENCHMARK RESULTS (9 WORKLOADS) ===');
    console.table(rows);
    expect(rows.length).toBe(9);
  }, 60_000);
});
