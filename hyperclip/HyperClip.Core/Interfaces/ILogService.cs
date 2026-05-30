namespace HyperClip.Core.Interfaces;

public interface ILogService
{
    Task<string[]> ReadLogsAsync(int maxLines = 500, CancellationToken ct = default);
    Task ExportLogsAsync(string filePath, CancellationToken ct = default);
    Task<long> GetLogDiskUsageAsync(CancellationToken ct = default);
}
