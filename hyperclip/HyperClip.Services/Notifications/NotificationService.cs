using HyperClip.Core.Interfaces;

namespace HyperClip.Services.Notifications;

public class NotificationService : INotificationService
{
    public event EventHandler<NotificationEvent>? NotificationRaised;

    public void Notify(string title, string message, string type = "info", int durationMs = 3200)
    {
        NotificationRaised?.Invoke(this, new NotificationEvent(title, message, type, durationMs));
    }
}
