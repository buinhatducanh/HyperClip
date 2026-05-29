using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public interface ISystemMonitor : IDisposable
{
    Task<SystemStats> GetStatsAsync(CancellationToken ct = default);
    void Start();
    void Stop();
    bool IsRunning { get; }
}
