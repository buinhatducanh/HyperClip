using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;

namespace HyperClip.UI.ViewModels;

public partial class ActivityLogViewModel : ObservableObject
{
    public ObservableCollection<ActivityLogEntry> Entries { get; } = [];

    public void AddEntry(string message, string type = "info")
    {
        System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            Entries.Insert(0, new ActivityLogEntry
            {
                Timestamp = DateTime.Now.ToString("HH:mm:ss"),
                Message = message,
                Type = type,
            });
            while (Entries.Count > 100) Entries.RemoveAt(Entries.Count - 1);
        });
    }
}

public class ActivityLogEntry
{
    public string Timestamp { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Type { get; set; } = "info";
}
