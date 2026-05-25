"use strict";
/**
 * IPC Handlers index — registers domain-specific handler groups.
 *
 * Each handler file exports a `register*` function.
 * main.ts imports this module and calls registerAllHandlers().
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAllHandlers = registerAllHandlers;
const unified_log_js_1 = require("../../services/unified_log.js");
const ipc_state_js_1 = require("../ipc-state.js");
const system_js_1 = require("./system.js");
const auth_js_1 = require("./auth.js");
const session_js_1 = require("./session.js");
const workspace_js_1 = require("./workspace.js");
const workspace_split_js_1 = require("./workspace-split.js");
const channel_js_1 = require("./channel.js");
const tracker_js_1 = require("./tracker.js");
const video_js_1 = require("./video.js");
const render_js_1 = require("./render.js");
const storage_js_1 = require("./storage.js");
const settings_js_1 = require("./settings.js");
const poller_js_1 = require("./poller.js");
const op_logs_js_1 = require("./op-logs.js");
const project_js_1 = require("./project.js");
const github_updater_js_1 = require("./github-updater.js");
function registerAllHandlers(ipcMain, _getMainWindow) {
    (0, unified_log_js_1.devLog)('[IPC] Registering handlers...');
    (0, system_js_1.registerSystemHandlers)(ipcMain);
    (0, auth_js_1.registerAuthHandlers)(ipcMain);
    (0, project_js_1.registerProjectHandlers)(ipcMain);
    (0, session_js_1.registerSessionHandlers)(ipcMain, _getMainWindow);
    (0, workspace_js_1.registerWorkspaceHandlers)(ipcMain);
    (0, workspace_split_js_1.registerWorkspaceSplitHandler)(ipcMain);
    (0, channel_js_1.registerChannelHandlers)(ipcMain);
    (0, tracker_js_1.registerTrackerHandlers)(ipcMain);
    (0, video_js_1.registerVideoHandlers)(ipcMain);
    (0, render_js_1.registerRenderHandlers)(ipcMain);
    (0, storage_js_1.registerStorageHandlers)(ipcMain, ipc_state_js_1.sendNotification);
    (0, settings_js_1.registerSettingsHandlers)(ipcMain);
    (0, poller_js_1.registerPollerHandlers)(ipcMain);
    (0, op_logs_js_1.registerOpLogHandlers)(ipcMain);
    (0, github_updater_js_1.registerGitHubUpdaterHandlers)(ipcMain);
    (0, unified_log_js_1.devLog)('[IPC] All handlers registered');
}
