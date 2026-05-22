"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveKey = deriveKey;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.blobToYAMLString = blobToYAMLString;
exports.parseYAMLBlob = parseYAMLBlob;
exports.computeHMAC = computeHMAC;
exports.verifyHMAC = verifyHMAC;
exports.generateRSAKeyPair = generateRSAKeyPair;
exports.rsaSign = rsaSign;
exports.rsaVerify = rsaVerify;
exports.sha256 = sha256;
/**
 * Crypto primitives for HyperClip licensing and data encryption.
 * - AES-256-GCM for encrypting YAML config files
 * - PBKDF2 for deriving a key from machineId
 * - RSA-2048 for signing update manifests
 * - HMAC-SHA256 for tamper detection
 */
const crypto_1 = __importDefault(require("crypto"));
// ─── Constants ─────────────────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (GCM recommended)
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
// ─── Machine-id based key derivation ───────────────────────────────────────────
/** Derive a 256-bit AES key from machineId + a fixed app salt. */
function deriveKey(machineId, salt) {
    const usedSalt = salt ?? crypto_1.default.randomBytes(SALT_LENGTH);
    const key = crypto_1.default.pbkdf2Sync(machineId, usedSalt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    return { key, salt: usedSalt };
}
/** Encrypt plaintext with AES-256-GCM. Returns a serializable object. */
function encrypt(plaintext, machineId) {
    const { key, salt } = deriveKey(machineId);
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
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
function decrypt(blob, machineId) {
    const key = crypto_1.default.pbkdf2Sync(machineId, Buffer.from(blob.salt, 'hex'), PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    const iv = Buffer.from(blob.iv, 'hex');
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(blob.data, 'base64')),
        decipher.final(),
    ]);
    return decrypted.toString('utf8');
}
// ─── YAML-serializable helpers ─────────────────────────────────────────────────
/** Serialize EncryptedBlob to a YAML-compatible string (no special chars). */
function blobToYAMLString(blob) {
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
function parseYAMLBlob(raw) {
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
function computeHMAC(data, key) {
    return crypto_1.default.createHmac('sha256', key).update(data).digest('hex');
}
function verifyHMAC(data, expected, key) {
    const actual = computeHMAC(data, key);
    return crypto_1.default.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
// ─── RSA key pair for update signing ───────────────────────────────────────────
/** Generate a new RSA-2048 key pair. Store privateKey PEM securely (e.g. server-side). */
function generateRSAKeyPair() {
    const { publicKey, privateKey } = crypto_1.default.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
}
/** Sign data with RSA private key (PKCS#1 v1.5 padding). */
function rsaSign(data, privateKeyPem) {
    const sign = crypto_1.default.createSign('RSA-SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKeyPem, 'hex');
}
/** Verify RSA signature. */
function rsaVerify(data, signature, publicKeyPem) {
    try {
        const verify = crypto_1.default.createVerify('RSA-SHA256');
        verify.update(data);
        verify.end();
        return verify.verify(publicKeyPem, signature, 'hex');
    }
    catch {
        return false;
    }
}
/** Compute SHA-256 hash of a string. */
function sha256(str) {
    return crypto_1.default.createHash('sha256').update(str).digest('hex');
}
