using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public class YtdlpOptions
{
    public string WorkspaceId { get; set; } = string.Empty;
    public string VideoUrl { get; set; } = string.Empty;
    public string OutputDir { get; set; } = string.Empty;
    public int TrimLimitMinutes { get; set; }
    public string Quality { get; set; } = "720";
    public string? CookiesFile { get; set; }
    public string? PlayerClient { get; set; }
}

public interface IYtdlpDownloader
{
    Task<DownloadResult> DownloadAsync(YtdlpOptions options, IProgress<DownloadProgress>? progress = null, CancellationToken ct = default);
    Task<VideoProbeResult?> ProbeAvailabilityAsync(string videoUrl, string? cookiesFile = null, CancellationToken ct = default);
    Task<string?> GetVideoDurationAsync(string videoUrl, CancellationToken ct = default);
    string GetYtdlpPath();
}

public class VideoProbeResult
{
    public bool Available { get; set; }
    public bool IsPrivate { get; set; }
    public bool IsNotFound { get; set; }
    public bool IsRateLimited { get; set; }
    public string Title { get; set; } = string.Empty;
    public int Duration { get; set; }
    public string? Error { get; set; }
}
