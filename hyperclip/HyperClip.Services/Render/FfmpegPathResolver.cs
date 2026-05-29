namespace HyperClip.Services.Render;

public class FfmpegPathResolver
{
    private string? _cachedFfmpeg;
    private string? _cachedFfprobe;

    public string GetFfmpegPath() => _cachedFfmpeg ??= ResolveBinary("ffmpeg");
    public string GetFfprobePath() => _cachedFfprobe ??= ResolveBinary("ffprobe");

    private string ResolveBinary(string name)
    {
        var candidates = new[]
        {
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "resources", "ffmpeg", "bin", $"{name}.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "scoop", "shims", $"{name}.exe"),
            name,
            $"{name}.exe",
        };

        foreach (var candidate in candidates)
        {
            if (candidate == name || candidate.EndsWith($"{name}.exe"))
            {
                var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
                foreach (var dir in pathEnv.Split(Path.PathSeparator))
                {
                    var fullPath = Path.Combine(dir, candidate);
                    if (File.Exists(fullPath)) return fullPath;
                }
            }
            else
            {
                if (File.Exists(candidate)) return candidate;
            }
        }
        return name;
    }
}
