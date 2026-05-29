using HyperClip.Core.Interfaces;
using HyperClip.Core.Enums;
using HyperClip.Core.Models;
using HyperClip.Services.Store;
using Microsoft.Extensions.Logging;

namespace HyperClip.Services.Render;

public class RenderPipeline : IDisposable
{
    private readonly IRenderEngine _engine;
    private readonly IWorkspaceStore _workspaceStore;
    private readonly IRenderedVideoStore _renderedVideoStore;
    private readonly WorkerPool _pool;
    private readonly ILogger<RenderPipeline> _logger;

    public RenderPipeline(
        IRenderEngine engine,
        IWorkspaceStore workspaceStore,
        IRenderedVideoStore renderedVideoStore,
        ILogger<RenderPipeline> logger)
    {
        _engine = engine;
        _workspaceStore = workspaceStore;
        _renderedVideoStore = renderedVideoStore;
        _logger = logger;
        _pool = new WorkerPool();
    }

    public async Task<Workspace?> StartRenderAsync(Workspace workspace, EditorState editor, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(workspace.DownloadedPath))
        {
            _logger.LogWarning("[Render] No DownloadedPath for workspace {Id}", workspace.Id);
            return null;
        }

        var downloadsDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "HyperClip", "downloads");
        var outputDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "HyperClip", "output");

        Directory.CreateDirectory(outputDir);

        var inputPath = Path.Combine(downloadsDir, workspace.DownloadedPath);
        if (!File.Exists(inputPath))
        {
            _logger.LogError("[Render] Input file not found: {Path}", inputPath);
            await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Error, ct);
            return null;
        }

        var outputPath = Path.Combine(outputDir, $"{workspace.Id}_rendered.mp4");

        await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Rendering, ct);

        var options = new RenderOptions
        {
            WorkspaceId = workspace.Id,
            InputPath = inputPath,
            OutputPath = outputPath,
            TrimStart = editor.TrimStart,
            TrimEnd = editor.TrimEnd > 0 ? editor.TrimEnd : 300,
            SpeedMultiplier = editor.SpeedMultiplier,
            CanvasWidth = 720,
            CanvasHeight = 1280,
            BackgroundColor = editor.BackgroundColor,
            Fps = editor.ExportFPS,
            Codec = editor.ExportCodec,
            Preset = editor.ExportPreset,
            Tune = editor.ExportTune,
        };

        var progress = new Progress<RenderProgress>(p =>
        {
            _ = _workspaceStore.UpdateAsync(workspace.Id, w => w.RenderProgress = p.Percent, ct);
        });

        try
        {
            var poolResult = await _pool.EnqueueAsync(workspace.Id, async ct2 =>
            {
                var renderResult = await _engine.RenderAsync(options, progress, ct2);
                return new PoolJobResult
                {
                    Success = renderResult.Success,
                    OutputFile = renderResult.OutputPath,
                    FileSize = renderResult.FileSize,
                    Error = renderResult.Error,
                };
            });

            if (poolResult.Success && !string.IsNullOrEmpty(poolResult.OutputFile))
            {
                await _workspaceStore.UpdateAsync(workspace.Id, w =>
                {
                    w.Status = WorkspaceStatus.Done;
                    w.RenderProgress = 100;
                    w.OutputPath = Path.GetFileName(poolResult.OutputFile);
                }, ct);

                var rendered = new RenderedVideo
                {
                    Id = Guid.NewGuid().ToString("N")[..12],
                    WorkspaceId = workspace.Id,
                    ChannelId = workspace.ChannelId,
                    ChannelName = workspace.ChannelName,
                    VideoTitle = workspace.VideoTitle,
                    ArchivedPath = poolResult.OutputFile,
                    OutputPath = poolResult.OutputFile,
                    Quality = (int)workspace.Quality,
                    Codec = options.Codec,
                    FileSize = FormatFileSize(poolResult.FileSize),
                    FileSizeBytes = poolResult.FileSize,
                    Duration = 0,
                    Thumbnail = workspace.Thumbnail,
                    RenderedAt = DateTime.UtcNow.ToString("o"),
                };

                await _renderedVideoStore.SaveAsync(rendered);

                var updated = await _workspaceStore.GetByIdAsync(workspace.Id, ct);
                _logger.LogInformation("[Render] Done: {Id} -> {Path}", workspace.Id, poolResult.OutputFile);
                return updated;
            }

            await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Error, ct);
            _logger.LogError("[Render] Failed: {Id} -- {Error}", workspace.Id, poolResult.Error);
            return null;
        }
        catch (OperationCanceledException)
        {
            await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Ready, ct);
            return null;
        }
        catch (Exception ex)
        {
            await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Error, ct);
            _logger.LogError(ex, "[Render] Exception: {Id}", workspace.Id);
            return null;
        }
    }

    public bool CancelRender(string workspaceId) => _pool.Cancel(workspaceId);
    public void CancelAll() => _pool.CancelAll();

    private static string FormatFileSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes}B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1}KB";
        if (bytes < 1024 * 1024 * 1024) return $"{bytes / (1024.0 * 1024):F1}MB";
        return $"{bytes / (1024.0 * 1024 * 1024):F2}GB";
    }

    public void Dispose() => _pool.Dispose();
}
