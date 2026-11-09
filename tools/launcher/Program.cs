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
                    System.Windows.Forms.MessageBox.Show(
                        "Không tìm thấy file thực thi chính:\n" + appExe,
                        "HyperClip - Lỗi Khởi Động",
                        System.Windows.Forms.MessageBoxButtons.OK,
                        System.Windows.Forms.MessageBoxIcon.Error
                    );
                    return 1;
                }

                // Set environment variables for current process tree
                Environment.SetEnvironmentVariable("HYPERCLIP_DATA_DIR", dataDir);
                Environment.SetEnvironmentVariable("HYPERCLIPB_DATA_DIR", dataDir);
                Environment.SetEnvironmentVariable("HYPERCLIP_EDITION", "long");

                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = appExe,
                    WorkingDirectory = appDir,
                    UseShellExecute = true
                };

                if (args != null && args.Length > 0) {
                    psi.Arguments = string.Join(" ", args);
                }

                Process.Start(psi);
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
