using HyperClip.Core.Interfaces;

namespace HyperClip.Services.Auth;

public class AuthService : IAuthService
{
    private AuthStatus _status = new(IsReady: true, AccountName: "Local Mode");

    public event EventHandler<AuthStatus>? StatusChanged;

    public Task<AuthStatus> GetStatusAsync(CancellationToken ct = default)
        => Task.FromResult(_status);

    public Task<bool> StartOAuthAsync(string projectId, CancellationToken ct = default)
    {
        // Placeholder — OAuth implementation requires Chrome cookie extraction
        // which will be ported from Electron's chrome_cookies.ts in a future iteration
        return Task.FromResult(false);
    }

    public Task LogoutAsync(CancellationToken ct = default)
    {
        _status = new(IsReady: false);
        StatusChanged?.Invoke(this, _status);
        return Task.CompletedTask;
    }
}
