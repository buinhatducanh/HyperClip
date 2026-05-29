namespace HyperClip.Core.Models;

public class AppSettings
{
    public string OutputFolder { get; set; } = string.Empty;
    public string VideoStoragePath { get; set; } = string.Empty;
    public string OutputPath { get; set; } = string.Empty;
    public int? DefaultTrimLimit { get; set; }
    public int DefaultQuality { get; set; } = 720;
    public bool AutoDownloadEnabled { get; set; }
    public bool PollingEnabled { get; set; }
    public bool AutoRender { get; set; }
    public string AutoRenderResolution { get; set; } = "720p";
    public int AutoRenderFps { get; set; } = 30;
    public int AutoSplitParts { get; set; } = 1;
    public int AutoSplitMinutes { get; set; } = 0;
    public string AutoRenderTitleTemplate { get; set; } = string.Empty;
    public bool MinimizeToTray { get; set; }
    public string AutoDownloadQuality { get; set; } = "720";
    public int PollIntervalMs { get; set; } = 5000;
    public int DownloadsCleanupDays { get; set; }
    public int MaxConcurrentRenders { get; set; } = 2;
    public bool ProxyEnabled { get; set; }
    public string ProxyHost { get; set; } = string.Empty;
    public int ProxyPort { get; set; }
    public string ProxyUsername { get; set; } = string.Empty;
    public string ProxyPassword { get; set; } = string.Empty;
    public int MaxConcurrentDownloads { get; set; } = 1;
    public int VideoMinDurationSec { get; set; }
    public int VideoMaxDurationSec { get; set; }
    public bool? OnboardingComplete { get; set; }
    public bool QuitOnClose { get; set; } = true;
    public HardwareProfile? HardwareProfile { get; set; }
}
