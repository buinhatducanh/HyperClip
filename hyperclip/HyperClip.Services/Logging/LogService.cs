using System.IO;
using HyperClip.Core.Interfaces;

namespace HyperClip.Services.Logging;

public class LogService : ILogService
{
    private readonly string _logDir;

    public LogService(string dataDir)
    {
        _logDir = Path.Combine(dataDir, "logs");
    }

    public Task<string[]> ReadLogsAsync(int maxLines = 500, CancellationToken ct = default)
    {
        if (!Directory.Exists(_logDir))
            return Task.FromResult(Array.Empty<string>());

        var latestLog = Directory.GetFiles(_logDir, "*.log")
            .OrderByDescending(f => File.GetLastWriteTime(f))
            .FirstOrDefault();

        if (latestLog == null)
            return Task.FromResult(Array.Empty<string>());

        var lines = File.ReadLines(latestLog).Reverse().Take(maxLines).ToArray();
        return Task.FromResult(lines);
    }

    public async Task ExportLogsAsync(string filePath, CancellationToken ct = default)
    {
        var lines = await ReadLogsAsync(5000, ct);
        await File.WriteAllLinesAsync(filePath, lines, ct);
    }

    public Task<long> GetLogDiskUsageAsync(CancellationToken ct = default)
    {
        if (!Directory.Exists(_logDir))
            return Task.FromResult(0L);

        var size = Directory.GetFiles(_logDir, "*", SearchOption.AllDirectories)
            .Sum(f => new FileInfo(f).Length);
        return Task.FromResult(size);
    }
}
