using System.IO;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using HyperClip.Core.Interfaces;
using HyperClip.Services.Download;
using HyperClip.Services.Render;
using HyperClip.Services.Store;
using HyperClip.UI.ViewModels;

// IRenderedVideoStore lives in HyperClip.Services.Store

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
        services.AddSingleton<IWorkspaceStore>(_ => new JsonWorkspaceStore(dataDir));
        services.AddSingleton<IChannelStore>(_ => new JsonChannelStore(dataDir));
        services.AddSingleton<IRenderedVideoStore>(_ => new JsonRenderedVideoStore(dataDir));
        services.AddSingleton<IYtdlpDownloader>(_ => new YtdlpDownloader(new YtdlpPathResolver()));
        services.AddSingleton<DownloadPipeline>();
        services.AddSingleton<FfmpegPathResolver>();
        services.AddSingleton<IRenderEngine>(sp => new FfmpegRenderer(sp.GetRequiredService<FfmpegPathResolver>()));
        services.AddSingleton<RenderPipeline>();
        services.AddLogging();
        services.AddSingleton<MainViewModel>();
        services.AddSingleton<TopBarViewModel>();
        services.AddSingleton<SidebarViewModel>();
        services.AddSingleton<WorkspaceQueueViewModel>();
        services.AddSingleton<DetailEditorViewModel>();
        _services = services.BuildServiceProvider();
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var mainWindow = new MainWindow(_services.GetRequiredService<MainViewModel>());
        mainWindow.Show();
    }
}
