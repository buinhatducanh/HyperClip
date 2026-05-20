/**
 * Encrypted YAML Store — HyperClip
 *
 * Encrypts sensitive data files (project configs, OAuth credentials) using
 * AES-256-GCM keyed to the machine's hardware ID.
 *
 * Format (config.enc.yaml):
 *   type: hyperclip-encrypted
 *   version: 1
 *   machineId: <first 8 + last 4 of hwId for diagnostics>
 *   encryptedAt: <ISO timestamp>
 *   iv: "<hex>"
 *   salt: "<hex>"
 *   tag: "<hex>"
 *   data: |
 *     <base64 encrypted JSON>
 *
 * This ensures:
 * - Copying the data folder to another machine → unreadable (wrong hwId key)
 * - Copying to same machine → readable (same hwId key)
 * - Tampering → GCM authentication fails
 */
import fs from 'fs';
import path from 'path';
import { getMachineId } from './hwid.js';
import { encrypt, decrypt, parseYAMLBlob } from './crypto.js';
import { log } from './unified_log.js';
/** Write an encrypted YAML file. */
export function writeEncryptedFile(filePath, data) {
    const machineId = getMachineId();
    const machineIdShort = `${machineId.slice(0, 8)}...${machineId.slice(-4)}`;
    const plaintext = JSON.stringify(data, null, 0);
    const blob = encrypt(plaintext, machineId);
    const header = {
        type: 'hyperclip-encrypted',
        version: 1,
        machineIdShort,
        encryptedAt: new Date().toISOString(),
    };
    const yamlLines = [
        `type: "${header.type}"`,
        `version: ${header.version}`,
        `machineId: "${header.machineIdShort}"`,
        `encryptedAt: "${header.encryptedAt}"`,
        `iv: "${blob.iv}"`,
        `salt: "${blob.salt}"`,
        `tag: "${blob.tag}"`,
        `data: |`,
        ...blob.data.match(/.{1,76}/g).map((line) => `  ${line}`),
    ];
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, yamlLines.join('\n'), 'utf8');
}
/** Read and decrypt an encrypted YAML file. */
export function readEncryptedFile(filePath) {
    if (!fs.existsSync(filePath))
        return null;
    try {
        const yaml = fs.readFileSync(filePath, 'utf8');
        const blob = parseYAMLBlob(yaml);
        const plaintext = decrypt(blob, getMachineId());
        return JSON.parse(plaintext);
    }
    catch (err) {
        log.warn(`[EncryptedStore] Failed to read ${filePath}: ${err}`);
        return null;
    }
}
/** Check if a file is encrypted YAML. */
export function isEncryptedYaml(filePath) {
    if (!fs.existsSync(filePath))
        return false;
    try {
        const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
        return firstLine.includes('hyperclip-encrypted');
    }
    catch {
        return false;
    }
}
/** Migrate a plain JSON file to encrypted YAML.
 *  Only migrates if the .enc.yaml doesn't already exist.
 */
export function migrateToEncrypted(jsonPath, encYamlPath) {
    if (fs.existsSync(encYamlPath))
        return false; // already migrated
    if (!fs.existsSync(jsonPath))
        return false; // source doesn't exist
    try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        writeEncryptedFile(encYamlPath, data);
        log.info(`[EncryptedStore] Migrated ${jsonPath} → ${encYamlPath}`);
        return true;
    }
    catch (err) {
        log.warn(`[EncryptedStore] Migration failed: ${err}`);
        return false;
    }
}
/** Delete both encrypted and legacy files. */
export function deleteSecureFile(encYamlPath, jsonPath) {
    if (fs.existsSync(encYamlPath))
        fs.unlinkSync(encYamlPath);
    if (jsonPath && fs.existsSync(jsonPath))
        fs.unlinkSync(jsonPath);
}
