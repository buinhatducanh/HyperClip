using CommunityToolkit.Mvvm.ComponentModel;
using HyperClip.Core.Models;

namespace HyperClip.UI.ViewModels;

public partial class TopBarViewModel : ObservableObject
{
    [ObservableProperty] private AppSettings _settings = new();
    [ObservableProperty] private SystemStats _systemStats = new();
    [ObservableProperty] private bool _autoRender;

    partial void OnAutoRenderChanged(bool value)
    {
        Settings.AutoRender = value;
    }
}
