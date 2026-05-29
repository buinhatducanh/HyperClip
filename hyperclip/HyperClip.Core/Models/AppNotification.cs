namespace HyperClip.Core.Models;

public class AppNotification
{
    public string Id { get; set; } = string.Empty;
    public string Type { get; set; } = "info";
    public string Message { get; set; } = string.Empty;
    public long Timestamp { get; set; }
    public bool Read { get; set; }
}
