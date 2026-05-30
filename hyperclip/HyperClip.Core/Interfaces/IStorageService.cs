namespace HyperClip.Core.Interfaces;

public interface IStorageService
{
    Task<StorageInfo> GetDiskUsageAsync(CancellationToken ct = default);
    Task ClearDownloadsAsync(CancellationToken ct = default);
    Task ClearBlurAsync(CancellationToken ct = default);
    Task<long> GetFolderSizeAsync(string path, CancellationToken ct = default);
    string GetVideoStoragePath();
    string GetOutputPath();
    void OpenFolder(string path);
}

public record StorageInfo(
    long VideoStorageBytes,
    long OutputBytes,
    long BlurCacheBytes,
    long FreeBytes,
    long TotalBytes
);
