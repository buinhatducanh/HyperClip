using System.Collections.Concurrent;
using HyperClip.Core.Interfaces;

namespace HyperClip.Services.Events;

public class EventBus : IEventBus
{
    private readonly ConcurrentDictionary<Type, List<Delegate>> _handlers = new();

    public void Publish<T>(T evt)
    {
        if (_handlers.TryGetValue(typeof(T), out var list))
        {
            foreach (var handler in list.ToArray())
            {
                ((Action<T>)handler).Invoke(evt);
            }
        }
    }

    public IDisposable Subscribe<T>(Action<T> handler)
    {
        var list = _handlers.GetOrAdd(typeof(T), _ => []);
        lock (list) { list.Add(handler); }
        return new Unsubscriber<T>(list, handler);
    }

    private sealed class Unsubscriber<T>(List<Delegate> list, Action<T> handler) : IDisposable
    {
        public void Dispose()
        {
            lock (list) { list.Remove(handler); }
        }
    }
}
