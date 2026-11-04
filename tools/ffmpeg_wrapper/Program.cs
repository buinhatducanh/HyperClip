using System;
using System.IO;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace FfmpegWrapper {
    class Program {
        static void Log(string msg) {
            try {
                string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
                if (string.IsNullOrEmpty(dataDir)) {
                    dataDir = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data";
                }
                string logFile = Path.Combine(dataDir, @"logs\wrapper.log");
                File.AppendAllText(logFile, string.Format("[{0:yyyy-MM-dd HH:mm:ss}] [ffmpeg_wrapper] {1}\r\n", DateTime.Now, msg));
            } catch {}
        }

        static double GetMediaDuration(string filePath, string ffmpegPath) {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return 0;
            try {
                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = ffmpegPath,
                    Arguments = string.Format("-i \"{0}\"", filePath),
                    UseShellExecute = false,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi)) {
                    string err = p.StandardError.ReadToEnd();
                    p.WaitForExit(3000);
                    Match m = Regex.Match(err, @"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)");
                    if (m.Success) {
                        int hours = int.Parse(m.Groups[1].Value);
                        int mins = int.Parse(m.Groups[2].Value);
                        double secs = double.Parse(m.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture);
                        return hours * 3600.0 + mins * 60.0 + secs;
                    }
                }
            } catch {}
            return 0;
        }

        static int Main(string[] args) {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string realFfmpeg = Path.Combine(exeDir, "ffmpeg_real.exe");

            // Fallback if real ffmpeg not renamed yet
            if (!File.Exists(realFfmpeg)) {
                string origFfmpeg = Path.Combine(exeDir, "ffmpeg_orig.exe");
                if (File.Exists(origFfmpeg)) realFfmpeg = origFfmpeg;
            }

            // 1. Read settings to get part durations
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

            // 2. Identify target part from arguments
            int partNum = 0;
            string inputPath = null;
            string outputPath = null;

            for (int i = 0; i < args.Length; i++) {
                if (args[i] == "-i" && i + 1 < args.Length) {
                    if (string.IsNullOrEmpty(inputPath)) inputPath = args[i + 1];
                }
            }
            if (args.Length > 0 && !args[args.Length - 1].StartsWith("-")) {
                outputPath = args[args.Length - 1];
            }

            // CRITICAL: NEVER modify internal chunk renders, temp renders, or composite frames!
            string allArgs = string.Join(" ", args);
            bool isChunkOrTemp = allArgs.Contains("_chunk") || allArgs.Contains("_c0_") || allArgs.Contains("_c1_") ||
                                 allArgs.Contains(@"\temp\") || allArgs.Contains("/temp/") || allArgs.Contains("_composite");

            // Detect partNum only for final renders or trim operations
            if (!isChunkOrTemp) {
                string combined = (inputPath ?? "") + " " + (outputPath ?? "");
                Match mPart = Regex.Match(combined, @"(?:_part|PART\s*)(\d+)", RegexOptions.IgnoreCase);
                if (mPart.Success) {
                    int.TryParse(mPart.Groups[1].Value, out partNum);
                }
            }

            int durSec = 0;
            if (partNum == 1) durSec = p1Sec;
            else if (partNum == 2) durSec = p2Sec;
            else if (partNum == 3) durSec = p3Sec;

            // If input file exists, use its actual duration as authoritative
            if (!string.IsNullOrEmpty(inputPath) && File.Exists(inputPath)) {
                double actDur = GetMediaDuration(inputPath, realFfmpeg);
                if (actDur > 0) {
                    durSec = (int)Math.Round(actDur);
                }
            }

            // 3. Transform arguments if autoSplitEnabled and valid partNum
            string[] modifiedArgs = (string[])args.Clone();

            if (!isChunkOrTemp && autoSplitEnabled && partNum > 0 && durSec > 0) {
                bool isTrim = false;
                bool isRender = false;

                for (int i = 0; i < modifiedArgs.Length; i++) {
                    if (modifiedArgs[i] == "-filter_complex") isRender = true;
                    if (modifiedArgs[i] == "-c" && i + 1 < modifiedArgs.Length && modifiedArgs[i + 1] == "copy") isTrim = true;
                }

                if (isTrim) {
                    // Type A: maybe_trim_file call (-y -i ... -t 60 -c copy ...)
                    for (int i = 0; i < modifiedArgs.Length; i++) {
                        if (modifiedArgs[i] == "-t" && i + 1 < modifiedArgs.Length) {
                            Log(string.Format("Adjusting maybe_trim_file for Part {0}: -t {1} -> -t {2}", partNum, modifiedArgs[i + 1], durSec));
                            modifiedArgs[i + 1] = durSec.ToString();
                            break;
                        }
                    }
                } else if (isRender) {
                    // Type B: Full render call (with -filter_complex and -t)
                    for (int i = 0; i < modifiedArgs.Length; i++) {
                        if (modifiedArgs[i] == "-filter_complex" && i + 1 < modifiedArgs.Length) {
                            string fc = modifiedArgs[i + 1];
                            string newFc = Regex.Replace(fc, @"trim=start=0:duration=([0-9\.]+)", "trim=start=0:duration=" + durSec);
                            newFc = Regex.Replace(newFc, @"atrim=start=0:duration=([0-9\.]+)", "atrim=start=0:duration=" + durSec);
                            if (newFc != fc) {
                                Log(string.Format("Adjusting filter_complex for Part {0}: duration -> {1}", partNum, durSec));
                                modifiedArgs[i + 1] = newFc;
                            }
                        } else if (modifiedArgs[i] == "-t" && i + 1 < modifiedArgs.Length) {
                            Log(string.Format("Adjusting render -t for Part {0}: {1} -> {2}.00", partNum, modifiedArgs[i + 1], durSec));
                            modifiedArgs[i + 1] = durSec.ToString() + ".00";
                        }
                    }
                }
            }

            // 4. Run real FFmpeg
            if (!File.Exists(realFfmpeg)) {
                Console.Error.WriteLine("[ffmpeg_wrapper] ffmpeg_real.exe not found: " + realFfmpeg);
                return 1;
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = realFfmpeg;
            string fullArgs = "";
            foreach (string a in modifiedArgs) {
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
