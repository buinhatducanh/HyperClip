using System.Collections.ObjectModel;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels;

public partial class ToastViewModel : ObservableObject, IDisposable
{
    private readonly Dispatcher _dispatcher;

    [ObservableProperty] private ObservableCollection<ToastNotification> _notifications = [];

    public ToastViewModel(INotificationService notificationService)
    {
        _dispatcher = Dispatcher.CurrentDispatcher;
        notificationService.NotificationRaised += (_, e) =>
        {
            var toast = new ToastNotification
            {
                Title = e.Title,
                Message = e.Message,
                Type = e.Type,
                CreatedAt = DateTime.Now,
            };
            _dispatcher.InvokeAsync(() =>
            {
                Notifications.Add(toast);
                var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(e.DurationMs) };
                timer.Tick += (_, _) =>
                {
                    Notifications.Remove(toast);
                    timer.Stop();
                };
                timer.Start();
            });
        };
    }

    public void Dispose() { }
}

public class ToastNotification
{
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public string Type { get; set; } = "info";
    public DateTime CreatedAt { get; set; }
}
