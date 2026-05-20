/**
 * Crypto primitives for HyperClip licensing and data encryption.
 * - AES-256-GCM for encrypting YAML config files
 * - PBKDF2 for deriving a key from machineId
 * - RSA-2048 for signing update manifests
 * - HMAC-SHA256 for tamper detection
 */
import crypto from 'crypto';
// ─── Constants ─────────────────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (GCM recommended)
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
// ─── Machine-id based key derivation ───────────────────────────────────────────
/** Derive a 256-bit AES key from machineId + a fixed app salt. */
export function deriveKey(machineId, salt) {
    const usedSalt = salt ?? crypto.randomBytes(SALT_LENGTH);
    const key = crypto.pbkdf2Sync(machineId, usedSalt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    return { key, salt: usedSalt };
}
/** Encrypt plaintext with AES-256-GCM. Returns a serializable object. */
export function encrypt(plaintext, machineId) {
    const { key, salt } = deriveKey(machineId);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
        version: 1,
        iv: iv.toString('hex'),
        data: encrypted.toString('base64'),
        salt: salt.toString('hex'),
        tag: tag.toString('hex'),
    };
}
/** Decrypt an AES-256-GCM blob. Throws on wrong machineId or tampered data. */
export function decrypt(blob, machineId) {
    const key = crypto.pbkdf2Sync(machineId, Buffer.from(blob.salt, 'hex'), PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    const iv = Buffer.from(blob.iv, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(blob.data, 'base64')),
        decipher.final(),
    ]);
    return decrypted.toString('utf8');
}
// ─── YAML-serializable helpers ─────────────────────────────────────────────────
/** Serialize EncryptedBlob to a YAML-compatible string (no special chars). */
export function blobToYAMLString(blob) {
    return [
        `version: ${blob.version}`,
        `iv: "${blob.iv}"`,
        `salt: "${blob.salt}"`,
        `tag: "${blob.tag}"`,
        `data: |`,
        ...blob.data.match(/.{1,76}/g).map((line) => `  ${line}`),
    ].join('\n');
}
/** Parse a YAML-like string back into an EncryptedBlob. */
export function parseYAMLBlob(raw) {
    const lines = raw.split('\n');
    const get = (key) => {
        const line = lines.find(l => l.startsWith(`${key}:`));
        if (!line)
            throw new Error(`Missing key: ${key}`);
        return line.replace(`${key}:`, '').replace(/^["\s]+|["\s]+$/g, '').trim();
    };
    const dataLines = lines.filter((l, i) => i > lines.findIndex(l => l.startsWith('data:')) && !l.startsWith('version:') && !l.startsWith('iv:') && !l.startsWith('salt:') && !l.startsWith('tag:'));
    return {
        version: parseInt(get('version')),
        iv: get('iv'),
        salt: get('salt'),
        tag: get('tag'),
        data: dataLines.join(''),
    };
}
// ─── HMAC for tamper detection (on top of GCM) ─────────────────────────────────
export function computeHMAC(data, key) {
    return crypto.createHmac('sha256', key).update(data).digest('hex');
}
export function verifyHMAC(data, expected, key) {
    const actual = computeHMAC(data, key);
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
// ─── RSA key pair for update signing ───────────────────────────────────────────
/** Generate a new RSA-2048 key pair. Store privateKey PEM securely (e.g. server-side). */
export function generateRSAKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
}
/** Sign data with RSA private key (PKCS#1 v1.5 padding). */
export function rsaSign(data, privateKeyPem) {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKeyPem, 'hex');
}
/** Verify RSA signature. */
export function rsaVerify(data, signature, publicKeyPem) {
    try {
        const verify = crypto.createVerify('RSA-SHA256');
        verify.update(data);
        verify.end();
        return verify.verify(publicKeyPem, signature, 'hex');
    }
    catch {
        return false;
    }
}
/** Compute SHA-256 hash of a string. */
export function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}
