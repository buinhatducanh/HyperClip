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

                if (!File.Exists(appExe)) {
                    System.Windows.Forms.MessageBox.Show("Không tìm thấy file thực thi chính:\n" + appExe, "HyperClip - Lỗi Khởi Động", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
                    return 1;
                }

                // If no app\HyperClip.exe is running, kill any stale leftover backend
                bool isAppRunning = false;
                int myPid = Process.GetCurrentProcess().Id;
                foreach (Process p in Process.GetProcessesByName("HyperClip")) {
                    try {
                        if (p.Id != myPid) {
                            string fn = "";
                            try { fn = p.MainModule.FileName; } catch {}
                            if (!string.IsNullOrEmpty(fn) && fn.IndexOf("app\\HyperClip.exe", StringComparison.OrdinalIgnoreCase) >= 0) {
                                isAppRunning = true;
                                break;
                            }
                        }
                    } catch {}
                }

                if (!isAppRunning) {
                    try {
                        foreach (Process t in Process.GetProcessesByName("hyperclip-tauri")) {
                            try { t.Kill(); } catch {}
                        }
                        foreach (Process n in Process.GetProcessesByName("node")) {
                            try {
                                string fn = "";
                                try { fn = n.MainModule.FileName; } catch {}
                                if (!string.IsNullOrEmpty(fn) && fn.IndexOf("HyperClip", StringComparison.OrdinalIgnoreCase) >= 0) {
                                    n.Kill();
                                }
                            } catch {}
                        }
                    } catch {}
                }

                // Set environment variables for process and user persistent scope
                try {
                    Environment.SetEnvironmentVariable("HYPERCLIP_DATA_DIR", dataDir, EnvironmentVariableTarget.User);
                    Environment.SetEnvironmentVariable("HYPERCLIPB_DATA_DIR", dataDir, EnvironmentVariableTarget.User);
                    Environment.SetEnvironmentVariable("HYPERCLIP_EDITION", "long", EnvironmentVariableTarget.User);
                } catch {}

                Environment.SetEnvironmentVariable("HYPERCLIP_DATA_DIR", dataDir);
                Environment.SetEnvironmentVariable("HYPERCLIPB_DATA_DIR", dataDir);
                Environment.SetEnvironmentVariable("HYPERCLIP_EDITION", "long");

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = appExe;
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.EnvironmentVariables["HYPERCLIP_DATA_DIR"] = dataDir;
                psi.EnvironmentVariables["HYPERCLIPB_DATA_DIR"] = dataDir;
                psi.EnvironmentVariables["HYPERCLIP_EDITION"] = "long";

                if (args != null && args.Length > 0) {
                    string fullArgs = "";
                    foreach (string a in args) {
                        if (fullArgs.Length > 0) fullArgs += " ";
                        if (string.IsNullOrEmpty(a)) fullArgs += "\"\"";
                        else if (!a.Contains(" ") && !a.Contains("\"")) fullArgs += a;
                        else fullArgs += "\"" + a.Replace("\"", "\\\"") + "\"";
                    }
                    psi.Arguments = fullArgs;
                }

                Process.Start(psi);
                return 0;
            } catch (Exception ex) {
                System.Windows.Forms.MessageBox.Show("Lỗi khởi động HyperClip:\n" + ex.Message, "HyperClip Error", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
