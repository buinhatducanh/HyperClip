using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public interface IWorkspaceStore
{
    Task<Workspace[]> GetAllAsync(CancellationToken ct = default);
    Task<Workspace?> GetByIdAsync(string id, CancellationToken ct = default);
    Task SaveAsync(Workspace workspace, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
    Task UpdateStatusAsync(string id, HyperClip.Core.Enums.WorkspaceStatus status, CancellationToken ct = default);
    Task UpdateAsync(string id, Action<Workspace> patch, CancellationToken ct = default);
    event EventHandler<Workspace>? WorkspaceUpdated;
}
