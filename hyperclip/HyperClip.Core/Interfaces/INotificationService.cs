namespace HyperClip.Core.Interfaces;

public interface INotificationService
{
    void Notify(string title, string message, string type = "info", int durationMs = 3200);
    event EventHandler<NotificationEvent>? NotificationRaised;
}

public record AppNotification(
    string Id,
    string Title,
    string Message,
    string Type,
    DateTime CreatedAt,
    bool IsRead = false
);
