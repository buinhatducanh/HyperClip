using HyperClip.Services.System;

namespace HyperClip.Tests.Services;

public class GpuMonitorTests
{
    [Fact]
    public async Task GpuMonitor_GetStats_ReturnsValidStats()
    {
        var monitor = new GpuMonitor();
        var stats = await monitor.GetStatsAsync();
        Assert.NotNull(stats);
        Assert.True(stats.CpuCores > 0);
    }

    [Fact]
    public void SystemMonitor_NotRunning_ByDefault()
    {
        var gpu = new GpuMonitor();
        var monitor = new SystemMonitor(gpu);
        Assert.False(monitor.IsRunning);
    }

    [Fact]
    public void GpuMonitor_Dispose_NoThrow()
    {
        var monitor = new GpuMonitor();
        monitor.Dispose();
    }
}
