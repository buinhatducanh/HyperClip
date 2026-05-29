using HyperClip.Core.Models;
namespace HyperClip.Core.Interfaces;
public interface ISettingsStore
{
    Task<AppSettings> LoadAsync(CancellationToken ct = default);
    Task SaveAsync(AppSettings settings, CancellationToken ct = default);
    event EventHandler<AppSettings>? SettingsUpdated;
}
