using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public interface IGpuMonitor
{
    Task<SystemStats> GetStatsAsync(CancellationToken ct = default);
    event EventHandler<SystemStats>? StatsUpdated;
    void Start(TimeSpan interval);
    void Stop();
}
