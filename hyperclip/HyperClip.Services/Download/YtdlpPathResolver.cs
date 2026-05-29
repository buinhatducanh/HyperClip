namespace HyperClip.Services.Download;

public class YtdlpPathResolver
{
    private string? _cachedPath;

    public string GetYtdlpPath()
    {
        if (_cachedPath != null) return _cachedPath;

        var candidates = new[]
        {
            // Bundled with app (dev + prod)
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "resources", "yt-dlp", "yt-dlp.exe"),
            // Scoop / user PATH
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "scoop", "shims", "yt-dlp.exe"),
            // Python Scripts (pip install)
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Python", "Scripts", "yt-dlp.exe"),
            // Direct PATH lookup
            "yt-dlp",
            "yt-dlp.exe",
        };

        foreach (var candidate in candidates)
        {
            if (candidate == "yt-dlp" || candidate == "yt-dlp.exe")
            {
                // PATH search for bare command
                var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
                foreach (var dir in pathEnv.Split(Path.PathSeparator))
                {
                    var fullPath = Path.Combine(dir, candidate);
                    if (File.Exists(fullPath)) { _cachedPath = fullPath; return fullPath; }
                }
            }
            else
            {
                if (File.Exists(candidate)) { _cachedPath = candidate; return candidate; }
            }
        }

        _cachedPath = "yt-dlp"; // fallback to PATH resolution at runtime
        return _cachedPath;
    }
}
