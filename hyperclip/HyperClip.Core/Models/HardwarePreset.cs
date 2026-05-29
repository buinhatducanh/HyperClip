namespace HyperClip.Core.Models;

public class HardwarePreset
{
    public string Id { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public int VramGB { get; set; }
    public int RamGB { get; set; }
    public int DownloadInstances { get; set; }
    public int RenderWorkers { get; set; }
    public int ChunkWorkers { get; set; }
    public int Sessions { get; set; }
    public bool Available { get; set; }
}

public class HardwareProfile
{
    public int VramGB { get; set; }
    public int RamGB { get; set; }
}
