namespace HyperClip.Core.Models;

public class WorkspaceMetrics
{
    public long? DownloadMs { get; set; }
    public double? DownloadSpeedMBs { get; set; }
    public long? DownloadFileSize { get; set; }
    public string? DownloadQuality { get; set; }
    public string? DownloadResolution { get; set; }
    public bool? DownloadIsMultiInstance { get; set; }
    public long? RenderMs { get; set; }
    public double? RenderFps { get; set; }
    public int? RenderWorkers { get; set; }
    public string? RenderPreset { get; set; }
    public string? RenderCodec { get; set; }
    public int? RenderChunks { get; set; }
    public string? RenderOutputResolution { get; set; }
    public double? SystemGpuLoad { get; set; }
    public double? SystemVramUsed { get; set; }
    public double? SystemRamUsed { get; set; }
    public string? DetectedAt { get; set; }
    public string? DownloadStartedAt { get; set; }
    public string? DownloadCompletedAt { get; set; }
    public string? RenderStartedAt { get; set; }
    public string? RenderCompletedAt { get; set; }
}
