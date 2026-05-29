using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Models;
using HyperClip.Core.Enums;
using TitleShapeEnum = HyperClip.Core.Enums.TitleShape;
using HyperClip.Services.Render;

namespace HyperClip.UI.ViewModels;

public partial class DetailEditorViewModel : ObservableObject
{
    private readonly RenderPipeline _renderPipeline;

    [ObservableProperty] private Workspace? _workspace;
    [ObservableProperty] private EditorState _editor = new();

    [ObservableProperty] private double _trimStart;
    [ObservableProperty] private double _trimEnd = 300;
    [ObservableProperty] private double _speedMultiplier = 1.0;
    [ObservableProperty] private string _backgroundColor = "#000000";
    [ObservableProperty] private string _titleText = "";
    [ObservableProperty] private int _titleFontSize = 24;
    [ObservableProperty] private string _titleShape = "rounded";
    [ObservableProperty] private int _exportFps = 30;
    [ObservableProperty] private string _exportCodec = "h264";
    [ObservableProperty] private string _exportPreset = "p1";
    [ObservableProperty] private string _exportTune = "hq";
    [ObservableProperty] private bool _isRendering;

    public DetailEditorViewModel(RenderPipeline renderPipeline)
    {
        _renderPipeline = renderPipeline;
    }

    public void LoadWorkspace(Workspace ws)
    {
        Workspace = ws;
        TrimStart = 0;
        TrimEnd = ws.TrimLimit ?? 300;
        SpeedMultiplier = 1.0;
        BackgroundColor = "#000000";
        TitleText = ws.VideoTitle;
        TitleFontSize = 24;
        ExportFps = 30;
        ExportCodec = "h264";
        ExportPreset = "p1";
        ExportTune = "hq";
        IsRendering = ws.Status == WorkspaceStatus.Rendering;
    }

    [RelayCommand]
    private async Task StartRenderAsync()
    {
        if (Workspace == null) return;

        Editor = new EditorState
        {
            TrimStart = TrimStart,
            TrimEnd = TrimEnd,
            SpeedMultiplier = SpeedMultiplier,
            BackgroundColor = BackgroundColor,
            TitleText = TitleText,
            TitleFontSize = TitleFontSize,
            TitleShape = Enum.TryParse<TitleShapeEnum>(TitleShape, true, out var shape) ? shape : TitleShapeEnum.Rounded,
            ExportFPS = ExportFps,
            ExportCodec = ExportCodec,
            ExportPreset = ExportPreset,
            ExportTune = ExportTune,
        };

        IsRendering = true;
        try
        {
            await _renderPipeline.StartRenderAsync(Workspace, Editor);
        }
        finally
        {
            IsRendering = false;
        }
    }

    [RelayCommand]
    private void CancelRender()
    {
        if (Workspace != null) _renderPipeline.CancelRender(Workspace.Id);
    }

    [RelayCommand]
    private void SetBackgroundColor(string color)
    {
        BackgroundColor = color;
    }

    partial void OnTrimStartChanged(double value) => Editor.TrimStart = value;
    partial void OnTrimEndChanged(double value) => Editor.TrimEnd = value;
    partial void OnSpeedMultiplierChanged(double value) => Editor.SpeedMultiplier = value;
    partial void OnBackgroundColorChanged(string value) => Editor.BackgroundColor = value;
}
