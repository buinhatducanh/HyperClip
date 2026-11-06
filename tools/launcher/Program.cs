using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace HyperClipLauncher {
    static class Program {
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private const int SW_RESTORE = 9;

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

                int myPid = Process.GetCurrentProcess().Id;

                // 1. Check if an actual app\HyperClip.exe is already running
                Process[] procs = Process.GetProcessesByName("HyperClip");
                foreach (Process p in procs) {
                    try {
                        if (p.Id != myPid) {
                            string pPath = "";
                            try { pPath = p.MainModule.FileName; } catch {}
                            bool isApp = !string.IsNullOrEmpty(pPath) && pPath.IndexOf("app\\HyperClip.exe", StringComparison.OrdinalIgnoreCase) >= 0;
                            if (isApp) {
                                if (p.Responding) {
                                    if (p.MainWindowHandle != IntPtr.Zero) {
                                        ShowWindow(p.MainWindowHandle, SW_RESTORE);
                                        SetForegroundWindow(p.MainWindowHandle);
                                    }
                                    return 0;
                                } else {
                                    // Hung process
                                    p.Kill();
                                }
                            }
                        }
                    } catch {}
                }

                // 2. Clean up any leftover orphan hyperclip-tauri or node daemons
                CleanupBackendProcesses(rootDir);

                // 3. Launch actual app\HyperClip.exe with app as working directory
                Environment.SetEnvironmentVariable("HYPERCLIP_DATA_DIR", dataDir);
                Environment.SetEnvironmentVariable("HYPERCLIPB_DATA_DIR", dataDir);
                Environment.SetEnvironmentVariable("HYPERCLIP_EDITION", "long");

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = appExe;
                psi.WorkingDirectory = appDir;
                psi.EnvironmentVariables["HYPERCLIP_DATA_DIR"] = dataDir;
                psi.EnvironmentVariables["HYPERCLIPB_DATA_DIR"] = dataDir;
                psi.EnvironmentVariables["HYPERCLIP_EDITION"] = "long";
                psi.UseShellExecute = false;

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

                Process child = Process.Start(psi);
                if (child != null) {
                    // Wait for the app to exit, then cleanly terminate leftover backend processes
                    child.WaitForExit();
                    Thread.Sleep(1000);
                    CleanupBackendProcesses(rootDir);
                }
                return 0;
            } catch (Exception ex) {
                System.Windows.Forms.MessageBox.Show("Lỗi khởi động HyperClip:\n" + ex.Message, "HyperClip Error", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
                return 1;
            }
        }

        private static void CleanupBackendProcesses(string rootDir) {
            try {
                Process[] tauris = Process.GetProcessesByName("hyperclip-tauri");
                foreach (Process t in tauris) {
                    try {
                        string tPath = "";
                        try { tPath = t.MainModule.FileName; } catch {}
                        if (string.IsNullOrEmpty(tPath) || tPath.IndexOf(rootDir, StringComparison.OrdinalIgnoreCase) >= 0 || tPath.IndexOf("HyperClip", StringComparison.OrdinalIgnoreCase) >= 0) {
                            t.Kill();
                        }
                    } catch {}
                }
            } catch {}

            try {
                Process[] nodes = Process.GetProcessesByName("node");
                foreach (Process n in nodes) {
                    try {
                        string nPath = "";
                        try { nPath = n.MainModule.FileName; } catch {}
                        if (!string.IsNullOrEmpty(nPath) && (nPath.IndexOf(rootDir, StringComparison.OrdinalIgnoreCase) >= 0 || nPath.IndexOf("HyperClip", StringComparison.OrdinalIgnoreCase) >= 0)) {
                            n.Kill();
                        }
                    } catch {}
                }
            } catch {}
        }
    }
}
