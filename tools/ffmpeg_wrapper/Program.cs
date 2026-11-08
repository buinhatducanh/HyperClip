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

            // 1. Read settings to get part durations and quality
            double trimLimit = 10.0;
            double p1 = 3.0;
            double p2 = 3.5;
            double p3 = 3.5;
            bool autoSplitEnabled = true;
            int p1Sec = 180;
            int p2Sec = 210;
            int p3Sec = 210;
            string renderRes = "1080p";

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

                    Match mRes = Regex.Match(json, @"""autoRenderResolution""\s*:\s*""([^""]+)""");
                    if (mRes.Success) {
                        renderRes = mRes.Groups[1].Value.ToLowerInvariant();
                    }

                    Match mTrim = Regex.Match(json, @"""defaultTrimLimit""\s*:\s*([0-9\.]+)");
                    if (mTrim.Success) {
                        double.TryParse(mTrim.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out trimLimit);
                    }

                    Match mMode = Regex.Match(json, @"""autoSplitMode""\s*:\s*""([^""]+)""");
                    string splitMode = mMode.Success ? mMode.Groups[1].Value : "parts";

                    int parts = 3;
                    Match mParts = Regex.Match(json, @"""autoSplitParts""\s*:\s*([0-9]+)");
                    if (mParts.Success) {
                        int.TryParse(mParts.Groups[1].Value, out parts);
                    }

                    Match mSub = Regex.Match(json, @"""autoSplitSubMode""\s*:\s*""([^""]+)""");
                    string subMode = mSub.Success ? mSub.Groups[1].Value : "";

                    Match mMin = Regex.Match(json, @"""autoSplitMinutes""\s*:\s*([0-9\.]+)");
                    if (mMin.Success) {
                        double minVal = 0;
                        if (double.TryParse(mMin.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out minVal) && minVal > 0) {
                            p1 = minVal;
                        }
                    }

                    Match mP1 = Regex.Match(json, @"""autoSplitCustomP1""\s*:\s*([0-9\.]+)");
                    if (mP1.Success) {
                        double cp1 = 0;
                        if (double.TryParse(mP1.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out cp1) && cp1 > 0) {
                            p1 = cp1;
                        }
                    }

                    int totalTrimSec = (int)Math.Max(60, Math.Round(trimLimit * 60.0));
                    if (splitMode == "minutes" || subMode == "custom_p1") {
                        p1Sec = (int)Math.Min(totalTrimSec - 60, Math.Max(60, Math.Round(p1 * 60.0)));
                        int remSec = Math.Max(0, totalTrimSec - p1Sec);
                        p2Sec = remSec / 2;
                        p3Sec = remSec - p2Sec;
                    } else if (parts == 2 || subMode == "parts_2") {
                        p1Sec = totalTrimSec / 2;
                        p2Sec = totalTrimSec - p1Sec;
                        p3Sec = 0;
                    } else {
                        p1Sec = totalTrimSec / 3;
                        p2Sec = totalTrimSec / 3;
                        p3Sec = totalTrimSec - p1Sec - p2Sec;
                    }
                }
            } catch { }

            // 2. Identify target part from arguments
            int partNum = 0;
            string inputPath = null;
            string outputPath = null;

            for (int i = 0; i < args.Length; i++) {
                if (args[i] == "-i" && i + 1 < args.Length) {
                    string cand = args[i + 1];
                    string ext = Path.GetExtension(cand).ToLowerInvariant();
                    if (ext == ".mp4" || ext == ".mkv" || ext == ".webm" || ext == ".mov" || ext == ".ts" || cand.Contains("_part")) {
                        inputPath = cand;
                        break;
                    }
                    if (string.IsNullOrEmpty(inputPath)) inputPath = cand;
                }
            }
            if (args.Length > 0 && !args[args.Length - 1].StartsWith("-")) {
                outputPath = args[args.Length - 1];
            }

            // CRITICAL: NEVER modify internal chunk renders, temp renders, or composite frames!
            string allArgs = string.Join(" ", args);
            bool isChunk = allArgs.Contains("_chunk") || allArgs.Contains("_c0_") || allArgs.Contains("_c1_");
            bool isOutputTemp = !string.IsNullOrEmpty(outputPath) && (outputPath.Contains(@"\temp\") || outputPath.Contains("/temp/"));
            bool isOutputImage = !string.IsNullOrEmpty(outputPath) && (outputPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase) || outputPath.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || outputPath.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase));
            bool isChunkOrTemp = isChunk || isOutputTemp || isOutputImage;

            // Chunk Render Safeguard: Cap chunk duration if it exceeds actual input video duration
            if (isChunk && autoSplitEnabled && !string.IsNullOrEmpty(inputPath) && File.Exists(inputPath)) {
                double inputDur = GetMediaDuration(inputPath, realFfmpeg);
                if (inputDur > 0) {
                    double seekSec = 0;
                    for (int i = 0; i < args.Length; i++) {
                        if (args[i] == "-ss" && i + 1 < args.Length) {
                            double.TryParse(args[i + 1], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out seekSec);
                            break;
                        }
                    }
                    double reqDur = 0;
                    int tIdx = -1;
                    for (int i = 0; i < args.Length; i++) {
                        if (args[i] == "-t" && i + 1 < args.Length) {
                            double.TryParse(args[i + 1], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out reqDur);
                            tIdx = i + 1;
                            break;
                        }
                    }
                    if (tIdx != -1 && reqDur > 0 && (seekSec + reqDur) > (inputDur + 0.5)) {
                        double maxDur = Math.Max(0.5, inputDur - seekSec);
                        Log(string.Format("Chunk duration exceeds input duration: seek={0} req={1} inputDur={2} -> Capping -t to {3:F2}",
                            seekSec, reqDur, inputDur, maxDur));
                        string[] chunkArgs = (string[])args.Clone();
                        chunkArgs[tIdx] = maxDur.ToString("F2", System.Globalization.CultureInfo.InvariantCulture);
                        for (int i = 0; i < chunkArgs.Length; i++) {
                            if (chunkArgs[i] == "-filter_complex" && i + 1 < chunkArgs.Length) {
                                string fc = chunkArgs[i + 1];
                                string newFc = Regex.Replace(fc, @"duration=([0-9\.]+)", "duration=" + maxDur.ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
                                chunkArgs[i + 1] = newFc;
                            }
                        }
                        args = chunkArgs;
                    }
                }
            }

            // Detect partNum only for final renders or trim operations
            if (!isChunkOrTemp) {
                string combined = (inputPath ?? "") + " " + (outputPath ?? "");
                Match mPart = Regex.Match(combined, @"(?:[_-]part|PART\s*)(\d+)", RegexOptions.IgnoreCase);
                if (mPart.Success) {
                    int.TryParse(mPart.Groups[1].Value, out partNum);
                } else {
                    // Try looking in allArgs (e.g. temp workspace background ws-...-part2_composite_bg.png)
                    mPart = Regex.Match(allArgs, @"(?:[_-]part|PART\s*)(\d+)", RegexOptions.IgnoreCase);
                    if (mPart.Success) {
                        int.TryParse(mPart.Groups[1].Value, out partNum);
                    } else if (autoSplitEnabled && outputPath != null && outputPath.EndsWith(".trim.tmp", StringComparison.OrdinalIgnoreCase)) {
                        // Rust's maybe_trim_file trimming master video into Part 1 source
                        partNum = 1;
                    }
                }
            }

            int durSec = 0;
            if (partNum == 1) {
                durSec = p1Sec;
            } else if (partNum == 2) {
                durSec = p2Sec;
            } else if (partNum >= 3) {
                durSec = p3Sec;
            }

            double actDur = 0;
            if (!string.IsNullOrEmpty(inputPath) && File.Exists(inputPath)) {
                actDur = GetMediaDuration(inputPath, realFfmpeg);
            }

            int targetT = durSec;
            if (partNum == 1) {
                // Part 1: Tuân thủ tuyệt đối p1Sec (3 phút). Nếu video nguồn ngắn hơn thì lấy hết video nguồn.
                targetT = (actDur > 0.5 && actDur < p1Sec) ? (int)Math.Floor(actDur) : p1Sec;
            } else if (partNum >= 2) {
                // Part 2 & Part 3: Video nguồn là file slice đã chia đều. Lấy trọn vẹn 100% actDur của file slice!
                if (actDur > 0.5) {
                    targetT = (int)Math.Round(actDur);
                } else {
                    targetT = durSec;
                }
            }

            // 3. Transform arguments if autoSplitEnabled and valid partNum
            string[] modifiedArgs = (string[])args.Clone();

            if (!isChunkOrTemp && autoSplitEnabled && partNum > 0 && targetT > 0) {
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
                            Log(string.Format("Adjusting maybe_trim_file for Part {0}: -t {1} -> -t {2}", partNum, modifiedArgs[i + 1], targetT));
                            modifiedArgs[i + 1] = targetT.ToString();
                            break;
                        }
                    }
                } else if (isRender) {
                    // Type B: Full render call (with -filter_complex and -t)
                    for (int i = 0; i < modifiedArgs.Length; i++) {
                        if (modifiedArgs[i] == "-filter_complex" && i + 1 < modifiedArgs.Length) {
                            string fc = modifiedArgs[i + 1];
                            string newFc = Regex.Replace(fc, @"trim=(?:start=[0-9\.]+:)?duration=([0-9\.]+)", "trim=start=0:duration=" + targetT);
                            newFc = Regex.Replace(newFc, @"atrim=(?:start=[0-9\.]+:)?duration=([0-9\.]+)", "atrim=start=0:duration=" + targetT);
                            // Ensure 1080p resolution if user configured 1080p
                            if (renderRes == "1080p" && newFc.Contains("scale=720:720")) {
                                newFc = newFc.Replace("scale=720:720", "scale=1080:1080");
                                Log("Upgrading render resolution to 1080p (scale=1080:1080)");
                            } else if (renderRes == "720p" && newFc.Contains("scale=1080:1080")) {
                                newFc = newFc.Replace("scale=1080:1080", "scale=720:720");
                                Log("Setting render resolution to 720p (scale=720:720)");
                            }
                            if (newFc != fc) {
                                Log(string.Format("Adjusting filter_complex for Part {0}: duration -> {1}", partNum, targetT));
                                modifiedArgs[i + 1] = newFc;
                            }
                        } else if (modifiedArgs[i] == "-t" && i + 1 < modifiedArgs.Length) {
                            Log(string.Format("Adjusting render -t for Part {0}: {1} -> {2}.00", partNum, modifiedArgs[i + 1], targetT));
                            modifiedArgs[i + 1] = targetT.ToString() + ".00";
                        }
                    }

                    // Tối ưu hóa bitrate theo chuẩn AdsPow cho 720p render siêu tốc
                    if (renderRes == "720p") {
                        for (int m = 0; m < modifiedArgs.Length; m++) {
                            if (modifiedArgs[m] == "-maxrate" && m + 1 < modifiedArgs.Length) {
                                modifiedArgs[m + 1] = "3M";
                            }
                            if (modifiedArgs[m] == "-bufsize" && m + 1 < modifiedArgs.Length) {
                                modifiedArgs[m + 1] = "4M";
                            }
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
