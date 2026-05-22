"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devLog = exports.silent = void 0;
/** Default: silent. Set DEV_LOG=1 to enable dev console.log output */
exports.silent = process.env.DEV_LOG !== '1';
const devLog = (...a) => { if (!exports.silent)
    console.log(...a); };
exports.devLog = devLog;
