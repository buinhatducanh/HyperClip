using System.Diagnostics;
using System.IO;
using HyperClip.Core.Interfaces;

namespace HyperClip.Services.Storage;

public class StorageService : IStorageService
{
    private readonly string _videoStoragePath;
    private readonly string _outputPath;
    private readonly string _blurCachePath;

    public StorageService(string dataDir)
    {
        _videoStoragePath = Path.Combine(dataDir, "videos");
        _outputPath = Path.Combine(dataDir, "output");
        _blurCachePath = Path.Combine(dataDir, "blur");
    }

    public Task<StorageInfo> GetDiskUsageAsync(CancellationToken ct = default)
    {
        var videoBytes = GetFolderSizeSafe(_videoStoragePath);
        var outputBytes = GetFolderSizeSafe(_outputPath);
        var blurBytes = GetFolderSizeSafe(_blurCachePath);

        var drive = new DriveInfo(Path.GetPathRoot(_videoStoragePath) ?? "C:\\");
        return Task.FromResult(new StorageInfo(
            videoBytes, outputBytes, blurBytes,
            drive.AvailableFreeSpace, drive.TotalSize));
    }

    public async Task ClearDownloadsAsync(CancellationToken ct = default)
    {
        await Task.Run(() => DeleteFolderContents(_videoStoragePath), ct);
    }

    public async Task ClearBlurAsync(CancellationToken ct = default)
    {
        await Task.Run(() => DeleteFolderContents(_blurCachePath), ct);
    }

    public Task<long> GetFolderSizeAsync(string path, CancellationToken ct = default)
    {
        return Task.FromResult(GetFolderSizeSafe(path));
    }

    public string GetVideoStoragePath() => _videoStoragePath;
    public string GetOutputPath() => _outputPath;

    public void OpenFolder(string path)
    {
        if (Directory.Exists(path))
            Process.Start(new ProcessStartInfo("explorer.exe", path) { UseShellExecute = true });
    }

    private static long GetFolderSizeSafe(string path)
    {
        if (!Directory.Exists(path)) return 0;
        try
        {
            return Directory.GetFiles(path, "*", SearchOption.AllDirectories)
                .Sum(f => new FileInfo(f).Length);
        }
        catch { return 0; }
    }

    private static void DeleteFolderContents(string path)
    {
        if (!Directory.Exists(path)) return;
        foreach (var file in Directory.GetFiles(path))
        {
            try { File.Delete(file); } catch { }
        }
    }
}
