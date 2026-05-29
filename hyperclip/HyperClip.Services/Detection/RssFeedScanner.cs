using System.Text.RegularExpressions;
using System.Xml.Linq;
using HyperClip.Core.Models;

namespace HyperClip.Services.Detection;

public partial class RssFeedScanner
{
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(15),
    };

    public async Task<List<DetectedVideo>> FetchLatestVideosAsync(string channelId, int limit = 5, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(channelId) || !channelId.StartsWith("UC"))
            return [];

        var url = $"https://www.youtube.com/feeds/videos.xml?channel_id={channelId}";

        try
        {
            var response = await Client.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) return [];

            var xml = await response.Content.ReadAsStringAsync(ct);
            return ParseFeed(xml, limit);
        }
        catch
        {
            return [];
        }
    }

    public async Task<ChannelInfo?> GetChannelInfoAsync(string channelUrl, CancellationToken ct = default)
    {
        var channelId = ExtractChannelId(channelUrl);
        if (string.IsNullOrEmpty(channelId)) return null;

        var url = $"https://www.youtube.com/feeds/videos.xml?channel_id={channelId}";

        try
        {
            var response = await Client.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) return null;

            var xml = await response.Content.ReadAsStringAsync(ct);
            var doc = XDocument.Parse(xml);
            var feed = doc.Root;
            var ns = feed?.Name.Namespace ?? XNamespace.None;
            var title = feed?.Element(ns + "title")?.Value ?? "Unknown";

            return new ChannelInfo
            {
                ChannelId = channelId,
                ChannelName = title,
                AvatarUrl = $"https://yt3.googleusercontent.com/ytc/{channelId}=s100-c-k-c0x00ffffff-no-rj",
            };
        }
        catch
        {
            return null;
        }
    }

    private static List<DetectedVideo> ParseFeed(string xml, int limit)
    {
        var doc = XDocument.Parse(xml);
        var feed = doc.Root;
        var ns = feed?.Name.Namespace ?? XNamespace.None;
        var videos = new List<DetectedVideo>();

        foreach (var entry in feed?.Elements(ns + "entry") ?? Enumerable.Empty<XElement>())
        {
            if (videos.Count >= limit) break;

            // RSS feed uses atom:id like "yt:video:dQw4w9WgXcQ"
            var rawId = entry.Element(ns + "id")?.Value ?? "";
            var videoId = rawId.Contains(':') ? rawId.Split(':').LastOrDefault() : rawId;
            var title = entry.Element(ns + "title")?.Value ?? "Unknown";
            var published = entry.Element(ns + "published")?.Value ?? "";
            var thumbnail = "";

            // Try to extract thumbnail from media:group/media:thumbnail
            var mediaNs = XNamespace.Get("http://search.yahoo.com/mrss/");
            var group = entry.Element(mediaNs + "group");
            var thumbEl = group?.Element(mediaNs + "thumbnail");
            if (thumbEl != null)
                thumbnail = thumbEl.Attribute("url")?.Value ?? "";

            if (string.IsNullOrEmpty(videoId) || videoId.Length < 5) continue;

            videos.Add(new DetectedVideo
            {
                VideoId = videoId,
                Title = title,
                PublishedAt = published,
                Thumbnail = thumbnail,
                DetectedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });
        }

        return videos;
    }

    private static string? ExtractChannelId(string url)
    {
        var match = ChannelIdRegex().Match(url);
        return match.Success ? match.Groups[1].Value : null;
    }

    [GeneratedRegex(@"\/channel\/(UC[a-zA-Z0-9_-]{22})")]
    private static partial Regex ChannelIdRegex();
}

public class ChannelInfo
{
    public string ChannelId { get; set; } = string.Empty;
    public string ChannelName { get; set; } = string.Empty;
    public string AvatarUrl { get; set; } = string.Empty;
}
