namespace HyperClip.Core.Models;

public class RenderConfig
{
    public string ExportResolution { get; set; } = string.Empty;
    public int Fps { get; set; }
    public double Speed { get; set; }
    public string Codec { get; set; } = string.Empty;
    public string? Preset { get; set; }
    public string? Tune { get; set; }
    public string? BackgroundType { get; set; }
    public string? AudioCodec { get; set; }
    public string? AudioBitrate { get; set; }
    public double? TrimStart { get; set; }
    public double? TrimEnd { get; set; }
    public bool? IsShort { get; set; }
    public int? VidHeightPct { get; set; }
    public string? GpuTier { get; set; }
}

public class SourceInfo
{
    public string? OriginalResolution { get; set; }
    public double? OriginalDuration { get; set; }
    public long? OriginalFileSize { get; set; }
    public string? DownloadQuality { get; set; }
}
