using System.Text.Json;
using System.Text.Json.Serialization;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.Store;

public class JsonChannelStore : IChannelStore
{
    private readonly string _filePath;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    public event EventHandler<Channel>? ChannelUpdated;

    public JsonChannelStore(string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        _filePath = Path.Combine(dataDir, "channels.json");
    }

    public async Task<Channel[]> GetAllAsync(CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return [];
            var json = await File.ReadAllTextAsync(_filePath, ct);
            return JsonSerializer.Deserialize<Channel[]>(json, JsonOptions) ?? [];
        }
        finally { _lock.Release(); }
    }

    public async Task<Channel?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var all = await GetAllAsync(ct);
        return all.FirstOrDefault(c => c.Id == id);
    }

    public async Task SaveAsync(Channel channel, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var all = File.Exists(_filePath)
                ? (JsonSerializer.Deserialize<Channel[]>(await File.ReadAllTextAsync(_filePath, ct), JsonOptions) ?? [])
                : [];
            var idx = Array.FindIndex(all, c => c.Id == channel.Id);
            if (idx >= 0) all[idx] = channel;
            else all = [.. all, channel];
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(all, JsonOptions), ct);
        }
        finally { _lock.Release(); }
        ChannelUpdated?.Invoke(this, channel);
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return;
            var all = JsonSerializer.Deserialize<Channel[]>(await File.ReadAllTextAsync(_filePath, ct), JsonOptions) ?? [];
            all = all.Where(c => c.Id != id).ToArray();
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(all, JsonOptions), ct);
        }
        finally { _lock.Release(); }
    }
}
