namespace HyperClip.Core.Interfaces;

public interface IEventBus
{
    void Publish<T>(T evt);
    IDisposable Subscribe<T>(Action<T> handler);
}

public record WorkspaceEvent(string WorkspaceId, string Action, object? Data = null);
public record ChannelEvent(string ChannelId, string Action, object? Data = null);
public record DownloadEvent(string WorkspaceId, string Action, double Progress = 0, string? Speed = null, string? Eta = null);
public record RenderEvent(string WorkspaceId, string Action, double Progress = 0, string? Eta = null);
public record ActivityEvent(string Message, string Type = "info", string? ChannelName = null);
public record NotificationEvent(string Title, string Message, string Type = "info", int DurationMs = 3200);
