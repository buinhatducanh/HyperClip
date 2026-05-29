using HyperClip.Services.Render;

namespace HyperClip.Tests.Services;

public class WorkerPoolTests
{
    [Fact]
    public void WorkerPool_DefaultMaxWorkers_IsTwo()
    {
        var pool = new WorkerPool();
        Assert.Equal(2, pool.MaxWorkers);
    }

    [Fact]
    public void WorkerPool_CustomMaxWorkers_Respected()
    {
        var pool = new WorkerPool(maxWorkers: 4);
        Assert.Equal(4, pool.MaxWorkers);
    }

    [Fact]
    public async Task WorkerPool_Enqueue_RunsJob()
    {
        var pool = new WorkerPool(maxWorkers: 1);
        var result = await pool.EnqueueAsync("job-1", async _ =>
        {
            await Task.Delay(10);
            return new PoolJobResult { Success = true };
        });
        Assert.True(result.Success);
    }

    [Fact]
    public async Task WorkerPool_Cancel_RemovesJob()
    {
        using var pool = new WorkerPool(maxWorkers: 1);
        var jobId = "cancel-job";

        var task = pool.EnqueueAsync(jobId, async (ct) =>
        {
            await Task.Delay(10000, ct);
            return new PoolJobResult { Success = true };
        });

        await Task.Delay(20);
        pool.Cancel(jobId);

        var result = await task;
        Assert.False(result.Success);
    }

    [Fact]
    public void WorkerPool_Status_TracksActiveAndQueued()
    {
        var pool = new WorkerPool(maxWorkers: 1);
        var status = pool.Status;
        Assert.Equal(0, status.Active);
        Assert.Equal(0, status.Queued);
    }

    [Fact]
    public async Task WorkerPool_CancelAll_ClearsQueue()
    {
        using var pool = new WorkerPool(maxWorkers: 1);

        var task1 = pool.EnqueueAsync("job-1", async ct => { await Task.Delay(10000, ct); return new PoolJobResult { Success = true }; });
        var task2 = pool.EnqueueAsync("job-2", async ct => { await Task.Delay(10000, ct); return new PoolJobResult { Success = true }; });

        await Task.Delay(10);
        pool.CancelAll();

        var r1 = await task1;
        var r2 = await task2;
        Assert.False(r1.Success);
        Assert.False(r2.Success);
    }

    [Fact]
    public async Task WorkerPool_Enqueue_JobFailure_ReturnsError()
    {
        using var pool = new WorkerPool(maxWorkers: 2);
        var result = await pool.EnqueueAsync("fail-job", async _ =>
        {
            throw new InvalidOperationException("test error");
        });
        Assert.False(result.Success);
        Assert.Contains("test error", result.Error);
    }
}
