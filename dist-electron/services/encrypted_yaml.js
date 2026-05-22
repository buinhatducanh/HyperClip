"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeEncryptedFile = writeEncryptedFile;
exports.readEncryptedFile = readEncryptedFile;
exports.isEncryptedYaml = isEncryptedYaml;
exports.migrateToEncrypted = migrateToEncrypted;
exports.deleteSecureFile = deleteSecureFile;
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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hwid_js_1 = require("./hwid.js");
const crypto_js_1 = require("./crypto.js");
const unified_log_js_1 = require("./unified_log.js");
/** Write an encrypted YAML file. */
function writeEncryptedFile(filePath, data) {
    const machineId = (0, hwid_js_1.getMachineId)();
    const machineIdShort = `${machineId.slice(0, 8)}...${machineId.slice(-4)}`;
    const plaintext = JSON.stringify(data, null, 0);
    const blob = (0, crypto_js_1.encrypt)(plaintext, machineId);
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
    fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
    fs_1.default.writeFileSync(filePath, yamlLines.join('\n'), 'utf8');
}
/** Read and decrypt an encrypted YAML file. */
function readEncryptedFile(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const yaml = fs_1.default.readFileSync(filePath, 'utf8');
        const blob = (0, crypto_js_1.parseYAMLBlob)(yaml);
        const plaintext = (0, crypto_js_1.decrypt)(blob, (0, hwid_js_1.getMachineId)());
        return JSON.parse(plaintext);
    }
    catch (err) {
        unified_log_js_1.log.warn(`[EncryptedStore] Failed to read ${filePath}: ${err}`);
        return null;
    }
}
/** Check if a file is encrypted YAML. */
function isEncryptedYaml(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return false;
    try {
        const firstLine = fs_1.default.readFileSync(filePath, 'utf8').split('\n')[0];
        return firstLine.includes('hyperclip-encrypted');
    }
    catch {
        return false;
    }
}
/** Migrate a plain JSON file to encrypted YAML.
 *  Only migrates if the .enc.yaml doesn't already exist.
 */
function migrateToEncrypted(jsonPath, encYamlPath) {
    if (fs_1.default.existsSync(encYamlPath))
        return false; // already migrated
    if (!fs_1.default.existsSync(jsonPath))
        return false; // source doesn't exist
    try {
        const data = JSON.parse(fs_1.default.readFileSync(jsonPath, 'utf8'));
        writeEncryptedFile(encYamlPath, data);
        unified_log_js_1.log.info(`[EncryptedStore] Migrated ${jsonPath} → ${encYamlPath}`);
        return true;
    }
    catch (err) {
        unified_log_js_1.log.warn(`[EncryptedStore] Migration failed: ${err}`);
        return false;
    }
}
/** Delete both encrypted and legacy files. */
function deleteSecureFile(encYamlPath, jsonPath) {
    if (fs_1.default.existsSync(encYamlPath))
        fs_1.default.unlinkSync(encYamlPath);
    if (jsonPath && fs_1.default.existsSync(jsonPath))
        fs_1.default.unlinkSync(jsonPath);
}
