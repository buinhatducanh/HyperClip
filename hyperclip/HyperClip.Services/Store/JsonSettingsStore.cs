using System.Text.Json;
using System.Text.Json.Serialization;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.Store;

public class JsonSettingsStore : ISettingsStore
{
    private readonly string _filePath;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };
    public event EventHandler<AppSettings>? SettingsUpdated;
    public JsonSettingsStore(string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        _filePath = Path.Combine(Path.GetDirectoryName(dataDir) ?? dataDir, "settings.json");
    }
    public async Task<AppSettings> LoadAsync(CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return new AppSettings();
            var json = await File.ReadAllTextAsync(_filePath, ct);
            return JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings();
        }
        finally { _lock.Release(); }
    }
    public async Task SaveAsync(AppSettings settings, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var json = JsonSerializer.Serialize(settings, JsonOptions);
            await File.WriteAllTextAsync(_filePath, json, ct);
        }
        finally { _lock.Release(); }
        SettingsUpdated?.Invoke(this, settings);
    }
}
