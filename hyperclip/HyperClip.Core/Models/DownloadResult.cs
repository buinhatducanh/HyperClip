namespace HyperClip.Core.Models;

public class DownloadResult
{
    public bool Success { get; set; }
    public string WorkspaceId { get; set; } = string.Empty;
    public string? FilePath { get; set; }
    public string? Thumbnail { get; set; }
    public int Duration { get; set; }
    public long FileSize { get; set; }
    public string? Error { get; set; }
}
