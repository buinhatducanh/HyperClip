using HyperClip.Core.Interfaces;

namespace HyperClip.Services.Activity;

public class ActivityService : IActivityService
{
    public event EventHandler<ActivityEvent>? ActivityAdded;

    private readonly List<ActivityEvent> _entries = [];
    private readonly object _lock = new();
    private const int MaxEntries = 100;

    public void AddEntry(string message, string type = "info")
    {
        var entry = new ActivityEvent(message, type);
        lock (_lock)
        {
            _entries.Insert(0, entry);
            while (_entries.Count > MaxEntries)
                _entries.RemoveAt(_entries.Count - 1);
        }
        ActivityAdded?.Invoke(this, entry);
    }

    public void Clear()
    {
        lock (_lock) { _entries.Clear(); }
    }
}
