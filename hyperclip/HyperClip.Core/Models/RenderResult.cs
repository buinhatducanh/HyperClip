namespace HyperClip.Core.Models;

public class RenderResult
{
    public bool Success { get; set; }
    public string WorkspaceId { get; set; } = string.Empty;
    public string? OutputPath { get; set; }
    public long FileSize { get; set; }
    public int Duration { get; set; }
    public string? Error { get; set; }
}
