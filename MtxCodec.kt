@file:Suppress("unused", "MemberVisibilityCanBePrivate")

// ضع اسم الحزمة الخاصة بمشروعك هنا عند إضافة الملف إلى تطبيق الأندرويد:
// package com.example.novelapp.codec

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.Deflater
import java.util.zip.Inflater
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round

/**
 * MTX Universal Text Compression & Multilingual Novel Engine — v2.5.0 (Format v25)
 * ---------------------------------------------------------------------------------
 * نسخة Kotlin مستقلة بالكامل في ملف واحد جاهز للإضافة مباشرة إلى أي مشروع Android / JVM
 * بدون أي اعتماديات خارجية (يعتمد فقط على Kotlin Stdlib + Android SDK Built-in APIs).
 *
 * التوافق الثنائي 100% (Byte-for-Byte Wire Compatible) مع محرك TypeScript MTX v2.5:
 * - يدعم فك ضغط جميع الإصدارات السابقة والحالية: v1.0 (MTX1), v2.0, v2.1, v2.2, v2.3 (M3HD), v2.4 (M4HD), v2.5 (M5HD).
 * - يدعم العربية (مع كامل التشكيل والشدة والهمزات والأرقام الهندية) والإنجليزية والنصوص المختلطة (RTL/LTR) بدون تطبيع هدّام.
 * - يدعم ضغط كل نسخة لغة من الفصل بشكل مستقل مع ربطها ببيانات الفصل (chapterId / translationGroupId).
 * - يدعم الفهرسة الجزئية للكتل على حدود الفقرات (M5HD Chunk Index) واسترجاع كتلة أو نطاق فقرات مباشرة.
 * - قابل للتوسعة لإضافة بنوك لغات مستقبلية ومفككات صيغ مستقبلية (v2.6+) دون إعادة كتابة المحرك.
 */

// ============================================================================
// 1. CONSTANTS, FORMAT VERSIONS, TYPES & INTERFACES
// ============================================================================

object MtxFormatVersions {
    const val V1_LEGACY: Int = 1
    const val V1_0: Int = 10
    const val V2_0: Int = 20
    const val V2_1: Int = 21
    const val V2_2: Int = 22
    const val V2_3: Int = 23
    const val V2_4: Int = 24
    const val V2_5: Int = 25
}

object MtxConstants {
    const val MTX_ENGINE_VERSION: String = "2.5.0"
    const val MTX_VERSION: Int = MtxFormatVersions.V2_5
    const val MTX_CIPHER_SECRET: String = "MTX_ARABIC_SECURE_CODEC_V2_2_FORTIFIED_2026"
    const val EXT_BANK_TOKEN: Int = 254
    const val ESCAPE_TOKEN: Int = 255
    const val MTX_HEADER_SIZE: Int = 20

    val MTX_MAGIC_V1: ByteArray = byteArrayOf(0x4D, 0x54, 0x58, 0x31) // "MTX1"
    val MTX_MAGIC_V2: ByteArray = byteArrayOf(0x4D, 0x54, 0x58, 0x32) // "MTX2"

    val MTX_V23_PAYLOAD_MAGIC: ByteArray = byteArrayOf(0x4D, 0x33, 0x48, 0x44) // "M3HD"
    const val MTX_V23_EXTENDED_HEADER_SIZE: Int = 14
    const val MTX_V23_FORMAT_SPEC: Int = 230

    val MTX_V24_PAYLOAD_MAGIC: ByteArray = byteArrayOf(0x4D, 0x34, 0x48, 0x44) // "M4HD"
    const val MTX_V24_EXTENDED_HEADER_SIZE: Int = 18
    const val MTX_V24_FORMAT_SPEC: Int = 240

    val MTX_V25_PAYLOAD_MAGIC: ByteArray = byteArrayOf(0x4D, 0x35, 0x48, 0x44) // "M5HD"
    const val MTX_V25_EXTENDED_HEADER_SIZE: Int = 20
    const val MTX_V25_FORMAT_SPEC: Int = 250
    const val MTX_V25_LEN_MASK: Long = 0xA55A3C91L
    const val MTX_V25_CHUNK_THRESHOLD_BYTES: Int = 98_304
    const val MTX_V25_CHUNK_TARGET_BYTES: Int = 32_768
    const val MTX_V25_CHUNK_ENTRY_SIZE: Int = 30

    const val MAX_METADATA_BYTES: Int = 65_535
    const val MAX_STREAM_BYTE_LEN: Int = 50_000_000
    const val EXT_STATIC_ID_BASE: Int = 256
    const val ESCAPE_ID_BASE: Int = 1024
    const val SMI_PAIR_SHIFT: Int = 15
    const val SMI_MAX_SYMBOL_ID: Int = 32_767
    const val PAIR_KEY_STRIDE_LARGE: Long = 1_048_576L
}

enum class MtxMagicType { MTX1, MTX2 }

enum class MtxEntryType(val wireName: String) {
    PREFIX("prefix"),
    SUFFIX("suffix"),
    NOVEL("novel"),
    FUSION("fusion"),
    GRAPHEME("grapheme"),
    COMPOUND_TASHKEEL("compound_tashkeel"),
    LETTER("letter"),
    WORD("word"),
    NGRAM("ngram"),
    WHITESPACE("whitespace"),
    PUNCTUATION("punctuation"),
    CONTRACTION("contraction"),
    ESCAPE("escape")
}

enum class CompressionProfile(val wireName: String) {
    BALANCED("balanced"),
    MAXIMUM("maximum"),
    FAST("fast")
}

enum class ChunkIndexMode {
    AUTO,
    ENABLED,
    DISABLED
}

data class MtxMetadata(
    val title: String = "رواية جديدة",
    val author: String = "كاتب مجهول",
    val chapterTitle: String = "الفصل الأول",
    val chapterIndex: Int = 1,
    val createdAt: String = MtxInternalUtils.nowIsoUtc(),
    val wordCount: Int? = null,
    val tags: List<String>? = null,
    val genre: String? = null,
    val translator: String? = null,
    val notes: String? = null,
    val codecVersion: String? = null,
    val formatVersion: Int? = null,
    val chapterId: String? = null,
    val languageCode: String? = null,
    val translationGroupId: String? = null,
    val editionLabel: String? = null,
    val bankId: Int? = null,
    val paragraphCount: Int? = null,
    val chunkCount: Int? = null
)

data class MtxDictionaryEntry(
    val id: Int,
    val token: String,
    val frequency: Int,
    val rawUtf8Bytes: Int,
    val totalSavedBytes: Int,
    val isDiacritized: Boolean,
    val type: MtxEntryType
)

data class MtxCompressionOptions(
    val profile: CompressionProfile = CompressionProfile.BALANCED,
    val useCache: Boolean = true,
    val languageHint: String = "auto",
    val enableChunkIndex: ChunkIndexMode = ChunkIndexMode.AUTO,
    val targetChunkBytes: Int = MtxConstants.MTX_V25_CHUNK_TARGET_BYTES
)

data class ArabicTextAnalysis(
    val totalChars: Int,
    val arabicLettersCount: Int,
    val tashkeelCount: Int,
    val tashkeelDensityPercent: Double,
    val wordCount: Int,
    val spaceCount: Int,
    val punctuationCount: Int,
    val detectedPrefixesCount: Int,
    val detectedSuffixesCount: Int,
    val estimatedUtf8Bytes: Int,
    val estimatedMtxBytes: Int,
    val estimatedSavingsPercent: Double
)

data class LanguageProfileResult(
    val dominantLanguage: String, // "ar" | "en" | "mixed"
    val recommendedBankId: Int,
    val recommendedBankCode: String,
    val arabicChars: Int,
    val latinChars: Int,
    val digitsAndPunct: Int,
    val otherUnicodeChars: Int,
    val arabicRatio: Double,
    val latinRatio: Double
)

data class MultilingualTextAnalysis(
    val base: ArabicTextAnalysis,
    val languageProfile: LanguageProfileResult,
    val englishLettersCount: Int,
    val contractionsCount: Int,
    val paragraphCount: Int,
    val emojiAndExtendedCount: Int,
    val normalizedSearchPreview: String
)

data class MtxChunkIndexEntry(
    val blockIndex: Int,
    val charStart: Int,
    val charLength: Int,
    val utf8ByteStart: Int,
    val utf8ByteLength: Int,
    val paragraphStart: Int,
    val paragraphCount: Int,
    val compressedByteStart: Int,
    val compressedByteLength: Int,
    val blockCrc32: Long
)

data class MtxChunkIndexInspection(
    val formatVersion: Int,
    val bankId: Int,
    val bankCode: String,
    val isChunked: Boolean,
    val totalTokenCount: Int,
    val chunkCount: Int,
    val metadata: MtxMetadata,
    val chunks: List<MtxChunkIndexEntry>
)

data class MtxCompressionResult(
    val mtxBytes: ByteArray,
    val originalUtf8Bytes: Int,
    val compressedBytes: Int,
    val savingsPercent: Double,
    val compressionRatio: Double,
    val encodingDurationMs: Double,
    val decodingDurationMs: Double,
    val tokenizationDurationMs: Double,
    val indexingDurationMs: Double,
    val dictionary: List<MtxDictionaryEntry>,
    val tokenCount: Int,
    val metadata: MtxMetadata,
    val checksum: Long,
    val crc32Checksum: Long,
    val isLossless: Boolean,
    val profile: CompressionProfile,
    val version: Int,
    val engineVersion: String,
    val escapeTokensCount: Int,
    val bankId: Int,
    val languageCode: String,
    val chunkCount: Int
)

data class MtxIntegrityDetails(
    val adler32Matched: Boolean,
    val crc32Verified: Boolean?
)

data class MtxDecompressionResult(
    val text: String,
    val metadata: MtxMetadata,
    val decodingDurationMs: Double,
    val originalUtf8Bytes: Int,
    val compressedBytes: Int,
    val savingsPercent: Double,
    val tokenCount: Int,
    val dictionarySize: Int,
    val isLossless: Boolean,
    val checksum: Long,
    val crc32Checksum: Long,
    val version: Int,
    val engineVersion: String,
    val formatLabel: String,
    val decoderId: String,
    val bankId: Int?,
    val chunkCount: Int?,
    val integrityDetails: MtxIntegrityDetails
)

data class MtxChapterEditionDescriptor(
    val chapterId: String,
    val languageCode: String,
    val title: String? = null,
    val author: String? = null,
    val chapterTitle: String? = null,
    val chapterIndex: Int? = null,
    val translationGroupId: String? = null,
    val editionLabel: String? = null
)

data class MtxChapterEditionManifestEntry(
    val chapterId: String,
    val languageCode: String,
    val formatVersion: Int,
    val bankId: Int,
    val originalUtf8Bytes: Int,
    val compressedBytes: Int,
    val savingsPercent: Double,
    val adler32Checksum: Long,
    val crc32Checksum: Long,
    val chunkCount: Int,
    val wordCount: Int,
    val isLossless: Boolean
)

data class MtxLinkedChapterManifest(
    val chapterId: String,
    val translationGroupId: String,
    val createdAt: String,
    val editions: Map<String, MtxChapterEditionManifestEntry>
)

data class MtxParsedHeader(
    val magic: MtxMagicType,
    val formatVersion: Int,
    val flags: Int,
    val salt: Long,
    val expectedAdler32: Long,
    val originalUtf8Bytes: Int,
    val dictionaryHintCount: Int
)

data class MtxFlagsDecoded(
    val usesRadixTrie: Boolean,
    val usesAffixes: Boolean,
    val usesFusions: Boolean,
    val usesBpe: Boolean,
    val usesCipher: Boolean,
    val usesEscapeProtocol: Boolean,
    val usesExtendedV23Integrity: Boolean,
    val usesExtendedV24Indexing: Boolean,
    val usesExtendedV25Multilingual: Boolean
)

data class MtxFormatDetectionResult(
    val magic: MtxMagicType,
    val formatVersion: Int,
    val versionLabel: String,
    val isLegacyFormat: Boolean,
    val isCurrentFormat: Boolean,
    val isSupported: Boolean,
    val header: MtxParsedHeader,
    val flagsDecoded: MtxFlagsDecoded
)

data class MtxDecodedPayload(
    val text: String,
    val metadata: MtxMetadata,
    val tokenCount: Int,
    val dictionarySize: Int,
    val originalUtf8Bytes: Int,
    val expectedCrc32: Long?,
    val decoderId: String,
    val formatLabel: String,
    val bankId: Int? = null,
    val chunkCount: Int? = null,
    val warnings: List<String>? = null
)

interface MtxFormatDecoder {
    val decoderId: String
    val formatLabel: String
    val supportedMagic: List<MtxMagicType>
    val supportedVersions: List<Int>
    val description: String
    fun canDecode(detection: MtxFormatDetectionResult): Boolean
    fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload
}

data class DecoderRegistrationInfo(
    val decoderId: String,
    val formatLabel: String,
    val supportedMagic: List<String>,
    val supportedVersions: List<Int>,
    val description: String
)

data class LegacyDecoderProfile(
    val vocabulary: List<String>? = null,
    val cipherSecret: String? = null,
    val customDecryptor: ((encrypted: ByteArray, salt: Long) -> ByteArray)? = null
)

data class MtxCacheStats(
    val tokenizationEntries: Int,
    val tokenizationBytes: Int,
    val tokenizationHits: Int,
    val tokenizationMisses: Int,
    val secretCacheEntries: Int
)

data class VocabularyBankConfig(
    val bankId: Int,
    val code: String,
    val label: String,
    val primaryTokens: List<String>,
    val extendedTokens: List<String>
)

data class MtxTokenizationResult(
    val tokens: List<String>,
    val dictionaryEntries: List<MtxDictionaryEntry>,
    val dynamicMerged: List<String>,
    val tokenizationDurationMs: Double
)

data class MtxParagraphRangeResult(
    val text: String,
    val accessedBlocks: Int,
    val totalBlocks: Int
)

// ============================================================================
// 2. ERROR HIERARCHY
// ============================================================================

open class MtxError(
    val code: String,
    override val message: String
) : RuntimeException(message)

class MtxInvalidFormatError(message: String) : MtxError("MTX_INVALID_FORMAT", message)

class MtxCorruptDataError(message: String) : MtxError("MTX_CORRUPT_DATA", message)

class MtxUnsupportedVersionError(
    val detectedVersion: Int,
    val supportedVersions: List<Int>,
    message: String? = null
) : MtxError(
    "MTX_UNSUPPORTED_VERSION",
    message ?: "إصدار تنسيق MTX غير مدعوم ($detectedVersion). الإصدارات المدعومة حالياً: ${supportedVersions.joinToString(", ")}."
)

// ============================================================================
// 3. INTERNAL UTILITIES, CHECKSUMS & HARDENED KEYSTREAM CIPHER
// ============================================================================

private object MtxInternalUtils {
    private val secureRandom = SecureRandom()

    fun nowIsoUtc(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    fun randomSalt(): Long = secureRandom.nextInt().toLong() and 0xFFFFFFFFL

    fun readUInt16BE(bytes: ByteArray, offset: Int): Int {
        return ((bytes[offset].toInt() and 0xFF) shl 8) or
            (bytes[offset + 1].toInt() and 0xFF)
    }

    fun readUInt32BE(bytes: ByteArray, offset: Int): Long {
        return ((bytes[offset].toLong() and 0xFFL) shl 24) or
            ((bytes[offset + 1].toLong() and 0xFFL) shl 16) or
            ((bytes[offset + 2].toLong() and 0xFFL) shl 8) or
            (bytes[offset + 3].toLong() and 0xFFL)
    }

    fun writeUInt16BE(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = ((value ushr 8) and 0xFF).toByte()
        bytes[offset + 1] = (value and 0xFF).toByte()
    }

    fun writeUInt32BE(bytes: ByteArray, offset: Int, value: Long) {
        bytes[offset] = ((value ushr 24) and 0xFFL).toByte()
        bytes[offset + 1] = ((value ushr 16) and 0xFFL).toByte()
        bytes[offset + 2] = ((value ushr 8) and 0xFFL).toByte()
        bytes[offset + 3] = (value and 0xFFL).toByte()
    }

    fun deflateRaw(input: ByteArray, level: Int): ByteArray {
        val deflater = Deflater(level, true)
        return try {
            deflater.setInput(input)
            deflater.finish()
            val out = ByteArrayOutputStream(max(64, input.size / 2))
            val buf = ByteArray(4096)
            while (!deflater.finished()) {
                val count = deflater.deflate(buf)
                if (count == 0 && deflater.needsInput()) break
                if (count > 0) out.write(buf, 0, count)
            }
            out.toByteArray()
        } finally {
            deflater.end()
        }
    }

    fun inflateRaw(input: ByteArray): ByteArray {
        val inflater = Inflater(true)
        return try {
            inflater.setInput(input)
            val out = ByteArrayOutputStream(max(64, input.size * 2))
            val buf = ByteArray(4096)
            while (!inflater.finished()) {
                val count = inflater.inflate(buf)
                if (count == 0) {
                    if (inflater.needsInput() || inflater.needsDictionary()) break
                } else {
                    out.write(buf, 0, count)
                }
            }
            if (input.isNotEmpty() && !inflater.finished()) {
                throw MtxCorruptDataError("بيانات DEFLATE مقطوعة أو غير مكتملة.")
            }
            out.toByteArray()
        } finally {
            inflater.end()
        }
    }

    fun round2(value: Double): Double = round(value * 100.0) / 100.0
    fun round1(value: Double): Double = round(value * 10.0) / 10.0
    fun round3(value: Double): Double = round(value * 1000.0) / 1000.0
}

object MtxCryptoAndChecksum {
    private val CRC32_TABLE: IntArray = IntArray(256).apply {
        for (i in 0 until 256) {
            var c = i
            for (k in 0 until 8) {
                c = if ((c and 1) != 0) (0xEDB88320.toInt() xor (c ushr 1)) else (c ushr 1)
            }
            this[i] = c
        }
    }

    private val DEFAULT_SECRET_BYTES: ByteArray = ByteArray(MtxConstants.MTX_CIPHER_SECRET.length).apply {
        for (i in MtxConstants.MTX_CIPHER_SECRET.indices) {
            this[i] = (MtxConstants.MTX_CIPHER_SECRET[i].code and 0xFF).toByte()
        }
    }

    private val secretLock = Any()
    private val secretBytesCache = object : LinkedHashMap<String, ByteArray>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?): Boolean {
            return size > 8
        }
    }

    fun getSecretCacheSize(): Int = synchronized(secretLock) { secretBytesCache.size }

    fun clearSecretCache() {
        synchronized(secretLock) { secretBytesCache.clear() }
    }

    private fun getSecretBytes(secret: String): ByteArray {
        if (secret == MtxConstants.MTX_CIPHER_SECRET) return DEFAULT_SECRET_BYTES
        synchronized(secretLock) {
            return secretBytesCache.getOrPut(secret) {
                ByteArray(secret.length).apply {
                    for (i in secret.indices) {
                        this[i] = (secret[i].code and 0xFF).toByte()
                    }
                }
            }
        }
    }

    fun calculateCrc32Bytes(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): Long {
        var crc = -1
        val end = offset + length
        for (i in offset until end) {
            crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (bytes[i].toInt() and 0xFF)) and 0xFF]
        }
        return (crc xor -1).toLong() and 0xFFFFFFFFL
    }

    fun calculateCrc32(str: String): Long {
        var crc = -1
        val len = str.length
        var i = 0
        while (i < len) {
            val code = str[i].code
            when {
                code < 0x80 -> {
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor code) and 0xFF]
                }
                code < 0x800 -> {
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0xC0 or (code ushr 6))) and 0xFF]
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0x80 or (code and 0x3F))) and 0xFF]
                }
                code in 0xD800..0xDBFF -> {
                    if (i + 1 < len) {
                        val next = str[i + 1].code
                        if (next in 0xDC00..0xDFFF) {
                            val cp = 0x10000 + ((code - 0xD800) shl 10) + (next - 0xDC00)
                            crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0xF0 or (cp ushr 18))) and 0xFF]
                            crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0x80 or ((cp ushr 12) and 0x3F))) and 0xFF]
                            crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0x80 or ((cp ushr 6) and 0x3F))) and 0xFF]
                            crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0x80 or (cp and 0x3F))) and 0xFF]
                            i += 2
                            continue
                        }
                    }
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor 0xEF) and 0xFF]
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor 0xBF) and 0xFF]
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor 0xBD) and 0xFF]
                }
                code in 0xDC00..0xDFFF -> {
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor 0xEF) and 0xFF]
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor 0xBF) and 0xFF]
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor 0xBD) and 0xFF]
                }
                else -> {
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0xE0 or (code ushr 12))) and 0xFF]
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0x80 or ((code ushr 6) and 0x3F))) and 0xFF]
                    crc = (crc ushr 8) xor CRC32_TABLE[(crc xor (0x80 or (code and 0x3F))) and 0xFF]
                }
            }
            i++
        }
        return (crc xor -1).toLong() and 0xFFFFFFFFL
    }

    /**
     * يطابق خوارزمية Adler-32 في TypeScript عبر وحدات UTF-16 بدقة 100%.
     */
    fun calculateAdler32(str: String): Long {
        var a = 1L
        var b = 0L
        val len = str.length
        var i = 0
        while (i < len) {
            var chunkEnd = i + 5552
            if (chunkEnd > len) chunkEnd = len
            while (i < chunkEnd) {
                a += str[i++].code.toLong()
                b += a
            }
            a %= 65521L
            b %= 65521L
        }
        return ((b shl 16) or a) and 0xFFFFFFFFL
    }

    fun fnv1a32(items: List<String>): Long {
        var hash = 0x811C9DC5.toInt()
        for (item in items) {
            for (i in item.indices) {
                hash = hash xor item[i].code
                hash *= 0x01000193
            }
            hash = hash xor 0xFF
            hash *= 0x01000193
        }
        return hash.toLong() and 0xFFFFFFFFL
    }

    fun fnv1a32String(str: String): Long {
        var hash = 0x811C9DC5.toInt()
        for (i in str.indices) {
            hash = hash xor str[i].code
            hash *= 0x01000193
        }
        return hash.toLong() and 0xFFFFFFFFL
    }

    fun applyMtxKeystream(
        data: ByteArray,
        salt: Long,
        secret: String = MtxConstants.MTX_CIPHER_SECRET,
        offset: Int = 0,
        length: Int = data.size - offset
    ): ByteArray {
        val result = ByteArray(length)
        val secBytes = getSecretBytes(secret)
        val secLen = secBytes.size

        val saltInt = salt.toInt()
        var s0 = saltInt xor 0x9E3779B9.toInt()
        var s1 = saltInt xor 0x6C62272E
        var s2 = 0x85EBCA6B.toInt()
        var s3 = 0xC2B2AE35.toInt()
        var secIdx = 0

        for (i in 0 until length) {
            s0 += s1
            val x3 = s3 xor s0
            s3 = (x3 shl 16) or (x3 ushr 16)
            s2 += s3
            val x1 = s1 xor s2
            s1 = (x1 shl 12) or (x1 ushr 20)
            s0 += s1
            val x3b = s3 xor s0
            s3 = (x3b shl 8) or (x3b ushr 24)
            s2 += s3
            val x1b = s1 xor s2
            s1 = (x1b shl 7) or (x1b ushr 25)

            val prn = (s0 xor s2) and 0xFF
            val sec = secBytes[secIdx].toInt() and 0xFF
            result[i] = ((data[offset + i].toInt() and 0xFF) xor (prn xor sec)).toByte()
            if (++secIdx == secLen) secIdx = 0
        }
        return result
    }

    fun applyLegacyLcgKeystream(
        data: ByteArray,
        salt: Long,
        secret: String,
        multiplier: Int = 1664525,
        increment: Int = 1013904223
    ): ByteArray {
        val len = data.size
        val result = ByteArray(len)
        val secBytes = if (secret.isNotEmpty()) getSecretBytes(secret) else null
        val secLen = secBytes?.size ?: 1
        var state = salt.toInt()
        var secIdx = 0

        for (i in 0 until len) {
            state = state * multiplier + increment
            val keyByte = if (secBytes != null) (secBytes[secIdx].toInt() and 0xFF) else 0
            if (++secIdx == secLen) secIdx = 0
            val prn = (state ushr 16) and 0xFF
            result[i] = ((data[i].toInt() and 0xFF) xor (prn xor keyByte)).toByte()
        }
        return result
    }
}

// ============================================================================
// 4. VOCABULARIES, MULTILINGUAL BANKS & ROOT-INDEXED TRIE
// ============================================================================

private object MtxStaticVocabularies {
    val STATIC_CHARS: List<String> = buildList {
        for (c in 0x0621..0x064A) add(c.toChar().toString())
        for (c in 0x064B..0x0652) add(c.toChar().toString())
        add("\u0670")
        add("\u0671")
        add("\u0640")
        add("ٱ")
        add("پ")
        add("چ")
        add("ژ")
        add("گ")
        addAll(
            listOf(
                " ", "\n", "\t", "،", "؛", "؟", "!", ".", ":", "«", "»", "\"", "'", "-", "—",
                "(", ")", "[", "]", "{", "}", "/", "\\", "@", "#", "%", "&", "*", "+", "=",
                "<", ">", "_", "^", "|", "~", "“", "”", "…"
            )
        )
        for (d in 0..9) add(d.toString())
        addAll(listOf("٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"))
    }

    val FUSED_PUNCTUATION: List<String> = listOf(
        "، ", "؛ ", ". ", "؟ ", "! ", ": ", ".\n", "،\n", "\n\n", "\n— ", "— ",
        "\n- ", "- ", " «", "» ", "... ", ".. ", " (", ") "
    )

    val MORPH_PREFIXES: List<String> = listOf(
        "وبالـ", "كالـ", "فالـ", "للـ", "والـ", "بالـ", "الـ", "ال", "وبـ", "ولـ",
        "فلـ", "أبالـ", "وكالـ", "فكالـ", "فلما ", "ولما ", "وحين ", "فحين ", "وإذا ",
        "فإذا ", "حيث ", "كذلك "
    )

    val MORPH_SUFFIXES: List<String> = listOf(
        "هما", "هم", "هن", "كم", "كن", "نا", "ها", "ين", "ون", "ات",
        "ان", "ية", "تك", "تهم", "تها", "تنا", "تم", "تني", "ني", "ه"
    )

    val TASHKEEL_GRAPHEMES: List<String> = listOf(
        "َّ", "ُّ", "ِّ", "ًّ", "ٌّ", "ٍّ",
        "كَ", "كِ", "كُ", "كْ",
        "مَ", "مِ", "مُ", "مْ",
        "نَ", "نِ", "نُ", "نْ",
        "لَ", "لِ", "لُ", "لْ",
        "رَ", "رِ", "رُ", "رْ",
        "فَ", "فِ", "بَ", "بِ", "تَ", "تِ",
        "يَ", "يِ", "سَ", "سِ", "سُ",
        "هَ", "هِ", "هُ"
    )

    val NOVEL_CONTEXT_WORDS: List<String> = listOf(
        "قال", "قالت", "كان", "كانت", "في", "على", "من", "إلى", "عن", "مع",
        "هذا", "هذه", "ذلك", "تلك", "الذي", "التي", "كل", "أن", "إن", "لم",
        "ثم", "بعد", "قبل", "بين", "عندما", "كما", "غير", "حتى", "فقد", "لقد",
        "كَانَ", "فِي", "مِنْ", "عَلَى", "إِلَى", "قَالَ", "قَالَتْ", "لَمْ", "كُلّ",
        "الَّذِي", "الَّتِي", "إِنَّ", "أَنَّ", "لَكِنَّ", "لَيْسَ", "كَانُوا", "يَكُونُ",
        "هَذَا", "هَذِهِ", "ذَلِكَ", "تِلْكَ",
        "عليه", "عليها", "إليه", "إليها", "منه", "منها", "عنه", "عنها",
        "فيه", "فيها", "بها", "به"
    )

    // قاموس v2.2–v2.4 الثابت (محفوظ حرفياً لضمان التوافق العكسي الكامل)
    val PRECOMPILED_VOCAB: List<String> = buildList {
        val seen = HashSet<String>(256)
        val combined = STATIC_CHARS + FUSED_PUNCTUATION + MORPH_PREFIXES +
            MORPH_SUFFIXES + TASHKEEL_GRAPHEMES + NOVEL_CONTEXT_WORDS
        for (item in combined) {
            if (seen.add(item)) {
                add(item)
                if (size >= 225) break
            }
        }
    }

    val PRECOMPILED_VOCAB_LEN: Int = PRECOMPILED_VOCAB.size
    val PRECOMPILED_VOCAB_HASH: Long = MtxCryptoAndChecksum.fnv1a32(PRECOMPILED_VOCAB)

    val ASCII_LOWER_LETTERS: List<String> = (97..122).map { it.toChar().toString() }
    val ASCII_UPPER_LETTERS: List<String> = (65..90).map { it.toChar().toString() }
    val ARABIC_CORE_LETTERS: List<String> = buildList {
        for (c in 0x0621..0x064A) add(c.toChar().toString())
        for (c in 0x064B..0x0652) add(c.toChar().toString())
        add("\u0670")
        add("\u0671")
        add("\u0640")
        add("ٱ")
        add("پ")
        add("چ")
        add("ژ")
        add("گ")
    }
    val ARABIC_PRIMARY_LETTERS: List<String> = buildList {
        for (c in 0x0621..0x064A) add(c.toChar().toString())
        for (c in 0x064B..0x0652) add(c.toChar().toString())
        add("\u0670")
        add("\u0671")
        add("\u0640")
    }

    val DIGITS_ASCII: List<String> = (0..9).map { it.toString() }
    val DIGITS_ARABIC_INDIC: List<String> = listOf("٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩")

    val ENGLISH_FUSED_AND_CONTRACTIONS: List<String> = listOf(
        ". ", ", ", "? ", "! ", ": ", "; ", ".\n", ",\n", "\n\n",
        "\" ", " \"", "” ", " “", "'s", "n't", "'t", "'re", "'ve",
        "'ll", "'d", "'m", "— ", "... ", " - "
    )

    val ENGLISH_MORPHEMES_AND_NGRAMS: List<String> = listOf(
        "th", "he", "in", "er", "an", "re", "on", "at", "en", "nd",
        "ti", "es", "or", "te", "of", "ed", "is", "it", "al", "ar",
        "st", "to", "nt", "ng", "se", "ha", "as", "ou", "io", "le",
        "ve", "co", "me", "de", "hi", "ri", "ro", "ic", "ne", "ea",
        "ra", "ce", "ing", "tion", "ment", "ness", "able", "ful",
        "less", "ous", "ly", "un", "pre", "igh", "ould"
    )

    val ENGLISH_NOVEL_WORDS: List<String> = listOf(
        "the ", "and ", "was ", "that ", "with ", "his ", "her ", "for ", "she ", "you ",
        "said ", "not ", "but ", "had ", "have ", "from ", "they ", "were ", "this ", "The ",
        "He ", "She ", "It ", "their ", "would ", "there ", "could ", "what ", "when ", "into ",
        "which ", "about ", "more ", "will ", "him ", "all ", "out ", "one ", "up ", "are ",
        "been ", "who ", "eyes ", "voice ", "chapter ", "Chapter "
    )

    val ARABIC_V25_PREFIXES: List<String> = listOf(
        "وال", "بال", "كال", "فال", "لل", "وبال", "وكال", "فكال", "ال", "ول", "فل"
    )

    val ARABIC_V25_NOVEL_WORDS: List<String> = listOf(
        "في ", "من ", "على ", "إلى ", "عن ", "مع ", "أن ", "إن ", "كان ", "كانت ",
        "قال ", "قالت ", "الذي ", "التي ", "هذا ", "هذه ", "ذلك ", "تلك ", "ثم ", "لم ",
        "بعد ", "قبل ", "بين ", "كما ", "غير ", "حتى ", "كل ", "عندما ", "فقد ", "لقد ",
        "عليه", "عليها", "إليه", "إليها", "منه", "منها", "فيه", "فيها",
        "كَانَ", "فِي", "مِنْ", "عَلَى", "إِلَى", "قَالَ"
    )

    val FUSED_SET: Set<String> = FUSED_PUNCTUATION.toHashSet()
    val PREFIX_SET: Set<String> = MORPH_PREFIXES.toHashSet()
    val SUFFIX_SET: Set<String> = MORPH_SUFFIXES.toHashSet()
    val NOVEL_SET: Set<String> = NOVEL_CONTEXT_WORDS.toHashSet()
    val GRAPHEME_SET: Set<String> = TASHKEEL_GRAPHEMES.toHashSet()
    val CONTRACTION_SET: Set<String> = setOf("'s", "n't", "'t", "'re", "'ve", "'ll", "'d", "'m")
    val PUNCT_CHAR_SET: Set<Char> = "،؛؟!«»\"\"''“”‘’—-.:()[]{}/\\@#\$%&*+=<>_^|~…".toHashSet()

    fun deduplicateVocabList(items: List<String>, maxLen: Int): List<String> {
        val out = ArrayList<String>(min(items.size, maxLen))
        val seen = HashSet<String>(items.size * 2)
        for (item in items) {
            if (item.isEmpty() || !seen.add(item)) continue
            out.add(item)
            if (out.size >= maxLen) break
        }
        return out
    }

    fun getUtf8ByteLength(str: String): Int {
        var bytes = 0
        val len = str.length
        var i = 0
        while (i < len) {
            val code = str[i].code
            when {
                code < 0x80 -> bytes += 1
                code < 0x800 -> bytes += 2
                code in 0xD800..0xDBFF -> {
                    if (i + 1 < len) {
                        val next = str[i + 1].code
                        if (next in 0xDC00..0xDFFF) {
                            bytes += 4
                            i += 2
                            continue
                        }
                    }
                    bytes += 3
                }
                else -> bytes += 3
            }
            i++
        }
        return bytes
    }

    fun containsArabicTashkeel(text: String): Boolean {
        for (i in text.indices) {
            val c = text[i].code
            if ((c in 0x064B..0x065F) || c == 0x0670) return true
        }
        return false
    }

    fun getSemanticType(token: String): MtxEntryType {
        if (token in CONTRACTION_SET) return MtxEntryType.CONTRACTION
        if (token in FUSED_SET) return MtxEntryType.FUSION
        if (token in PREFIX_SET) return MtxEntryType.PREFIX
        if (token in SUFFIX_SET) return MtxEntryType.SUFFIX
        if (token in NOVEL_SET) return MtxEntryType.NOVEL
        if (token in GRAPHEME_SET) {
            return if ('ّ' in token) MtxEntryType.COMPOUND_TASHKEEL else MtxEntryType.GRAPHEME
        }
        val len = token.length
        if (len > 0) {
            var allWs = true
            var allPunct = true
            for (i in 0 until len) {
                val ch = token[i]
                val code = ch.code
                if (code != 32 && code != 10 && code != 9 && code != 13) allWs = false
                if (ch !in PUNCT_CHAR_SET) allPunct = false
                if (!allWs && !allPunct) break
            }
            if (allWs) return MtxEntryType.WHITESPACE
            if (allPunct) return MtxEntryType.PUNCTUATION
        }
        if (len == 1) return MtxEntryType.LETTER
        if (len == 2 && containsArabicTashkeel(token)) return MtxEntryType.GRAPHEME
        if (token.endsWith(" ") && len >= 3) return MtxEntryType.WORD
        return MtxEntryType.NGRAM
    }
}

class ReverseVocabularyIndex(private val dynamicTokens: List<String>) {
    val totalSize: Int = MtxStaticVocabularies.PRECOMPILED_VOCAB_LEN + dynamicTokens.size

    fun get(id: Int): String? {
        if (id < 0) return null
        if (id < MtxStaticVocabularies.PRECOMPILED_VOCAB_LEN) {
            return MtxStaticVocabularies.PRECOMPILED_VOCAB[id]
        }
        val dynIdx = id - MtxStaticVocabularies.PRECOMPILED_VOCAB_LEN
        return if (dynIdx in dynamicTokens.indices) dynamicTokens[dynIdx] else null
    }

    fun getOrEmpty(id: Int): String = get(id) ?: ""

    fun bindFlatTable(): Array<String?> {
        val table = arrayOfNulls<String>(255)
        val preLen = MtxStaticVocabularies.PRECOMPILED_VOCAB_LEN
        for (i in 0 until preLen) {
            table[i] = MtxStaticVocabularies.PRECOMPILED_VOCAB[i]
        }
        val dynLen = min(dynamicTokens.size, 255 - preLen)
        for (i in 0 until dynLen) {
            table[preLen + i] = dynamicTokens[i]
        }
        return table
    }
}

private class TrieNode {
    var token: String? = null
    var tokenId: Int = -1
    val children = HashMap<Int, TrieNode>(4)
}

private const val ROOT_FLAT_LIMIT = 0x0700

class FastVocabularyTrie {
    private val root = TrieNode()
    private val rootFastTable = arrayOfNulls<TrieNode>(ROOT_FLAT_LIMIT)

    fun insert(word: String, tokenId: Int = -1) {
        if (word.isEmpty()) return
        val firstCode = word[0].code
        var curr: TrieNode

        if (firstCode < ROOT_FLAT_LIMIT) {
            var node = rootFastTable[firstCode]
            if (node == null) {
                node = TrieNode()
                rootFastTable[firstCode] = node
                root.children[firstCode] = node
            }
            curr = node
        } else {
            curr = root.children.getOrPut(firstCode) { TrieNode() }
        }

        for (i in 1 until word.length) {
            val code = word[i].code
            curr = curr.children.getOrPut(code) { TrieNode() }
        }
        curr.token = word
        curr.tokenId = tokenId
    }

    fun findLongestPrefix(text: String, startIndex: Int): String? {
        val len = text.length
        if (startIndex >= len) return null
        val firstCode = text[startIndex].code
        val startNode = if (firstCode < ROOT_FLAT_LIMIT) rootFastTable[firstCode] else root.children[firstCode]
        if (startNode == null) return null

        var curr: TrieNode = startNode
        var longest: String? = curr.token
        for (i in (startIndex + 1) until len) {
            val next = curr.children[text[i].code] ?: break
            curr = next
            if (curr.token != null) longest = curr.token
        }
        return longest
    }

    fun findLongestPrefixPacked(text: String, startIndex: Int): Int {
        val len = text.length
        if (startIndex >= len) return 0
        val firstCode = text[startIndex].code
        val startNode = if (firstCode < ROOT_FLAT_LIMIT) rootFastTable[firstCode] else root.children[firstCode]
        if (startNode == null) return 0

        var curr: TrieNode = startNode
        var bestPacked = if (curr.tokenId >= 0) (1 shl 10) or (curr.tokenId + 1) else 0
        for (i in (startIndex + 1) until len) {
            val next = curr.children[text[i].code] ?: break
            curr = next
            if (curr.tokenId >= 0) {
                bestPacked = ((i - startIndex + 1) shl 10) or (curr.tokenId + 1)
            }
        }
        return bestPacked
    }
}

class CompiledVocabularyBank(config: VocabularyBankConfig) {
    val bankId: Int = config.bankId
    val code: String = config.code
    val label: String = config.label
    val primaryVocab: List<String> = MtxStaticVocabularies.deduplicateVocabList(config.primaryTokens, 224)
    val extendedVocab: List<String> = run {
        val primarySet = primaryVocab.toHashSet()
        val filtered = config.extendedTokens.filter { it !in primarySet }
        MtxStaticVocabularies.deduplicateVocabList(filtered, 176)
    }

    val primaryLen: Int = primaryVocab.size
    val extStaticLen: Int = extendedVocab.size
    val primaryDynCap: Int = MtxConstants.EXT_BANK_TOKEN - primaryLen
    val extDynCap: Int = 256 - extStaticLen
    val totalDynCap: Int = primaryDynCap + extDynCap
    val extDynIdBase: Int = MtxConstants.EXT_STATIC_ID_BASE + extStaticLen
    val vocabHash: Long = MtxCryptoAndChecksum.fnv1a32(primaryVocab + extendedVocab)

    val trie = FastVocabularyTrie()
    val tokenToId = HashMap<String, Int>(512)
    val primaryUtf8Len = IntArray(primaryLen)
    val primaryTashkeel = ByteArray(primaryLen)
    val primaryTypes = Array(primaryLen) { MtxEntryType.LETTER }
    val extUtf8Len = IntArray(extStaticLen)
    val extTashkeel = ByteArray(extStaticLen)
    val extTypes = Array(extStaticLen) { MtxEntryType.LETTER }

    private val basePrimaryTable = arrayOfNulls<String>(MtxConstants.EXT_BANK_TOKEN)
    private val baseExtTable = arrayOfNulls<String>(256)

    init {
        for (i in 0 until primaryLen) {
            val tok = primaryVocab[i]
            trie.insert(tok, i)
            tokenToId[tok] = i
            primaryUtf8Len[i] = MtxStaticVocabularies.getUtf8ByteLength(tok)
            primaryTashkeel[i] = if (MtxStaticVocabularies.containsArabicTashkeel(tok)) 1 else 0
            primaryTypes[i] = MtxStaticVocabularies.getSemanticType(tok)
            basePrimaryTable[i] = tok
        }
        for (i in 0 until extStaticLen) {
            val tok = extendedVocab[i]
            val id = MtxConstants.EXT_STATIC_ID_BASE + i
            trie.insert(tok, id)
            tokenToId[tok] = id
            extUtf8Len[i] = MtxStaticVocabularies.getUtf8ByteLength(tok)
            extTashkeel[i] = if (MtxStaticVocabularies.containsArabicTashkeel(tok)) 1 else 0
            extTypes[i] = MtxStaticVocabularies.getSemanticType(tok)
            baseExtTable[i] = tok
        }
    }

    fun bindDynamicTables(dynamicTokens: List<String>): Pair<Array<String?>, Array<String?>> {
        val primary = basePrimaryTable.copyOf()
        val extended = baseExtTable.copyOf()
        val dynLen = dynamicTokens.size
        val primaryDynCount = min(dynLen, primaryDynCap)
        for (i in 0 until primaryDynCount) {
            primary[primaryLen + i] = dynamicTokens[i]
        }
        val extDynCount = max(0, min(dynLen - primaryDynCap, extDynCap))
        for (i in 0 until extDynCount) {
            extended[extStaticLen + i] = dynamicTokens[primaryDynCap + i]
        }
        return primary to extended
    }
}

class MtxVocabularyBankRegistry {
    private val lock = Any()
    private val banksById = HashMap<Int, CompiledVocabularyBank>()
    private val banksByCode = HashMap<String, CompiledVocabularyBank>()

    fun register(config: VocabularyBankConfig): CompiledVocabularyBank {
        val bank = CompiledVocabularyBank(config)
        synchronized(lock) {
            banksById[bank.bankId] = bank
            banksByCode[bank.code.lowercase(Locale.ROOT)] = bank
        }
        return bank
    }

    fun getById(bankId: Int): CompiledVocabularyBank? = synchronized(lock) { banksById[bankId] }

    fun getByCode(code: String): CompiledVocabularyBank? =
        synchronized(lock) { banksByCode[code.lowercase(Locale.ROOT)] }

    fun listBanks(): List<CompiledVocabularyBank> =
        synchronized(lock) { banksById.values.sortedBy { it.bankId } }
}

object MtxVocabularyBanks {
    val defaultVocabularyRegistry = MtxVocabularyBankRegistry()

    val BANK_ARABIC_PRIMARY: CompiledVocabularyBank = defaultVocabularyRegistry.register(
        VocabularyBankConfig(
            bankId = 0,
            code = "ar",
            label = "Arabic Novel Primary + English Extended",
            primaryTokens = buildList {
                addAll(MtxStaticVocabularies.ARABIC_PRIMARY_LETTERS)
                addAll(
                    listOf(
                        " ", "\n", "\t", "،", "؛", "؟", "!", ".", ":", "«", "»",
                        "\"", "'", "-", "—", "(", ")", "…", "“", "”"
                    )
                )
                addAll(MtxStaticVocabularies.DIGITS_ASCII)
                addAll(MtxStaticVocabularies.DIGITS_ARABIC_INDIC)
                addAll(MtxStaticVocabularies.FUSED_PUNCTUATION)
                addAll(MtxStaticVocabularies.ARABIC_V25_PREFIXES)
                addAll(MtxStaticVocabularies.MORPH_SUFFIXES)
                addAll(MtxStaticVocabularies.TASHKEEL_GRAPHEMES)
                addAll(
                    listOf(
                        "كَانَ", "فِي", "مِنْ", "عَلَى", "إِلَى", "قَالَ", "قَالَتْ",
                        "لَمْ", "كُلّ", "الَّذِي", "الَّتِي", "هَذَا", "هَذِهِ", "ذَلِكَ", "تِلْكَ"
                    )
                )
                addAll(MtxStaticVocabularies.ARABIC_V25_NOVEL_WORDS)
            },
            extendedTokens = buildList {
                addAll(MtxStaticVocabularies.ASCII_LOWER_LETTERS)
                addAll(MtxStaticVocabularies.ASCII_UPPER_LETTERS)
                addAll(
                    listOf(
                        "[", "]", "{", "}", "/", "\\", "@", "#", "%", "&", "*", "+", "=",
                        "<", ">", "_", "^", "|", "~", "ٱ", "پ", "چ", "ژ", "گ"
                    )
                )
                addAll(MtxStaticVocabularies.ENGLISH_FUSED_AND_CONTRACTIONS)
                addAll(MtxStaticVocabularies.ENGLISH_MORPHEMES_AND_NGRAMS)
                addAll(MtxStaticVocabularies.ENGLISH_NOVEL_WORDS)
            }
        )
    )

    val BANK_ENGLISH_PRIMARY: CompiledVocabularyBank = defaultVocabularyRegistry.register(
        VocabularyBankConfig(
            bankId = 1,
            code = "en",
            label = "English Novel Primary + Arabic Extended",
            primaryTokens = buildList {
                addAll(MtxStaticVocabularies.ASCII_LOWER_LETTERS)
                addAll(MtxStaticVocabularies.ASCII_UPPER_LETTERS)
                addAll(
                    listOf(
                        " ", "\n", "\t", ".", ",", "!", "?", ":", ";", "'", "\"",
                        "-", "—", "(", ")", "…", "“", "”", "’", "‘"
                    )
                )
                addAll(MtxStaticVocabularies.DIGITS_ASCII)
                addAll(MtxStaticVocabularies.ENGLISH_FUSED_AND_CONTRACTIONS)
                addAll(MtxStaticVocabularies.ENGLISH_MORPHEMES_AND_NGRAMS)
                addAll(MtxStaticVocabularies.ENGLISH_NOVEL_WORDS)
            },
            extendedTokens = buildList {
                addAll(
                    listOf(
                        "[", "]", "{", "}", "/", "\\", "*", "&", "%", "#", "@", "+", "=",
                        "$", "<", ">", "_", "^", "|", "~"
                    )
                )
                addAll(MtxStaticVocabularies.ARABIC_CORE_LETTERS)
                addAll(listOf("،", "؛", "؟", "«", "»", "، "))
                addAll(MtxStaticVocabularies.DIGITS_ARABIC_INDIC)
                addAll(MtxStaticVocabularies.ARABIC_V25_PREFIXES)
                addAll(MtxStaticVocabularies.ARABIC_V25_NOVEL_WORDS)
            }
        )
    )

    val BANK_MIXED_BILINGUAL: CompiledVocabularyBank = defaultVocabularyRegistry.register(
        VocabularyBankConfig(
            bankId = 2,
            code = "mixed",
            label = "Balanced Bilingual (Arabic + English)",
            primaryTokens = buildList {
                addAll(MtxStaticVocabularies.ARABIC_PRIMARY_LETTERS)
                addAll(MtxStaticVocabularies.ASCII_LOWER_LETTERS)
                addAll(MtxStaticVocabularies.ASCII_UPPER_LETTERS)
                addAll(listOf(" ", "\n", "\t"))
                addAll(MtxStaticVocabularies.DIGITS_ASCII)
                addAll(
                    listOf(
                        ".", ",", "،", "؟", "?", "!", ":", ";", "؛", "'", "\"", "-", "—",
                        "(", ")", "«", "»", "“", "”", "’", "…",
                        ". ", ", ", "، ", "? ", "؟ ", "! ", ": ", ".\n", "\n\n",
                        "'s", "n't", "'t", "'re", "'ve", "'ll", "— ",
                        "ال", "وال", "بال", "لل", "في ", "من ", "على ", "إلى ", "عن ", "مع ",
                        "أن ", "إن ", "كان ", "كانت ", "قال ", "قالت ", "هذا ", "هذه ", "التي ", "الذي ",
                        "th", "he", "in", "er", "an", "re", "on", "at", "en", "nd",
                        "es", "or", "ed", "is", "it", "st", "to", "ng", "ing", "tion",
                        "ment", "ly", "the ", "and ", "was ", "that ", "with ", "his ",
                        "her ", "for ", "said ", "not ", "but ", "you ", "this "
                    )
                )
            },
            extendedTokens = buildList {
                addAll(
                    listOf(
                        "[", "]", "{", "}", "/", "\\", "@", "#", "%", "&", "*", "+", "=",
                        "ٱ", "پ", "چ", "ژ", "گ"
                    )
                )
                addAll(MtxStaticVocabularies.DIGITS_ARABIC_INDIC)
                addAll(MtxStaticVocabularies.MORPH_SUFFIXES)
                addAll(MtxStaticVocabularies.TASHKEEL_GRAPHEMES)
                addAll(MtxStaticVocabularies.ARABIC_V25_NOVEL_WORDS)
                addAll(MtxStaticVocabularies.ENGLISH_MORPHEMES_AND_NGRAMS)
                addAll(MtxStaticVocabularies.ENGLISH_NOVEL_WORDS)
            }
        )
    )
}

// ============================================================================
// 5. BOUNDED SMART LRU TOKENIZATION CACHE
// ============================================================================

private data class CachedTokenizationPlan(
    val text: String,
    val bankId: Int,
    val finalTokenIds: IntArray,
    val blockTokenRanges: List<IntRange>,
    val dynamicMerged: List<String>,
    val escapeLiterals: List<String>,
    val escapeUtf8Lengths: IntArray,
    val dictionaryEntries: List<MtxDictionaryEntry>,
    val tokenizationDurationMs: Double,
    val indexingDurationMs: Double,
    val estimatedBytes: Int
)

private object MtxTokenizationCache {
    private const val MAX_CACHE_ENTRIES = 24
    private const val MAX_CACHE_TOTAL_BYTES = 1_572_864
    const val MAX_CACHEABLE_TEXT_CHARS = 32_768

    private val lock = Any()
    private val map = LinkedHashMap<String, CachedTokenizationPlan>(32, 0.75f, true)
    private var totalBytes = 0
    private var hits = 0
    private var misses = 0

    fun get(key: String, text: String): CachedTokenizationPlan? {
        synchronized(lock) {
            val entry = map[key]
            if (entry == null || entry.text != text) {
                misses++
                return null
            }
            hits++
            return entry
        }
    }

    fun set(key: String, plan: CachedTokenizationPlan) {
        synchronized(lock) {
            val existing = map.remove(key)
            if (existing != null) {
                totalBytes -= existing.estimatedBytes
            }
            while (
                (map.size >= MAX_CACHE_ENTRIES ||
                    (totalBytes + plan.estimatedBytes > MAX_CACHE_TOTAL_BYTES && map.isNotEmpty()))
            ) {
                val it = map.entries.iterator()
                if (!it.hasNext()) break
                val eldest = it.next()
                totalBytes -= eldest.value.estimatedBytes
                it.remove()
            }
            if (plan.estimatedBytes <= MAX_CACHE_TOTAL_BYTES) {
                map[key] = plan
                totalBytes += plan.estimatedBytes
            }
        }
    }

    fun clear() {
        synchronized(lock) {
            map.clear()
            totalBytes = 0
            hits = 0
            misses = 0
        }
    }

    fun stats(): MtxCacheStats = synchronized(lock) {
        MtxCacheStats(
            tokenizationEntries = map.size,
            tokenizationBytes = totalBytes,
            tokenizationHits = hits,
            tokenizationMisses = misses,
            secretCacheEntries = MtxCryptoAndChecksum.getSecretCacheSize()
        )
    }
}

// ============================================================================
// 6. HIGH-SPEED MULTILINGUAL INTEGER-ID BPE ENGINE & PARAGRAPH CHUNKER
// ============================================================================

private class BpeMaxHeap(initialCapacity: Int = 256) {
    private var heapSavings = IntArray(initialCapacity)
    private var heapFreqs = IntArray(initialCapacity)
    private var heapKeys = LongArray(initialCapacity)
    var size: Int = 0
        private set

    private fun ensureCapacity() {
        if (size < heapSavings.size) return
        val nextCap = heapSavings.size * 2
        heapSavings = heapSavings.copyOf(nextCap)
        heapFreqs = heapFreqs.copyOf(nextCap)
        heapKeys = heapKeys.copyOf(nextCap)
    }

    fun push(savings: Int, freq: Int, key: Long) {
        ensureCapacity()
        var idx = size++
        while (idx > 0) {
            val parent = (idx - 1) ushr 1
            val pSav = heapSavings[parent]
            if (pSav > savings || (pSav == savings && heapFreqs[parent] >= freq)) break
            heapSavings[idx] = pSav
            heapFreqs[idx] = heapFreqs[parent]
            heapKeys[idx] = heapKeys[parent]
            idx = parent
        }
        heapSavings[idx] = savings
        heapFreqs[idx] = freq
        heapKeys[idx] = key
    }

    class PoppedEntry {
        var savings: Int = 0
        var freq: Int = 0
        var key: Long = 0L
    }

    fun popInto(out: PoppedEntry): Boolean {
        if (size == 0) return false
        out.savings = heapSavings[0]
        out.freq = heapFreqs[0]
        out.key = heapKeys[0]

        val lastIdx = --size
        if (lastIdx > 0) {
            val lastSav = heapSavings[lastIdx]
            val lastFreq = heapFreqs[lastIdx]
            val lastKey = heapKeys[lastIdx]
            var idx = 0
            val half = size ushr 1

            while (idx < half) {
                var child = (idx shl 1) + 1
                val right = child + 1
                if (right < size &&
                    (heapSavings[right] > heapSavings[child] ||
                        (heapSavings[right] == heapSavings[child] && heapFreqs[right] > heapFreqs[child]))
                ) {
                    child = right
                }
                val cSav = heapSavings[child]
                if (lastSav > cSav || (lastSav == cSav && lastFreq >= heapFreqs[child])) break
                heapSavings[idx] = cSav
                heapFreqs[idx] = heapFreqs[child]
                heapKeys[idx] = heapKeys[child]
                idx = child
            }
            heapSavings[idx] = lastSav
            heapFreqs[idx] = lastFreq
            heapKeys[idx] = lastKey
        }
        return true
    }
}

private data class TextChunkSpan(
    val charStart: Int,
    val charLength: Int,
    val paragraphStart: Int,
    val paragraphCount: Int
)

private fun splitTextIntoParagraphChunks(text: String, targetChunkBytes: Int): List<TextChunkSpan> {
    val len = text.length
    if (len == 0) {
        return listOf(TextChunkSpan(0, 0, 0, 1))
    }

    val spans = ArrayList<TextChunkSpan>()
    var chunkStart = 0
    var chunkParaStart = 0
    var chunkParaCount = 0
    var currentParaIdx = 0
    var approxUtf8Bytes = 0.0
    var pos = 0

    while (pos < len) {
        val nlIdx = text.indexOf('\n', pos)
        val paraEnd = if (nlIdx == -1) len else nlIdx + 1
        val paraLen = paraEnd - pos
        approxUtf8Bytes += if (text[pos].code >= 0x0600) paraLen * 2.0 else paraLen * 1.15
        chunkParaCount++

        if (approxUtf8Bytes >= targetChunkBytes && paraEnd < len) {
            spans.add(
                TextChunkSpan(
                    charStart = chunkStart,
                    charLength = paraEnd - chunkStart,
                    paragraphStart = chunkParaStart,
                    paragraphCount = chunkParaCount
                )
            )
            chunkStart = paraEnd
            chunkParaStart = currentParaIdx + 1
            chunkParaCount = 0
            approxUtf8Bytes = 0.0
        }
        currentParaIdx++
        pos = paraEnd
    }

    if (chunkStart < len) {
        spans.add(
            TextChunkSpan(
                charStart = chunkStart,
                charLength = len - chunkStart,
                paragraphStart = chunkParaStart,
                paragraphCount = max(1, chunkParaCount)
            )
        )
    }
    return spans
}

private data class InternalTokenizationOutput(
    val finalTokenIds: IntArray,
    val blockTokenRanges: List<IntRange>, // start until (start + count)
    val dynamicMerged: List<String>,
    val escapeLiterals: List<String>,
    val escapeUtf8Lengths: IntArray,
    val dictionaryEntries: List<MtxDictionaryEntry>,
    val tokenizationDurationMs: Double,
    val indexingDurationMs: Double
)

private fun executeMultilingualBpeTokenization(
    text: String,
    bank: CompiledVocabularyBank,
    profile: CompressionProfile,
    chunkSpans: List<TextChunkSpan>,
    buildDictionaryEntries: Boolean
): InternalTokenizationOutput {
    val startNs = System.nanoTime()
    val textLen = text.length
    val numBlocks = chunkSpans.size

    var cap = max(16, textLen)
    var rawIds = IntArray(cap)
    var tokenCount = 0

    val escapeMap = HashMap<String, Int>(64)
    val escapeLiterals = ArrayList<String>(64)
    val escapeUtf8LenList = ArrayList<Int>(64)

    val blockStartIndices = IntArray(numBlocks)
    val blockInitialCounts = IntArray(numBlocks)
    val trie = bank.trie

    for (b in 0 until numBlocks) {
        val span = chunkSpans[b]
        val spanEnd = span.charStart + span.charLength
        blockStartIndices[b] = tokenCount
        var i = span.charStart

        while (i < spanEnd) {
            val packed = trie.findLongestPrefixPacked(text, i)
            val tokenId: Int
            if (packed != 0) {
                val matchLen = packed ushr 10
                if (i + matchLen <= spanEnd) {
                    tokenId = (packed and 1023) - 1
                    i += matchLen
                } else {
                    val ch = text.substring(i, i + 1)
                    val singleId = bank.tokenToId[ch]
                    tokenId = if (singleId != null) {
                        singleId
                    } else {
                        escapeMap.getOrPut(ch) {
                            val newId = MtxConstants.ESCAPE_ID_BASE + escapeLiterals.size
                            escapeLiterals.add(ch)
                            escapeUtf8LenList.add(MtxStaticVocabularies.getUtf8ByteLength(ch))
                            newId
                        }
                    }
                    i += 1
                }
            } else {
                val codePoint = Character.codePointAt(text, i)
                val charLen = if (codePoint > 0xFFFF) 2 else 1
                val lit = text.substring(i, i + charLen)
                i += charLen
                tokenId = escapeMap.getOrPut(lit) {
                    val newId = MtxConstants.ESCAPE_ID_BASE + escapeLiterals.size
                    escapeLiterals.add(lit)
                    escapeUtf8LenList.add(MtxStaticVocabularies.getUtf8ByteLength(lit))
                    newId
                }
            }

            if (tokenCount == cap) {
                cap *= 2
                rawIds = rawIds.copyOf(cap)
            }
            rawIds[tokenCount++] = tokenId
        }
        blockInitialCounts[b] = tokenCount - blockStartIndices[b]
    }

    val indexingStartNs = System.nanoTime()

    val maxDynamicSlots = when (profile) {
        CompressionProfile.FAST -> min(20, bank.primaryDynCap)
        CompressionProfile.MAXIMUM -> min(128, bank.totalDynCap)
        CompressionProfile.BALANCED -> min(44, bank.primaryDynCap)
    }
    val minFrequency = if (profile == CompressionProfile.FAST) 3 else 2
    val minSavingsThreshold = if (profile == CompressionProfile.FAST) 5 else 3

    val dynamicMerged = ArrayList<String>(maxDynamicSlots)
    val dynUtf8Lengths = IntArray(maxDynamicSlots)

    fun getUtf8LenById(id: Int): Int {
        return when {
            id < bank.primaryLen -> bank.primaryUtf8Len[id]
            id < MtxConstants.EXT_BANK_TOKEN -> dynUtf8Lengths[id - bank.primaryLen]
            id < bank.extDynIdBase -> bank.extUtf8Len[id - MtxConstants.EXT_STATIC_ID_BASE]
            id < MtxConstants.ESCAPE_ID_BASE -> dynUtf8Lengths[bank.primaryDynCap + (id - bank.extDynIdBase)]
            else -> escapeUtf8LenList[id - MtxConstants.ESCAPE_ID_BASE]
        }
    }

    fun getStreamByteCostById(id: Int): Int {
        if (id < MtxConstants.EXT_BANK_TOKEN) return 1
        if (id < MtxConstants.ESCAPE_ID_BASE) return 2
        val uLen = escapeUtf8LenList[id - MtxConstants.ESCAPE_ID_BASE]
        return if (uLen > 255) (ceil(uLen / 255.0).toInt() * 2 + uLen) else (2 + uLen)
    }

    fun getTokenStrById(id: Int): String {
        return when {
            id < bank.primaryLen -> bank.primaryVocab[id]
            id < MtxConstants.EXT_BANK_TOKEN -> dynamicMerged[id - bank.primaryLen]
            id < bank.extDynIdBase -> bank.extendedVocab[id - MtxConstants.EXT_STATIC_ID_BASE]
            id < MtxConstants.ESCAPE_ID_BASE -> dynamicMerged[bank.primaryDynCap + (id - bank.extDynIdBase)]
            else -> escapeLiterals[id - MtxConstants.ESCAPE_ID_BASE]
        }
    }

    val finalTokenIds: IntArray
    val blockTokenRanges = ArrayList<IntRange>(numBlocks)

    val maxSymbolId = MtxConstants.ESCAPE_ID_BASE + escapeLiterals.size
    val useSmiKeys = maxSymbolId <= MtxConstants.SMI_MAX_SYMBOL_ID
    val keyStride = if (useSmiKeys) (1L shl MtxConstants.SMI_PAIR_SHIFT) else MtxConstants.PAIR_KEY_STRIDE_LARGE

    if (tokenCount >= 2 && maxDynamicSlots > 0) {
        val tokIds = rawIds.copyOf(tokenCount)
        val prev = IntArray(tokenCount)
        val next = IntArray(tokenCount)
        val occPrev = IntArray(tokenCount) { -1 }
        val occNext = IntArray(tokenCount) { -1 }
        val keyAt = LongArray(tokenCount) { -1L }

        for (b in 0 until numBlocks) {
            val bStart = blockStartIndices[b]
            val bCount = blockInitialCounts[b]
            val bEnd = bStart + bCount
            for (idx in bStart until bEnd) {
                prev[idx] = if (idx > bStart) idx - 1 else -1
                next[idx] = if (idx + 1 < bEnd) idx + 1 else -1
            }
        }

        val pairCount = HashMap<Long, Int>(min(4096, tokenCount))
        val occHead = HashMap<Long, Int>(min(4096, tokenCount))
        val heap = BpeMaxHeap(min(4096, max(64, tokenCount ushr 2)))

        fun linkPair(nodeIdx: Int, pushToHeap: Boolean) {
            val r = next[nodeIdx]
            if (r == -1) return
            val idA = tokIds[nodeIdx]
            val idB = tokIds[r]
            val key = if (useSmiKeys) {
                ((idA.toLong() shl MtxConstants.SMI_PAIR_SHIFT) or idB.toLong())
            } else {
                idA.toLong() * keyStride + idB.toLong()
            }
            keyAt[nodeIdx] = key
            val nextCnt = (pairCount[key] ?: 0) + 1
            pairCount[key] = nextCnt

            val oldHead = occHead[key]
            occPrev[nodeIdx] = -1
            occNext[nodeIdx] = oldHead ?: -1
            if (oldHead != null) occPrev[oldHead] = nodeIdx
            occHead[key] = nodeIdx

            if (pushToHeap && nextCnt >= minFrequency) {
                val mergedUtf8 = getUtf8LenById(idA) + getUtf8LenById(idB)
                if (mergedUtf8 <= 96) {
                    val targetBytes = if (dynamicMerged.size < bank.primaryDynCap) 1 else 2
                    val sav = nextCnt * (getStreamByteCostById(idA) + getStreamByteCostById(idB) - targetBytes)
                    if (sav >= minSavingsThreshold) {
                        heap.push(sav, nextCnt, key)
                    }
                }
            }
        }

        fun unlinkPair(nodeIdx: Int) {
            val oldKey = keyAt[nodeIdx]
            if (oldKey < 0L) return
            val cnt = (pairCount[oldKey] ?: 0) - 1
            if (cnt <= 0) pairCount.remove(oldKey) else pairCount[oldKey] = cnt

            val p = occPrev[nodeIdx]
            val nx = occNext[nodeIdx]
            if (p != -1) {
                occNext[p] = nx
            } else if (nx != -1) {
                occHead[oldKey] = nx
            } else {
                occHead.remove(oldKey)
            }
            if (nx != -1) occPrev[nx] = p

            occPrev[nodeIdx] = -1
            occNext[nodeIdx] = -1
            keyAt[nodeIdx] = -1L
        }

        for (idx in (tokenCount - 2) downTo 0) {
            if (next[idx] != -1) linkPair(idx, false)
        }

        for ((key, freq) in pairCount) {
            if (freq < minFrequency) continue
            val idA = if (useSmiKeys) (key ushr MtxConstants.SMI_PAIR_SHIFT).toInt() else (key / keyStride).toInt()
            val idB = if (useSmiKeys) (key and MtxConstants.SMI_MAX_SYMBOL_ID.toLong()).toInt() else (key - idA.toLong() * keyStride).toInt()
            val mergedUtf8 = getUtf8LenById(idA) + getUtf8LenById(idB)
            if (mergedUtf8 > 96) continue
            val sav = freq * (getStreamByteCostById(idA) + getStreamByteCostById(idB) - 1)
            if (sav >= minSavingsThreshold) heap.push(sav, freq, key)
        }

        val popped = BpeMaxHeap.PoppedEntry()
        val positionsScratch = ArrayList<Int>(64)
        var currentTokenCount = tokenCount

        while (dynamicMerged.size < maxDynamicSlots && heap.popInto(popped)) {
            val actualFreq = pairCount[popped.key] ?: 0
            if (actualFreq < minFrequency) continue

            val idA = if (useSmiKeys) (popped.key ushr MtxConstants.SMI_PAIR_SHIFT).toInt() else (popped.key / keyStride).toInt()
            val idB = if (useSmiKeys) (popped.key and MtxConstants.SMI_MAX_SYMBOL_ID.toLong()).toInt() else (popped.key - idA.toLong() * keyStride).toInt()
            val mergedUtf8Len = getUtf8LenById(idA) + getUtf8LenById(idB)
            if (mergedUtf8Len > 96) continue

            val newDynIdx = dynamicMerged.size
            val isPrimarySlot = newDynIdx < bank.primaryDynCap
            val costSum = getStreamByteCostById(idA) + getStreamByteCostById(idB)
            if (!isPrimarySlot && costSum <= 2) continue

            val targetStreamBytes = if (isPrimarySlot) 1 else 2
            val actualSavings = actualFreq * (costSum - targetStreamBytes)

            if (actualSavings < minSavingsThreshold) continue
            if (!isPrimarySlot && actualSavings <= mergedUtf8Len + 2) continue

            if (actualFreq != popped.freq || actualSavings != popped.savings) {
                heap.push(actualSavings, actualFreq, popped.key)
                continue
            }

            val newDynId = if (isPrimarySlot) {
                bank.primaryLen + newDynIdx
            } else {
                bank.extDynIdBase + (newDynIdx - bank.primaryDynCap)
            }

            dynUtf8Lengths[newDynIdx] = mergedUtf8Len
            dynamicMerged.add(getTokenStrById(idA) + getTokenStrById(idB))

            positionsScratch.clear()
            var occCur = occHead[popped.key] ?: -1
            var isSortedAsc = true
            var lastPos = -1
            while (occCur != -1) {
                if (occCur <= lastPos) isSortedAsc = false
                lastPos = occCur
                positionsScratch.add(occCur)
                occCur = occNext[occCur]
            }
            if (!isSortedAsc && positionsScratch.size > 1) {
                positionsScratch.sort()
            }

            for (leftNode in positionsScratch) {
                if (keyAt[leftNode] != popped.key) continue
                val rightNode = next[leftNode]
                if (rightNode == -1) continue

                val leftNeighbor = prev[leftNode]
                val rightNeighbor = next[rightNode]

                if (leftNeighbor != -1) unlinkPair(leftNeighbor)
                unlinkPair(leftNode)
                unlinkPair(rightNode)

                tokIds[leftNode] = newDynId
                next[leftNode] = rightNeighbor
                if (rightNeighbor != -1) prev[rightNeighbor] = leftNode
                prev[rightNode] = -1
                next[rightNode] = -1
                currentTokenCount--

                if (leftNeighbor != -1) linkPair(leftNeighbor, true)
                if (rightNeighbor != -1) linkPair(leftNode, true)
            }
        }

        finalTokenIds = IntArray(currentTokenCount)
        var writeIdx = 0
        for (b in 0 until numBlocks) {
            val rangeStart = writeIdx
            var cur = if (blockInitialCounts[b] > 0) blockStartIndices[b] else -1
            while (cur != -1) {
                finalTokenIds[writeIdx++] = tokIds[cur]
                cur = next[cur]
            }
            blockTokenRanges.add(rangeStart until writeIdx)
        }
    } else {
        finalTokenIds = rawIds.copyOf(tokenCount)
        for (b in 0 until numBlocks) {
            val start = blockStartIndices[b]
            blockTokenRanges.add(start until (start + blockInitialCounts[b]))
        }
    }

    val indexingEndNs = System.nanoTime()

    val dictionaryEntries = if (buildDictionaryEntries) {
        val idFreq = HashMap<Int, Int>(min(512, finalTokenIds.size))
        for (id in finalTokenIds) {
            idFreq[id] = (idFreq[id] ?: 0) + 1
        }
        val entries = ArrayList<MtxDictionaryEntry>(idFreq.size)
        var entryIdx = 0
        for ((id, freq) in idFreq) {
            val tokenStr = getTokenStrById(id)
            val utf8Len = getUtf8LenById(id)
            val saved = freq * max(1, utf8Len - getStreamByteCostById(id))
            val isDiacritized = when {
                id < bank.primaryLen -> bank.primaryTashkeel[id].toInt() == 1
                id >= MtxConstants.EXT_STATIC_ID_BASE && id < bank.extDynIdBase ->
                    bank.extTashkeel[id - MtxConstants.EXT_STATIC_ID_BASE].toInt() == 1
                else -> MtxStaticVocabularies.containsArabicTashkeel(tokenStr)
            }
            val entryType = when {
                id < bank.primaryLen -> bank.primaryTypes[id]
                id >= MtxConstants.ESCAPE_ID_BASE -> MtxEntryType.ESCAPE
                id < bank.extDynIdBase && id >= MtxConstants.EXT_STATIC_ID_BASE ->
                    bank.extTypes[id - MtxConstants.EXT_STATIC_ID_BASE]
                else -> MtxStaticVocabularies.getSemanticType(tokenStr)
            }
            entries.add(
                MtxDictionaryEntry(
                    id = entryIdx++,
                    token = tokenStr,
                    frequency = freq,
                    rawUtf8Bytes = utf8Len,
                    totalSavedBytes = saved,
                    isDiacritized = isDiacritized,
                    type = entryType
                )
            )
        }
        entries.sortByDescending { it.totalSavedBytes }
        entries
    } else {
        emptyList()
    }

    val escapeUtf8Lengths = IntArray(escapeUtf8LenList.size) { escapeUtf8LenList[it] }
    val endNs = System.nanoTime()

    return InternalTokenizationOutput(
        finalTokenIds = finalTokenIds,
        blockTokenRanges = blockTokenRanges,
        dynamicMerged = dynamicMerged,
        escapeLiterals = escapeLiterals,
        escapeUtf8Lengths = escapeUtf8Lengths,
        dictionaryEntries = dictionaryEntries,
        tokenizationDurationMs = MtxInternalUtils.round2((endNs - startNs) / 1_000_000.0),
        indexingDurationMs = MtxInternalUtils.round2((indexingEndNs - indexingStartNs) / 1_000_000.0)
    )
}

private fun getOrComputeTokenizationPlan(
    text: String,
    bank: CompiledVocabularyBank,
    profile: CompressionProfile,
    chunkSpans: List<TextChunkSpan>,
    useCache: Boolean
): CachedTokenizationPlan {
    val canCache = useCache &&
        text.length <= MtxTokenizationCache.MAX_CACHEABLE_TEXT_CHARS &&
        chunkSpans.size == 1
    var cacheKey = ""
    if (canCache) {
        cacheKey = "${bank.bankId}:${profile.wireName}:${text.length}:${MtxCryptoAndChecksum.fnv1a32String(text)}"
        val hit = MtxTokenizationCache.get(cacheKey, text)
        if (hit != null) return hit
    }

    val output = executeMultilingualBpeTokenization(text, bank, profile, chunkSpans, true)
    val plan = CachedTokenizationPlan(
        text = text,
        bankId = bank.bankId,
        finalTokenIds = output.finalTokenIds,
        blockTokenRanges = output.blockTokenRanges,
        dynamicMerged = output.dynamicMerged,
        escapeLiterals = output.escapeLiterals,
        escapeUtf8Lengths = output.escapeUtf8Lengths,
        dictionaryEntries = output.dictionaryEntries,
        tokenizationDurationMs = output.tokenizationDurationMs,
        indexingDurationMs = output.indexingDurationMs,
        estimatedBytes = text.length * 2 +
            output.finalTokenIds.size * 4 +
            output.dictionaryEntries.size * 64
    )

    if (canCache) {
        MtxTokenizationCache.set(cacheKey, plan)
    }
    return plan
}

// ============================================================================
// 7. VERSION DETECTION & BINARY PAYLOAD PARSERS
// ============================================================================

private val KNOWN_FORMAT_VERSIONS: Set<Int> = setOf(
    MtxFormatVersions.V1_LEGACY,
    MtxFormatVersions.V1_0,
    MtxFormatVersions.V2_0,
    MtxFormatVersions.V2_1,
    MtxFormatVersions.V2_2,
    MtxFormatVersions.V2_3,
    MtxFormatVersions.V2_4,
    MtxFormatVersions.V2_5
)

private val ASCII_CHAR_TABLE: Array<String> = Array(128) { it.toChar().toString() }

private fun decodeEscapeUtf8Fast(stream: ByteArray, offset: Int, len: Int): String {
    if (len == 1) {
        val b0 = stream[offset].toInt() and 0xFF
        if (b0 < 0x80) return ASCII_CHAR_TABLE[b0]
    } else if (len == 2) {
        val b0 = stream[offset].toInt() and 0xFF
        val b1 = stream[offset + 1].toInt() and 0xFF
        if ((b0 and 0xE0) == 0xC0 && (b1 and 0xC0) == 0x80) {
            val cp = ((b0 and 0x1F) shl 6) or (b1 and 0x3F)
            if (cp >= 0x80) return cp.toChar().toString()
        }
    } else if (len == 3) {
        val b0 = stream[offset].toInt() and 0xFF
        val b1 = stream[offset + 1].toInt() and 0xFF
        val b2 = stream[offset + 2].toInt() and 0xFF
        if ((b0 and 0xF0) == 0xE0 && (b1 and 0xC0) == 0x80 && (b2 and 0xC0) == 0x80) {
            val cp = ((b0 and 0x0F) shl 12) or ((b1 and 0x3F) shl 6) or (b2 and 0x3F)
            if (cp >= 0x800 && (cp < 0xD800 || cp > 0xDFFF)) return cp.toChar().toString()
        }
    } else if (len == 4) {
        val b0 = stream[offset].toInt() and 0xFF
        val b1 = stream[offset + 1].toInt() and 0xFF
        val b2 = stream[offset + 2].toInt() and 0xFF
        val b3 = stream[offset + 3].toInt() and 0xFF
        if ((b0 and 0xF8) == 0xF0 && (b1 and 0xC0) == 0x80 && (b2 and 0xC0) == 0x80 && (b3 and 0xC0) == 0x80) {
            val cp = ((b0 and 0x07) shl 18) or ((b1 and 0x3F) shl 12) or ((b2 and 0x3F) shl 6) or (b3 and 0x3F)
            if (cp in 0x10000..0x10FFFF) return String(Character.toChars(cp))
        }
    }
    return String(stream, offset, len, StandardCharsets.UTF_8)
}

private fun parseMetadataJsonBlock(payload: ByteArray, offStart: Int): Pair<MtxMetadata, Int> {
    var off = offStart
    if (off + 2 > payload.size) {
        throw MtxCorruptDataError("الملف تالف: طول بيانات الوصف مفقود.")
    }
    val metaLen = MtxInternalUtils.readUInt16BE(payload, off)
    off += 2
    if (off + metaLen > payload.size) {
        throw MtxCorruptDataError("الملف تالف: بيانات الوصف مقطوعة أو تتجاوز حدود الحمولة.")
    }

    val metadata = try {
        val metaStr = String(payload, off, metaLen, StandardCharsets.UTF_8)
        val obj = JSONObject(metaStr)

        fun optNonNullString(key: String): String? =
            if (obj.has(key) && !obj.isNull(key)) obj.optString(key) else null

        fun optNonNullInt(key: String): Int? =
            if (obj.has(key) && !obj.isNull(key)) obj.optInt(key) else null

        val tagsArr = obj.optJSONArray("tags")
        val tagsList = if (tagsArr != null) {
            List(tagsArr.length()) { idx -> tagsArr.optString(idx) }
        } else {
            null
        }

        val chapterIdStr = if (obj.has("chapterId") && !obj.isNull("chapterId")) {
            obj.get("chapterId").toString()
        } else {
            null
        }

        MtxMetadata(
            title = optNonNullString("title") ?: "مخطوطة مسترجعة",
            author = optNonNullString("author") ?: "كاتب غير معروف",
            chapterTitle = optNonNullString("chapterTitle") ?: "فصل مسترجع",
            chapterIndex = optNonNullInt("chapterIndex") ?: 1,
            createdAt = optNonNullString("createdAt") ?: MtxInternalUtils.nowIsoUtc(),
            wordCount = optNonNullInt("wordCount"),
            tags = tagsList,
            genre = optNonNullString("genre"),
            translator = optNonNullString("translator"),
            notes = optNonNullString("notes"),
            codecVersion = optNonNullString("codecVersion"),
            formatVersion = optNonNullInt("formatVersion"),
            chapterId = chapterIdStr,
            languageCode = optNonNullString("languageCode"),
            translationGroupId = optNonNullString("translationGroupId"),
            editionLabel = optNonNullString("editionLabel"),
            bankId = optNonNullInt("bankId"),
            paragraphCount = optNonNullInt("paragraphCount"),
            chunkCount = optNonNullInt("chunkCount")
        )
    } catch (_: Exception) {
        MtxMetadata(
            title = "مخطوطة مسترجعة",
            author = "كاتب غير معروف",
            chapterTitle = "فصل مسترجع",
            chapterIndex = 1,
            createdAt = MtxInternalUtils.nowIsoUtc()
        )
    }

    return metadata to (off + metaLen)
}

private fun parseDynamicDictionaryBlock(payload: ByteArray, offStart: Int): Pair<List<String>, Int> {
    var off = offStart
    if (off >= payload.size) {
        throw MtxCorruptDataError("الملف تالف: جدول المقاطع الديناميكي مفقود.")
    }
    val dynCount = payload[off++].toInt() and 0xFF
    val dynamicMerged = ArrayList<String>(dynCount)
    for (i in 0 until dynCount) {
        if (off >= payload.size) {
            throw MtxCorruptDataError("الملف تالف: مقاطع القاموس مقطوعة.")
        }
        val len = payload[off++].toInt() and 0xFF
        if (off + len > payload.size) {
            throw MtxCorruptDataError("الملف تالف: طول المقطع الديناميكي يتجاوز حدود البيانات.")
        }
        dynamicMerged.add(String(payload, off, len, StandardCharsets.UTF_8))
        off += len
    }
    return dynamicMerged to off
}

private data class ParsedStandardPayload(
    val metadata: MtxMetadata,
    val dynamicMerged: List<String>,
    val reverseIndex: ReverseVocabularyIndex?,
    val customFullVocab: List<String>?,
    val stream: ByteArray,
    val nextOffset: Int
)

private fun parseStandardMtxPayload(
    payload: ByteArray,
    customBaseVocabulary: List<String>?,
    offsetStart: Int = 0
): ParsedStandardPayload {
    var off = offsetStart
    if (payload.size - off < 7) {
        throw MtxCorruptDataError("الملف تالف: حجم الحمولة أصغر من الحد الأدنى المطلوب.")
    }
    val (metadata, afterMeta) = parseMetadataJsonBlock(payload, off)
    off = afterMeta
    val (dynamicMerged, afterDyn) = parseDynamicDictionaryBlock(payload, off)
    off = afterDyn

    if (off + 4 > payload.size) {
        throw MtxCorruptDataError("الملف تالف: ترويسة تيار الرموز مفقودة.")
    }
    val streamByteLenLong = MtxInternalUtils.readUInt32BE(payload, off)
    off += 4
    if (streamByteLenLong > MtxConstants.MAX_STREAM_BYTE_LEN || off + streamByteLenLong > payload.size) {
        throw MtxCorruptDataError("الملف تالف: طول تيار الرموز غير متوافق مع حجم الحمولة.")
    }
    val streamByteLen = streamByteLenLong.toInt()
    val stream = payload.copyOfRange(off, off + streamByteLen)
    off += streamByteLen

    return if (customBaseVocabulary != null) {
        ParsedStandardPayload(
            metadata = metadata,
            dynamicMerged = dynamicMerged,
            reverseIndex = null,
            customFullVocab = customBaseVocabulary + dynamicMerged,
            stream = stream,
            nextOffset = off
        )
    } else {
        ParsedStandardPayload(
            metadata = metadata,
            dynamicMerged = dynamicMerged,
            reverseIndex = ReverseVocabularyIndex(dynamicMerged),
            customFullVocab = null,
            stream = stream,
            nextOffset = off
        )
    }
}

private fun decodeUniversalEscapeStream(
    stream: ByteArray,
    vocabLookup: ReverseVocabularyIndex,
    tokenCountHint: Int = -1
): Pair<String, Int> {
    if (tokenCountHint > MtxConstants.MAX_STREAM_BYTE_LEN) {
        throw MtxCorruptDataError("الملف تالف: عدد الرموز المصرّح به يتجاوز الحد الأقصى المسموح.")
    }
    val flatTable = vocabLookup.bindFlatTable()
    val streamLen = stream.size
    val sb = StringBuilder(max(16, streamLen))
    var tokens = 0
    var sOff = 0

    while (sOff < streamLen) {
        val id = stream[sOff++].toInt() and 0xFF
        if (id == MtxConstants.ESCAPE_TOKEN) {
            if (sOff >= streamLen) {
                throw MtxCorruptDataError("الملف تالف: تسلسل ESCAPE_TOKEN مقطوع قبل بايت الطول.")
            }
            val len = stream[sOff++].toInt() and 0xFF
            if (sOff + len > streamLen) {
                throw MtxCorruptDataError("الملف تالف: بيانات UTF-8 داخل ESCAPE_TOKEN مقطوعة.")
            }
            sb.append(decodeEscapeUtf8Fast(stream, sOff, len))
            sOff += len
        } else {
            val mapped = flatTable[id]
                ?: throw MtxCorruptDataError("الملف تالف: مرجع رمز غير موجود في القاموس (ID=$id).")
            sb.append(mapped)
        }
        tokens++
    }
    return sb.toString() to tokens
}

private fun decodeV25BankedStream(
    stream: ByteArray,
    primaryTable: Array<String?>,
    extendedTable: Array<String?>
): Pair<String, Int> {
    val streamLen = stream.size
    val sb = StringBuilder(max(16, streamLen * 2))
    var count = 0
    var sOff = 0

    while (sOff < streamLen) {
        val id = stream[sOff++].toInt() and 0xFF
        when {
            id < MtxConstants.EXT_BANK_TOKEN -> {
                val mapped = primaryTable[id]
                    ?: throw MtxCorruptDataError("الملف تالف: مرجع رمز غير موجود في البنك الأساسي (ID=$id).")
                sb.append(mapped)
            }
            id == MtxConstants.EXT_BANK_TOKEN -> {
                if (sOff >= streamLen) {
                    throw MtxCorruptDataError("الملف تالف: تسلسل EXT_BANK_TOKEN (254) مقطوع.")
                }
                val extId = stream[sOff++].toInt() and 0xFF
                val mapped = extendedTable[extId]
                    ?: throw MtxCorruptDataError("الملف تالف: مرجع رمز غير موجود في البنك الموسّع (extID=$extId).")
                sb.append(mapped)
            }
            else -> {
                if (sOff >= streamLen) {
                    throw MtxCorruptDataError("الملف تالف: تسلسل ESCAPE_TOKEN مقطوع قبل بايت الطول.")
                }
                val len = stream[sOff++].toInt() and 0xFF
                if (sOff + len > streamLen) {
                    throw MtxCorruptDataError("الملف تالف: بيانات UTF-8 داخل ESCAPE_TOKEN مقطوعة.")
                }
                sb.append(decodeEscapeUtf8Fast(stream, sOff, len))
                sOff += len
            }
        }
        count++
    }
    return sb.toString() to count
}

// ============================================================================
// 8. LEGACY & CURRENT FORMAT DECODERS (v1.0 – v2.5)
// ============================================================================

private fun decodeLegacySingleByteStream(
    stream: ByteArray,
    reverseIndex: ReverseVocabularyIndex?,
    customFullVocab: List<String>?
): Pair<String, Int> {
    val sb = StringBuilder(stream.size * 2)
    if (reverseIndex != null) {
        for (b in stream) sb.append(reverseIndex.getOrEmpty(b.toInt() and 0xFF))
    } else if (customFullVocab != null) {
        for (b in stream) {
            val idx = b.toInt() and 0xFF
            sb.append(if (idx in customFullVocab.indices) customFullVocab[idx] else "")
        }
    }
    return sb.toString() to stream.size
}

private fun tryDecryptAndInflateLegacy(
    encryptedPayload: ByteArray,
    salt: Long,
    expectedAdler32: Long,
    customBaseVocabulary: List<String>?,
    profile: LegacyDecoderProfile?
): Pair<ParsedStandardPayload, Pair<String, Int>> {
    val secret = profile?.cipherSecret ?: MtxConstants.MTX_CIPHER_SECRET
    val strategies = ArrayList<() -> ByteArray>(4)
    profile?.customDecryptor?.let { custom -> strategies.add { custom(encryptedPayload, salt) } }
    strategies.add { MtxCryptoAndChecksum.applyMtxKeystream(encryptedPayload, salt, secret) }
    strategies.add { MtxCryptoAndChecksum.applyLegacyLcgKeystream(encryptedPayload, salt, secret) }
    strategies.add { encryptedPayload }

    var firstSuccess: Pair<ParsedStandardPayload, Pair<String, Int>>? = null
    for (decrypt in strategies) {
        try {
            val decrypted = decrypt()
            val inflated = MtxInternalUtils.inflateRaw(decrypted)
            val parsed = parseStandardMtxPayload(inflated, customBaseVocabulary, 0)
            val decoded = decodeLegacySingleByteStream(parsed.stream, parsed.reverseIndex, parsed.customFullVocab)
            if (MtxCryptoAndChecksum.calculateAdler32(decoded.first) == expectedAdler32) {
                return parsed to decoded
            }
            if (firstSuccess == null) firstSuccess = parsed to decoded
        } catch (_: Exception) {
            // جرّب استراتيجية فك التشفير التالية
        }
    }
    return firstSuccess
        ?: throw MtxCorruptDataError("فشل فك ضغط ملف MTX القديم: البيانات تالفة أو مشفرة بمفتاح/خوارزمية قديمة غير متطابقة.")
}

class MtxV1LegacyDecoder(private val profile: LegacyDecoderProfile? = null) : MtxFormatDecoder {
    override val decoderId = "mtx-legacy-v1"
    override val formatLabel = "MTX v1.0 (Legacy)"
    override val supportedMagic = listOf(MtxMagicType.MTX1)
    override val supportedVersions = listOf(MtxFormatVersions.V1_LEGACY, MtxFormatVersions.V1_0)
    override val description = "مفكك ضغط لإصدارات MTX 1.x القديمة ذات الترويسة MTX1 وتدفق الرموز أحادي البايت."

    override fun canDecode(detection: MtxFormatDetectionResult): Boolean =
        detection.magic == MtxMagicType.MTX1 && detection.formatVersion in supportedVersions

    override fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload {
        val encryptedPayload = mtxBytes.copyOfRange(MtxConstants.MTX_HEADER_SIZE, mtxBytes.size)
        val (parsed, decoded) = tryDecryptAndInflateLegacy(
            encryptedPayload,
            detection.header.salt,
            detection.header.expectedAdler32,
            profile?.vocabulary,
            profile
        )
        val dictSize = parsed.reverseIndex?.totalSize
            ?: parsed.customFullVocab?.size
            ?: MtxStaticVocabularies.PRECOMPILED_VOCAB_LEN
        return MtxDecodedPayload(
            text = decoded.first,
            metadata = parsed.metadata,
            tokenCount = decoded.second,
            dictionarySize = dictSize,
            originalUtf8Bytes = detection.header.originalUtf8Bytes,
            expectedCrc32 = null,
            decoderId = decoderId,
            formatLabel = formatLabel
        )
    }
}

class MtxV20V21LegacyDecoder(private val profile: LegacyDecoderProfile? = null) : MtxFormatDecoder {
    override val decoderId = "mtx-legacy-v2.0-v2.1"
    override val formatLabel = "MTX v2.0 / v2.1 (Legacy)"
    override val supportedMagic = listOf(MtxMagicType.MTX2)
    override val supportedVersions = listOf(MtxFormatVersions.V2_0, MtxFormatVersions.V2_1)
    override val description = "مفكك ضغط لإصدارات MTX v2.0 و v2.1 قبل إضافة بروتوكول ESCAPE_TOKEN=255."

    override fun canDecode(detection: MtxFormatDetectionResult): Boolean =
        detection.magic == MtxMagicType.MTX2 && detection.formatVersion in supportedVersions

    override fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload {
        val encryptedPayload = mtxBytes.copyOfRange(MtxConstants.MTX_HEADER_SIZE, mtxBytes.size)
        val (parsed, decoded) = tryDecryptAndInflateLegacy(
            encryptedPayload,
            detection.header.salt,
            detection.header.expectedAdler32,
            profile?.vocabulary,
            profile
        )
        val dictSize = parsed.reverseIndex?.totalSize
            ?: parsed.customFullVocab?.size
            ?: MtxStaticVocabularies.PRECOMPILED_VOCAB_LEN
        val label = if (detection.formatVersion == MtxFormatVersions.V2_0) "MTX v2.0 (Legacy)" else "MTX v2.1 (Legacy)"
        return MtxDecodedPayload(
            text = decoded.first,
            metadata = parsed.metadata,
            tokenCount = decoded.second,
            dictionarySize = dictSize,
            originalUtf8Bytes = detection.header.originalUtf8Bytes,
            expectedCrc32 = null,
            decoderId = decoderId,
            formatLabel = label
        )
    }
}

class MtxV22Decoder : MtxFormatDecoder {
    override val decoderId = "mtx-v2.2-fortified"
    override val formatLabel = "MTX v2.2 (Fortified)"
    override val supportedMagic = listOf(MtxMagicType.MTX2)
    override val supportedVersions = listOf(MtxFormatVersions.V2_2)
    override val description = "مفكك ضغط لإصدار MTX v2.2 المزوّد ببروتوكول ESCAPE_TOKEN=255 ومفتاح التدفق غير الخطي."

    override fun canDecode(detection: MtxFormatDetectionResult): Boolean =
        detection.magic == MtxMagicType.MTX2 && detection.formatVersion == MtxFormatVersions.V2_2

    override fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload {
        val decryptedPayload = MtxCryptoAndChecksum.applyMtxKeystream(
            mtxBytes,
            detection.header.salt,
            offset = MtxConstants.MTX_HEADER_SIZE,
            length = mtxBytes.size - MtxConstants.MTX_HEADER_SIZE
        )
        val payload = try {
            MtxInternalUtils.inflateRaw(decryptedPayload)
        } catch (_: Exception) {
            throw MtxCorruptDataError("فشل فك ضغط بيانات MTX v2.2: البيانات غير صالحة أو تعرضت للتلف.")
        }
        val parsed = parseStandardMtxPayload(payload, null, 0)
        val reverseIndex = parsed.reverseIndex!!
        val (text, tokenCount) = decodeUniversalEscapeStream(parsed.stream, reverseIndex)
        return MtxDecodedPayload(
            text = text,
            metadata = parsed.metadata,
            tokenCount = tokenCount,
            dictionarySize = reverseIndex.totalSize,
            originalUtf8Bytes = detection.header.originalUtf8Bytes,
            expectedCrc32 = null,
            decoderId = decoderId,
            formatLabel = formatLabel
        )
    }
}

class MtxV23Decoder : MtxFormatDecoder {
    override val decoderId = "mtx-v2.3-unified"
    override val formatLabel = "MTX v2.3 (Unified)"
    override val supportedMagic = listOf(MtxMagicType.MTX2)
    override val supportedVersions = listOf(MtxFormatVersions.V2_3)
    override val description = "مفكك ضغط إصدار MTX v2.3 مع التحقق المزدوج وبصمة القاموس M3HD."

    override fun canDecode(detection: MtxFormatDetectionResult): Boolean =
        detection.magic == MtxMagicType.MTX2 && detection.formatVersion == MtxFormatVersions.V2_3

    override fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload {
        val decryptedPayload = MtxCryptoAndChecksum.applyMtxKeystream(
            mtxBytes,
            detection.header.salt,
            offset = MtxConstants.MTX_HEADER_SIZE,
            length = mtxBytes.size - MtxConstants.MTX_HEADER_SIZE
        )
        val payload = try {
            MtxInternalUtils.inflateRaw(decryptedPayload)
        } catch (_: Exception) {
            throw MtxCorruptDataError("فشل فك ضغط بيانات MTX v2.3: البيانات غير صالحة أو تعرضت للتلف.")
        }
        if (payload.size < MtxConstants.MTX_V23_EXTENDED_HEADER_SIZE) {
            throw MtxCorruptDataError("الملف تالف: ترويسة التحقق الممتدة (M3HD) لإصدار v2.3 مفقودة.")
        }
        for (i in 0 until 4) {
            if (payload[i] != MtxConstants.MTX_V23_PAYLOAD_MAGIC[i]) {
                throw MtxCorruptDataError("الملف تالف: توقيع ترويسة v2.3 الداخلية (M3HD) غير مطابق.")
            }
        }
        val formatSpec = MtxInternalUtils.readUInt16BE(payload, 4)
        val expectedCrc32 = MtxInternalUtils.readUInt32BE(payload, 6)
        val vocabHash = MtxInternalUtils.readUInt32BE(payload, 10)
        if (formatSpec > MtxConstants.MTX_V23_FORMAT_SPEC + 9) {
            throw MtxCorruptDataError("مواصفة v2.3 الفرعية غير متوافقة ($formatSpec).")
        }
        val warnings = if (vocabHash != MtxStaticVocabularies.PRECOMPILED_VOCAB_HASH) {
            listOf("تنبيه توافق: بصمة القاموس الثابت في الملف (${vocabHash.toString(16)}) تختلف عن القاموس الحالي.")
        } else {
            null
        }
        val parsed = parseStandardMtxPayload(payload, null, MtxConstants.MTX_V23_EXTENDED_HEADER_SIZE)
        val reverseIndex = parsed.reverseIndex!!
        val (text, tokenCount) = decodeUniversalEscapeStream(parsed.stream, reverseIndex)
        return MtxDecodedPayload(
            text = text,
            metadata = parsed.metadata,
            tokenCount = tokenCount,
            dictionarySize = reverseIndex.totalSize,
            originalUtf8Bytes = detection.header.originalUtf8Bytes,
            expectedCrc32 = expectedCrc32,
            decoderId = decoderId,
            formatLabel = formatLabel,
            warnings = warnings
        )
    }
}

class MtxV24Decoder : MtxFormatDecoder {
    override val decoderId = "mtx-v2.4-indexed"
    override val formatLabel = "MTX v2.4 (Indexed)"
    override val supportedMagic = listOf(MtxMagicType.MTX2)
    override val supportedVersions = listOf(MtxFormatVersions.V2_4)
    override val description = "مفكك ضغط إصدار MTX v2.4 المزوّد بفهرس عكسي مباشر وترويسة الفهرسة M4HD."

    override fun canDecode(detection: MtxFormatDetectionResult): Boolean =
        detection.magic == MtxMagicType.MTX2 && detection.formatVersion == MtxFormatVersions.V2_4

    override fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload {
        val decryptedPayload = MtxCryptoAndChecksum.applyMtxKeystream(
            mtxBytes,
            detection.header.salt,
            offset = MtxConstants.MTX_HEADER_SIZE,
            length = mtxBytes.size - MtxConstants.MTX_HEADER_SIZE
        )
        val payload = try {
            MtxInternalUtils.inflateRaw(decryptedPayload)
        } catch (_: Exception) {
            throw MtxCorruptDataError("فشل فك ضغط بيانات MTX v2.4: البيانات غير صالحة أو تعرضت للتلف.")
        }
        if (payload.size < MtxConstants.MTX_V24_EXTENDED_HEADER_SIZE) {
            throw MtxCorruptDataError("الملف تالف: ترويسة الفهرسة الممتدة (M4HD) لإصدار v2.4 مفقودة.")
        }
        for (i in 0 until 4) {
            if (payload[i] != MtxConstants.MTX_V24_PAYLOAD_MAGIC[i]) {
                throw MtxCorruptDataError("الملف تالف: توقيع ترويسة v2.4 الداخلية (M4HD) غير مطابق.")
            }
        }
        val formatSpec = MtxInternalUtils.readUInt16BE(payload, 4)
        val expectedCrc32 = MtxInternalUtils.readUInt32BE(payload, 6)
        val vocabHash = MtxInternalUtils.readUInt32BE(payload, 10)
        val tokenCountHint = MtxInternalUtils.readUInt32BE(payload, 14).toInt()
        if (formatSpec > MtxConstants.MTX_V24_FORMAT_SPEC + 9) {
            throw MtxCorruptDataError("مواصفة v2.4 الفرعية غير متوافقة ($formatSpec).")
        }
        val warnings = if (vocabHash != MtxStaticVocabularies.PRECOMPILED_VOCAB_HASH) {
            listOf("تنبيه توافق: بصمة القاموس الثابت في الملف (${vocabHash.toString(16)}) تختلف عن القاموس الحالي.")
        } else {
            null
        }
        val parsed = parseStandardMtxPayload(payload, null, MtxConstants.MTX_V24_EXTENDED_HEADER_SIZE)
        val reverseIndex = parsed.reverseIndex!!
        val (text, tokenCount) = decodeUniversalEscapeStream(parsed.stream, reverseIndex, tokenCountHint)
        return MtxDecodedPayload(
            text = text,
            metadata = parsed.metadata,
            tokenCount = tokenCount,
            dictionarySize = reverseIndex.totalSize,
            originalUtf8Bytes = detection.header.originalUtf8Bytes,
            expectedCrc32 = expectedCrc32,
            decoderId = decoderId,
            formatLabel = formatLabel,
            warnings = warnings
        )
    }
}

private data class ParsedV25Envelope(
    val bank: CompiledVocabularyBank,
    val isChunked: Boolean,
    val expectedCrc32: Long,
    val totalTokenCountHint: Int,
    val metadata: MtxMetadata,
    val dynamicMerged: List<String>,
    val chunks: List<MtxChunkIndexEntry>,
    val singleStreamOffset: Int = 0,
    val headerPayload: ByteArray? = null,
    val warnings: List<String>
)

private fun parseV25HeaderDirectory(
    mtxBytes: ByteArray,
    detection: MtxFormatDetectionResult
): ParsedV25Envelope {
    if (mtxBytes.size < MtxConstants.MTX_HEADER_SIZE + 5) {
        throw MtxCorruptDataError("الملف تالف: ترويسة حاوية MTX v2.5 غير مكتملة.")
    }
    val salt = detection.header.salt
    val maskedSegLen = MtxInternalUtils.readUInt32BE(mtxBytes, MtxConstants.MTX_HEADER_SIZE)
    val headerSegLenLong = (maskedSegLen xor (salt xor MtxConstants.MTX_V25_LEN_MASK)) and 0xFFFFFFFFL
    val containerStart = MtxConstants.MTX_HEADER_SIZE + 4

    if (headerSegLenLong > (mtxBytes.size - containerStart).toLong()) {
        throw MtxCorruptDataError("الملف تالف: طول ترويسة v2.5 الداخلية غير متوافق مع حجم الملف.")
    }
    val headerSegLen = headerSegLenLong.toInt()
    val headerCipherLen = if (headerSegLen == 0) (mtxBytes.size - containerStart) else headerSegLen

    val decryptedHeader = MtxCryptoAndChecksum.applyMtxKeystream(
        mtxBytes,
        salt,
        offset = containerStart,
        length = headerCipherLen
    )
    val headerPayload = try {
        MtxInternalUtils.inflateRaw(decryptedHeader)
    } catch (_: Exception) {
        throw MtxCorruptDataError("فشل فك ضغط بيانات MTX v2.5: الترويسة الداخلية تالفة أو مفتاح الفك غير مطابق.")
    }

    if (headerPayload.size < MtxConstants.MTX_V25_EXTENDED_HEADER_SIZE) {
        throw MtxCorruptDataError("الملف تالف: ترويسة M5HD لإصدار v2.5 مفقودة.")
    }
    for (i in 0 until 4) {
        if (headerPayload[i] != MtxConstants.MTX_V25_PAYLOAD_MAGIC[i]) {
            throw MtxCorruptDataError("الملف تالف: توقيع M5HD غير مطابق.")
        }
    }

    val formatSpec = MtxInternalUtils.readUInt16BE(headerPayload, 4)
    val bankId = headerPayload[6].toInt() and 0xFF
    val chunkFlags = headerPayload[7].toInt() and 0xFF
    val expectedCrc32 = MtxInternalUtils.readUInt32BE(headerPayload, 8)
    val vocabHash = MtxInternalUtils.readUInt32BE(headerPayload, 12)
    val totalTokenCountHint = MtxInternalUtils.readUInt32BE(headerPayload, 16).toInt()

    if (formatSpec > MtxConstants.MTX_V25_FORMAT_SPEC + 9) {
        throw MtxCorruptDataError("مواصفة v2.5 الفرعية غير متوافقة ($formatSpec).")
    }

    val bank = MtxVocabularyBanks.defaultVocabularyRegistry.getById(bankId)
        ?: throw MtxCorruptDataError("معرّف بنك المفردات ($bankId) غير مسجل في المحرك.")

    val warnings = ArrayList<String>(1)
    if (vocabHash != bank.vocabHash) {
        warnings.add("تنبيه توافق: بصمة بنك المفردات (${vocabHash.toString(16)}) تختلف عن البنك المسجل (${bank.code}).")
    }

    val isChunked = (chunkFlags and 0x01) != 0
    var off = MtxConstants.MTX_V25_EXTENDED_HEADER_SIZE
    var chunkCount = 1
    if (isChunked) {
        if (off + 2 > headerPayload.size) {
            throw MtxCorruptDataError("الملف تالف: عدد الكتل المفهرسة مفقود في ترويسة M5HD.")
        }
        chunkCount = MtxInternalUtils.readUInt16BE(headerPayload, off)
        off += 2
    }

    val (metadata, afterMeta) = parseMetadataJsonBlock(headerPayload, off)
    off = afterMeta
    val (dynamicMerged, afterDyn) = parseDynamicDictionaryBlock(headerPayload, off)
    off = afterDyn

    if (!isChunked) {
        return ParsedV25Envelope(
            bank = bank,
            isChunked = false,
            expectedCrc32 = expectedCrc32,
            totalTokenCountHint = totalTokenCountHint,
            metadata = metadata,
            dynamicMerged = dynamicMerged,
            chunks = emptyList(),
            singleStreamOffset = off,
            headerPayload = headerPayload,
            warnings = warnings
        )
    }

    val expectedTableBytes = chunkCount * MtxConstants.MTX_V25_CHUNK_ENTRY_SIZE
    if (off + expectedTableBytes > headerPayload.size) {
        throw MtxCorruptDataError("الملف تالف: جدول فهرسة الكتل (Chunk Index) مقطوع.")
    }

    val chunks = ArrayList<MtxChunkIndexEntry>(chunkCount)
    var blockCursor = containerStart + headerSegLen

    for (i in 0 until chunkCount) {
        val charStart = MtxInternalUtils.readUInt32BE(headerPayload, off).toInt()
        val charLength = MtxInternalUtils.readUInt32BE(headerPayload, off + 4).toInt()
        val utf8ByteStart = MtxInternalUtils.readUInt32BE(headerPayload, off + 8).toInt()
        val utf8ByteLength = MtxInternalUtils.readUInt32BE(headerPayload, off + 12).toInt()
        val paragraphStart = MtxInternalUtils.readUInt32BE(headerPayload, off + 16).toInt()
        val paragraphCount = MtxInternalUtils.readUInt16BE(headerPayload, off + 20)
        val compressedByteLength = MtxInternalUtils.readUInt32BE(headerPayload, off + 22).toInt()
        val blockCrc32 = MtxInternalUtils.readUInt32BE(headerPayload, off + 26)
        off += MtxConstants.MTX_V25_CHUNK_ENTRY_SIZE

        if (compressedByteLength < 0 || blockCursor + compressedByteLength > mtxBytes.size) {
            throw MtxCorruptDataError("الملف تالف: حدود الكتلة المضغوطة رقم $i تتجاوز حجم الملف.")
        }

        chunks.add(
            MtxChunkIndexEntry(
                blockIndex = i,
                charStart = charStart,
                charLength = charLength,
                utf8ByteStart = utf8ByteStart,
                utf8ByteLength = utf8ByteLength,
                paragraphStart = paragraphStart,
                paragraphCount = paragraphCount,
                compressedByteStart = blockCursor,
                compressedByteLength = compressedByteLength,
                blockCrc32 = blockCrc32
            )
        )
        blockCursor += compressedByteLength
    }

    if (blockCursor != mtxBytes.size) {
        throw MtxCorruptDataError("الملف تالف: مجموع أطوال الكتل لا يطابق حجم الحاوية الثنائية.")
    }

    return ParsedV25Envelope(
        bank = bank,
        isChunked = true,
        expectedCrc32 = expectedCrc32,
        totalTokenCountHint = totalTokenCountHint,
        metadata = metadata,
        dynamicMerged = dynamicMerged,
        chunks = chunks,
        warnings = warnings
    )
}

private fun decodeSingleV25Block(
    mtxBytes: ByteArray,
    salt: Long,
    chunk: MtxChunkIndexEntry,
    primaryTable: Array<String?>,
    extendedTable: Array<String?>
): Pair<String, Int> {
    val blockSalt = ((salt.toInt() xor ((chunk.blockIndex + 1) * 0x9E3779B1.toInt())).toLong() and 0xFFFFFFFFL)
    val decrypted = MtxCryptoAndChecksum.applyMtxKeystream(
        mtxBytes,
        blockSalt,
        offset = chunk.compressedByteStart,
        length = chunk.compressedByteLength
    )
    val stream = try {
        MtxInternalUtils.inflateRaw(decrypted)
    } catch (_: Exception) {
        throw MtxCorruptDataError("فشل فك ضغط الكتلة رقم ${chunk.blockIndex}: البيانات تالفة.")
    }
    val decoded = decodeV25BankedStream(stream, primaryTable, extendedTable)
    val actualBlockCrc = MtxCryptoAndChecksum.calculateCrc32(decoded.first)
    if (actualBlockCrc != chunk.blockCrc32) {
        throw MtxCorruptDataError("فشل التحقق من سلامة الكتلة رقم ${chunk.blockIndex}: بصمة CRC-32 غير مطابقة.")
    }
    return decoded
}

class MtxV25Decoder : MtxFormatDecoder {
    override val decoderId = "mtx-v2.5-multilingual"
    override val formatLabel = "MTX v2.5 (Multilingual Indexed)"
    override val supportedMagic = listOf(MtxMagicType.MTX2)
    override val supportedVersions = listOf(MtxFormatVersions.V2_5)
    override val description =
        "مفكك ضغط الإصدار الحالي MTX v2.5 متعدد اللغات المزوّد ببنوك المفردات المستقلة وفهرسة الكتل الجزئية M5HD."

    override fun canDecode(detection: MtxFormatDetectionResult): Boolean =
        detection.magic == MtxMagicType.MTX2 && detection.formatVersion == MtxFormatVersions.V2_5

    override fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload {
        val env = parseV25HeaderDirectory(mtxBytes, detection)
        val (primary, extended) = env.bank.bindDynamicTables(env.dynamicMerged)
        val dictSize = env.bank.primaryLen + env.bank.extStaticLen + env.dynamicMerged.size

        if (!env.isChunked) {
            val payload = env.headerPayload!!
            var off = env.singleStreamOffset
            if (off + 4 > payload.size) {
                throw MtxCorruptDataError("الملف تالف: ترويسة تيار الرموز مفقودة في M5HD.")
            }
            val streamByteLenLong = MtxInternalUtils.readUInt32BE(payload, off)
            off += 4
            if (streamByteLenLong > MtxConstants.MAX_STREAM_BYTE_LEN || off + streamByteLenLong > payload.size) {
                throw MtxCorruptDataError("الملف تالف: طول تيار الرموز في v2.5 غير متوافق مع الحمولة.")
            }
            val streamByteLen = streamByteLenLong.toInt()
            val stream = payload.copyOfRange(off, off + streamByteLen)
            val (text, tokenCount) = decodeV25BankedStream(stream, primary, extended)

            return MtxDecodedPayload(
                text = text,
                metadata = env.metadata,
                tokenCount = tokenCount,
                dictionarySize = dictSize,
                originalUtf8Bytes = detection.header.originalUtf8Bytes,
                expectedCrc32 = env.expectedCrc32,
                decoderId = decoderId,
                formatLabel = formatLabel,
                bankId = env.bank.bankId,
                chunkCount = 1,
                warnings = env.warnings.ifEmpty { null }
            )
        }

        val fullText = StringBuilder(max(64, detection.header.originalUtf8Bytes))
        var totalTokens = 0
        for (chunk in env.chunks) {
            val (blockText, blockTokens) = decodeSingleV25Block(
                mtxBytes,
                detection.header.salt,
                chunk,
                primary,
                extended
            )
            fullText.append(blockText)
            totalTokens += blockTokens
        }

        return MtxDecodedPayload(
            text = fullText.toString(),
            metadata = env.metadata,
            tokenCount = totalTokens,
            dictionarySize = dictSize,
            originalUtf8Bytes = detection.header.originalUtf8Bytes,
            expectedCrc32 = env.expectedCrc32,
            decoderId = decoderId,
            formatLabel = formatLabel,
            bankId = env.bank.bankId,
            chunkCount = env.chunks.size,
            warnings = env.warnings.ifEmpty { null }
        )
    }
}

// ============================================================================
// 9. FORMAT COMPATIBILITY LAYER
// ============================================================================

class MtxFormatCompatibilityLayer(initialDecoders: List<MtxFormatDecoder> = emptyList()) {
    private val lock = Any()
    private val decoders = ArrayList<MtxFormatDecoder>(8)

    init {
        for (decoder in initialDecoders) {
            registerDecoder(decoder)
        }
    }

    fun registerDecoder(decoder: MtxFormatDecoder) {
        synchronized(lock) {
            val idx = decoders.indexOfFirst { it.decoderId == decoder.decoderId }
            if (idx >= 0) decoders[idx] = decoder else decoders.add(decoder)
        }
    }

    fun unregisterDecoder(decoderId: String): Boolean {
        synchronized(lock) {
            val idx = decoders.indexOfFirst { it.decoderId == decoderId }
            if (idx >= 0) {
                decoders.removeAt(idx)
                return true
            }
            return false
        }
    }

    fun listRegisteredDecoders(): List<DecoderRegistrationInfo> = synchronized(lock) {
        decoders.map { d ->
            DecoderRegistrationInfo(
                decoderId = d.decoderId,
                formatLabel = d.formatLabel,
                supportedMagic = d.supportedMagic.map { it.name },
                supportedVersions = d.supportedVersions.toList(),
                description = d.description
            )
        }
    }

    fun getSupportedVersions(): List<Int> = synchronized(lock) {
        val versions = HashSet<Int>()
        for (d in decoders) versions.addAll(d.supportedVersions)
        versions.sorted()
    }

    fun resolveDecoder(detection: MtxFormatDetectionResult): MtxFormatDecoder = synchronized(lock) {
        decoders.firstOrNull { it.canDecode(detection) }
            ?: throw MtxUnsupportedVersionError(
                detectedVersion = detection.formatVersion,
                supportedVersions = getSupportedVersions(),
                message = "إصدار تنسيق MTX (${detection.versionLabel} / رمز ${detection.formatVersion}) غير مدعوم في طبقة التوافق الحالية. الإصدارات المدعومة: ${getSupportedVersions().joinToString(", ")}."
            )
    }

    fun decode(mtxBytes: ByteArray, detection: MtxFormatDetectionResult): MtxDecodedPayload =
        resolveDecoder(detection).decode(mtxBytes, detection)
}

fun createMtxCompatibilityLayer(legacyProfile: LegacyDecoderProfile? = null): MtxFormatCompatibilityLayer {
    return MtxFormatCompatibilityLayer(
        listOf(
            MtxV25Decoder(),
            MtxV24Decoder(),
            MtxV23Decoder(),
            MtxV22Decoder(),
            MtxV20V21LegacyDecoder(legacyProfile),
            MtxV1LegacyDecoder(legacyProfile)
        )
    )
}

// ============================================================================
// 10. UNIFIED MTX ENGINE & ANDROID FACADE OBJECT
// ============================================================================

private fun encodeTokenRangeToStream(
    finalIds: IntArray,
    range: IntRange,
    bank: CompiledVocabularyBank,
    escapeByteBuffers: Array<ByteArray>
): Pair<ByteArray, Int> {
    var streamByteLength = 0
    var escapeTokensCount = 0

    for (k in range) {
        val id = finalIds[k]
        when {
            id < MtxConstants.EXT_BANK_TOKEN -> streamByteLength += 1
            id < MtxConstants.ESCAPE_ID_BASE -> streamByteLength += 2
            else -> {
                escapeTokensCount++
                val rawBytes = escapeByteBuffers[id - MtxConstants.ESCAPE_ID_BASE]
                streamByteLength += if (rawBytes.size > 255) {
                    ceil(rawBytes.size / 255.0).toInt() * 2 + rawBytes.size
                } else {
                    2 + rawBytes.size
                }
            }
        }
    }

    val stream = ByteArray(streamByteLength)
    var off = 0
    for (k in range) {
        val id = finalIds[k]
        when {
            id < MtxConstants.EXT_BANK_TOKEN -> stream[off++] = id.toByte()
            id < MtxConstants.ESCAPE_ID_BASE -> {
                val extSlot = if (id < bank.extDynIdBase) {
                    id - MtxConstants.EXT_STATIC_ID_BASE
                } else {
                    bank.extStaticLen + (id - bank.extDynIdBase)
                }
                stream[off++] = MtxConstants.EXT_BANK_TOKEN.toByte()
                stream[off++] = extSlot.toByte()
            }
            else -> {
                val rawBytes = escapeByteBuffers[id - MtxConstants.ESCAPE_ID_BASE]
                if (rawBytes.size > 255) {
                    var sliceOff = 0
                    while (sliceOff < rawBytes.size) {
                        val sliceLen = min(255, rawBytes.size - sliceOff)
                        stream[off++] = MtxConstants.ESCAPE_TOKEN.toByte()
                        stream[off++] = sliceLen.toByte()
                        System.arraycopy(rawBytes, sliceOff, stream, off, sliceLen)
                        off += sliceLen
                        sliceOff += sliceLen
                    }
                } else {
                    stream[off++] = MtxConstants.ESCAPE_TOKEN.toByte()
                    stream[off++] = rawBytes.size.toByte()
                    System.arraycopy(rawBytes, 0, stream, off, rawBytes.size)
                    off += rawBytes.size
                }
            }
        }
    }

    return stream to escapeTokensCount
}

private fun serializeMetadataToUtf8(metadata: MtxMetadata): ByteArray {
    val obj = JSONObject()
    obj.put("title", metadata.title)
    obj.put("author", metadata.author)
    obj.put("chapterTitle", metadata.chapterTitle)
    obj.put("chapterIndex", metadata.chapterIndex)
    obj.put("createdAt", metadata.createdAt)
    metadata.wordCount?.let { obj.put("wordCount", it) }
    metadata.tags?.let { obj.put("tags", JSONArray(it)) }
    metadata.genre?.let { obj.put("genre", it) }
    metadata.translator?.let { obj.put("translator", it) }
    metadata.notes?.let { obj.put("notes", it) }
    metadata.codecVersion?.let { obj.put("codecVersion", it) }
    metadata.formatVersion?.let { obj.put("formatVersion", it) }
    metadata.chapterId?.let { obj.put("chapterId", it) }
    metadata.languageCode?.let { obj.put("languageCode", it) }
    metadata.translationGroupId?.let { obj.put("translationGroupId", it) }
    metadata.editionLabel?.let { obj.put("editionLabel", it) }
    metadata.bankId?.let { obj.put("bankId", it) }
    metadata.paragraphCount?.let { obj.put("paragraphCount", it) }
    metadata.chunkCount?.let { obj.put("chunkCount", it) }
    return obj.toString().toByteArray(StandardCharsets.UTF_8)
}

class MtxEngine(
    private val compatibilityLayer: MtxFormatCompatibilityLayer = createMtxCompatibilityLayer()
) {
    val engineVersion: String = MtxConstants.MTX_ENGINE_VERSION
    val outputFormatVersion: Int = MtxConstants.MTX_VERSION

    fun registerFormatDecoder(decoder: MtxFormatDecoder) {
        compatibilityLayer.registerDecoder(decoder)
    }

    fun getCompatibilityLayer(): MtxFormatCompatibilityLayer = compatibilityLayer

    fun inspect(mtxBytes: ByteArray): MtxFormatDetectionResult = MtxCodec.detectMtxFormat(mtxBytes)

    fun inspectChunkIndex(mtxBytes: ByteArray): MtxChunkIndexInspection {
        val detection = MtxCodec.detectMtxFormat(mtxBytes)
        if (detection.formatVersion != MtxFormatVersions.V2_5) {
            throw MtxUnsupportedVersionError(
                detection.formatVersion,
                listOf(MtxFormatVersions.V2_5),
                "فهرسة الكتل الجزئية متاحة حصرياً لتنسيق MTX v2.5 (M5HD)."
            )
        }
        val env = parseV25HeaderDirectory(mtxBytes, detection)
        return MtxChunkIndexInspection(
            formatVersion = detection.formatVersion,
            bankId = env.bank.bankId,
            bankCode = env.bank.code,
            isChunked = env.isChunked,
            totalTokenCount = env.totalTokenCountHint,
            chunkCount = if (env.isChunked) env.chunks.size else 1,
            metadata = env.metadata,
            chunks = env.chunks
        )
    }

    fun decompressBlock(mtxBytes: ByteArray, blockIndex: Int): String {
        val detection = MtxCodec.detectMtxFormat(mtxBytes)
        if (detection.formatVersion != MtxFormatVersions.V2_5) {
            return decompress(mtxBytes).text
        }
        val env = parseV25HeaderDirectory(mtxBytes, detection)
        if (!env.isChunked) {
            if (blockIndex != 0) {
                throw MtxCorruptDataError("رقم الكتلة ($blockIndex) خارج النطاق (الكتل المتاحة: 1).")
            }
            return decompress(mtxBytes).text
        }
        if (blockIndex !in env.chunks.indices) {
            throw MtxCorruptDataError("رقم الكتلة ($blockIndex) خارج النطاق (0..${env.chunks.size - 1}).")
        }
        val (primary, extended) = env.bank.bindDynamicTables(env.dynamicMerged)
        return decodeSingleV25Block(
            mtxBytes,
            detection.header.salt,
            env.chunks[blockIndex],
            primary,
            extended
        ).first
    }

    fun decompressParagraphRange(
        mtxBytes: ByteArray,
        startParagraph: Int,
        endParagraph: Int
    ): MtxParagraphRangeResult {
        val detection = MtxCodec.detectMtxFormat(mtxBytes)
        if (detection.formatVersion != MtxFormatVersions.V2_5) {
            val full = decompress(mtxBytes)
            val paras = full.text.split("\n")
            val s = max(0, startParagraph)
            val e = min(paras.size - 1, endParagraph)
            val sliced = if (s <= e) paras.subList(s, e + 1).joinToString("\n") else ""
            return MtxParagraphRangeResult(sliced, 1, 1)
        }

        val env = parseV25HeaderDirectory(mtxBytes, detection)
        if (!env.isChunked) {
            val full = decompress(mtxBytes)
            val paras = full.text.split("\n")
            val s = max(0, startParagraph)
            val e = min(paras.size - 1, endParagraph)
            val sliced = if (s <= e) paras.subList(s, e + 1).joinToString("\n") else ""
            return MtxParagraphRangeResult(sliced, 1, 1)
        }

        val (primary, extended) = env.bank.bindDynamicTables(env.dynamicMerged)
        val matchingChunks = env.chunks.filter { c ->
            val cEnd = c.paragraphStart + c.paragraphCount - 1
            cEnd >= startParagraph && c.paragraphStart <= endParagraph
        }
        if (matchingChunks.isEmpty()) {
            return MtxParagraphRangeResult("", 0, env.chunks.size)
        }

        val firstPara = matchingChunks[0].paragraphStart
        val combined = StringBuilder()
        for (chunk in matchingChunks) {
            combined.append(
                decodeSingleV25Block(mtxBytes, detection.header.salt, chunk, primary, extended).first
            )
        }
        val paras = combined.toString().split("\n")
        val relStart = max(0, startParagraph - firstPara)
        val relEnd = min(paras.size - 1, endParagraph - firstPara)
        val out = if (relStart <= relEnd) paras.subList(relStart, relEnd + 1).joinToString("\n") else ""
        return MtxParagraphRangeResult(out, matchingChunks.size, env.chunks.size)
    }

    fun compress(
        text: String,
        metadata: MtxMetadata = MtxMetadata(),
        options: MtxCompressionOptions = MtxCompressionOptions()
    ): MtxCompressionResult {
        val startNs = System.nanoTime()
        val profile = options.profile
        val useCache = options.useCache

        val rawUtf8 = text.toByteArray(StandardCharsets.UTF_8)
        val rawUtf8Bytes = rawUtf8.size
        val checksum = MtxCryptoAndChecksum.calculateAdler32(text)
        val crc32Checksum = MtxCryptoAndChecksum.calculateCrc32Bytes(rawUtf8)

        val langProfile = MtxCodec.detectTextLanguageProfile(text)
        val effectiveHint = when {
            options.languageHint != "auto" -> options.languageHint
            !metadata.languageCode.isNullOrBlank() -> metadata.languageCode
            else -> "auto"
        }
        val bank = MtxCodec.resolveBankForText(text, effectiveHint)
        val effectiveLangCode = metadata.languageCode
            ?: if (options.languageHint != "auto") options.languageHint else langProfile.dominantLanguage

        val wantsChunking = when (options.enableChunkIndex) {
            ChunkIndexMode.ENABLED -> true
            ChunkIndexMode.DISABLED -> false
            ChunkIndexMode.AUTO -> rawUtf8Bytes >= MtxConstants.MTX_V25_CHUNK_THRESHOLD_BYTES
        }

        val paragraphCount = if (text.isEmpty()) 0 else text.count { it == '\n' } + 1
        var chunkSpans = if (wantsChunking) {
            splitTextIntoParagraphChunks(text, options.targetChunkBytes)
        } else {
            emptyList()
        }
        if (chunkSpans.size < 2) {
            chunkSpans = listOf(TextChunkSpan(0, text.length, 0, paragraphCount))
        }

        val isChunked = chunkSpans.size > 1
        val trimmedWords = text.trim()
        val computedWordCount = metadata.wordCount ?: if (trimmedWords.isEmpty()) {
            0
        } else {
            trimmedWords.split(Regex("\\s+")).count { it.isNotEmpty() }
        }

        val fullMetadata = metadata.copy(
            wordCount = computedWordCount,
            tags = metadata.tags ?: listOf("رواية متعددة اللغات", "صيغة MTX v2.5"),
            genre = metadata.genre ?: "أدب روائي",
            translator = metadata.translator ?: "",
            notes = metadata.notes ?: "",
            codecVersion = "MTX $engineVersion Multilingual",
            formatVersion = outputFormatVersion,
            languageCode = effectiveLangCode,
            bankId = bank.bankId,
            paragraphCount = paragraphCount,
            chunkCount = chunkSpans.size
        )

        val plan = getOrComputeTokenizationPlan(text, bank, profile, chunkSpans, useCache)
        val finalIds = plan.finalTokenIds
        val finalLen = finalIds.size
        val dynamicMerged = plan.dynamicMerged

        val escapeByteBuffers = Array(plan.escapeLiterals.size) { idx ->
            plan.escapeLiterals[idx].toByteArray(StandardCharsets.UTF_8)
        }

        val metaBytes = serializeMetadataToUtf8(fullMetadata)
        if (metaBytes.size > MtxConstants.MAX_METADATA_BYTES) {
            throw MtxInvalidFormatError(
                "حجم بيانات الوصف (${metaBytes.size} بايت) يتجاوز الحد الأقصى المسموح (${MtxConstants.MAX_METADATA_BYTES} بايت)."
            )
        }

        val dynBuffers = Array(dynamicMerged.size) { idx ->
            dynamicMerged[idx].toByteArray(StandardCharsets.UTF_8)
        }
        var dynSectionLen = 1
        for (b in dynBuffers) dynSectionLen += 1 + b.size

        val deflateLevel = when (profile) {
            CompressionProfile.FAST -> 5
            CompressionProfile.MAXIMUM -> 9
            CompressionProfile.BALANCED -> 8
        }
        val salt = MtxInternalUtils.randomSalt()
        var escapeTokensCount = 0
        val containerBody: ByteArray
        val headerSegLen: Long

        if (!isChunked) {
            val (stream, escCnt) = encodeTokenRangeToStream(finalIds, 0 until finalLen, bank, escapeByteBuffers)
            escapeTokensCount = escCnt

            val payload = ByteArray(
                MtxConstants.MTX_V25_EXTENDED_HEADER_SIZE + 2 + metaBytes.size + dynSectionLen + 4 + stream.size
            )
            var off = 0
            System.arraycopy(MtxConstants.MTX_V25_PAYLOAD_MAGIC, 0, payload, off, 4)
            off += 4
            MtxInternalUtils.writeUInt16BE(payload, off, MtxConstants.MTX_V25_FORMAT_SPEC)
            off += 2
            payload[off++] = bank.bankId.toByte()
            payload[off++] = 0x00
            MtxInternalUtils.writeUInt32BE(payload, off, crc32Checksum)
            off += 4
            MtxInternalUtils.writeUInt32BE(payload, off, bank.vocabHash)
            off += 4
            MtxInternalUtils.writeUInt32BE(payload, off, finalLen.toLong())
            off += 4

            MtxInternalUtils.writeUInt16BE(payload, off, metaBytes.size)
            off += 2
            System.arraycopy(metaBytes, 0, payload, off, metaBytes.size)
            off += metaBytes.size

            payload[off++] = dynBuffers.size.toByte()
            for (b in dynBuffers) {
                payload[off++] = b.size.toByte()
                System.arraycopy(b, 0, payload, off, b.size)
                off += b.size
            }

            MtxInternalUtils.writeUInt32BE(payload, off, stream.size.toLong())
            off += 4
            System.arraycopy(stream, 0, payload, off, stream.size)

            val compressedPayload = MtxInternalUtils.deflateRaw(payload, deflateLevel)
            containerBody = MtxCryptoAndChecksum.applyMtxKeystream(compressedPayload, salt)
            headerSegLen = 0L
        } else {
            val numBlocks = chunkSpans.size
            val encryptedBlocks = arrayOfNulls<ByteArray>(numBlocks)
            val chunkUtf8Lengths = IntArray(numBlocks)
            val chunkUtf8Starts = IntArray(numBlocks)
            val chunkCrcs = LongArray(numBlocks)
            var totalBlocksByteLen = 0
            var runningUtf8Offset = 0

            for (b in 0 until numBlocks) {
                val span = chunkSpans[b]
                val range = plan.blockTokenRanges[b]
                val blockSlice = text.substring(span.charStart, span.charStart + span.charLength)
                val blockUtf8 = blockSlice.toByteArray(StandardCharsets.UTF_8)
                chunkUtf8Starts[b] = runningUtf8Offset
                chunkUtf8Lengths[b] = blockUtf8.size
                runningUtf8Offset += blockUtf8.size
                chunkCrcs[b] = MtxCryptoAndChecksum.calculateCrc32Bytes(blockUtf8)

                val (blockStream, escCnt) = encodeTokenRangeToStream(finalIds, range, bank, escapeByteBuffers)
                escapeTokensCount += escCnt

                val blockDeflated = MtxInternalUtils.deflateRaw(blockStream, deflateLevel)
                val blockSalt = ((salt.toInt() xor ((b + 1) * 0x9E3779B1.toInt())).toLong() and 0xFFFFFFFFL)
                val blockEncrypted = MtxCryptoAndChecksum.applyMtxKeystream(blockDeflated, blockSalt)
                encryptedBlocks[b] = blockEncrypted
                totalBlocksByteLen += blockEncrypted.size
            }

            val headerDirSize = MtxConstants.MTX_V25_EXTENDED_HEADER_SIZE +
                2 + 2 + metaBytes.size + dynSectionLen + numBlocks * MtxConstants.MTX_V25_CHUNK_ENTRY_SIZE
            val headerDir = ByteArray(headerDirSize)
            var off = 0

            System.arraycopy(MtxConstants.MTX_V25_PAYLOAD_MAGIC, 0, headerDir, off, 4)
            off += 4
            MtxInternalUtils.writeUInt16BE(headerDir, off, MtxConstants.MTX_V25_FORMAT_SPEC)
            off += 2
            headerDir[off++] = bank.bankId.toByte()
            headerDir[off++] = 0x01
            MtxInternalUtils.writeUInt32BE(headerDir, off, crc32Checksum)
            off += 4
            MtxInternalUtils.writeUInt32BE(headerDir, off, bank.vocabHash)
            off += 4
            MtxInternalUtils.writeUInt32BE(headerDir, off, finalLen.toLong())
            off += 4

            MtxInternalUtils.writeUInt16BE(headerDir, off, numBlocks)
            off += 2

            MtxInternalUtils.writeUInt16BE(headerDir, off, metaBytes.size)
            off += 2
            System.arraycopy(metaBytes, 0, headerDir, off, metaBytes.size)
            off += metaBytes.size

            headerDir[off++] = dynBuffers.size.toByte()
            for (b in dynBuffers) {
                headerDir[off++] = b.size.toByte()
                System.arraycopy(b, 0, headerDir, off, b.size)
                off += b.size
            }

            for (b in 0 until numBlocks) {
                val span = chunkSpans[b]
                MtxInternalUtils.writeUInt32BE(headerDir, off, span.charStart.toLong())
                MtxInternalUtils.writeUInt32BE(headerDir, off + 4, span.charLength.toLong())
                MtxInternalUtils.writeUInt32BE(headerDir, off + 8, chunkUtf8Starts[b].toLong())
                MtxInternalUtils.writeUInt32BE(headerDir, off + 12, chunkUtf8Lengths[b].toLong())
                MtxInternalUtils.writeUInt32BE(headerDir, off + 16, span.paragraphStart.toLong())
                MtxInternalUtils.writeUInt16BE(headerDir, off + 20, span.paragraphCount)
                MtxInternalUtils.writeUInt32BE(headerDir, off + 22, encryptedBlocks[b]!!.size.toLong())
                MtxInternalUtils.writeUInt32BE(headerDir, off + 26, chunkCrcs[b])
                off += MtxConstants.MTX_V25_CHUNK_ENTRY_SIZE
            }

            val deflatedDir = MtxInternalUtils.deflateRaw(headerDir, deflateLevel)
            val encryptedDir = MtxCryptoAndChecksum.applyMtxKeystream(deflatedDir, salt)
            headerSegLen = encryptedDir.size.toLong()

            containerBody = ByteArray(encryptedDir.size + totalBlocksByteLen)
            System.arraycopy(encryptedDir, 0, containerBody, 0, encryptedDir.size)
            var bodyOff = encryptedDir.size
            for (eb in encryptedBlocks) {
                val bytes = eb!!
                System.arraycopy(bytes, 0, containerBody, bodyOff, bytes.size)
                bodyOff += bytes.size
            }
        }

        val mtxBytes = ByteArray(MtxConstants.MTX_HEADER_SIZE + 4 + containerBody.size)
        System.arraycopy(MtxConstants.MTX_MAGIC_V2, 0, mtxBytes, 0, 4)
        mtxBytes[4] = outputFormatVersion.toByte()
        mtxBytes[5] = 0xFF.toByte()
        MtxInternalUtils.writeUInt32BE(mtxBytes, 6, salt)
        MtxInternalUtils.writeUInt32BE(mtxBytes, 10, checksum)
        MtxInternalUtils.writeUInt32BE(mtxBytes, 14, rawUtf8Bytes.toLong())
        MtxInternalUtils.writeUInt16BE(mtxBytes, 18, min(65_535, plan.dictionaryEntries.size))
        MtxInternalUtils.writeUInt32BE(
            mtxBytes,
            20,
            (headerSegLen xor (salt xor MtxConstants.MTX_V25_LEN_MASK)) and 0xFFFFFFFFL
        )
        System.arraycopy(containerBody, 0, mtxBytes, MtxConstants.MTX_HEADER_SIZE + 4, containerBody.size)

        val encodingDurationMs = MtxInternalUtils.round2((System.nanoTime() - startNs) / 1_000_000.0)

        // تحقق فوري من استرجاع النص دون فقد أي حرف
        val verifyStartNs = System.nanoTime()
        val decompressed = decompress(mtxBytes)
        val decodingDurationMs = MtxInternalUtils.round2((System.nanoTime() - verifyStartNs) / 1_000_000.0)

        val isLossless = decompressed.text == text && decompressed.isLossless
        val compressedBytes = mtxBytes.size
        val savingsPercent = if (rawUtf8Bytes == 0) {
            0.0
        } else {
            max(0.0, MtxInternalUtils.round1(((rawUtf8Bytes - compressedBytes).toDouble() / rawUtf8Bytes) * 100.0))
        }
        val compressionRatio = if (rawUtf8Bytes == 0) {
            0.0
        } else {
            MtxInternalUtils.round1(rawUtf8Bytes.toDouble() / max(1, compressedBytes))
        }

        return MtxCompressionResult(
            mtxBytes = mtxBytes,
            originalUtf8Bytes = rawUtf8Bytes,
            compressedBytes = compressedBytes,
            savingsPercent = savingsPercent,
            compressionRatio = compressionRatio,
            encodingDurationMs = encodingDurationMs,
            decodingDurationMs = decodingDurationMs,
            tokenizationDurationMs = plan.tokenizationDurationMs,
            indexingDurationMs = plan.indexingDurationMs,
            dictionary = plan.dictionaryEntries.toList(),
            tokenCount = finalLen,
            metadata = fullMetadata,
            checksum = checksum,
            crc32Checksum = crc32Checksum,
            isLossless = isLossless,
            profile = profile,
            version = outputFormatVersion,
            engineVersion = engineVersion,
            escapeTokensCount = escapeTokensCount,
            bankId = bank.bankId,
            languageCode = effectiveLangCode,
            chunkCount = chunkSpans.size
        )
    }

    fun compressChapterEdition(
        text: String,
        edition: MtxChapterEditionDescriptor,
        options: MtxCompressionOptions = MtxCompressionOptions()
    ): MtxCompressionResult {
        val meta = MtxMetadata(
            title = edition.title ?: "رواية جديدة",
            author = edition.author ?: "كاتب مجهول",
            chapterTitle = edition.chapterTitle ?: "الفصل الأول",
            chapterIndex = edition.chapterIndex ?: 1,
            chapterId = edition.chapterId,
            languageCode = edition.languageCode,
            translationGroupId = edition.translationGroupId ?: "chapter-${edition.chapterId}",
            editionLabel = edition.editionLabel ?: edition.languageCode.uppercase(Locale.ROOT)
        )
        val opts = if (options.languageHint == "auto") {
            options.copy(languageHint = edition.languageCode)
        } else {
            options
        }
        return compress(text, meta, opts)
    }

    fun decompress(mtxBytes: ByteArray): MtxDecompressionResult {
        val startNs = System.nanoTime()
        val detection = MtxCodec.detectMtxFormat(mtxBytes)
        val decoded = compatibilityLayer.decode(mtxBytes, detection)

        val actualChecksum = MtxCryptoAndChecksum.calculateAdler32(decoded.text)
        val actualCrc32 = MtxCryptoAndChecksum.calculateCrc32(decoded.text)
        val adler32Matched = actualChecksum == detection.header.expectedAdler32
        val crc32Verified = decoded.expectedCrc32?.let { actualCrc32 == it }
        val isLossless = adler32Matched && (crc32Verified == null || crc32Verified)

        val decodingDurationMs = MtxInternalUtils.round2((System.nanoTime() - startNs) / 1_000_000.0)
        val compressedBytes = mtxBytes.size
        val effectiveUtf8Bytes = if (decoded.originalUtf8Bytes > 0) {
            decoded.originalUtf8Bytes
        } else {
            MtxStaticVocabularies.getUtf8ByteLength(decoded.text)
        }

        val savingsPercent = if (effectiveUtf8Bytes == 0) {
            0.0
        } else {
            max(0.0, MtxInternalUtils.round1(((effectiveUtf8Bytes - compressedBytes).toDouble() / effectiveUtf8Bytes) * 100.0))
        }

        return MtxDecompressionResult(
            text = decoded.text,
            metadata = decoded.metadata,
            decodingDurationMs = decodingDurationMs,
            originalUtf8Bytes = effectiveUtf8Bytes,
            compressedBytes = compressedBytes,
            savingsPercent = savingsPercent,
            tokenCount = decoded.tokenCount,
            dictionarySize = decoded.dictionarySize,
            isLossless = isLossless,
            checksum = actualChecksum,
            crc32Checksum = actualCrc32,
            version = detection.formatVersion,
            engineVersion = engineVersion,
            formatLabel = decoded.formatLabel,
            decoderId = decoded.decoderId,
            bankId = decoded.bankId,
            chunkCount = decoded.chunkCount,
            integrityDetails = MtxIntegrityDetails(adler32Matched, crc32Verified)
        )
    }
}

/**
 * الواجهة الرئيسية الموحّدة للاستدعاء المباشر في مشاريع Android.
 */
object MtxCodec {
    val defaultCompatibilityLayer: MtxFormatCompatibilityLayer = createMtxCompatibilityLayer()
    val defaultMtxEngine: MtxEngine = MtxEngine(defaultCompatibilityLayer)

    fun compressToMtx(
        text: String,
        metadata: MtxMetadata = MtxMetadata(),
        options: MtxCompressionOptions = MtxCompressionOptions()
    ): MtxCompressionResult = defaultMtxEngine.compress(text, metadata, options)

    fun decompressFromMtx(mtxBytes: ByteArray): MtxDecompressionResult =
        defaultMtxEngine.decompress(mtxBytes)

    fun inspectMtxHeader(mtxBytes: ByteArray): MtxFormatDetectionResult =
        defaultMtxEngine.inspect(mtxBytes)

    fun inspectMtxChunkIndex(mtxBytes: ByteArray): MtxChunkIndexInspection =
        defaultMtxEngine.inspectChunkIndex(mtxBytes)

    fun decompressMtxBlock(mtxBytes: ByteArray, blockIndex: Int): String =
        defaultMtxEngine.decompressBlock(mtxBytes, blockIndex)

    fun decompressMtxParagraphRange(
        mtxBytes: ByteArray,
        startParagraph: Int,
        endParagraph: Int
    ): MtxParagraphRangeResult =
        defaultMtxEngine.decompressParagraphRange(mtxBytes, startParagraph, endParagraph)

    fun compressChapterEdition(
        text: String,
        edition: MtxChapterEditionDescriptor,
        options: MtxCompressionOptions = MtxCompressionOptions()
    ): MtxCompressionResult = defaultMtxEngine.compressChapterEdition(text, edition, options)

    fun buildLinkedChapterManifest(
        chapterId: String,
        editionResults: List<MtxCompressionResult>,
        translationGroupId: String? = null
    ): MtxLinkedChapterManifest {
        val editions = LinkedHashMap<String, MtxChapterEditionManifestEntry>(editionResults.size)
        for (res in editionResults) {
            val lang = res.languageCode.ifBlank { res.metadata.languageCode ?: "unknown" }
            editions[lang] = MtxChapterEditionManifestEntry(
                chapterId = chapterId,
                languageCode = lang,
                formatVersion = res.version,
                bankId = res.bankId,
                originalUtf8Bytes = res.originalUtf8Bytes,
                compressedBytes = res.compressedBytes,
                savingsPercent = res.savingsPercent,
                adler32Checksum = res.checksum,
                crc32Checksum = res.crc32Checksum,
                chunkCount = res.chunkCount,
                wordCount = res.metadata.wordCount ?: 0,
                isLossless = res.isLossless
            )
        }
        return MtxLinkedChapterManifest(
            chapterId = chapterId,
            translationGroupId = translationGroupId ?: "chapter-$chapterId",
            createdAt = MtxInternalUtils.nowIsoUtc(),
            editions = editions
        )
    }

    fun detectTextLanguageProfile(text: String): LanguageProfileResult {
        val len = text.length
        var arabicChars = 0
        var latinChars = 0
        var digitsAndPunct = 0
        var otherUnicodeChars = 0

        var i = 0
        while (i < len) {
            val code = text[i].code
            when {
                (code in 0x0600..0x06FF) || (code in 0x0750..0x077F) -> arabicChars++
                (code in 65..90) || (code in 97..122) -> latinChars++
                code < 0x80 -> digitsAndPunct++
                else -> {
                    otherUnicodeChars++
                    if (code in 0xD800..0xDBFF && i + 1 < len) {
                        val next = text[i + 1].code
                        if (next in 0xDC00..0xDFFF) i++
                    }
                }
            }
            i++
        }

        val totalLetters = max(1, arabicChars + latinChars)
        val arabicRatio = MtxInternalUtils.round3(arabicChars.toDouble() / totalLetters)
        val latinRatio = MtxInternalUtils.round3(latinChars.toDouble() / totalLetters)

        val dominantLanguage: String
        val recommendedBankId: Int
        val recommendedBankCode: String

        when {
            latinChars == 0 && arabicChars >= 0 -> {
                dominantLanguage = "ar"
                recommendedBankId = MtxVocabularyBanks.BANK_ARABIC_PRIMARY.bankId
                recommendedBankCode = "ar"
            }
            arabicChars == 0 && latinChars > 0 -> {
                dominantLanguage = "en"
                recommendedBankId = MtxVocabularyBanks.BANK_ENGLISH_PRIMARY.bankId
                recommendedBankCode = "en"
            }
            arabicChars >= latinChars * 4 -> {
                dominantLanguage = "ar"
                recommendedBankId = MtxVocabularyBanks.BANK_ARABIC_PRIMARY.bankId
                recommendedBankCode = "ar"
            }
            latinChars >= arabicChars * 4 -> {
                dominantLanguage = "en"
                recommendedBankId = MtxVocabularyBanks.BANK_ENGLISH_PRIMARY.bankId
                recommendedBankCode = "en"
            }
            else -> {
                dominantLanguage = "mixed"
                recommendedBankId = MtxVocabularyBanks.BANK_MIXED_BILINGUAL.bankId
                recommendedBankCode = "mixed"
            }
        }

        return LanguageProfileResult(
            dominantLanguage = dominantLanguage,
            recommendedBankId = recommendedBankId,
            recommendedBankCode = recommendedBankCode,
            arabicChars = arabicChars,
            latinChars = latinChars,
            digitsAndPunct = digitsAndPunct,
            otherUnicodeChars = otherUnicodeChars,
            arabicRatio = arabicRatio,
            latinRatio = latinRatio
        )
    }

    fun resolveBankForText(text: String, languageHint: String = "auto"): CompiledVocabularyBank {
        if (languageHint.isNotBlank() && languageHint != "auto") {
            MtxVocabularyBanks.defaultVocabularyRegistry.getByCode(languageHint)?.let { return it }
        }
        val profile = detectTextLanguageProfile(text)
        return MtxVocabularyBanks.defaultVocabularyRegistry.getById(profile.recommendedBankId)
            ?: MtxVocabularyBanks.BANK_ARABIC_PRIMARY
    }

    fun buildNormalizedSearchIndexKey(text: String): String {
        return text
            .replace(Regex("[\\u064B-\\u065F\\u0670\\u0640]"), "")
            .replace(Regex("[أإآٱ]"), "ا")
            .replace('ى', 'ي')
            .replace('ة', 'ه')
            .lowercase(Locale.ROOT)
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    fun tokenizeArabicText(
        text: String,
        profile: CompressionProfile = CompressionProfile.BALANCED,
        languageHint: String = "auto"
    ): MtxTokenizationResult {
        val bank = resolveBankForText(text, languageHint)
        val spans = listOf(TextChunkSpan(0, text.length, 0, 1))
        val plan = getOrComputeTokenizationPlan(text, bank, profile, spans, true)
        val ids = plan.finalTokenIds
        val tokens = List(ids.size) { i ->
            val id = ids[i]
            when {
                id < bank.primaryLen -> bank.primaryVocab[id]
                id < MtxConstants.EXT_BANK_TOKEN -> plan.dynamicMerged[id - bank.primaryLen]
                id < bank.extDynIdBase -> bank.extendedVocab[id - MtxConstants.EXT_STATIC_ID_BASE]
                id < MtxConstants.ESCAPE_ID_BASE ->
                    plan.dynamicMerged[bank.primaryDynCap + (id - bank.extDynIdBase)]
                else -> plan.escapeLiterals[id - MtxConstants.ESCAPE_ID_BASE]
            }
        }
        return MtxTokenizationResult(
            tokens = tokens,
            dictionaryEntries = plan.dictionaryEntries.toList(),
            dynamicMerged = plan.dynamicMerged.toList(),
            tokenizationDurationMs = plan.tokenizationDurationMs
        )
    }

    fun analyzeArabicText(text: String): ArabicTextAnalysis {
        val rawUtf8Bytes = MtxStaticVocabularies.getUtf8ByteLength(text)
        var tashkeelCount = 0
        var arabicLettersCount = 0
        var spaceCount = 0
        var punctuationCount = 0

        for (ch in text) {
            val code = ch.code
            when {
                (code in 0x064B..0x065F) || code == 0x0670 -> tashkeelCount++
                code in 0x0621..0x064A -> arabicLettersCount++
                ch.isWhitespace() -> spaceCount++
                ch in MtxStaticVocabularies.PUNCT_CHAR_SET -> punctuationCount++
            }
        }

        val trimmed = text.trim()
        val words = if (trimmed.isNotEmpty()) trimmed.split(Regex("\\s+")).filter { it.isNotEmpty() } else emptyList()
        val wordCount = words.size

        var detectedPrefixesCount = 0
        var detectedSuffixesCount = 0
        for (w in words) {
            if (MtxStaticVocabularies.ARABIC_V25_PREFIXES.any { w.startsWith(it) }) detectedPrefixesCount++
            if (MtxStaticVocabularies.MORPH_SUFFIXES.any { w.endsWith(it) }) detectedSuffixesCount++
        }

        val effectiveCharBase = max(1, arabicLettersCount + tashkeelCount)
        val tashkeelDensityPercent = MtxInternalUtils.round1((tashkeelCount.toDouble() / effectiveCharBase) * 100.0)
        val estimatedSavingsRatio = if (tashkeelDensityPercent > 20.0) 0.82 else 0.76
        val estimatedMtxBytes = if (rawUtf8Bytes == 0) 0 else max(32, round(rawUtf8Bytes * (1.0 - estimatedSavingsRatio)).toInt())
        val estimatedSavingsPercent = if (rawUtf8Bytes == 0) 0.0 else MtxInternalUtils.round1(estimatedSavingsRatio * 100.0)

        return ArabicTextAnalysis(
            totalChars = text.length,
            arabicLettersCount = arabicLettersCount,
            tashkeelCount = tashkeelCount,
            tashkeelDensityPercent = tashkeelDensityPercent,
            wordCount = wordCount,
            spaceCount = spaceCount,
            punctuationCount = punctuationCount,
            detectedPrefixesCount = detectedPrefixesCount,
            detectedSuffixesCount = detectedSuffixesCount,
            estimatedUtf8Bytes = rawUtf8Bytes,
            estimatedMtxBytes = estimatedMtxBytes,
            estimatedSavingsPercent = estimatedSavingsPercent
        )
    }

    fun analyzeMultilingualText(text: String): MultilingualTextAnalysis {
        val base = analyzeArabicText(text)
        val languageProfile = detectTextLanguageProfile(text)
        var englishLettersCount = 0
        for (ch in text) {
            if (ch in 'A'..'Z' || ch in 'a'..'z') englishLettersCount++
        }
        val contractionsCount = Regex("\\b[A-Za-z]+(?:'s|n't|'t|'re|'ve|'ll|'d|'m)\\b", RegexOption.IGNORE_CASE)
            .findAll(text).count()
        val paragraphCount = if (text.isEmpty()) 0 else text.count { it == '\n' } + 1
        var emojiAndExtendedCount = 0
        var i = 0
        while (i < text.length) {
            val cp = Character.codePointAt(text, i)
            if (cp in 0x1F000..0x1FAFF || cp in 0x2600..0x27BF || cp in 0xFDF0..0xFDFF) {
                emojiAndExtendedCount++
            }
            i += Character.charCount(cp)
        }
        return MultilingualTextAnalysis(
            base = base,
            languageProfile = languageProfile,
            englishLettersCount = englishLettersCount,
            contractionsCount = contractionsCount,
            paragraphCount = paragraphCount,
            emojiAndExtendedCount = emojiAndExtendedCount,
            normalizedSearchPreview = buildNormalizedSearchIndexKey(text.take(240))
        )
    }

    fun formatVersionToLabel(magic: MtxMagicType, version: Int): String {
        if (magic == MtxMagicType.MTX1) {
            return if (version == 1 || version == 10) "v1.0" else "v1.$version"
        }
        return if (version >= 10) "v${version / 10}.${version % 10}" else "v2.$version"
    }

    fun detectMtxFormat(mtxBytes: ByteArray): MtxFormatDetectionResult {
        if (mtxBytes.size < MtxConstants.MTX_HEADER_SIZE) {
            throw MtxCorruptDataError(
                "الملف تالف: الحجم (${mtxBytes.size} بايت) أصغر من ترويسة MTX المعتمدة (${MtxConstants.MTX_HEADER_SIZE} بايت)."
            )
        }
        val isV2 = mtxBytes[0] == 0x4D.toByte() && mtxBytes[1] == 0x54.toByte() &&
            mtxBytes[2] == 0x58.toByte() && mtxBytes[3] == 0x32.toByte()
        val isV1 = mtxBytes[0] == 0x4D.toByte() && mtxBytes[1] == 0x54.toByte() &&
            mtxBytes[2] == 0x58.toByte() && mtxBytes[3] == 0x31.toByte()
        if (!isV2 && !isV1) {
            throw MtxInvalidFormatError("صيغة غير صالحة: التوقيع السحري للملف لا يطابق MTX1 أو MTX2.")
        }

        val magic = if (isV2) MtxMagicType.MTX2 else MtxMagicType.MTX1
        val formatVersion = mtxBytes[4].toInt() and 0xFF
        val flags = mtxBytes[5].toInt() and 0xFF
        val salt = MtxInternalUtils.readUInt32BE(mtxBytes, 6)
        val expectedAdler32 = MtxInternalUtils.readUInt32BE(mtxBytes, 10)
        val originalUtf8Bytes = MtxInternalUtils.readUInt32BE(mtxBytes, 14).toInt()
        val dictionaryHintCount = MtxInternalUtils.readUInt16BE(mtxBytes, 18)

        val isSupported = (magic == MtxMagicType.MTX1 && (formatVersion == 1 || formatVersion == 10)) ||
            (magic == MtxMagicType.MTX2 && formatVersion in KNOWN_FORMAT_VERSIONS && formatVersion >= 20)

        return MtxFormatDetectionResult(
            magic = magic,
            formatVersion = formatVersion,
            versionLabel = formatVersionToLabel(magic, formatVersion),
            isLegacyFormat = magic == MtxMagicType.MTX1 || formatVersion < MtxFormatVersions.V2_2,
            isCurrentFormat = magic == MtxMagicType.MTX2 && formatVersion == MtxFormatVersions.V2_5,
            isSupported = isSupported,
            header = MtxParsedHeader(
                magic = magic,
                formatVersion = formatVersion,
                flags = flags,
                salt = salt,
                expectedAdler32 = expectedAdler32,
                originalUtf8Bytes = originalUtf8Bytes,
                dictionaryHintCount = dictionaryHintCount
            ),
            flagsDecoded = MtxFlagsDecoded(
                usesRadixTrie = (flags and 0x01) != 0,
                usesAffixes = (flags and 0x02) != 0,
                usesFusions = (flags and 0x04) != 0,
                usesBpe = (flags and 0x08) != 0,
                usesCipher = (flags and 0x10) != 0,
                usesEscapeProtocol = formatVersion >= MtxFormatVersions.V2_2,
                usesExtendedV23Integrity = (flags and 0x20) != 0 && formatVersion >= MtxFormatVersions.V2_3,
                usesExtendedV24Indexing = (flags and 0x40) != 0 && formatVersion >= MtxFormatVersions.V2_4,
                usesExtendedV25Multilingual = (flags and 0x80) != 0 && formatVersion >= MtxFormatVersions.V2_5
            )
        )
    }

    fun clearMtxCaches() {
        MtxTokenizationCache.clear()
        MtxCryptoAndChecksum.clearSecretCache()
    }

    fun getMtxCacheStats(): MtxCacheStats = MtxTokenizationCache.stats()

    fun calculateCrc32(str: String): Long = MtxCryptoAndChecksum.calculateCrc32(str)

    fun calculateCrc32Bytes(bytes: ByteArray): Long = MtxCryptoAndChecksum.calculateCrc32Bytes(bytes)

    fun calculateAdler32(str: String): Long = MtxCryptoAndChecksum.calculateAdler32(str)

    fun registerVocabularyBank(config: VocabularyBankConfig): CompiledVocabularyBank =
        MtxVocabularyBanks.defaultVocabularyRegistry.register(config)

    fun registerFormatDecoder(decoder: MtxFormatDecoder) {
        defaultMtxEngine.registerFormatDecoder(decoder)
    }
}
