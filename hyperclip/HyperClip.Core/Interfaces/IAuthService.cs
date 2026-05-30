namespace HyperClip.Core.Interfaces;

public interface IAuthService
{
    Task<AuthStatus> GetStatusAsync(CancellationToken ct = default);
    Task<bool> StartOAuthAsync(string projectId, CancellationToken ct = default);
    Task LogoutAsync(CancellationToken ct = default);
    event EventHandler<AuthStatus>? StatusChanged;
}

public record AuthStatus(
    bool IsReady,
    string? AccountName = null,
    int ActiveSessions = 0,
    int TotalSessions = 30,
    int ActiveProjects = 0,
    bool IsDegraded = false
);
