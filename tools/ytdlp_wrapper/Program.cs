using System;
using System.IO;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace YtDlpWrapper {
    class Program {
        static int Main(string[] args) {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string realYtDlp = Path.Combine(exeDir, "yt-dlp_real.exe");

            // 1. Locate ffmpeg.exe
            string ffmpegPath = Path.GetFullPath(Path.Combine(exeDir, @"..\ffmpeg\bin\ffmpeg.exe"));
            if (!File.Exists(ffmpegPath)) {
                ffmpegPath = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\app\_internal\resources\ffmpeg\bin\ffmpeg.exe";
            }

            // 2. Parse -o output argument
            string outputPath = null;
            for (int i = 0; i < args.Length; i++) {
                if (args[i] == "-o" && i + 1 < args.Length) {
                    outputPath = args[i + 1];
                    break;
                } else if (args[i].StartsWith("-o=")) {
                    outputPath = args[i].Substring(3).Trim('"');
                    break;
                }
            }

            // 3. Check if target is a part video (_part2.mp4, _part3.mp4, etc.)
            if (!string.IsNullOrEmpty(outputPath)) {
                string fileName = Path.GetFileName(outputPath);
                Match m = Regex.Match(fileName, @"^(.*)_part(\d+)\.mp4$", RegexOptions.IgnoreCase);
                if (m.Success) {
                    string baseName = m.Groups[1].Value;
                    int partNum = int.Parse(m.Groups[2].Value);
                    string dir = Path.GetDirectoryName(outputPath);
                    if (string.IsNullOrEmpty(dir)) dir = ".";
                    string masterPath = Path.Combine(dir, baseName + "_master.mp4");

                    if (File.Exists(masterPath) && File.Exists(ffmpegPath)) {
                        // Read settings
                        double trimLimit = 10.0;
                        double p1 = 4.0;
                        double p2 = 3.0;
                        double p3 = 3.0;

                        try {
                            string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
                            if (string.IsNullOrEmpty(dataDir)) {
                                dataDir = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data";
                            }
                            string setPath = Path.Combine(dataDir, @".hyperclip\settings.json");
                            if (File.Exists(setPath)) {
                                string json = File.ReadAllText(setPath);
                                Match mTrim = Regex.Match(json, @"""defaultTrimLimit""\s*:\s*([0-9\.]+)");
                                if (mTrim.Success) {
                                    double.TryParse(mTrim.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out trimLimit);
                                }

                                Match mP1 = Regex.Match(json, @"""autoSplitCustomP1""\s*:\s*([0-9\.]+)");
                                if (!mP1.Success) mP1 = Regex.Match(json, @"""autoSplitPart1Minutes""\s*:\s*([0-9\.]+)");
                                if (!mP1.Success) mP1 = Regex.Match(json, @"""autoSplitMinutes""\s*:\s*([0-9\.]+)");
                                if (mP1.Success) {
                                    double.TryParse(mP1.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out p1);
                                }

                                double rem = Math.Max(0, trimLimit - p1);
                                p2 = Math.Round((rem / 2.0) * 10.0) / 10.0;
                                p3 = Math.Max(0, Math.Round((rem - p2) * 10.0) / 10.0);
                            }
                        } catch {}

                        int p1Sec = (int)Math.Round(p1 * 60);
                        int p2Sec = (int)Math.Round(p2 * 60);
                        int p3Sec = (int)Math.Round(p3 * 60);

                        int startSec = 0;
                        int durSec = 60;
                        if (partNum == 2) {
                            startSec = p1Sec;
                            durSec = p2Sec;
                        } else if (partNum == 3) {
                            startSec = p1Sec + p2Sec;
                            durSec = p3Sec;
                        } else {
                            startSec = p1Sec + p2Sec + (partNum - 3) * p3Sec;
                            durSec = p3Sec;
                        }

                        // Local slice via FFmpeg stream copy (<0.1s, zero network overhead)
                        ProcessStartInfo psiFmt = new ProcessStartInfo();
                        psiFmt.FileName = ffmpegPath;
                        psiFmt.Arguments = string.Format("-y -ss {0} -i \"{1}\" -t {2} -c copy \"{3}\"", startSec, masterPath, durSec, outputPath);
                        psiFmt.UseShellExecute = false;
                        psiFmt.CreateNoWindow = true;
                        Process pFmt = Process.Start(psiFmt);
                        pFmt.WaitForExit();

                        if (File.Exists(outputPath) && new FileInfo(outputPath).Length > 1000) {
                            Console.WriteLine("[smart-split] Local slice successful for part " + partNum + " [" + startSec + "s.." + (startSec + durSec) + "s] (" + durSec + "s)");
                            Console.WriteLine("[download] Destination: " + outputPath);
                            Console.WriteLine(string.Format("[download] 100% of {0:F2}MiB in 00:00:00 at 100.00MiB/s", new FileInfo(outputPath).Length / (1024.0 * 1024.0)));
                            Console.WriteLine("[download] 100%");
                            return 0;
                        }
                    }
                }
            }

            // Fallback: run real yt-dlp
            if (!File.Exists(realYtDlp)) {
                Console.Error.WriteLine("[wrapper] yt-dlp_real.exe not found: " + realYtDlp);
                return 1;
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = realYtDlp;
            string fullArgs = "";
            foreach (string a in args) {
                if (fullArgs.Length > 0) fullArgs += " ";
                if (string.IsNullOrEmpty(a)) fullArgs += "\"\"";
                else if (!a.Contains(" ") && !a.Contains("\"")) fullArgs += a;
                else fullArgs += "\"" + a.Replace("\"", "\\\"") + "\"";
            }
            psi.Arguments = fullArgs;
            psi.UseShellExecute = false;
            Process p = Process.Start(psi);
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}
