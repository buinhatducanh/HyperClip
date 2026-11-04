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
                string watchScript = Path.Combine(rootDir, "watch-shutdown.ps1");

                // 1. Launch watch-shutdown.ps1 in background if exists
                if (File.Exists(watchScript)) {
                    try {
                        ProcessStartInfo psiWatch = new ProcessStartInfo();
                        psiWatch.FileName = "powershell.exe";
                        psiWatch.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + watchScript + "\"";
                        psiWatch.CreateNoWindow = true;
                        psiWatch.UseShellExecute = false;
                        Process.Start(psiWatch);
                    } catch {}
                }

                if (!File.Exists(appExe)) {
                    System.Windows.Forms.MessageBox.Show("Không tìm thấy file thực thi chính:\n" + appExe, "HyperClip - Lỗi Khởi Động", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
                    return 1;
                }

                // 2. Launch actual app\HyperClip.exe with app as working directory
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
                // Return immediately so launcher does not linger in task manager
                return 0;
            } catch (Exception ex) {
                System.Windows.Forms.MessageBox.Show("Lỗi khởi động HyperClip:\n" + ex.Message, "HyperClip Error", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
