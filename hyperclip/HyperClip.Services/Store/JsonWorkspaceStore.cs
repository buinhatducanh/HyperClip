using System.Text.Json;
using System.Text.Json.Serialization;
using HyperClip.Core.Enums;
using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.Store;

public class JsonWorkspaceStore : IWorkspaceStore
{
    private readonly string _filePath;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    public event EventHandler<Workspace>? WorkspaceUpdated;

    public JsonWorkspaceStore(string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        _filePath = Path.Combine(dataDir, "workspaces.json");
    }

    public async Task<Workspace[]> GetAllAsync(CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return [];
            var json = await File.ReadAllTextAsync(_filePath, ct);
            return JsonSerializer.Deserialize<Workspace[]>(json, JsonOptions) ?? [];
        }
        finally { _lock.Release(); }
    }

    public async Task<Workspace?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var all = await GetAllAsync(ct);
        return all.FirstOrDefault(w => w.Id == id);
    }

    public async Task SaveAsync(Workspace workspace, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var all = File.Exists(_filePath)
                ? (JsonSerializer.Deserialize<Workspace[]>(await File.ReadAllTextAsync(_filePath, ct), JsonOptions) ?? [])
                : [];
            var idx = Array.FindIndex(all, w => w.Id == workspace.Id);
            if (idx >= 0) all[idx] = workspace;
            else all = [.. all, workspace];
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(all, JsonOptions), ct);
        }
        finally { _lock.Release(); }
        WorkspaceUpdated?.Invoke(this, workspace);
    }

    public async Task DeleteAsync(string id, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return;
            var all = JsonSerializer.Deserialize<Workspace[]>(await File.ReadAllTextAsync(_filePath, ct), JsonOptions) ?? [];
            all = all.Where(w => w.Id != id).ToArray();
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(all, JsonOptions), ct);
        }
        finally { _lock.Release(); }
    }

    public async Task UpdateStatusAsync(string id, WorkspaceStatus status, CancellationToken ct = default)
    {
        await UpdateAsync(id, w => w.Status = status, ct);
    }

    public async Task UpdateAsync(string id, Action<Workspace> patch, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            if (!File.Exists(_filePath)) return;
            var all = JsonSerializer.Deserialize<Workspace[]>(await File.ReadAllTextAsync(_filePath, ct), JsonOptions) ?? [];
            var ws = all.FirstOrDefault(w => w.Id == id);
            if (ws == null) return;
            patch(ws);
            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(all, JsonOptions), ct);
            WorkspaceUpdated?.Invoke(this, ws);
        }
        finally { _lock.Release(); }
    }
}
