namespace HyperClip.Core.Models;

public class DownloadProgress
{
    public string WorkspaceId { get; set; } = string.Empty;
    public double Percent { get; set; }
    public string Speed { get; set; } = string.Empty;
    public int EtaSeconds { get; set; }
    public long DownloadedBytes { get; set; }
    public long TotalBytes { get; set; }
}
