using System.IO;
using System.Diagnostics;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;
using HyperClip.Services.Render;
using HyperClip.Services.Download;

namespace HyperClip.Services.Diagnostics;

public class DiagnosticsService : IDiagnosticsService
{
    private readonly FfmpegPathResolver _ffmpegPath;
    private readonly YtdlpPathResolver _ytdlpPath;
    private readonly IChannelStore _channelStore;

    public DiagnosticsService(
        FfmpegPathResolver ffmpegPath,
        YtdlpPathResolver ytdlpPath,
        IChannelStore channelStore)
    {
        _ffmpegPath = ffmpegPath;
        _ytdlpPath = ytdlpPath;
        _channelStore = channelStore;
    }

    public async Task<DiagnosticResult> RunDiagnosticsAsync(CancellationToken ct = default)
    {
        var issues = new List<DiagnosticIssue>();

        // FFmpeg
        var ffmpeg = _ffmpegPath.GetFfmpegPath();
        if (string.IsNullOrEmpty(ffmpeg) || !File.Exists(ffmpeg))
            issues.Add(new("FFmpeg", "critical", "FFmpeg not found", "Install FFmpeg or check PATH"));

        // yt-dlp
        var ytdlp = _ytdlpPath.GetYtdlpPath();
        if (string.IsNullOrEmpty(ytdlp) || !File.Exists(ytdlp))
            issues.Add(new("yt-dlp", "critical", "yt-dlp not found", "Install yt-dlp via pip or scoop"));

        // GPU
        try
        {
            var psi = new ProcessStartInfo("nvidia-smi", "--query-gpu=name --format=csv,noheader")
            {
                RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true
            };
            var proc = Process.Start(psi);
            if (proc != null)
            {
                var name = await proc.StandardOutput.ReadToEndAsync(ct);
                if (string.IsNullOrWhiteSpace(name))
                    issues.Add(new("GPU", "warning", "No NVIDIA GPU detected", "NVENC encoding will not be available"));
                await proc.WaitForExitAsync(ct);
            }
        }
        catch
        {
            issues.Add(new("GPU", "warning", "nvidia-smi not available", "GPU detection failed"));
        }

        // Disk space
        var drive = new DriveInfo(Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)) ?? "C:\\");
        if (drive.AvailableFreeSpace < 5L * 1024 * 1024 * 1024)
            issues.Add(new("Disk", "critical", $"Low disk space: {drive.AvailableFreeSpace / (1024 * 1024 * 1024)}GB free", "Free up disk space for downloads and renders"));

        // Channels
        var channels = await _channelStore.GetAllAsync(ct);
        if (channels.Length == 0)
            issues.Add(new("Channels", "warning", "No channels configured", "Add YouTube channels to start detection"));

        return new DiagnosticResult(
            IsHealthy: issues.All(i => i.Severity != "critical"),
            Issues: issues,
            RunAt: DateTime.UtcNow);
    }
}
