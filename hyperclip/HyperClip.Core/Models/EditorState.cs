using HyperClip.Core.Enums;

namespace HyperClip.Core.Models;

public class EditorState
{
    public CanvasBg CanvasBg { get; set; } = CanvasBg.Black;
    public double TrimStart { get; set; }
    public double TrimEnd { get; set; }
    public string? HeaderImageUrl { get; set; }
    public string? HeaderImageDiskPath { get; set; }
    public int HeaderImageOffsetY { get; set; }
    public string TitleText { get; set; } = string.Empty;
    public TitleShape TitleShape { get; set; } = TitleShape.Rounded;
    public string TitleBorderColor { get; set; } = "#FFFFFF";
    public string TitleBgColor { get; set; } = "#000000";
    public int TitleFontSize { get; set; } = 24;
    public double SpeedMultiplier { get; set; } = 1.0;
    public int ExportQuality { get; set; } = 720;
    public string ExportCodec { get; set; } = "h264";
    public int ExportFPS { get; set; } = 30;
    public string ExportPreset { get; set; } = "p1";
    public string ExportTune { get; set; } = "hq";
    public bool EnableChunked { get; set; }
    public bool UpscaleToTikTok { get; set; }
    public string BackgroundType { get; set; } = "blur";
    public string? BackgroundImageUrl { get; set; }
    public string? BackgroundImageDiskPath { get; set; }
    public string BackgroundColor { get; set; } = "#000000";
    public int VidHeightPct { get; set; } = 70;
    public bool BottomBarEnabled { get; set; }
    public string BottomBarColor { get; set; } = "#000000";
}
