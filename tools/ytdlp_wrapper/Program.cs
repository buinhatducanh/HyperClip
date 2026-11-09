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
            double p1 = 3.0;
            double p2 = 3.5;
            double p3 = 3.5;
            int parts = 3;
            bool autoSplitEnabled = true;
            int p1Sec = 180;
            int p2Sec = 210;
            int p3Sec = 210;
            string splitMode = "parts";
            string subMode = "";
            string autoRenderResolution = "1080p";
            string autoDownloadQuality = "1080";
            string dataDir = Environment.GetEnvironmentVariable("HYPERCLIP_DATA_DIR");
            if (string.IsNullOrEmpty(dataDir)) {
                dataDir = @"D:\HyperClip\HyperClip-TestCustomer-20260616-224538\HyperClip-Data";
            }

            try {
                string setPath = Path.Combine(dataDir, @".hyperclip\settings.json");
                if (File.Exists(setPath)) {
                    string json = File.ReadAllText(setPath);
                    if (json.Contains("\"autoSplitEnabled\": false") || json.Contains("\"autoSplitEnabled\":false")) {
                        autoSplitEnabled = false;
                    }

                    Match mRes = Regex.Match(json, @"""autoRenderResolution""\s*:\s*""([^""]+)""");
                    if (mRes.Success) autoRenderResolution = mRes.Groups[1].Value.ToLowerInvariant();

                    Match mDl = Regex.Match(json, @"""autoDownloadQuality""\s*:\s*""([^""]+)""");
                    if (mDl.Success) autoDownloadQuality = mDl.Groups[1].Value;

                    Match mTrim = Regex.Match(json, @"""defaultTrimLimit""\s*:\s*([0-9\.]+)");
                    if (mTrim.Success) {
                        double.TryParse(mTrim.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out trimLimit);
                    }

                    Match mMode = Regex.Match(json, @"""autoSplitMode""\s*:\s*""([^""]+)""");
                    splitMode = mMode.Success ? mMode.Groups[1].Value : "parts";
                    if (splitMode == "none") autoSplitEnabled = false;

                    Match mParts = Regex.Match(json, @"""autoSplitParts""\s*:\s*([0-9]+)");
                    if (mParts.Success) {
                        int.TryParse(mParts.Groups[1].Value, out parts);
                    }

                    Match mSub = Regex.Match(json, @"""autoSplitSubMode""\s*:\s*""([^""]+)""");
                    subMode = mSub.Success ? mSub.Groups[1].Value : "";

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
            } catch {}

            // 4. Intercept slicing from master video ONLY for explicit part files (_part2, _part3, etc.)
            bool isPartDownload = false;
            if (!string.IsNullOrEmpty(outputPath)) {
                string fileName = Path.GetFileName(outputPath);
                string dir = Path.GetDirectoryName(outputPath);
                if (string.IsNullOrEmpty(dir)) dir = ".";

                Match mPart = Regex.Match(fileName, @"^(.*)_part(\d+)\.mp4$", RegexOptions.IgnoreCase);
                if (mPart.Success) {
                    isPartDownload = true;
                    string baseName = mPart.Groups[1].Value;
                    int partNum = int.Parse(mPart.Groups[2].Value);

                    string cleanBase = Regex.Replace(baseName, @"(?:_h|\.hedge)$", "", RegexOptions.IgnoreCase);
                    string[] candFiles = new string[] {
                        Path.Combine(dir, baseName + "_master.mp4"),
                        Path.Combine(dir, cleanBase + "_master.mp4"),
                        Path.Combine(dir, cleanBase + "_h_master.mp4"),
                        Path.Combine(dir, cleanBase + ".mp4.hedge_master.mp4"),
                        Path.Combine(dir, cleanBase + ".hedge_master.mp4"),
                        Path.Combine(dir, cleanBase + ".mp4.hedge.mp4"),
                        Path.Combine(dir, cleanBase + ".mp4"),
                        Path.Combine(dir, baseName + ".mp4")
                    };

                    string masterPath = null;
                    double bestDur = 0;
                    foreach (string cand in candFiles) {
                        if (File.Exists(cand)) {
                            double d = GetMediaDuration(cand, ffmpegPath);
                            if (d > bestDur) {
                                bestDur = d;
                                masterPath = cand;
                            }
                        }
                    }

                    // If duration is still short (< 180s) or no master found, look for any matching video in dir
                    if (bestDur < 180.0) {
                        Match mVid = Regex.Match(baseName, @"([a-zA-Z0-9_-]{11})");
                        if (mVid.Success) {
                            string vid = mVid.Groups[1].Value;
                            try {
                                foreach (string f in Directory.GetFiles(dir, "*" + vid + "*.mp4")) {
                                    string fn = Path.GetFileName(f);
                                    if (fn.Contains("_part") || fn.Contains("_chunk") || fn.Contains(".trim")) continue;
                                    double d = GetMediaDuration(f, ffmpegPath);
                                    if (d > bestDur) {
                                        bestDur = d;
                                        masterPath = f;
                                    }
                                }
                            } catch {}

                            // If still short, check history.json
                            if (bestDur < 180.0) {
                                try {
                                    string histFile = Path.Combine(dataDir, "history.json");
                                    if (File.Exists(histFile)) {
                                        string hJson = File.ReadAllText(histFile);
                                        Match mH = Regex.Match(hJson, string.Format(@"""videoId""\s*:\s*""{0}""[\s\S]*?""durationSec""\s*:\s*([0-9\.]+)", vid));
                                        if (mH.Success) {
                                            double hDur = 0;
                                            if (double.TryParse(mH.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out hDur) && hDur > 0) {
                                                bestDur = hDur;
                                                Log(string.Format("Resolved video {0} duration {1}s from history.json", vid, hDur));
                                            }
                                        }
                                    }
                                } catch {}
                            }

                            // If still short, check workspaces.json
                            if (bestDur < 180.0) {
                                try {
                                    string wsFile = Path.Combine(dataDir, @".hyperclip\workspaces.json");
                                    if (File.Exists(wsFile)) {
                                        string wJson = File.ReadAllText(wsFile);
                                        Match mW = Regex.Match(wJson, string.Format(@"""video_id""\s*:\s*""{0}""[\s\S]*?""durationSec""\s*:\s*([0-9\.]+)", vid));
                                        if (mW.Success) {
                                            double wDur = 0;
                                            if (double.TryParse(mW.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out wDur) && wDur > 0) {
                                                bestDur = wDur;
                                                Log(string.Format("Resolved video {0} duration {1}s from workspaces.json", vid, wDur));
                                            }
                                        }
                                    }
                                } catch {}
                            }
                        }
                    }

                    double masterDur = bestDur;
                    bool hasSavedPlan = false;
                    bool savedPlanEnabled = false;
                    int savedParts = 0;
                    int savedP1Sec = 0;
                    int savedP2Sec = 0;
                    int savedP3Sec = 0;
                    double savedTotalSec = 0;
                    string[] splitMetaCandidates = new string[] {
                        string.IsNullOrEmpty(masterPath) ? null : masterPath + ".meta.json",
                        Path.Combine(dir, cleanBase + "_master.mp4.meta.json"),
                        Path.Combine(dir, baseName + "_master.mp4.meta.json")
                    };
                    foreach (string metaPath in splitMetaCandidates) {
                        if (string.IsNullOrEmpty(metaPath) || !File.Exists(metaPath)) continue;
                        try {
                            string meta = File.ReadAllText(metaPath);
                            Match mEnabled = Regex.Match(meta, @"""enabled""\s*:\s*(true|false)", RegexOptions.IgnoreCase);
                            Match mSavedParts = Regex.Match(meta, @"""parts""\s*:\s*([0-9]+)");
                            Match mSavedP1 = Regex.Match(meta, @"""p1Sec""\s*:\s*([0-9\.]+)");
                            Match mSavedP2 = Regex.Match(meta, @"""p2Sec""\s*:\s*([0-9\.]+)");
                            Match mSavedP3 = Regex.Match(meta, @"""p3Sec""\s*:\s*([0-9\.]+)");
                            Match mSavedTotal = Regex.Match(meta, @"""totalTrimSec""\s*:\s*([0-9\.]+)");
                            Match mActualTotal = Regex.Match(meta, @"""actualDurationSec""\s*:\s*([0-9\.]+)");
                            int.TryParse(mSavedP1.Groups[1].Value, out savedP1Sec);
                            int.TryParse(mSavedP2.Groups[1].Value, out savedP2Sec);
                            int.TryParse(mSavedP3.Groups[1].Value, out savedP3Sec);
                            int.TryParse(mSavedParts.Groups[1].Value, out savedParts);
                            double.TryParse(mSavedTotal.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out savedTotalSec);
                            if (savedTotalSec <= 0) double.TryParse(mActualTotal.Groups[1].Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out savedTotalSec);
                            savedPlanEnabled = mEnabled.Success && string.Equals(mEnabled.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase);
                            hasSavedPlan = mSavedParts.Success && mSavedP1.Success && savedP1Sec > 0 && savedTotalSec > 0;
                        } catch (Exception ex) {
                            Log("Could not read saved split plan: " + ex.Message);
                        }
                        if (hasSavedPlan) break;
                    }

                    if (!hasSavedPlan && !autoSplitEnabled) {
                        Console.Error.WriteLine("[smart-split] No saved plan for this part and automatic split is now disabled.");
                        return 1;
                    }

                    int effectiveParts = hasSavedPlan ? savedParts : parts;
                    if (hasSavedPlan && !savedPlanEnabled) {
                        Console.Error.WriteLine(string.Format("[smart-split] Part {0} is outside saved plan ({1} parts).", partNum, effectiveParts));
                        return 1;
                    }

                    // A sidecar plan is immutable for this video. Use live settings only for legacy jobs without one.
                    double effectiveTotal = hasSavedPlan
                        ? savedTotalSec
                        : ((masterDur > 0) ? masterDur : ((trimLimit > 0 && trimLimit < 900) ? trimLimit * 60.0 : 660.0));
                    int effectiveP1 = hasSavedPlan ? savedP1Sec : p1Sec;
                    double remainSec = Math.Max(0, effectiveTotal - effectiveP1);
                    int effectiveP2 = 0;
                    int effectiveP3 = 0;
                    if (hasSavedPlan) {
                        effectiveP2 = savedP2Sec;
                        effectiveP3 = savedP3Sec;
                    } else if (splitMode == "minutes" || subMode == "custom_p1" || (p1Sec > 0 && splitMode != "parts")) {
                        effectiveP1 = (int)Math.Min(effectiveTotal, Math.Max(1, p1Sec));
                        remainSec = Math.Max(0, effectiveTotal - effectiveP1);
                        if (remainSec < 30) {
                            effectiveP1 = (int)effectiveTotal;
                            effectiveParts = 1;
                        } else if (remainSec < 60 || effectiveParts == 2) {
                            effectiveP2 = (int)remainSec;
                            effectiveParts = 2;
                        } else {
                            effectiveP2 = (int)Math.Ceiling(remainSec / 2.0);
                            effectiveP3 = (int)(remainSec - effectiveP2);
                            effectiveParts = 3;
                        }
                    } else if (effectiveParts == 2) {
                        effectiveP1 = (int)Math.Ceiling(effectiveTotal / 2.0);
                        effectiveP2 = (int)(effectiveTotal - effectiveP1);
                    } else {
                        effectiveP1 = (int)Math.Ceiling(effectiveTotal / 3.0);
                        remainSec = Math.Max(0, effectiveTotal - effectiveP1);
                        effectiveP2 = (int)Math.Ceiling(remainSec / 2.0);
                        effectiveP3 = (int)(remainSec - effectiveP2);
                    }
                    if (partNum > effectiveParts || effectiveP1 <= 0 || (partNum == 2 && effectiveP2 <= 0) || (partNum >= 3 && effectiveP3 <= 0)) {
                        Console.Error.WriteLine(string.Format("[smart-split] Part {0} has no segment in the {1}-part plan.", partNum, effectiveParts));
                        return 1;
                    }

                    int startSec = 0;
                    int durSec = effectiveP1;

                    if (partNum == 1) {
                        startSec = 0;
                        durSec = effectiveP1;
                    } else if (partNum == 2) {
                        startSec = effectiveP1;
                        durSec = effectiveP2;
                    } else if (partNum == 3) {
                        startSec = effectiveP1 + effectiveP2;
                        durSec = effectiveP3;
                    } else {
                        startSec = effectiveP1 + effectiveP2 + (partNum - 3) * effectiveP3;
                        durSec = effectiveP3;
                    }

                    // A) If master video exists, SLICE LOCALLY (50ms, zero network)
                    if (File.Exists(masterPath) && File.Exists(ffmpegPath)) {
                        try { if (File.Exists(outputPath)) File.Delete(outputPath); } catch {}
                        ProcessStartInfo psiFmt = new ProcessStartInfo();
                        psiFmt.FileName = ffmpegPath;
                        psiFmt.Arguments = string.Format("-y -ss {0} -i \"{1}\" -t {2} -c copy \"{3}\"", startSec, masterPath, durSec, outputPath);
                        psiFmt.UseShellExecute = false;
                        psiFmt.CreateNoWindow = true;
                        Process pFmt = Process.Start(psiFmt);
                        pFmt.WaitForExit();

                        if (pFmt.ExitCode == 0 && File.Exists(outputPath) && new FileInfo(outputPath).Length > 1000) {
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

            // 4b. If master video or single video download, ensure it downloads target duration (trimLimit)
            if (!isPartDownload) {
                if (trimLimit >= 900 || trimLimit <= 0) {
                    // Full video download: remove --download-sections so yt-dlp gets 100% of the video
                    System.Collections.Generic.List<string> cleanArgs = new System.Collections.Generic.List<string>();
                    for (int i = 0; i < args.Length; i++) {
                        if (args[i] == "--download-sections" && i + 1 < args.Length) {
                            Log(string.Format("Full video mode: stripping section constraint '{0}'", args[i + 1]));
                            i++;
                            continue;
                        }
                        cleanArgs.Add(args[i]);
                    }
                    args = cleanArgs.ToArray();
                } else {
                    TimeSpan tsLimit = TimeSpan.FromMinutes(trimLimit);
                    string masterSection = string.Format("*00:00:00-{0:D2}:{1:D2}:{2:D2}",
                        (int)tsLimit.TotalHours, tsLimit.Minutes, tsLimit.Seconds);

                    bool sectionReplaced = false;
                    for (int i = 0; i < args.Length; i++) {
                        if (args[i] == "--download-sections" && i + 1 < args.Length) {
                            Log(string.Format("Rewriting master download section from '{0}' to full limit '{1}'", args[i + 1], masterSection));
                            args[i + 1] = masterSection;
                            sectionReplaced = true;
                            break;
                        }
                    }
                    if (!sectionReplaced) {
                        Log(string.Format("Injecting master download section: '{0}'", masterSection));
                        string[] newArgs = new string[args.Length + 2];
                        Array.Copy(args, newArgs, args.Length);
                        newArgs[args.Length] = "--download-sections";
                        newArgs[args.Length + 1] = masterSection;
                        args = newArgs;
                    }
                }
            }

            // 4c. Ensure download resolution strictly matches user setting (360p vs 720p vs 1080p)
            string targetQ = "720";
            if (autoDownloadQuality == "360") {
                targetQ = "360";
            } else if (autoRenderResolution.Contains("720") || autoDownloadQuality == "720") {
                targetQ = "720";
            } else if (autoRenderResolution.Contains("1080") || autoDownloadQuality == "1080") {
                targetQ = "1080";
            }

            // 4d. Strip broken extractor-args that trigger YouTube SABR experiment blocking 1080p formats
            System.Collections.Generic.List<string> cleanArgsList = new System.Collections.Generic.List<string>();
            for (int i = 0; i < args.Length; i++) {
                if (args[i] == "--extractor-args" && i + 1 < args.Length && args[i + 1].Contains("player_client=")) {
                    Log("Stripping broken extractor-args to prevent SABR 360p fallback: " + args[i + 1]);
                    i++; // skip flag and value
                    continue;
                }
                cleanArgsList.Add(args[i]);
            }
            args = cleanArgsList.ToArray();

            // 4e. Format string enforcement (NEVER allow /worst, and use fast progressive 18 for 360p)
            for (int i = 0; i < args.Length; i++) {
                if (args[i] == "-f" && i + 1 < args.Length) {
                    if (targetQ == "360") {
                        args[i + 1] = "18/best[height<=?360]/bestvideo[height<=?360]+bestaudio/worst";
                        Log("Enforced 360p format string (AdsPow Speed Flow - Fast 18): " + args[i + 1]);
                    } else if (targetQ == "720") {
                        args[i + 1] = "bestvideo[height<=?720]+bestaudio/bestvideo+bestaudio/best[height<=?720]/best";
                        Log("Enforced 720p format string: " + args[i + 1]);
                    } else if (targetQ == "1080") {
                        args[i + 1] = "bestvideo[height<=?1080]+bestaudio/bestvideo+bestaudio/best[height<=?1080]/best";
                        Log("Enforced 1080p format string: " + args[i + 1]);
                    }
                } else if (args[i].StartsWith("-f=")) {
                    if (targetQ == "360") {
                        args[i] = "-f=18/best[height<=?360]/bestvideo[height<=?360]+bestaudio/worst";
                        Log("Enforced 360p format string (AdsPow Speed Flow - Fast 18): " + args[i]);
                    } else if (targetQ == "720") {
                        args[i] = "-f=bestvideo[height<=?720]+bestaudio/bestvideo+bestaudio/best[height<=?720]/best";
                        Log("Enforced 720p format string: " + args[i]);
                    } else if (targetQ == "1080") {
                        args[i] = "-f=bestvideo[height<=?1080]+bestaudio/bestvideo+bestaudio/best[height<=?1080]/best";
                        Log("Enforced 1080p format string: " + args[i]);
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

            // 6. If this was the master video download, create _master.mp4 snapshot for local part slicing
            if (!isPartDownload && p.ExitCode == 0 && !string.IsNullOrEmpty(outputPath) && File.Exists(outputPath)) {
                try {
                    FileInfo fi = new FileInfo(outputPath);
                    if (fi.Length > 65536) {
                        string dir = Path.GetDirectoryName(outputPath);
                        if (string.IsNullOrEmpty(dir)) dir = ".";
                        string fileNameWithoutExt = Path.GetFileNameWithoutExtension(outputPath);
                        string cleanName = Regex.Replace(fileNameWithoutExt, @"(?:\.mp4)?(?:\.hedge)?$", "", RegexOptions.IgnoreCase);
                        
                        if (!cleanName.EndsWith("_master", StringComparison.OrdinalIgnoreCase)) {
                            string masterSnapshot = Path.Combine(dir, cleanName + "_master.mp4");
                            File.Copy(outputPath, masterSnapshot, true);
                            Log(string.Format("Saved master video snapshot: {0} ({1:F2} MB)", masterSnapshot, fi.Length / (1024.0 * 1024.0)));

                            string hMaster = Path.Combine(dir, cleanName + "_h_master.mp4");
                            try { File.Copy(outputPath, hMaster, true); } catch {}
                        }
                    }
                } catch {}
            }

            return p.ExitCode;
        }
    }
}
