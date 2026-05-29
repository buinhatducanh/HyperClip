using System.Text.Json;
using System.Text.Json.Serialization;
using HyperClip.Core.Models;

namespace HyperClip.Services.Store;

public interface IRenderedVideoStore
{
    Task<RenderedVideo[]> GetAllAsync(CancellationToken ct = default);
    Task SaveAsync(RenderedVideo video, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
}

public class JsonRenderedVideoStore : IRenderedVideoStore
{
    private readonly string _filePath;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    public JsonRenderedVideoStore(string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        _filePath = Path.Combine(dataDir, "rendered_videos.json");
    }

    public async Task<RenderedVideo[]> GetAllAsync(CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return [];
            var json = await File.ReadAllTextAsync(_filePath, ct);
            return JsonSerializer.Deserialize<RenderedVideo[]>(json, JsonOptions) ?? [];
        }
        finally { _lock.Release(); }
    }

    public async Task SaveAsync(RenderedVideo video, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var all = File.Exists(_filePath)
                ? (JsonSerializer.Deserialize<RenderedVideo[]>(await File.ReadAllTextAsync(_filePath, ct), JsonOptions) ?? [])
                : [];
            all = [.. all, video];
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(all, JsonOptions), ct);
        }
        finally { _lock.Release(); }
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return;
            var all = JsonSerializer.Deserialize<RenderedVideo[]>(await File.ReadAllTextAsync(_filePath, ct), JsonOptions) ?? [];
            all = all.Where(v => v.Id != id).ToArray();
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(all, JsonOptions), ct);
        }
        finally { _lock.Release(); }
    }
}
