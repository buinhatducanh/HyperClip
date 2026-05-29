namespace HyperClip.Core.Models;

public class SystemStats
{
    public double RamUsed { get; set; }
    public double RamTotal { get; set; }
    public double RamFree { get; set; }
    public double RamDiskUsed { get; set; }
    public double RamDiskTotal { get; set; }
    public double RamDiskAvailable { get; set; }
    public bool RamDiskIsAvailable { get; set; }
    public double CpuUsage { get; set; }
    public int CpuCores { get; set; }
    public string CpuName { get; set; } = string.Empty;
    public double GpuUsage { get; set; }
    public double GpuTemp { get; set; }
    public string GpuName { get; set; } = string.Empty;
    public string GpuEncoder { get; set; } = string.Empty;
    public double GpuMemoryTotal { get; set; }
    public double GpuMemoryFree { get; set; }
    public string GpuTier { get; set; } = string.Empty;
    public int MaxChunkWorkers { get; set; }
    public string NetworkIp { get; set; } = string.Empty;
    public bool IsOnline { get; set; }
    public int ActiveWorkers { get; set; }
}
