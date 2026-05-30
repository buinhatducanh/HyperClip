using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels.Settings;

public partial class SessionsTabViewModel : ObservableObject
{
    [ObservableProperty] private ObservableCollection<SessionInfo> _sessions = [];
    [ObservableProperty] private bool _isLoading;

    public SessionsTabViewModel(IAuthService authService)
    {
        _ = LoadAsync(authService);
    }

    private async Task LoadAsync(IAuthService authService)
    {
        IsLoading = true;
        var status = await authService.GetStatusAsync();
        await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            Sessions.Clear();
            for (int i = 1; i <= 30; i++)
            {
                Sessions.Add(new SessionInfo
                {
                    ProfileName = $"HyperClip-Chrome-Profile-{i}",
                    Index = i,
                    HasCookies = i <= status.ActiveSessions,
                    Status = i <= status.ActiveSessions ? "Active" : "No cookies"
                });
            }
            IsLoading = false;
        });
    }
}

public class SessionInfo
{
    public string ProfileName { get; set; } = "";
    public int Index { get; set; }
    public bool HasCookies { get; set; }
    public string Status { get; set; } = "";
}
