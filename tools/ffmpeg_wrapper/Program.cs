using System;
using System.IO;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace FfmpegWrapper {
    class Program {
        static void Log(string msg) {
            try {
                string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
                if (string.IsNullOrEmpty(dataDir)) {
                    dataDir = @"C:\Users\Administrator\Desktop\HyperClip\HyperClip-Data";
                }
                string logFile = Path.Combine(dataDir, @"logs\wrapper.log");
                string dir = Path.GetDirectoryName(logFile);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
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

            // 1. Read settings to get part durations, resolution, and background mode
            double trimLimit = 10.0;
            double p1 = 3.0;
            bool autoSplitEnabled = true;
            int p1Sec = 180;
            int p2Sec = 210;
            int p3Sec = 210;
            string renderRes = "720p"; // Chuẩn TikTok/Shorts mặc định
            string bgMode = "thumbnail"; // "thumbnail" (Quy tắc 1) hoặc "custom" (Quy tắc 2)
            string customBgPath = null;

            try {
                string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
                if (string.IsNullOrEmpty(dataDir)) {
                    dataDir = @"C:\Users\Administrator\Desktop\HyperClip\HyperClip-Data";
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

                    Match mBg = Regex.Match(json, @"""canvasBackgroundMode""\s*:\s*""([^""]+)""");
                    if (mBg.Success) {
                        bgMode = mBg.Groups[1].Value.ToLowerInvariant();
                    }

                    Match mBgPath = Regex.Match(json, @"""customBgPath""\s*:\s*""([^""]+)""");
                    if (mBgPath.Success) {
                        string customPath = mBgPath.Groups[1].Value.Replace("\\\\", "\\");
                        if (File.Exists(customPath)) customBgPath = customPath;
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
                    if (splitMode == "minutes" || subMode == "custom_p1" || (p1 > 0 && splitMode != "parts")) {
                        p1Sec = (int)Math.Min(totalTrimSec, Math.Max(1, Math.Round(p1 * 60.0)));
                        int remSec = Math.Max(0, totalTrimSec - p1Sec);
                        if (remSec < 30) {
                            p1Sec = totalTrimSec;
                            p2Sec = 0;
                            p3Sec = 0;
                            parts = 1;
                        } else if (remSec < 60 || parts == 2) {
                            p2Sec = remSec;
                            p3Sec = 0;
                            parts = 2;
                        } else {
                            p2Sec = (int)Math.Ceiling(remSec / 2.0);
                            p3Sec = remSec - p2Sec;
                            parts = 3;
                        }
                    } else if (parts == 2 || subMode == "parts_2") {
                        p1Sec = (int)Math.Ceiling(totalTrimSec / 2.0);
                        p2Sec = totalTrimSec - p1Sec;
                        p3Sec = 0;
                    } else {
                        p1Sec = (int)Math.Ceiling(totalTrimSec / 3.0);
                        p2Sec = (int)Math.Ceiling((totalTrimSec - p1Sec) / 2.0);
                        p3Sec = totalTrimSec - p1Sec - p2Sec;
                    }
                }
            } catch { }

            if (customBgPath == null) {
                if (File.Exists("bg.jpg")) customBgPath = Path.GetFullPath("bg.jpg");
                else if (File.Exists("app\\bg.jpg")) customBgPath = Path.GetFullPath("app\\bg.jpg");
                else if (File.Exists(Path.Combine(exeDir, @"..\..\..\bg.jpg"))) {
                    customBgPath = Path.GetFullPath(Path.Combine(exeDir, @"..\..\..\bg.jpg"));
                }
            }

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

            string allArgs = string.Join(" ", args);
            bool isCompositeBgGen = !string.IsNullOrEmpty(outputPath) && outputPath.Contains("_composite_bg") && (outputPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase) || outputPath.Contains(".tmp"));
            bool isChunk = allArgs.Contains("_chunk") || allArgs.Contains("_c0_") || allArgs.Contains("_c1_");
            bool isOutputTemp = !string.IsNullOrEmpty(outputPath) && (outputPath.Contains(@"\temp\") || outputPath.Contains("/temp/"));
            bool isOutputImage = !string.IsNullOrEmpty(outputPath) && (outputPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase) || outputPath.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || outputPath.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase));
            bool isChunkOrTemp = isChunk || (isOutputTemp && !isCompositeBgGen) || (isOutputImage && !isCompositeBgGen);

            string[] modifiedArgs = (string[])args.Clone();

            // ═══ CANVSA REVOLUTION: INTERCEPT COMPOSITE BACKGROUND GENERATION (2 QUY TẮC) ═══
            // Quy tắc 1 (Mặc định): Tự động lấy thumbnail video phủ 100% canvas, sắc nét, có chỉnh màu tăng tương phản
            // Quy tắc 2: Gắn ảnh nền tùy chỉnh riêng (customBgPath hoặc bg.jpg)
            if (isCompositeBgGen) {
                int cw = 720, ch = 1280, tw = 660, th = 350, tx = 30, ty = 30;
                if (renderRes == "1080p") {
                    cw = 1080; ch = 1920; tw = 990; th = 525; tx = 45; ty = 45;
                } else if (renderRes == "360p") {
                    cw = 360; ch = 640; tw = 330; th = 175; tx = 15; ty = 15;
                }

                bool useCustomBg = (bgMode == "custom" && !string.IsNullOrEmpty(customBgPath) && File.Exists(customBgPath));

                // Nếu user chọn Quy tắc 2 (Gắn ảnh riêng) mà Tauri chưa chèn vào args, tự động chèn -i <customBgPath>
                if (useCustomBg) {
                    bool alreadyIn = false;
                    for (int j = 0; j < modifiedArgs.Length; j++) {
                        if (modifiedArgs[j] == "-i" && j + 1 < modifiedArgs.Length && 
                            (modifiedArgs[j + 1].Equals(customBgPath, StringComparison.OrdinalIgnoreCase) || 
                             modifiedArgs[j + 1].EndsWith(Path.GetFileName(customBgPath), StringComparison.OrdinalIgnoreCase))) {
                            alreadyIn = true;
                            break;
                        }
                    }
                    if (!alreadyIn) {
                        List<string> injList = new List<string>();
                        bool added = false;
                        for (int k = 0; k < modifiedArgs.Length; k++) {
                            if (!added && modifiedArgs[k] == "-filter_complex") {
                                injList.Add("-i");
                                injList.Add(customBgPath);
                                added = true;
                            }
                            injList.Add(modifiedArgs[k]);
                        }
                        if (!added) {
                            injList.Insert(0, customBgPath);
                            injList.Insert(0, "-i");
                        }
                        modifiedArgs = injList.ToArray();
                    }
                }

                for (int i = 0; i < modifiedArgs.Length; i++) {
                    if (modifiedArgs[i] == "-filter_complex" && i + 1 < modifiedArgs.Length) {
                        string customFilter = "";
                        if (useCustomBg) {
                            // Quy tắc 2: Dùng ảnh nền tùy chỉnh [1:v]
                            customFilter = string.Format("[1:v]scale={0}:{1}:force_original_aspect_ratio=increase,crop={0}:{1}:(ow-iw)/2:(oh-ih)/2[full_bg];" +
                                                         "[0:v]scale={2}:{3}:force_original_aspect_ratio=increase,crop={2}:{3},drawbox=x=0:y=0:w={2}:h={3}:color=white@0.25:t=2[hd_box];" +
                                                         "[full_bg][hd_box]overlay=x={4}:y={5},format=nv12[final]",
                                                         cw, ch, tw, th, tx, ty);
                        } else {
                            // Quy tắc 1 (Mặc định chuẩn): Lấy ngay thumbnail video [0:v] làm ảnh nền full bleed thẩm mỹ cao
                            customFilter = string.Format("[0:v]scale={0}:{1}:force_original_aspect_ratio=increase,crop={0}:{1}:(ow-iw)/2:(oh-ih)/2,eq=brightness=-0.1:saturation=1.1[full_bg];" +
                                                         "[0:v]scale={2}:{3}:force_original_aspect_ratio=increase,crop={2}:{3},drawbox=x=0:y=0:w={2}:h={3}:color=white@0.3:t=2[hd_box];" +
                                                         "[full_bg][hd_box]overlay=x={4}:y={5},format=nv12[final]",
                                                         cw, ch, tw, th, tx, ty);
                        }
                        modifiedArgs[i + 1] = customFilter;
                        Log(string.Format("Overriding _composite_bg with full-canvas layout ({0}x{1}) - {2}", 
                            cw, ch, useCustomBg ? "Quy tắc 2: Ảnh tùy chỉnh (" + customBgPath + ")" : "Quy tắc 1: Thumbnail video mặc định"));
                        break;
                    }
                }
            }

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
                        modifiedArgs = (string[])args.Clone();
                    }
                }
            }

            // Detect partNum only for final renders or trim operations
            if (!isChunkOrTemp && !isCompositeBgGen) {
                string combined = (inputPath ?? "") + " " + (outputPath ?? "");
                Match mPart = Regex.Match(combined, @"(?:[_-]part|PART\s*)(\d+)", RegexOptions.IgnoreCase);
                if (mPart.Success) {
                    int.TryParse(mPart.Groups[1].Value, out partNum);
                } else {
                    mPart = Regex.Match(allArgs, @"(?:[_-]part|PART\s*)(\d+)", RegexOptions.IgnoreCase);
                    if (mPart.Success) {
                        int.TryParse(mPart.Groups[1].Value, out partNum);
                    } else if (autoSplitEnabled && outputPath != null && outputPath.EndsWith(".trim.tmp", StringComparison.OrdinalIgnoreCase)) {
                        partNum = 1;
                    }
                }
            }

            // Read sidecar metadata if available
            try {
                string[] checkPaths = new string[] { inputPath, outputPath };
                foreach (string cp in checkPaths) {
                    if (string.IsNullOrEmpty(cp)) continue;
                    string dir = Path.GetDirectoryName(cp);
                    string fn = Path.GetFileName(cp);
                    if (string.IsNullOrEmpty(dir)) dir = ".";
                    Match mVid = Regex.Match(fn, @"([a-zA-Z0-9_-]{11})");
                    if (mVid.Success) {
                        string vid = mVid.Groups[1].Value;
                        string[] candMeta = new string[] {
                            Path.Combine(dir, vid + "_master.mp4.meta.json"),
                            Path.Combine(dir, fn + ".meta.json")
                        };
                        foreach (string cm in candMeta) {
                            if (File.Exists(cm)) {
                                string meta = File.ReadAllText(cm);
                                Match mSavedP1 = Regex.Match(meta, @"""p1Sec""\s*:\s*([0-9\.]+)");
                                Match mSavedP2 = Regex.Match(meta, @"""p2Sec""\s*:\s*([0-9\.]+)");
                                Match mSavedP3 = Regex.Match(meta, @"""p3Sec""\s*:\s*([0-9\.]+)");
                                int sp1 = 0, sp2 = 0, sp3 = 0;
                                if (mSavedP1.Success && int.TryParse(mSavedP1.Groups[1].Value, out sp1) && sp1 > 0) p1Sec = sp1;
                                if (mSavedP2.Success && int.TryParse(mSavedP2.Groups[1].Value, out sp2) && sp2 > 0) p2Sec = sp2;
                                if (mSavedP3.Success && int.TryParse(mSavedP3.Groups[1].Value, out sp3) && sp3 > 0) p3Sec = sp3;
                                break;
                            }
                        }
                    }
                }
            } catch {}

            int durSec = (partNum == 1) ? p1Sec : ((partNum == 2) ? p2Sec : p3Sec);
            double actDur = 0;
            if (!string.IsNullOrEmpty(inputPath) && File.Exists(inputPath)) {
                actDur = GetMediaDuration(inputPath, realFfmpeg);
            }

            int targetT = durSec;
            if (partNum == 1) {
                targetT = (actDur > 0.5 && actDur < p1Sec) ? (int)Math.Floor(actDur) : p1Sec;
            } else if (partNum >= 2) {
                targetT = (actDur > 0.5) ? (int)Math.Round(actDur) : durSec;
            }

            // ═══ 3. TRANSFORM ARGUMENTS FOR RENDER & TRIM ═══
            if (!isChunkOrTemp && !isCompositeBgGen) {
                bool isTrim = false;
                bool isRender = false;

                for (int i = 0; i < modifiedArgs.Length; i++) {
                    if (modifiedArgs[i] == "-filter_complex") isRender = true;
                    if (modifiedArgs[i] == "-c" && i + 1 < modifiedArgs.Length && modifiedArgs[i + 1] == "copy") isTrim = true;
                }

                if (isTrim && autoSplitEnabled && partNum > 0 && targetT > 0) {
                    for (int i = 0; i < modifiedArgs.Length; i++) {
                        if (modifiedArgs[i] == "-t" && i + 1 < modifiedArgs.Length) {
                            Log(string.Format("Adjusting maybe_trim_file for Part {0}: -t {1} -> -t {2}", partNum, modifiedArgs[i + 1], targetT));
                            modifiedArgs[i + 1] = targetT.ToString();
                            break;
                        }
                    }
                } else if (isRender) {
                    // Áp dụng bố cục chuẩn đã thống nhất:
                    // Video chiều cao tăng gấp rưỡi (1.5x), giữ chiều ngang, dời lên chạm sát thumbnail ở trên!
                    int vw = 720, vh = 608, vy = 380;
                    if (renderRes == "1080p") {
                        vw = 1080; vh = 912; vy = 570;
                    } else if (renderRes == "360p") {
                        vw = 360; vh = 304; vy = 190;
                    }

                    for (int i = 0; i < modifiedArgs.Length; i++) {
                        if (modifiedArgs[i] == "-filter_complex" && i + 1 < modifiedArgs.Length) {
                            string fc = modifiedArgs[i + 1];
                            string newFc = fc;

                            if (autoSplitEnabled && partNum > 0 && targetT > 0) {
                                newFc = Regex.Replace(newFc, @"trim=(?:start=[0-9\.]+:)?duration=([0-9\.]+)", "trim=start=0:duration=" + targetT);
                                newFc = Regex.Replace(newFc, @"atrim=(?:start=[0-9\.]+:)?duration=([0-9\.]+)", "atrim=start=0:duration=" + targetT);
                            }

                            // 1. Cập nhật scale video: Giữ chiều ngang, chiều cao tăng gấp rưỡi
                            newFc = Regex.Replace(newFc, @"scale=\d+:\d+", string.Format("scale={0}:{1}", vw, vh));

                            // 2. Cập nhật vị trí overlay: Dời lên chạm sát đáy thumbnail
                            newFc = Regex.Replace(newFc, @"(overlay(?:_cuda)?=x=0:y=)\d+", string.Format("${{1}}{0}", vy));

                            if (newFc != fc) {
                                Log(string.Format("Adjusting filter_complex: scale={0}:{1}, y={2}, targetT={3}", vw, vh, vy, targetT));
                                modifiedArgs[i + 1] = newFc;
                            }
                        } else if (modifiedArgs[i] == "-t" && i + 1 < modifiedArgs.Length && autoSplitEnabled && partNum > 0 && targetT > 0) {
                            Log(string.Format("Adjusting render -t for Part {0}: {1} -> {2}.00", partNum, modifiedArgs[i + 1], targetT));
                            modifiedArgs[i + 1] = targetT.ToString() + ".00";
                        }
                    }

                    if (renderRes == "720p") {
                        for (int m = 0; m < modifiedArgs.Length; m++) {
                            if (modifiedArgs[m] == "-maxrate" && m + 1 < modifiedArgs.Length) {
                                modifiedArgs[m + 1] = "600k";
                            }
                            if (modifiedArgs[m] == "-bufsize" && m + 1 < modifiedArgs.Length) {
                                modifiedArgs[m + 1] = "1200k";
                            }
                        }
                    }
                }
            }

            // Bitrate & codec chuẩn AdsPow
            for (int m = 0; m < modifiedArgs.Length; m++) {
                if (modifiedArgs[m] == "-b:a" && m + 1 < modifiedArgs.Length) {
                    modifiedArgs[m + 1] = "48k";
                }
                if (modifiedArgs[m] == "-maxrate" && m + 1 < modifiedArgs.Length) {
                    modifiedArgs[m + 1] = (renderRes == "1080p") ? "1.5M" : "600k";
                }
                if (modifiedArgs[m] == "-bufsize" && m + 1 < modifiedArgs.Length) {
                    modifiedArgs[m + 1] = (renderRes == "1080p") ? "3M" : "1200k";
                }
                if (modifiedArgs[m] == "-cq" && m + 1 < modifiedArgs.Length) {
                    modifiedArgs[m + 1] = (renderRes == "1080p") ? "23" : "25";
                }
                if (modifiedArgs[m] == "-c:v" && m + 1 < modifiedArgs.Length && modifiedArgs[m + 1] == "hevc_nvenc") {
                    modifiedArgs[m + 1] = "h264_nvenc";
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
