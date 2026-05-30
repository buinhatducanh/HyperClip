using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Enums;
using HyperClip.Core.Models;

namespace HyperClip.UI.ViewModels;

public partial class DetailEditorViewModel : ObservableObject
{
    [ObservableProperty] private Workspace? _workspace;
    [ObservableProperty] private EditorState _editor = new();
    [ObservableProperty] private bool _isRendering;
    [ObservableProperty] private bool _isLoading;

    [ObservableProperty] private double _trimStart;
    [ObservableProperty] private double _trimEnd = 300;
    [ObservableProperty] private double _speedMultiplier = 1.0;
    [ObservableProperty] private string _titleText = "";
    [ObservableProperty] private string _titleShape = "Rounded";
    [ObservableProperty] private string _titleBorderColor = "#FFFFFF";
    [ObservableProperty] private string _titleBgColor = "#000000";
    [ObservableProperty] private int _titleFontSize = 24;
    [ObservableProperty] private string _backgroundColor = "#000000";
    [ObservableProperty] private string _backgroundType = "blur";
    [ObservableProperty] private int _exportFps = 30;
    [ObservableProperty] private string _exportCodec = "h264";
    [ObservableProperty] private string _exportPreset = "p1";
    [ObservableProperty] private string _exportTune = "hq";
    [ObservableProperty] private bool _exportUpscaleToTikTok;
    [ObservableProperty] private bool _enableChunked;
    [ObservableProperty] private int _exportQuality = 720;
    [ObservableProperty] private int _maxChunkWorkers = 4;
    [ObservableProperty] private int _videoHeightPct = 70;
    [ObservableProperty] private string _headerImagePath = "";
    [ObservableProperty] private int _headerPositionY;
    [ObservableProperty] private int _splitCount = 1;
    [ObservableProperty] private int _audioVolume = 100;
    [ObservableProperty] private bool _audioMute;
    [ObservableProperty] private string _titleSubtitleText = "";
    [ObservableProperty] private bool _bottomBarEnabled = true;
    [ObservableProperty] private string _bottomBarColor = "#3B82F6";
    [ObservableProperty] private bool _isShort;

    public bool HasWorkspace => Workspace != null;

    partial void OnTrimStartChanged(double value) { if (Workspace != null) Workspace.Editor.TrimStart = value; }
    partial void OnTrimEndChanged(double value) { if (Workspace != null) Workspace.Editor.TrimEnd = value; }
    partial void OnSpeedMultiplierChanged(double value) { if (Workspace != null) Workspace.Editor.SpeedMultiplier = value; }
    partial void OnBackgroundColorChanged(string value) { if (Workspace != null) Workspace.Editor.BackgroundColor = value; }

    [RelayCommand]
    private void SetSpeed(string speed)
    {
        if (double.TryParse(speed, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out var val))
            SpeedMultiplier = val;
    }

    [RelayCommand]
    private void SetQuality(string quality)
    {
        if (int.TryParse(quality, out var val))
            ExportQuality = val;
    }

    [RelayCommand]
    private void SetBackgroundType(string type)
    {
        BackgroundType = type;
        if (Workspace != null) Workspace.Editor.BackgroundType = type;
    }

    [RelayCommand]
    private void ToggleChunked()
    {
        EnableChunked = !EnableChunked;
        if (Workspace != null) Workspace.Editor.EnableChunked = EnableChunked;
    }

    [RelayCommand]
    private void SetTitleShape(string shape)
    {
        TitleShape = shape;
        if (Workspace != null && Enum.TryParse<TitleShape>(shape, true, out var s))
            Workspace.Editor.TitleShape = s;
    }

    [RelayCommand]
    private void ToggleBottomBar()
    {
        BottomBarEnabled = !BottomBarEnabled;
        if (Workspace != null) Workspace.Editor.BottomBarEnabled = BottomBarEnabled;
    }

    [RelayCommand]
    private void SetVolume(int volume)
    {
        AudioVolume = Math.Clamp(volume, 0, 100);
        if (Workspace != null) Workspace.Editor.AudioVolume = AudioVolume;
    }

    [RelayCommand]
    private void ToggleMute()
    {
        AudioMute = !AudioMute;
        if (Workspace != null) Workspace.Editor.AudioMute = AudioMute;
    }

    [RelayCommand]
    private void RegenerateBlur()
    {
        BackgroundType = "blur";
        if (Workspace != null) Workspace.Editor.BackgroundType = "blur";
    }

    [RelayCommand]
    private void Reset()
    {
        TrimStart = 0;
        TrimEnd = Workspace?.TrimLimit ?? 300;
        SpeedMultiplier = 1.0;
        BackgroundColor = "#000000";
        BackgroundType = "blur";
        TitleText = Workspace?.VideoTitle ?? "";
        TitleFontSize = 24;
        TitleShape = "Rounded";
        TitleBorderColor = "#FFFFFF";
        TitleBgColor = "#000000";
        TitleSubtitleText = "";
        BottomBarEnabled = true;
        BottomBarColor = "#3B82F6";
        ExportFps = 30;
        ExportCodec = "h264";
        ExportPreset = "p1";
        ExportQuality = 720;
        EnableChunked = false;
        AudioVolume = 100;
        AudioMute = false;
        SplitCount = 1;
        HeaderImagePath = "";
        HeaderPositionY = 0;
        VideoHeightPct = 70;
    }

    public void LoadWorkspace(Workspace ws)
    {
        Workspace = ws;
        var e = ws.Editor;
        TrimStart = e.TrimStart;
        TrimEnd = e.TrimEnd > 0 ? e.TrimEnd : (ws.TrimLimit ?? 300);
        SpeedMultiplier = e.SpeedMultiplier > 0 ? e.SpeedMultiplier : 1.0;
        TitleText = e.TitleText ?? ws.VideoTitle ?? "";
        TitleShape = e.TitleShape.ToString();
        TitleBorderColor = e.TitleBorderColor ?? "#FFFFFF";
        TitleBgColor = e.TitleBgColor ?? "#000000";
        TitleFontSize = e.TitleFontSize > 0 ? e.TitleFontSize : 24;
        BackgroundColor = e.BackgroundColor ?? "#000000";
        BackgroundType = e.BackgroundType ?? "blur";
        ExportFps = e.ExportFPS > 0 ? e.ExportFPS : 30;
        ExportCodec = e.ExportCodec ?? "h264";
        ExportPreset = e.ExportPreset ?? "p1";
        ExportTune = e.ExportTune ?? "hq";
        EnableChunked = e.EnableChunked;
        ExportUpscaleToTikTok = e.UpscaleToTikTok;
        ExportQuality = e.ExportQuality > 0 ? e.ExportQuality : 720;
        VideoHeightPct = e.VidHeightPct > 0 ? e.VidHeightPct : 70;
        HeaderImagePath = e.HeaderImageDiskPath ?? "";
        HeaderPositionY = e.HeaderImageOffsetY;
        BottomBarEnabled = e.BottomBarEnabled;
        BottomBarColor = e.BottomBarColor ?? "#3B82F6";
        TitleSubtitleText = e.TitleSubtitleText ?? "";
        AudioVolume = e.AudioVolume > 0 ? e.AudioVolume : 100;
        AudioMute = e.AudioMute;
        SplitCount = e.SplitCount > 0 ? e.SplitCount : 1;
        IsShort = ws.IsShort ?? false;
        IsRendering = ws.Status == WorkspaceStatus.Rendering;
        OnPropertyChanged(nameof(HasWorkspace));
    }

    [RelayCommand]
    private async Task StartRenderAsync()
    {
        if (Workspace == null) return;
        IsRendering = true;
        var e = Workspace.Editor;
        e.TrimStart = TrimStart;
        e.TrimEnd = TrimEnd;
        e.SpeedMultiplier = SpeedMultiplier;
        e.BackgroundColor = BackgroundColor;
        e.BackgroundType = BackgroundType;
        e.TitleText = TitleText;
        e.TitleSubtitleText = TitleSubtitleText;
        e.TitleFontSize = TitleFontSize;
        if (Enum.TryParse<TitleShape>(TitleShape, true, out var s)) e.TitleShape = s;
        e.TitleBorderColor = TitleBorderColor;
        e.TitleBgColor = TitleBgColor;
        e.BottomBarEnabled = BottomBarEnabled;
        e.BottomBarColor = BottomBarColor;
        e.ExportFPS = ExportFps;
        e.ExportCodec = ExportCodec;
        e.ExportPreset = ExportPreset;
        e.ExportTune = ExportTune;
        e.ExportQuality = ExportQuality;
        e.EnableChunked = EnableChunked;
        e.UpscaleToTikTok = ExportUpscaleToTikTok;
        e.AudioVolume = AudioMute ? 0 : AudioVolume;
        e.AudioMute = AudioMute;
        e.SplitCount = SplitCount;
        e.HeaderImageDiskPath = HeaderImagePath;
        e.HeaderImageOffsetY = HeaderPositionY;
        e.VidHeightPct = VideoHeightPct;
        await Task.CompletedTask;
        IsRendering = false;
    }

    [RelayCommand]
    private void CancelRender()
    {
        IsRendering = false;
    }
}
