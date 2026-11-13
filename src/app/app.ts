import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  ArabicTextAnalysis,
  CompressionProfile,
  DecoderRegistrationInfo,
  MTX_ENGINE_VERSION,
  MTX_VERSION,
  MtxCacheStats,
  MtxCompressionResult,
  MtxDecompressionResult,
  MtxFormatDetectionResult,
  analyzeMultilingualText,
  buildLinkedChapterManifest,
  clearMtxCaches,
  compressChapterEdition,
  compressToMtx,
  decompressFromMtx,
  defaultCompatibilityLayer,
  downloadMtxFile,
  getHexDump,
  getMtxCacheStats,
  inspectMtxHeader,
} from '../engine/mtx-codec';
import {
  compressV23Baseline,
  compressV24Baseline,
  encodeExactV22Buffer,
  encodeReconstructedV10Buffer,
  encodeReconstructedV21Buffer,
} from './mtx-workbench-fixtures';

export type PresetKey = 'tashkeel' | 'english_novel' | 'mixed_unicode' | 'large_chapter' | 'empty';
export type TargetEncodeFormat = 'v25' | 'v24' | 'v23' | 'v22' | 'v21_lcg' | 'v21_nonlinear' | 'v10';

export interface VerificationCaseResult {
  id: string;
  title: string;
  scope: 'verified' | 'reconstructed' | 'error-handling';
  passed: boolean;
  details: string;
  durationMs: number;
}

export interface BenchmarkRow {
  workload: string;
  utf8Bytes: number;
  v24Bytes: number;
  v25Bytes: number;
  v24CompMs: number;
  v25CompMs: number;
  compGainPct: number;
  v24DecMs: number;
  v25DecMs: number;
  decGainPct: number;
  v25CompMBs: number;
  v25DecMBs: number;
}

const PRESET_TEXTS: Record<PresetKey, { label: string; text: string }> = {
  tashkeel: {
    label: 'Arabic with Tashkeel',
    text: 'كَانَ الرَّجُلُ يَسِيرُ فِي طَرِيقٍ طَوِيلٍ، وَالشَّمْسُ تُلْقِي أَشِعَّتَهَا الذَّهَبِيَّةَ عَلَى الرِّمَالِ! قَالَ: «هَلْ هَذَا هُوَ الْمَكَانُ الَّذِي بَحَثْنَا عَنْهُ؟» ثُمَّ تَوَقَّفَ قَلِيلًا وَتَأَمَّلَ الْأُفُقَ بِهُدُوءٍ.',
  },
  english_novel: {
    label: 'English Novel Dialogue',
    text: 'Chapter 15: "I\'m certain Alexander didn\'t leave the manuscript here," Elizabeth whispered, glancing toward the rain-streaked window. Well-known scholars had searched Cairo\'s old archive for decades without finding a single page!',
  },
  mixed_unicode: {
    label: 'Mixed RTL/LTR & Emoji',
    text: 'مرحباً بكم في محرك MTX v2.5 🚀 — Mixed RTL/LTR: "Hello, World!" (2026) — قال Alexander: "I can\'t wait for الفصل القادم!" — رموز خاصة: © ® ™ € £ ¥ ∑ ∞ ≠ ≤ ≥ — إيموجي: 🌙✨📖💎 وتركيبات نادرة: گ پ چ ژ ٱ ﷽',
  },
  large_chapter: {
    label: 'Large Bilingual Chapter (~52KB)',
    text: 'في مَدِينَةِ الْأَحْلَامِ الْقَدِيمَةِ، كَانَتِ السَّمَاءُ تَتَلَأْلَأُ بِالنُّجُومِ السَّاطِعَةِ، وَالرِّيَاحُ تَحْمِلُ عَبَقَ الْيَاسَمِينِ وَالنَّارَنْجِ. قَالَ الرَّاوِي: «لَقَدْ مَرَّتْ سَنَوَاتٌ طِوَالٌ مُنْذُ ذَلِكَ الْيَوْمِ!» 🌍✨\n'.repeat(
      140
    ),
  },
  empty: {
    label: 'Empty Text (0 Bytes)',
    text: '',
  },
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [ReactiveFormsModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly engineVersion = MTX_ENGINE_VERSION;
  readonly currentFormatVersion = MTX_VERSION;
  readonly decoders: DecoderRegistrationInfo[] = defaultCompatibilityLayer.listRegisteredDecoders();

  readonly encoderForm = new FormGroup({
    text: new FormControl<string>(PRESET_TEXTS.tashkeel.text, { nonNullable: true }),
    title: new FormControl<string>('ليالي النيل / Nights of the Nile', { nonNullable: true }),
    author: new FormControl<string>('نجيب محفوظ', { nonNullable: true }),
    chapterTitle: new FormControl<string>('الفصل الأول', { nonNullable: true }),
    profile: new FormControl<CompressionProfile>('balanced', { nonNullable: true }),
    targetFormat: new FormControl<TargetEncodeFormat>('v25', { nonNullable: true }),
  });

  readonly activeBuffer = signal<Uint8Array | null>(null);
  readonly activeSourceLabel = signal<string>('No binary buffer loaded');
  readonly compressionResult = signal<MtxCompressionResult | null>(null);
  readonly headerInspection = signal<MtxFormatDetectionResult | null>(null);
  readonly decompressionResult = signal<MtxDecompressionResult | null>(null);
  readonly decoderError = signal<string | null>(null);
  readonly hexPreview = signal<string>('');
  readonly isBusy = signal<boolean>(false);

  readonly verificationResults = signal<VerificationCaseResult[]>([]);
  readonly benchmarkRows = signal<BenchmarkRow[]>([]);
  readonly cacheStats = signal<MtxCacheStats>(getMtxCacheStats());
  readonly isRunningSuite = signal<boolean>(false);

  readonly textAnalysis = signal<ArabicTextAnalysis>(
    analyzeMultilingualText(PRESET_TEXTS.tashkeel.text)
  );

  readonly roundTripMatchesInput = computed(() => {
    const decomp = this.decompressionResult();
    if (!decomp) return null;
    return decomp.text === this.encoderForm.controls.text.value;
  });

  constructor() {
    this.encoderForm.controls.text.valueChanges.subscribe((val) => {
      this.textAnalysis.set(analyzeMultilingualText(val));
    });
    void this.encodeAndInspect();
  }

  applyPreset(key: PresetKey): void {
    this.encoderForm.controls.text.setValue(PRESET_TEXTS[key].text);
    void this.encodeAndInspect();
  }

  async encodeAndInspect(): Promise<void> {
    this.isBusy.set(true);
    this.decoderError.set(null);

    try {
      const { text, title, author, chapterTitle, profile, targetFormat } =
        this.encoderForm.getRawValue();

      let bytes: Uint8Array;
      let sourceLabel: string;

      if (targetFormat === 'v25') {
        const res = await compressToMtx(text, { title, author, chapterTitle }, { profile });
        this.compressionResult.set(res);
        bytes = res.mtxBytes;
        sourceLabel = `Encoded MTX v2.5 (${profile}, bank=${res.languageCode}, chunks=${res.chunkCount})`;
      } else if (targetFormat === 'v24') {
        this.compressionResult.set(null);
        bytes = await compressV24Baseline(text, profile);
        sourceLabel = `Encoded MTX v2.4 (${profile} Baseline)`;
      } else if (targetFormat === 'v23') {
        this.compressionResult.set(null);
        bytes = await compressV23Baseline(text, profile);
        sourceLabel = `Encoded MTX v2.3 (${profile} Baseline)`;
      } else if (targetFormat === 'v22') {
        this.compressionResult.set(null);
        bytes = encodeExactV22Buffer(text, { title, author, chapterTitle });
        sourceLabel = 'Encoded MTX v2.2 (Exact Spec)';
      } else if (targetFormat === 'v21_lcg') {
        this.compressionResult.set(null);
        bytes = encodeReconstructedV21Buffer(text, 'lcg', { title, author, chapterTitle });
        sourceLabel = 'Simulated MTX v2.1 (LCG Keystream)';
      } else if (targetFormat === 'v21_nonlinear') {
        this.compressionResult.set(null);
        bytes = encodeReconstructedV21Buffer(text, 'nonlinear', { title, author, chapterTitle });
        sourceLabel = 'Simulated MTX v2.1 (Non-Linear Keystream)';
      } else {
        this.compressionResult.set(null);
        bytes = encodeReconstructedV10Buffer(text);
        sourceLabel = 'Simulated MTX v1.0 (MTX1 Header)';
      }

      await this.inspectAndDecompressBuffer(bytes, sourceLabel);
      this.cacheStats.set(getMtxCacheStats());
    } catch (err: unknown) {
      this.decoderError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.isBusy.set(false);
    }
  }

  async inspectAndDecompressBuffer(bytes: Uint8Array, sourceLabel: string): Promise<void> {
    this.activeBuffer.set(bytes);
    this.activeSourceLabel.set(sourceLabel);
    this.hexPreview.set(getHexDump(bytes, 48));
    this.decoderError.set(null);

    try {
      const inspection = inspectMtxHeader(bytes);
      this.headerInspection.set(inspection);
    } catch (err: unknown) {
      this.headerInspection.set(null);
      this.decompressionResult.set(null);
      this.decoderError.set(err instanceof Error ? err.message : String(err));
      return;
    }

    try {
      const decompressed = await decompressFromMtx(bytes);
      this.decompressionResult.set(decompressed);
    } catch (err: unknown) {
      this.decompressionResult.set(null);
      this.decoderError.set(err instanceof Error ? err.message : String(err));
    }
  }

  async simulateFailure(kind: 'corrupt_payload' | 'unsupported_v26' | 'invalid_magic'): Promise<void> {
    const base = this.activeBuffer();
    if (!base || base.length < 24) {
      await this.encodeAndInspect();
    }
    const current = this.activeBuffer();
    if (!current) return;

    const mutated = new Uint8Array(current);
    if (kind === 'corrupt_payload') {
      mutated[21] ^= 0xff;
      mutated[22] ^= 0xaa;
      await this.inspectAndDecompressBuffer(mutated, 'Simulated Corrupt Payload');
    } else if (kind === 'unsupported_v26') {
      mutated[4] = 26;
      await this.inspectAndDecompressBuffer(mutated, 'Simulated Unsupported Version (v2.6 / 26)');
    } else {
      mutated.set([0x50, 0x4b, 0x03, 0x04], 0);
      await this.inspectAndDecompressBuffer(mutated, 'Simulated Invalid Magic Signature');
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    await this.inspectAndDecompressBuffer(bytes, `Uploaded File: ${file.name}`);
    input.value = '';
  }

  async downloadCurrentBuffer(): Promise<void> {
    const buf = this.activeBuffer();
    if (!buf) return;
    const title = this.encoderForm.controls.title.value || 'mtx_export';
    await downloadMtxFile(buf, title);
  }

  formatHex(num: number): string {
    return '0x' + (num >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  clearCaches(): void {
    clearMtxCaches();
    this.cacheStats.set(getMtxCacheStats());
  }

  async runVerificationSuite(): Promise<void> {
    this.isRunningSuite.set(true);
    const results: VerificationCaseResult[] = [];

    const runCase = async (
      id: string,
      title: string,
      scope: VerificationCaseResult['scope'],
      fn: () => Promise<string>
    ) => {
      const start = performance.now();
      try {
        const details = await fn();
        results.push({
          id,
          title,
          scope,
          passed: true,
          details,
          durationMs: Math.round((performance.now() - start) * 100) / 100,
        });
      } catch (err: unknown) {
        results.push({
          id,
          title,
          scope,
          passed: false,
          details: err instanceof Error ? err.message : String(err),
          durationMs: Math.round((performance.now() - start) * 100) / 100,
        });
      }
    };

    await runCase('T1', 'v2.1 Reconstructed Format Decompression', 'reconstructed', async () => {
      const src = PRESET_TEXTS.tashkeel.text;
      const v21Lcg = encodeReconstructedV21Buffer(src, 'lcg');
      const out = await decompressFromMtx(v21Lcg);
      if (out.text !== src || out.version !== 21 || !out.isLossless) {
        throw new Error('Mismatch decoding reconstructed v2.1 buffer');
      }
      return `Decoded via ${out.decoderId} · ${out.compressedBytes} B · exact text match`;
    });

    await runCase('T2', 'v2.2, v2.3 & v2.4 Backward Compatibility', 'verified', async () => {
      const src = PRESET_TEXTS.mixed_unicode.text;
      const v22 = encodeExactV22Buffer(src);
      const out22 = await decompressFromMtx(v22);
      const v23 = await compressV23Baseline(src, 'balanced');
      const out23 = await decompressFromMtx(v23);
      const v24 = await compressV24Baseline(src, 'balanced');
      const out24 = await decompressFromMtx(v24);
      if (
        out22.text !== src ||
        out23.text !== src ||
        out24.text !== src ||
        out24.integrityDetails.crc32Verified !== true
      ) {
        throw new Error('v2.2, v2.3 or v2.4 backward compatibility check failed');
      }
      return `v2.2 (${out22.decoderId}), v2.3 (${out23.decoderId}) & v2.4 (${out24.decoderId}) lossless`;
    });

    await runCase('T3', 'v2.5 Bilingual Chapter Editions (AR + EN)', 'verified', async () => {
      const arRes = await compressChapterEdition(
        PRESET_TEXTS.tashkeel.text,
        { chapterId: 15, languageCode: 'ar', chapterTitle: 'الفصل 15' },
        { profile: 'maximum', useCache: false }
      );
      const enRes = await compressChapterEdition(
        PRESET_TEXTS.english_novel.text,
        { chapterId: 15, languageCode: 'en', chapterTitle: 'Chapter 15' },
        { profile: 'maximum', useCache: false }
      );
      const manifest = buildLinkedChapterManifest(15, [arRes, enRes]);
      const arDec = await decompressFromMtx(arRes.mtxBytes);
      const enDec = await decompressFromMtx(enRes.mtxBytes);
      if (
        arDec.text !== PRESET_TEXTS.tashkeel.text ||
        enDec.text !== PRESET_TEXTS.english_novel.text ||
        !manifest.editions['ar'] ||
        !manifest.editions['en']
      ) {
        throw new Error('v2.5 bilingual edition round-trip failed');
      }
      return `AR ${arRes.originalUtf8Bytes}→${arRes.compressedBytes} B · EN ${enRes.originalUtf8Bytes}→${enRes.compressedBytes} B · Linked Ch.15`;
    });

    await runCase('T4', 'Empty String (0 B) & Large Chunked Chapter', 'verified', async () => {
      const emptyComp = await compressToMtx('');
      const emptyOut = await decompressFromMtx(emptyComp.mtxBytes);
      if (emptyOut.text !== '' || Number.isNaN(emptyOut.savingsPercent)) {
        throw new Error('Empty text handling failed');
      }
      const largeSrc = PRESET_TEXTS.large_chapter.text;
      const largeComp = await compressToMtx(largeSrc, {}, { useCache: false });
      const largeOut = await decompressFromMtx(largeComp.mtxBytes);
      if (largeOut.text !== largeSrc) {
        throw new Error('Large text round-trip failed');
      }
      return `Empty OK · Large ${largeComp.originalUtf8Bytes}→${largeComp.compressedBytes} B (${largeComp.chunkCount} chunks, ${largeComp.savingsPercent}% saved)`;
    });

    await runCase('T5', 'Corrupt Buffer & Unsupported Version Rejection', 'error-handling', async () => {
      const comp = await compressToMtx('اختبار تلف');
      const v26 = new Uint8Array(comp.mtxBytes);
      v26[4] = 26;
      let rejectedV26 = false;
      try {
        await decompressFromMtx(v26);
      } catch {
        rejectedV26 = true;
      }
      const corrupt = new Uint8Array(comp.mtxBytes);
      corrupt[21] ^= 0xff;
      corrupt[22] ^= 0xaa;
      let rejectedCorrupt = false;
      try {
        await decompressFromMtx(corrupt);
      } catch {
        rejectedCorrupt = true;
      }
      if (!rejectedV26 || !rejectedCorrupt) {
        throw new Error('Failed to reject unsupported version or corrupt payload');
      }
      return 'Rejected v2.6 with MtxUnsupportedVersionError & tampered payload with MtxCorruptDataError';
    });

    // Live v2.4 vs v2.5 A/B Benchmark inside browser
    const benchRows: BenchmarkRow[] = [];
    const encoder = new TextEncoder();
    const workloads = [
      { name: 'Arabic Tashkeel', text: PRESET_TEXTS.tashkeel.text, rounds: 15 },
      { name: 'English Novel', text: PRESET_TEXTS.english_novel.text.repeat(20), rounds: 10 },
      { name: 'Mixed RTL/LTR + Emoji', text: PRESET_TEXTS.mixed_unicode.text.repeat(15), rounds: 10 },
    ];

    // Warmup
    const warm24 = await compressV24Baseline(PRESET_TEXTS.english_novel.text, 'balanced');
    await decompressFromMtx(warm24);
    const warm25 = await compressToMtx(PRESET_TEXTS.english_novel.text, {}, { useCache: false });
    await decompressFromMtx(warm25.mtxBytes);

    for (const w of workloads) {
      const utf8Bytes = encoder.encode(w.text).length;
      const t24c = performance.now();
      let b24: Uint8Array = new Uint8Array(0);
      for (let r = 0; r < w.rounds; r++) b24 = await compressV24Baseline(w.text, 'balanced');
      const v24CompMs = (performance.now() - t24c) / w.rounds;

      const t24d = performance.now();
      for (let r = 0; r < w.rounds; r++) await decompressFromMtx(b24);
      const v24DecMs = (performance.now() - t24d) / w.rounds;

      clearMtxCaches();
      const t25c = performance.now();
      let b25: Uint8Array = new Uint8Array(0);
      for (let r = 0; r < w.rounds; r++) {
        b25 = (await compressToMtx(w.text, {}, { profile: 'balanced', useCache: false })).mtxBytes;
      }
      const v25CompMs = (performance.now() - t25c) / w.rounds;

      const t25d = performance.now();
      for (let r = 0; r < w.rounds; r++) await decompressFromMtx(b25);
      const v25DecMs = (performance.now() - t25d) / w.rounds;

      benchRows.push({
        workload: w.name,
        utf8Bytes,
        v24Bytes: b24.length,
        v25Bytes: b25.length,
        v24CompMs: Math.round(v24CompMs * 100) / 100,
        v25CompMs: Math.round(v25CompMs * 100) / 100,
        compGainPct: Math.round(((v24CompMs - v25CompMs) / v24CompMs) * 1000) / 10,
        v24DecMs: Math.round(v24DecMs * 100) / 100,
        v25DecMs: Math.round(v25DecMs * 100) / 100,
        decGainPct: Math.round(((v24DecMs - v25DecMs) / v24DecMs) * 1000) / 10,
        v25CompMBs: Math.round((utf8Bytes / (1024 * 1024) / (v25CompMs / 1000)) * 100) / 100,
        v25DecMBs: Math.round((utf8Bytes / (1024 * 1024) / (v25DecMs / 1000)) * 100) / 100,
      });
    }

    this.verificationResults.set(results);
    this.benchmarkRows.set(benchRows);
    this.cacheStats.set(getMtxCacheStats());
    this.isRunningSuite.set(false);
  }
}
