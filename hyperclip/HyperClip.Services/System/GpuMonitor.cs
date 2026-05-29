using System.Diagnostics;
using System.Globalization;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.System;

public class GpuMonitor : IGpuMonitor, IDisposable
{
    private Timer? _timer;
    private bool _running;

    public async Task<SystemStats> GetStatsAsync(CancellationToken ct = default)
    {
        var stats = new SystemStats
        {
            CpuCores = Environment.ProcessorCount,
            CpuName = Environment.MachineName,
        };

        // RAM via PowerShell (async, never blocks UI)
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell",
                Arguments = "-Command \"Get-CimInstance Win32_OperatingSystem | ForEach-Object { '{0},{1}' -f $_.TotalVisibleMemorySize,$_.FreePhysicalMemory }\"",
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc != null)
            {
                var output = await proc.StandardOutput.ReadToEndAsync(ct);
                var parts = output.Trim().Split(',');
                if (parts.Length >= 2)
                {
                    if (double.TryParse(parts[0].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var totalKB))
                        stats.RamTotal = totalKB * 1024;
                    if (double.TryParse(parts[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var freeKB))
                    {
                        stats.RamFree = freeKB * 1024;
                        stats.RamUsed = stats.RamTotal - stats.RamFree;
                    }
                }
                await proc.WaitForExitAsync(ct);
            }
        }
        catch { }

        // GPU via nvidia-smi (async)
        try
        {
            var gpu = await GetNvidiaSmiStatsAsync(ct);
            if (gpu != null)
            {
                stats.GpuName = gpu.Value.Name;
                stats.GpuUsage = gpu.Value.Usage;
                stats.GpuTemp = gpu.Value.Temp;
                stats.GpuMemoryTotal = gpu.Value.MemoryTotal;
                stats.GpuMemoryFree = gpu.Value.MemoryFree;
            }
        }
        catch { }

        return stats;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;
    }

    public void Stop()
    {
        _running = false;
        _timer?.Dispose();
        _timer = null;
    }

    private static async Task<(string Name, double Usage, double Temp, double MemoryTotal, double MemoryFree)?>
        GetNvidiaSmiStatsAsync(CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "nvidia-smi",
            Arguments = "--query-gpu=name,utilization.gpu,temperature.gpu,memory.total,memory.free --format=csv,noheader,nounits",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = Process.Start(psi);
        if (proc == null) return null;

        var output = await proc.StandardOutput.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);

        if (proc.ExitCode != 0) return null;

        var line = output.Trim().Split('\n').FirstOrDefault()?.Trim();
        if (string.IsNullOrEmpty(line)) return null;

        var parts = line.Split(',').Select(p => p.Trim()).ToArray();
        if (parts.Length < 5) return null;

        if (!double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var usage)) usage = 0;
        if (!double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var temp)) temp = 0;
        if (!double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var memTotal)) memTotal = 0;
        if (!double.TryParse(parts[4], NumberStyles.Float, CultureInfo.InvariantCulture, out var memFree)) memFree = 0;

        return (parts[0], usage, temp, memTotal * 1024 * 1024, memFree * 1024 * 1024);
    }

    public void Dispose() { Stop(); }
}
