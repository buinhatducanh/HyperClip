using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.Download;

public partial class YtdlpDownloader : IYtdlpDownloader
{
    private readonly YtdlpPathResolver _pathResolver;
    private static readonly TimeSpan DownloadTimeout = TimeSpan.FromMinutes(30);

    public YtdlpDownloader(YtdlpPathResolver pathResolver)
    {
        _pathResolver = pathResolver;
    }

    public string GetYtdlpPath() => _pathResolver.GetYtdlpPath();

    public async Task<DownloadResult> DownloadAsync(
        YtdlpOptions options,
        IProgress<DownloadProgress>? progress = null,
        CancellationToken ct = default)
    {
        var clients = new[] { "tv_embedded", "web", "ios" };

        foreach (var client in clients)
        {
            ct.ThrowIfCancellationRequested();

            var clientOpts = new YtdlpOptions
            {
                WorkspaceId = options.WorkspaceId,
                VideoUrl = options.VideoUrl,
                OutputDir = options.OutputDir,
                TrimLimitMinutes = options.TrimLimitMinutes,
                Quality = options.Quality,
                CookiesFile = options.CookiesFile,
                PlayerClient = client,
            };
            var result = await TryDownloadWithClient(clientOpts, progress, ct);
            if (result.Success) return result;

            if (result.Error?.Contains("not available") == true || result.Error?.Contains("video unavailable") == true || result.Error?.Contains("no video formats found") == true)
                return new DownloadResult { Success = false, WorkspaceId = result.WorkspaceId, Error = $"[{client}] {result.Error}" };

            if (result.Error?.Contains("429") == true || result.Error?.Contains("Too Many Requests", StringComparison.OrdinalIgnoreCase) == true)
            {
                await Task.Delay(2000, ct);
                continue;
            }
        }

        return new DownloadResult
        {
            Success = false,
            WorkspaceId = options.WorkspaceId,
            Error = "All download clients failed",
        };
    }

    private async Task<DownloadResult> TryDownloadWithClient(
        YtdlpOptions options,
        IProgress<DownloadProgress>? progress,
        CancellationToken ct)
    {
        var ytdlp = GetYtdlpPath();
        if (!File.Exists(ytdlp) && ytdlp != "yt-dlp")
            return new DownloadResult { Success = false, WorkspaceId = options.WorkspaceId, Error = $"yt-dlp not found at {ytdlp}" };

        Directory.CreateDirectory(options.OutputDir);

        var existing = FindExistingFile(options.OutputDir, options.WorkspaceId);
        if (existing != null)
        {
            var info = new FileInfo(existing);
            return new DownloadResult { Success = true, WorkspaceId = options.WorkspaceId, FilePath = existing, FileSize = info.Length };
        }

        var outputTemplate = Path.Combine(options.OutputDir, $"{options.WorkspaceId}_%(id)s.%(ext)s");
        var args = BuildArgs(options, outputTemplate);

        return await SpawnDownloadAsync(ytdlp, args, options, progress, ct);
    }

    private string[] BuildArgs(YtdlpOptions options, string outputTemplate)
    {
        var args = new List<string>
        {
            options.VideoUrl,
            "--extractor-args", $"youtube:player_client={options.PlayerClient ?? "tv_embedded"}",
            "-f", FormatSelector(options.Quality),
            "--merge-output-format", "mp4",
            "--remux-video", "mp4",
            "--output", $"\"{outputTemplate}\"",
            "--no-playlist",
            "--newline",
            "--concurrent-fragments", "16",
            "--retries", "3",
            "--fragment-retries", "3",
            "--socket-timeout", "15",
        };

        if (!string.IsNullOrEmpty(options.CookiesFile))
        {
            args.Add("--cookies");
            args.Add($"\"{options.CookiesFile}\"");
        }

        if (options.TrimLimitMinutes > 0)
        {
            var totalSec = options.TrimLimitMinutes * 60;
            var hh = $"{totalSec / 3600:D2}";
            var mm = $"{(totalSec % 3600) / 60:D2}";
            var ss = $"{totalSec % 60:D2}";
            args.Add("--download-sections");
            args.Add($"*00:00:00-{hh}:{mm}:{ss}");
        }

        return args.ToArray();
    }

    private static string FormatSelector(string quality)
    {
        var h = int.TryParse(quality, out var q) ? q : 720;
        return $"bestvideo[height<={h}][vcodec!=\"none\"]+bestaudio[acodec=aac]/bestvideo[height<={h}]+bestaudio/{h}/best";
    }

    private async Task<DownloadResult> SpawnDownloadAsync(
        string ytdlp,
        string[] args,
        YtdlpOptions options,
        IProgress<DownloadProgress>? progress,
        CancellationToken ct)
    {
        var joinedArgs = string.Join(" ", args);
        var psi = new ProcessStartInfo
        {
            FileName = ytdlp,
            Arguments = joinedArgs,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = new Process { StartInfo = psi };
        var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linkedCts.CancelAfter(DownloadTimeout);

        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data == null) return;
            var pctMatch = PctRegex().Match(e.Data);
            if (pctMatch.Success && double.TryParse(pctMatch.Groups[1].Value, out var pct))
            {
                progress?.Report(new DownloadProgress
                {
                    WorkspaceId = options.WorkspaceId,
                    Percent = Math.Min(pct, 100),
                    Speed = ExtractSpeed(e.Data),
                });
            }
        };

        try
        {
            proc.Start();
            proc.BeginErrorReadLine();

            await proc.WaitForExitAsync(linkedCts.Token);
            var exitCode = proc.ExitCode;

            var downloadedFile = FindExistingFile(options.OutputDir, options.WorkspaceId);

            if (exitCode == 0 && downloadedFile != null)
            {
                var info = new FileInfo(downloadedFile);
                return new DownloadResult
                {
                    Success = true,
                    WorkspaceId = options.WorkspaceId,
                    FilePath = downloadedFile,
                    FileSize = info.Length,
                };
            }

            return new DownloadResult
            {
                Success = false,
                WorkspaceId = options.WorkspaceId,
                Error = $"yt-dlp exited with code {exitCode}",
            };
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            try { proc.Kill(true); } catch { }
            return new DownloadResult { Success = false, WorkspaceId = options.WorkspaceId, Error = "Download timeout" };
        }
        catch (OperationCanceledException)
        {
            return new DownloadResult { Success = false, WorkspaceId = options.WorkspaceId, Error = "Cancelled" };
        }
    }

    public async Task<VideoProbeResult?> ProbeAvailabilityAsync(string videoUrl, string? cookiesFile = null, CancellationToken ct = default)
    {
        var ytdlp = GetYtdlpPath();
        var args = new List<string>
        {
            videoUrl,
            "--extractor-args", "youtube:player_client=web",
            "--dump-json",
            "--no-download",
            "--no-playlist",
            "--socket-timeout", "15",
        };
        if (!string.IsNullOrEmpty(cookiesFile)) { args.Add("--cookies"); args.Add(cookiesFile); }

        var psi = new ProcessStartInfo
        {
            FileName = ytdlp,
            Arguments = string.Join(" ", args),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = new Process { StartInfo = psi };
        var output = new StringBuilder();
        var error = new StringBuilder();

        proc.OutputDataReceived += (_, e) => { if (e.Data != null) output.AppendLine(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) error.AppendLine(e.Data); };

        try
        {
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(20));
            await proc.WaitForExitAsync(cts.Token);

            var err = error.ToString().ToLowerInvariant();
            if (proc.ExitCode == 0 && output.Length > 0)
                return new VideoProbeResult { Available = true };

            return new VideoProbeResult
            {
                Available = false,
                IsPrivate = err.Contains("private video"),
                IsNotFound = err.Contains("not available") || err.Contains("video unavailable") || err.Contains("no video formats found"),
                IsRateLimited = err.Contains("429") || err.Contains("too many requests"),
                Error = error.ToString().Trim()[..Math.Min(200, error.Length)],
            };
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(); } catch { }
            return null;
        }
    }

    public async Task<string?> GetVideoDurationAsync(string videoUrl, CancellationToken ct = default)
    {
        var ytdlp = GetYtdlpPath();
        var psi = new ProcessStartInfo
        {
            FileName = ytdlp,
            Arguments = $"\"{videoUrl}\" --dump-json --no-download --no-playlist",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = new Process { StartInfo = psi };
        var output = new StringBuilder();
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) output.AppendLine(e.Data); };

        try
        {
            proc.Start();
            proc.BeginOutputReadLine();
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(20));
            await proc.WaitForExitAsync(cts.Token);

            if (proc.ExitCode == 0)
            {
                var json = output.ToString().Trim();
                var match = DurationRegex().Match(json);
                if (match.Success && int.TryParse(match.Groups[1].Value, out var duration))
                    return TimeSpan.FromSeconds(duration).ToString(@"m\:ss");
            }
        }
        catch { }

        return null;
    }

    private static string? FindExistingFile(string outputDir, string workspaceId)
    {
        try
        {
            return Directory.GetFiles(outputDir)
                .FirstOrDefault(f => Path.GetFileName(f).StartsWith(workspaceId + "_") &&
                    (f.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) ||
                     f.EndsWith(".webm", StringComparison.OrdinalIgnoreCase)));
        }
        catch { return null; }
    }

    private static string ExtractSpeed(string line)
    {
        var m = Regex.Match(line, @"(\d+\.?\d*[KMG]?i?B/s)", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value : "";
    }

    [GeneratedRegex(@"(\d+\.?\d*)%")]
    private static partial Regex PctRegex();

    [GeneratedRegex(@"""duration"":\s*(\d+)")]
    private static partial Regex DurationRegex();
}
