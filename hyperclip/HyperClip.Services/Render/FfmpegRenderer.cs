using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.Render;

public partial class FfmpegRenderer : IRenderEngine
{
    private readonly FfmpegPathResolver _resolver;
    private readonly bool _hasNvenc;
    private readonly bool _hasCudaFilters;
    private readonly bool _hasHevcNvenc;

    public bool HasNvenc => _hasNvenc;
    public bool HasCudaFilters => _hasCudaFilters;

    public FfmpegRenderer(FfmpegPathResolver resolver)
    {
        _resolver = resolver;
        var caps = DetectCapabilities();
        _hasNvenc = caps.HasNvenc;
        _hasCudaFilters = caps.HasCudaFilters;
        _hasHevcNvenc = caps.HasHevcNvenc;
    }

    public async Task<RenderResult> RenderAsync(
        RenderOptions options,
        IProgress<RenderProgress>? progress = null,
        CancellationToken ct = default)
    {
        var ffmpeg = _resolver.GetFfmpegPath();
        Directory.CreateDirectory(Path.GetDirectoryName(options.OutputPath) ?? "");

        var duration = options.TrimEnd - options.TrimStart;
        var args = BuildFilterChain(options, duration);

        return await SpawnFfmpegAsync(ffmpeg, args, options, duration, progress, ct);
    }

    private string[] BuildFilterChain(RenderOptions options, double duration)
    {
        var args = new List<string>();

        // Trim
        args.Add("-ss");
        args.Add(options.TrimStart.ToString("F3", CultureInfo.InvariantCulture));
        args.Add("-t");
        args.Add(duration.ToString("F3", CultureInfo.InvariantCulture));
        args.Add("-i");
        args.Add(options.InputPath);

        // Speed + scale + pad
        var filters = new List<string>();

        if (options.SpeedMultiplier != 1.0)
        {
            var pts = 1.0 / options.SpeedMultiplier;
            filters.Add($"setpts={pts.ToString("F3", CultureInfo.InvariantCulture)}*PTS");
        }

        // Scale to canvas then pad
        filters.Add($"scale={options.CanvasWidth}:{options.CanvasHeight}:force_original_aspect_ratio=decrease");
        filters.Add($"pad={options.CanvasWidth}:{options.CanvasHeight}:(ow-iw)/2:(oh-ih)/2:black");

        filters.Add($"fps={options.Fps}");

        args.Add("-vf");
        args.Add(string.Join(",", filters));

        // Bitrate cap
        var bitrate = options.BitrateCap > 0 ? options.BitrateCap : GetBitrateCap(options.CanvasHeight);
        args.Add("-maxrate");
        args.Add($"{bitrate / 1000}k");
        args.Add("-bufsize");
        args.Add($"{bitrate / 1000}k");

        // Codec
        var codec = DetermineCodec(options);
        args.Add("-c:v");
        args.Add(codec);

        if (codec.Contains("nvenc"))
        {
            args.Add("-preset");
            args.Add("p1");
            args.Add("-tune");
            args.Add("ull");
        }
        else
        {
            args.Add("-preset");
            args.Add("ultrafast");
            args.Add("-crf");
            args.Add("18");
        }

        // Audio
        args.Add("-c:a");
        args.Add("aac");
        args.Add("-b:a");
        args.Add("192k");

        // Output
        args.Add("-y");
        args.Add(options.OutputPath);

        return args.ToArray();
    }

    private string DetermineCodec(RenderOptions options)
    {
        if (_hasNvenc && options.Codec == "h264") return "h264_nvenc";
        if (_hasHevcNvenc && options.Codec == "hevc") return "hevc_nvenc";
        return "libx264";
    }

    private static int GetBitrateCap(int canvasHeight) =>
        canvasHeight switch
        {
            <= 360 => 3_000_000,
            <= 720 => 6_000_000,
            _ => 12_000_000
        };

    private async Task<RenderResult> SpawnFfmpegAsync(
        string ffmpeg,
        string[] args,
        RenderOptions options,
        double duration,
        IProgress<RenderProgress>? progress,
        CancellationToken ct)
    {
        var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linkedCts.CancelAfter(TimeSpan.FromHours(2));

        var joinedArgs = string.Join(" ", args.Select(a => $"\"{a}\""));

        var psi = new ProcessStartInfo
        {
            FileName = ffmpeg,
            Arguments = joinedArgs,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = new Process { StartInfo = psi };
        var t0 = DateTime.UtcNow;

        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data == null || duration <= 0) return;
            var match = TimeRegex().Match(e.Data);
            if (match.Success)
            {
                var h = int.Parse(match.Groups[1].Value);
                var m = int.Parse(match.Groups[2].Value);
                var s = ParseDouble(match.Groups[3].Value);
                var elapsed = h * 3600 + m * 60 + s;
                var pct = Math.Min(99, (elapsed / duration) * 100);
                var eta = elapsed > 0
                    ? (int)((duration - elapsed) * (DateTime.UtcNow - t0).TotalSeconds / elapsed)
                    : 0;

                progress?.Report(new RenderProgress
                {
                    WorkspaceId = options.WorkspaceId,
                    Percent = Math.Round(pct, 1),
                    CurrentTime = $"{h:D2}:{m:D2}:{s:F1}",
                    Fps = ExtractFps(e.Data),
                    Speed = ExtractSpeed(e.Data),
                    EtaSeconds = eta,
                });
            }
        };

        try
        {
            proc.Start();
            proc.BeginErrorReadLine();

            await proc.WaitForExitAsync(linkedCts.Token);

            if (proc.ExitCode == 0 && File.Exists(options.OutputPath))
            {
                var info = new FileInfo(options.OutputPath);
                progress?.Report(new RenderProgress
                {
                    WorkspaceId = options.WorkspaceId,
                    Percent = 100
                });
                return new RenderResult
                {
                    Success = true,
                    WorkspaceId = options.WorkspaceId,
                    OutputPath = options.OutputPath,
                    FileSize = info.Length,
                    Duration = (int)duration,
                };
            }

            return new RenderResult
            {
                Success = false,
                WorkspaceId = options.WorkspaceId,
                Error = $"FFmpeg exited {proc.ExitCode}",
            };
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            try { proc.Kill(true); } catch { /* process may have already exited */ }
            return new RenderResult
            {
                Success = false,
                WorkspaceId = options.WorkspaceId,
                Error = "Render timeout"
            };
        }
        catch (OperationCanceledException)
        {
            return new RenderResult
            {
                Success = false,
                WorkspaceId = options.WorkspaceId,
                Error = "Cancelled"
            };
        }
    }

    public Task<bool> CancelAsync(string workspaceId) => Task.FromResult(true);

    private static (bool HasNvenc, bool HasCudaFilters, bool HasHevcNvenc) DetectCapabilities()
    {
        try
        {
            var ffmpegPath = new FfmpegPathResolver().GetFfmpegPath();
            var psi = new ProcessStartInfo
            {
                FileName = ffmpegPath,
                Arguments = "-hide_banner -encoders 2>&1",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            var output = proc!.StandardOutput.ReadToEnd();
            proc.WaitForExit(5000);
            return (output.Contains("h264_nvenc"), false, output.Contains("hevc_nvenc"));
        }
        catch
        {
            return (false, false, false);
        }
    }

    private static double ExtractFps(string line)
    {
        var m = Regex.Match(line, @"fps=\s*([\d.]+)");
        return m.Success && double.TryParse(
            m.Groups[1].Value,
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var fps) ? fps : 0;
    }

    private static string ExtractSpeed(string line)
    {
        var m = Regex.Match(line, @"speed=\s*([\d.]+)x");
        return m.Success ? $"{m.Groups[1].Value}x" : "";
    }

    private static double ParseDouble(string s)
    {
        if (double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
            return v;
        // Fallback: try with comma as decimal separator
        if (double.TryParse(s, NumberStyles.Float, new CultureInfo("vi-VN"), out v))
            return v;
        return 0;
    }

    [GeneratedRegex(@"time=(\d+):(\d+):(\d+\.?\d*)")]
    private static partial Regex TimeRegex();
}
