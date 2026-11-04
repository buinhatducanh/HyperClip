using System;
using System.IO;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace YtDlpWrapper {
    class Program {
        static void Log(string msg) {
            try {
                string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
                if (string.IsNullOrEmpty(dataDir)) {
                    dataDir = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data";
                }
                string logFile = Path.Combine(dataDir, @"logs\wrapper.log");
                File.AppendAllText(logFile, string.Format("[{0:yyyy-MM-dd HH:mm:ss}] [ytdlp_wrapper] {1}\r\n", DateTime.Now, msg));
            } catch {}
        }

        static int Main(string[] args) {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string realYtDlp = Path.Combine(exeDir, "yt-dlp_real.exe");

            // 1. Locate ffmpeg.exe (or ffmpeg_real.exe)
            string ffmpegPath = Path.GetFullPath(Path.Combine(exeDir, @"..\ffmpeg\bin\ffmpeg.exe"));
            if (!File.Exists(ffmpegPath)) {
                ffmpegPath = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\app\_internal\resources\ffmpeg\bin\ffmpeg.exe";
            }
            string ffmpegReal = Path.Combine(Path.GetDirectoryName(ffmpegPath), "ffmpeg_real.exe");
            if (File.Exists(ffmpegReal)) ffmpegPath = ffmpegReal;

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
            double p1 = 1.0;
            double p2 = 4.5;
            double p3 = 4.5;
            bool autoSplitEnabled = true;

            try {
                string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
                if (string.IsNullOrEmpty(dataDir)) {
                    dataDir = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data";
                }
                string setPath = Path.Combine(dataDir, @".hyperclip\settings.json");
                if (File.Exists(setPath)) {
                    string json = File.ReadAllText(setPath);
                    if (json.Contains("\"autoSplitEnabled\": false") || json.Contains("\"autoSplitEnabled\":false")) {
                        autoSplitEnabled = false;
                    }

                    Match mTrim = Regex.Match(json, @"""defaultTrimLimit""\s*:\s*([0-9\.]+)");
                    if (mTrim.Success) {
                        double.TryParse(mTrim.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out trimLimit);
                    }

                    int parts = 3;
                    Match mParts = Regex.Match(json, @"""autoSplitParts""\s*:\s*([0-9]+)");
                    if (mParts.Success) {
                        int.TryParse(mParts.Groups[1].Value, out parts);
                    }

                    Match mP1 = Regex.Match(json, @"""autoSplitCustomP1""\s*:\s*([0-9\.]+)");
                    bool hasCustomP1 = mP1.Success;
                    if (!mP1.Success) mP1 = Regex.Match(json, @"""autoSplitPart1Minutes""\s*:\s*([0-9\.]+)");
                    if (!mP1.Success) mP1 = Regex.Match(json, @"""autoSplitMinutes""\s*:\s*([0-9\.]+)");
                    if (mP1.Success) {
                        double.TryParse(mP1.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out p1);
                    }

                    if (parts == 2) {
                        p1 = Math.Round((trimLimit / 2.0) * 10.0) / 10.0;
                        p2 = Math.Max(0, Math.Round((trimLimit - p1) * 10.0) / 10.0);
                        p3 = 0;
                    } else if (parts == 3 && !hasCustomP1) {
                        p1 = Math.Round((trimLimit / 3.0) * 10.0) / 10.0;
                        p2 = Math.Round((trimLimit / 3.0) * 10.0) / 10.0;
                        p3 = Math.Max(0, Math.Round((trimLimit - p1 - p2) * 10.0) / 10.0);
                    } else {
                        double rem = Math.Max(0, trimLimit - p1);
                        p2 = Math.Round((rem / 2.0) * 10.0) / 10.0;
                        p3 = Math.Max(0, Math.Round((rem - p2) * 10.0) / 10.0);
                        Match mRem = Regex.Match(json, @"""autoSplitRemainMinutes""\s*:\s*([0-9\.]+)");
                        if (mRem.Success) {
                            double remMin = 0;
                            if (double.TryParse(mRem.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out remMin) && remMin > 0) {
                                p2 = remMin;
                                p3 = Math.Max(0, Math.Round((trimLimit - p1 - p2) * 10.0) / 10.0);
                            }
                        }
                    }
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

                    string masterPath = Path.Combine(dir, baseName + "_master.mp4");

                    // A) If master video exists, SLICE LOCALLY (50ms, zero network)
                    if (File.Exists(masterPath) && File.Exists(ffmpegPath)) {
                        ProcessStartInfo psiFmt = new ProcessStartInfo();
                        psiFmt.FileName = ffmpegPath;
                        psiFmt.Arguments = string.Format("-y -ss {0} -i \"{1}\" -t {2} -c copy \"{3}\"", startSec, masterPath, durSec, outputPath);
                        psiFmt.UseShellExecute = false;
                        psiFmt.CreateNoWindow = true;
                        Process pFmt = Process.Start(psiFmt);
                        pFmt.WaitForExit();

                        if (File.Exists(outputPath) && new FileInfo(outputPath).Length > 1000) {
                            Log(string.Format("Local slice successful for part {0} [{1}s..{2}s] ({3}s) -> {4}", partNum, startSec, startSec + durSec, durSec, outputPath));
                            Console.WriteLine("[smart-split] Local slice successful for part " + partNum + " [" + startSec + "s.." + (startSec + durSec) + "s] (" + durSec + "s)");
                            Console.WriteLine("[download] Destination: " + outputPath);
                            Console.WriteLine(string.Format("[download] 100% of {0:F2}MiB in 00:00:00 at 100.00MiB/s", new FileInfo(outputPath).Length / (1024.0 * 1024.0)));
                            Console.WriteLine("[download] 100%");
                            return 0;
                        }
                    }

                    // B) Fallback: Master not on disk yet, rewrite --download-sections for the exact part timeline
                    TimeSpan tsStart = TimeSpan.FromSeconds(startSec);
                    TimeSpan tsEnd = TimeSpan.FromSeconds(startSec + durSec);
                    string targetSection = string.Format("*{0:D2}:{1:D2}:{2:D2}-{3:D2}:{4:D2}:{5:D2}",
                        (int)tsStart.TotalHours, tsStart.Minutes, tsStart.Seconds,
                        (int)tsEnd.TotalHours, tsEnd.Minutes, tsEnd.Seconds);

                    bool sectionReplaced = false;
                    for (int i = 0; i < args.Length; i++) {
                        if (args[i] == "--download-sections" && i + 1 < args.Length) {
                            Log(string.Format("Rewriting download section for part {0} from '{1}' to '{2}'", partNum, args[i + 1], targetSection));
                            args[i + 1] = targetSection;
                            sectionReplaced = true;
                            break;
                        }
                    }

                    if (!sectionReplaced) {
                        Log(string.Format("Injecting download section for part {0}: '{1}'", partNum, targetSection));
                        string[] newArgs = new string[args.Length + 2];
                        Array.Copy(args, newArgs, args.Length);
                        newArgs[args.Length] = "--download-sections";
                        newArgs[args.Length + 1] = targetSection;
                        args = newArgs;
                    }
                }
            }

            // 5. Run real yt-dlp
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
