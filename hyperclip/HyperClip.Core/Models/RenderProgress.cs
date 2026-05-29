namespace HyperClip.Core.Models;

public class RenderProgress
{
    public string WorkspaceId { get; set; } = string.Empty;
    public double Percent { get; set; }
    public string CurrentTime { get; set; } = string.Empty;
    public string TotalTime { get; set; } = string.Empty;
    public double Fps { get; set; }
    public string Speed { get; set; } = string.Empty;
    public int EtaSeconds { get; set; }
}
