namespace HyperClip.Services.Render;

public class PoolJobResult
{
    public bool Success { get; set; }
    public string? OutputFile { get; set; }
    public long FileSize { get; set; }
    public string? Error { get; set; }
}

public class PoolStatus
{
    public int Active { get; set; }
    public int Queued { get; set; }
}

public class WorkerPool : IDisposable
{
    private readonly int _maxWorkers;
    private readonly Dictionary<string, CancellationTokenSource> _active = new();
    private readonly Queue<(string JobId, Func<CancellationToken, Task<PoolJobResult>> Fn, TaskCompletionSource<PoolJobResult> Resolve)> _queue = new();
    private readonly object _lock = new();
    private bool _disposed;

    public WorkerPool(int maxWorkers = 2) => _maxWorkers = maxWorkers;
    public int MaxWorkers => _maxWorkers;

    public PoolStatus Status
    {
        get
        {
            lock (_lock) { return new PoolStatus { Active = _active.Count, Queued = _queue.Count }; }
        }
    }

    public async Task<PoolJobResult> EnqueueAsync(string jobId, Func<CancellationToken, Task<PoolJobResult>> fn)
    {
        var tcs = new TaskCompletionSource<PoolJobResult>();
        bool disposed;
        lock (_lock)
        {
            disposed = _disposed;
            if (_disposed)
            {
                tcs.SetResult(new PoolJobResult { Success = false, Error = "Pool disposed" });
            }
            else if (_active.Count < _maxWorkers)
            {
                _ = RunAsync(jobId, fn, tcs);
            }
            else
            {
                _queue.Enqueue((jobId, fn, tcs));
            }
        }
        return await tcs.Task;
    }

    public bool Cancel(string jobId)
    {
        lock (_lock)
        {
            if (_active.TryGetValue(jobId, out var cts))
            {
                cts.Cancel();
                _active.Remove(jobId);
                Drain();
                return true;
            }

            var items = _queue.ToArray();
            for (int i = 0; i < items.Length; i++)
            {
                if (items[i].JobId == jobId)
                {
                    var newQueue = new Queue<(string, Func<CancellationToken, Task<PoolJobResult>>, TaskCompletionSource<PoolJobResult>)>();
                    for (int j = 0; j < items.Length; j++)
                    {
                        if (j == i) items[j].Resolve.SetResult(new PoolJobResult { Success = false, Error = "Cancelled from queue" });
                        else newQueue.Enqueue(items[j]);
                    }
                    _queue.Clear();
                    foreach (var item in newQueue) _queue.Enqueue(item);
                    return true;
                }
            }
        }
        return false;
    }

    public void CancelAll()
    {
        lock (_lock)
        {
            foreach (var cts in _active.Values) cts.Cancel();
            _active.Clear();
            while (_queue.Count > 0)
            {
                var (_, _, tcs) = _queue.Dequeue();
                tcs.SetResult(new PoolJobResult { Success = false, Error = "Pool shutdown" });
            }
        }
    }

    private async Task RunAsync(string jobId, Func<CancellationToken, Task<PoolJobResult>> fn, TaskCompletionSource<PoolJobResult> outer)
    {
        var cts = new CancellationTokenSource();
        lock (_lock) { _active[jobId] = cts; }
        try
        {
            var result = await fn(cts.Token);
            outer.SetResult(result);
        }
        catch (OperationCanceledException)
        {
            outer.SetResult(new PoolJobResult { Success = false, Error = "Cancelled" });
        }
        catch (Exception ex)
        {
            outer.SetResult(new PoolJobResult { Success = false, Error = ex.Message });
        }
        finally
        {
            lock (_lock)
            {
                _active.Remove(jobId);
                Drain();
            }
        }
    }

    private void Drain()
    {
        while (_queue.Count > 0 && _active.Count < _maxWorkers)
        {
            var (jobId, fn, tcs) = _queue.Dequeue();
            _ = RunAsync(jobId, fn, tcs);
        }
    }

    public void Dispose() { CancelAll(); lock (_lock) _disposed = true; }
}
