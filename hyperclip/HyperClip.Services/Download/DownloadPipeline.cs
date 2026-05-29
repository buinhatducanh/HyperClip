using HyperClip.Core.Interfaces;
using HyperClip.Core.Enums;
using HyperClip.Core.Models;
using Microsoft.Extensions.Logging;

namespace HyperClip.Services.Download;

public class DownloadPipeline : IDisposable
{
    private readonly IYtdlpDownloader _downloader;
    private readonly IWorkspaceStore _workspaceStore;
    private readonly ILogger<DownloadPipeline> _logger;

    public DownloadPipeline(IYtdlpDownloader downloader, IWorkspaceStore workspaceStore, ILogger<DownloadPipeline> logger)
    {
        _downloader = downloader;
        _workspaceStore = workspaceStore;
        _logger = logger;
    }

    public async Task<Workspace?> StartDownloadAsync(Workspace workspace, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(workspace.VideoUrl))
        {
            _logger.LogWarning("[Pipeline] No VideoUrl for workspace {Id}", workspace.Id);
            return null;
        }

        var outputDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "HyperClip", "downloads");

        Directory.CreateDirectory(outputDir);

        await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Downloading, ct);

        var options = new YtdlpOptions
        {
            WorkspaceId = workspace.Id,
            VideoUrl = workspace.VideoUrl,
            OutputDir = outputDir,
            TrimLimitMinutes = workspace.TrimLimit ?? 0,
            Quality = workspace.DownloadQuality ?? "720",
        };

        var progress = new Progress<DownloadProgress>(p =>
        {
            _ = _workspaceStore.UpdateAsync(workspace.Id, w =>
            {
                w.DownloadProgress = p.Percent;
                w.DownloadSpeed = p.Speed;
            }, ct);
        });

        try
        {
            var result = await _downloader.DownloadAsync(options, progress, ct);

            if (result.Success && result.FilePath != null)
            {
                await _workspaceStore.UpdateAsync(workspace.Id, w =>
                {
                    w.Status = WorkspaceStatus.Ready;
                    w.DownloadedPath = Path.GetFileName(result.FilePath);
                    w.FileSize = FormatFileSize(result.FileSize);
                    w.DownloadProgress = 100;
                    w.DownloadedAt = DateTime.UtcNow.ToString("o");
                }, ct);

                var updated = await _workspaceStore.GetByIdAsync(workspace.Id, ct);
                _logger.LogInformation("[Pipeline] Download complete: {Id} → {Path}", workspace.Id, result.FilePath);
                return updated;
            }

            await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Error, ct);
            await _workspaceStore.UpdateAsync(workspace.Id, w => w.Status = WorkspaceStatus.Error, ct);
            _logger.LogError("[Pipeline] Download failed: {Id} — {Error}", workspace.Id, result.Error);
            return null;
        }
        catch (OperationCanceledException)
        {
            await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Waiting, ct);
            _logger.LogInformation("[Pipeline] Download cancelled: {Id}", workspace.Id);
            return null;
        }
        catch (Exception ex)
        {
            await _workspaceStore.UpdateStatusAsync(workspace.Id, WorkspaceStatus.Error, ct);
            _logger.LogError(ex, "[Pipeline] Download exception: {Id}", workspace.Id);
            return null;
        }
    }

    private static string FormatFileSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes}B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1}KB";
        if (bytes < 1024 * 1024 * 1024) return $"{bytes / (1024.0 * 1024):F1}MB";
        return $"{bytes / (1024.0 * 1024 * 1024):F2}GB";
    }

    public void Dispose() { }
}
