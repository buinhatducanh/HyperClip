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

            // 3. Read settings
            double trimLimit = 10.0;
            double p1 = 4.0;
            double p2 = 3.0;
            double p3 = 3.0;
            bool autoSplitEnabled = false;

            try {
                string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
                if (string.IsNullOrEmpty(dataDir)) {
                    dataDir = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data";
                }
                string setPath = Path.Combine(dataDir, @".hyperclip\settings.json");
                if (File.Exists(setPath)) {
                    string json = File.ReadAllText(setPath);
                    if (json.Contains("\"autoSplitEnabled\": true") || json.Contains("\"autoSplitEnabled\":true")) {
                        autoSplitEnabled = true;
                    }

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

            // 4. Intercept slicing from master video or rewrite sections
            if (!string.IsNullOrEmpty(outputPath) && autoSplitEnabled) {
                string fileName = Path.GetFileName(outputPath);
                string dir = Path.GetDirectoryName(outputPath);
                if (string.IsNullOrEmpty(dir)) dir = ".";

                int partNum = 0;
                string baseName = null;

                Match mPart = Regex.Match(fileName, @"^(.*)_part(\d+)\.mp4$", RegexOptions.IgnoreCase);
                if (mPart.Success) {
                    baseName = mPart.Groups[1].Value;
                    partNum = int.Parse(mPart.Groups[2].Value);
                } else if (fileName.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) && !fileName.Contains("_master")) {
                    baseName = fileName.Substring(0, fileName.Length - 4);
                    partNum = 1;
                }

                if (partNum > 0 && !string.IsNullOrEmpty(baseName)) {
                    string masterPath = Path.Combine(dir, baseName + "_master.mp4");

                    // A) If master video exists, SLICE LOCALLY (50ms, zero network)
                    if (File.Exists(masterPath) && File.Exists(ffmpegPath)) {
                        int startSec = 0;
                        int durSec = p1Sec;

                        if (partNum == 1) {
                            startSec = 0;
                            durSec = p1Sec;
                        } else if (partNum == 2) {
                            startSec = p1Sec;
                            durSec = p2Sec;
                        } else if (partNum == 3) {
                            startSec = p1Sec + p2Sec;
                            durSec = p3Sec;
                        } else {
                            startSec = p1Sec + p2Sec + (partNum - 3) * p3Sec;
                            durSec = p3Sec;
                        }

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
                    } else if (partNum == 1) {
                        // B) Fallback: Master not on disk yet, but yt-dlp was invoked for Part 1.
                        // Clamp --download-sections to exact p1 duration!
                        for (int i = 0; i < args.Length; i++) {
                            if (args[i] == "--download-sections" && i + 1 < args.Length) {
                                TimeSpan ts = TimeSpan.FromSeconds(p1Sec);
                                string p1Time = string.Format("{0:D2}:{1:D2}:{2:D2}", (int)ts.TotalHours, ts.Minutes, ts.Seconds);
                                args[i + 1] = "*00:00:00-" + p1Time;
                                break;
                            }
                        }
                    }
                }
            }

            // 5. Fallback: run real yt-dlp
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
