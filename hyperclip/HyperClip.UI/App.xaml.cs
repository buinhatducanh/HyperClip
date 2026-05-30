using System.IO;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using HyperClip.Core.Interfaces;
using HyperClip.Services.Activity;
using HyperClip.Services.Auth;
using HyperClip.Services.Detection;
using HyperClip.Services.Diagnostics;
using HyperClip.Services.Download;
using HyperClip.Services.Events;
using HyperClip.Services.Logging;
using HyperClip.Services.Notifications;
using HyperClip.Services.Render;
using HyperClip.Services.Storage;
using HyperClip.Services.Store;
using HyperClip.Services.System;
using HyperClip.UI.ViewModels;

namespace HyperClip.UI;

public partial class App : Application
{
    private readonly IServiceProvider _services;

    public App()
    {
        var dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "HyperClip", "data");

        var services = new ServiceCollection();

        // Stores
        services.AddSingleton<IWorkspaceStore>(_ => new JsonWorkspaceStore(dataDir));
        services.AddSingleton<IChannelStore>(_ => new JsonChannelStore(dataDir));
        services.AddSingleton<IRenderedVideoStore>(_ => new JsonRenderedVideoStore(dataDir));
        services.AddSingleton<ISettingsStore>(_ => new JsonSettingsStore(dataDir));

        // Foundation services
        services.AddSingleton<IEventBus, EventBus>();
        services.AddSingleton<INotificationService, NotificationService>();
        services.AddSingleton<IActivityService, ActivityService>();
        services.AddSingleton<IStorageService>(_ => new StorageService(dataDir));
        services.AddSingleton<ILogService>(_ => new LogService(dataDir));
        services.AddSingleton<IAuthService, AuthService>();

        // Detection + Download
        services.AddSingleton<IYtdlpDownloader>(_ => new YtdlpDownloader(new YtdlpPathResolver()));
        services.AddSingleton<DownloadPipeline>();
        services.AddSingleton<RssFeedScanner>();
        services.AddSingleton<YoutubePoller>();
        services.AddSingleton<IPollerService>(sp => sp.GetRequiredService<YoutubePoller>());
        services.AddSingleton<IChannelService>(sp => new ChannelService(
            sp.GetRequiredService<IChannelStore>(),
            sp.GetRequiredService<RssFeedScanner>()));
        services.AddSingleton<AutoDownloadService>();

        // Render
        services.AddSingleton<FfmpegPathResolver>();
        services.AddSingleton<IRenderEngine>(sp => new FfmpegRenderer(sp.GetRequiredService<FfmpegPathResolver>()));
        services.AddSingleton<RenderPipeline>();

        // System
        services.AddSingleton<GpuMonitor>();
        services.AddSingleton<ISystemMonitor>(sp => new SystemMonitor(sp.GetRequiredService<GpuMonitor>()));
        services.AddSingleton<IDiagnosticsService>(sp => new DiagnosticsService(
            sp.GetRequiredService<FfmpegPathResolver>(),
            new YtdlpPathResolver(),
            sp.GetRequiredService<IChannelStore>()));

        services.AddLogging();

        // ViewModels
        services.AddSingleton<MainViewModel>(sp => new MainViewModel(
            sp.GetRequiredService<IWorkspaceStore>(),
            sp.GetRequiredService<IChannelStore>(),
            sp.GetRequiredService<IRenderedVideoStore>(),
            sp.GetRequiredService<WorkspaceQueueViewModel>(),
            sp.GetRequiredService<DetailEditorViewModel>(),
            sp));
        services.AddSingleton<TopBarViewModel>(sp => new TopBarViewModel(sp.GetRequiredService<ISystemMonitor>()));
        services.AddSingleton<WorkspaceQueueViewModel>();
        services.AddSingleton<DetailEditorViewModel>();
        services.AddSingleton<SettingsViewModel>();
        services.AddSingleton<ChannelSidebarViewModel>();
        services.AddSingleton<ToastViewModel>();
        services.AddSingleton<RenderedVideosViewModel>();
        services.AddSingleton<DetectionStatusBarViewModel>();

        _services = services.BuildServiceProvider();
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var systemMonitor = _services.GetService<ISystemMonitor>();
        systemMonitor?.Start();
        var mainWindow = new MainWindow(_services.GetRequiredService<MainViewModel>());
        mainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        var systemMonitor = _services.GetService<ISystemMonitor>();
        systemMonitor?.Stop();
        base.OnExit(e);
    }
}
