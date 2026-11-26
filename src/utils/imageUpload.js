import { supabase } from '../config/database.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB max decoded size

const ALLOWED_MIME_TO_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

const badUpload = (message) => Object.assign(new Error(message), { statusCode: 400 });

/**
 * Validates HTTP(S) URLs (and optionally app-relative `/...` asset paths),
 * blocking `javascript:`, `data:`, `vbscript:`, or protocol-relative `//` URLs.
 */
export const sanitizeAssetUrl = (raw, { allowRelative = false } = {}) => {
    const value = String(raw || '').trim();
    if (!value) return '';

    if (allowRelative && value.startsWith('/') && !value.startsWith('//')) {
        return value;
    }

    try {
        const parsed = new URL(value);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
    } catch (_) {
        // Invalid URL handled below
    }
    throw badUpload('Invalid URL. Only HTTP or HTTPS URLs are allowed.');
};

const matchesImageMagicBytes = (buf, ext) => {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
    if (ext === 'png') {
        return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    }
    if (ext === 'jpg') {
        return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    }
    if (ext === 'gif') {
        const sig = buf.subarray(0, 6).toString('ascii');
        return sig === 'GIF87a' || sig === 'GIF89a';
    }
    if (ext === 'webp') {
        return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return false;
};

const inferRasterExtFromMagic = (buf) => {
    for (const ext of ['png', 'jpg', 'webp', 'gif']) {
        if (matchesImageMagicBytes(buf, ext)) return ext;
    }
    return null;
};

/**
 * Validates and uploads a base64 raster image to Supabase Storage (or validates an external URL).
 * Rejects SVG (`image/svg+xml`) and non-image payloads to prevent stored XSS on storage origins.
 */
export async function processUploadImage(
    rawInput,
    {
        bucket = 'menu-item-images',
        fallbackBucket = null,
        objectPathBuilder,
        allowRelative = false,
        appendCacheBust = false,
        throwOnUploadError = false
    } = {}
) {
    if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) return '';
    const cleanStr = rawInput.trim();

    if (/^https?:\/\//i.test(cleanStr) || (allowRelative && cleanStr.startsWith('/'))) {
        return sanitizeAssetUrl(cleanStr, { allowRelative });
    }

    let mimeType = null;
    let ext = null;
    let base64Data = cleanStr;

    if (cleanStr.startsWith('data:')) {
        const match = cleanStr.match(/^data:([a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+)(?:;[^;,]+)*;base64,(.+)$/s);
        if (!match) {
            throw badUpload('Invalid image data format.');
        }
        mimeType = match[1].toLowerCase();
        base64Data = match[2].replace(/\s+/g, '');
        ext = ALLOWED_MIME_TO_EXT[mimeType];
        if (!ext) {
            throw badUpload('Unsupported image format. Only PNG, JPG, WebP, and GIF images are allowed.');
        }
    } else if (cleanStr.length < 300) {
        // Short non-data strings are invalid URLs rather than raw base64 payloads
        return sanitizeAssetUrl(cleanStr, { allowRelative });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        throw badUpload('Image file must be non-empty and under 5 MB.');
    }

    if (ext) {
        if (!matchesImageMagicBytes(buffer, ext)) {
            throw badUpload('Uploaded image content does not match its declared format.');
        }
    } else {
        ext = inferRasterExtFromMagic(buffer);
        if (!ext) {
            throw badUpload('Unsupported or invalid image payload. Only PNG, JPG, WebP, and GIF are allowed.');
        }
        mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    }

    if (!supabase) {
        throw new Error('Supabase Storage is not configured on the server.');
    }

    const fileName = objectPathBuilder ? objectPathBuilder(ext) : `uploads/${Date.now()}.${ext}`;
    const canonicalContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, buffer, { contentType: canonicalContentType, upsert: true });

    if (uploadError) {
        if (fallbackBucket && fallbackBucket !== bucket) {
            const { error: fallbackErr } = await supabase.storage
                .from(fallbackBucket)
                .upload(fileName, buffer, { contentType: canonicalContentType, upsert: true });
            if (!fallbackErr) {
                const { data: fallbackUrlData } = supabase.storage.from(fallbackBucket).getPublicUrl(fileName);
                const url = fallbackUrlData?.publicUrl || '';
                return appendCacheBust && url ? `${url}?t=${Date.now()}` : url;
            }
        }
        if (throwOnUploadError) {
            throw new Error(`Failed to upload image to storage: ${uploadError.message}`);
        }
        console.warn(`⚠️ Supabase image upload warning for bucket '${bucket}':`, uploadError.message);
        return `data:${canonicalContentType};base64,${buffer.toString('base64')}`;
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
    const publicUrl = urlData?.publicUrl || '';
    return appendCacheBust && publicUrl ? `${publicUrl}?t=${Date.now()}` : publicUrl;
}
