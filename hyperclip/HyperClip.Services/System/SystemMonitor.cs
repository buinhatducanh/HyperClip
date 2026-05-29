using System.Diagnostics;
using System.Globalization;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.System;

public class SystemMonitor : ISystemMonitor
{
    private readonly GpuMonitor _gpuMonitor;
    private Timer? _timer;
    private bool _running;
    private SystemStats _lastStats = new();

    public bool IsRunning => _running;

    public SystemMonitor(GpuMonitor gpuMonitor)
    {
        _gpuMonitor = gpuMonitor;
    }

    public async Task<SystemStats> GetStatsAsync(CancellationToken ct = default)
    {
        return _running ? _lastStats : await CollectStatsAsync(ct);
    }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _gpuMonitor.Start();
        _timer = new Timer(async _ => await PollAsync(), null, 0, 5000);
    }

    public void Stop()
    {
        _running = false;
        _timer?.Dispose();
        _timer = null;
        _gpuMonitor.Stop();
    }

    private async Task PollAsync()
    {
        if (!_running) return;
        _lastStats = await CollectStatsAsync();
    }

    private async Task<SystemStats> CollectStatsAsync(CancellationToken ct = default)
    {
        var stats = new SystemStats
        {
            CpuCores = Environment.ProcessorCount,
            CpuName = Environment.MachineName,
            IsOnline = true,
        };

        // CPU usage
        try
        {
            using var cpuCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total");
            _ = cpuCounter.NextValue(); // first call always returns 0
            await Task.Delay(100, ct); // need brief delay for accurate reading
            stats.CpuUsage = Math.Round(cpuCounter.NextValue(), 1);
        }
        catch { stats.CpuUsage = 0; }

        // RAM + GPU via GpuMonitor
        try
        {
            var gpuStats = await _gpuMonitor.GetStatsAsync(ct);
            stats.RamTotal = gpuStats.RamTotal;
            stats.RamUsed = gpuStats.RamUsed;
            stats.RamFree = gpuStats.RamFree;
            stats.GpuName = gpuStats.GpuName;
            stats.GpuUsage = gpuStats.GpuUsage;
            stats.GpuTemp = gpuStats.GpuTemp;
            stats.GpuMemoryTotal = gpuStats.GpuMemoryTotal;
            stats.GpuMemoryFree = gpuStats.GpuMemoryFree;
        }
        catch { }

        return stats;
    }

    public void Dispose()
    {
        Stop();
    }
}
