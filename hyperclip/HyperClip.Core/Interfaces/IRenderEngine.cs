using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public class RenderOptions
{
    public string WorkspaceId { get; set; } = string.Empty;
    public string InputPath { get; set; } = string.Empty;
    public string OutputPath { get; set; } = string.Empty;
    public double TrimStart { get; set; }
    public double TrimEnd { get; set; }
    public double SpeedMultiplier { get; set; } = 1.0;
    public int CanvasWidth { get; set; } = 720;
    public int CanvasHeight { get; set; } = 1280;
    public string BackgroundColor { get; set; } = "#000000";
    public string? BackgroundImagePath { get; set; }
    public int HeaderImageOffsetY { get; set; }
    public string TitleText { get; set; } = string.Empty;
    public int TitleFontSize { get; set; } = 24;
    public string TitleShape { get; set; } = "rounded";
    public string TitleBorderColor { get; set; } = "#FFFFFF";
    public string TitleBgColor { get; set; } = "#000000";
    public int Fps { get; set; } = 30;
    public string Codec { get; set; } = "h264";
    public string Preset { get; set; } = "p1";
    public string Tune { get; set; } = "hq";
    public int BitrateCap { get; set; } = 6_000_000;
}

public interface IRenderEngine
{
    Task<RenderResult> RenderAsync(RenderOptions options, IProgress<RenderProgress>? progress = null, CancellationToken ct = default);
    Task<bool> CancelAsync(string workspaceId);
    bool HasNvenc { get; }
    bool HasCudaFilters { get; }
}
