using System;
using System.IO;
using System.Diagnostics;

namespace HyperClipLauncher {
    static class Program {
        [STAThread]
        static int Main(string[] args) {
            try {
                string currentExe = typeof(Program).Assembly.Location;
                string rootDir = Path.GetDirectoryName(currentExe);
                if (string.IsNullOrEmpty(rootDir)) rootDir = AppDomain.CurrentDomain.BaseDirectory;

                string appDir = Path.Combine(rootDir, "app");
                string appExe = Path.Combine(appDir, "HyperClip.exe");
                string dataDir = Path.Combine(rootDir, "HyperClip-Data");
                string startScript = Path.Combine(rootDir, "tools", "start_assigned_adspower.js");
                string watchScript = Path.Combine(rootDir, "watch-shutdown.ps1");
                string bundledNode = Path.Combine(appDir, "_internal", "resources", "node", "node.exe");

                if (!File.Exists(appExe)) {
                    System.Windows.Forms.MessageBox.Show(
                        "Không tìm thấy file thực thi chính:\n" + appExe,
                        "HyperClip - Lỗi Khởi Động",
                        System.Windows.Forms.MessageBoxButtons.OK,
                        System.Windows.Forms.MessageBoxIcon.Error
                    );
                    return 1;
                }

                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = appExe,
                    WorkingDirectory = appDir,
                    UseShellExecute = false
                };

                psi.EnvironmentVariables["HYPERCLIP_DATA_DIR"] = dataDir;
                psi.EnvironmentVariables["HYPERCLIPB_DATA_DIR"] = dataDir;
                psi.EnvironmentVariables["HYPERCLIP_EDITION"] = "long";

                if (args != null && args.Length > 0) {
                    psi.Arguments = string.Join(" ", args);
                }

                using (Process app = Process.Start(psi)) {
                    if (app == null) return 1;

                    if (File.Exists(watchScript)) {
                        ProcessStartInfo watchInfo = new ProcessStartInfo {
                            FileName = "powershell.exe",
                            Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + watchScript + "\"",
                            WorkingDirectory = rootDir,
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            WindowStyle = ProcessWindowStyle.Hidden
                        };
                        watchInfo.EnvironmentVariables["HYPERCLIP_DATA_DIR"] = dataDir;
                        watchInfo.EnvironmentVariables["HYPERCLIPB_DATA_DIR"] = dataDir;
                        try { Process.Start(watchInfo); } catch { }
                    }

                    Process adsPowerStartup = null;
                    if (File.Exists(startScript)) {
                        ProcessStartInfo startInfo = new ProcessStartInfo {
                            FileName = File.Exists(bundledNode) ? bundledNode : "node.exe",
                            Arguments = "\"" + startScript + "\"",
                            WorkingDirectory = rootDir,
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            WindowStyle = ProcessWindowStyle.Hidden
                        };
                        startInfo.EnvironmentVariables["HYPERCLIP_DATA_DIR"] = dataDir;
                        startInfo.EnvironmentVariables["HYPERCLIPB_DATA_DIR"] = dataDir;
                        startInfo.EnvironmentVariables["HYPERCLIP_EDITION"] = "long";
                        try { adsPowerStartup = Process.Start(startInfo); } catch { }
                    }

                    app.WaitForExit();

                    // Let the watcher close the session after the last HyperClip window exits.
                    if (adsPowerStartup != null) {
                        try { adsPowerStartup.WaitForExit(); } catch { }
                        adsPowerStartup.Dispose();
                    }
                }
                return 0;
            } catch (Exception ex) {
                System.Windows.Forms.MessageBox.Show(
                    "Lỗi khởi động HyperClip:\n" + ex.Message,
                    "HyperClip Error",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Error
                );
                return 1;
            }
        }
    }
}
