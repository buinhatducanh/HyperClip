using System.Text.Json.Serialization;
using HyperClip.Core.Enums;

namespace HyperClip.Core.Models;

public class Workspace
{
	public string Id { get; set; } = string.Empty;
	public string ChannelId { get; set; } = string.Empty;
	public string ChannelName { get; set; } = string.Empty;
	public string ChannelColor { get; set; } = string.Empty;
	public string? VideoId { get; set; }
	public string? VideoUrl { get; set; }
	public string VideoTitle { get; set; } = string.Empty;
	public string Thumbnail { get; set; } = string.Empty;
	public string Duration { get; set; } = string.Empty;
	public string DownloadedAt { get; set; } = string.Empty;
	public WorkspaceStatus Status { get; set; } = WorkspaceStatus.New;
	public double? RenderProgress { get; set; }
	public string? RenderEta { get; set; }
	public string FileSize { get; set; } = string.Empty;
	public string? PublishedAt { get; set; }
	public string? DetectedAt { get; set; }
	public string? VideoResolution { get; set; }
	public string? DownloadQuality { get; set; }
	public int? TrimLimit { get; set; }
	public RenderQuality Quality { get; set; } = RenderQuality.Quality720;
	public string? DownloadedPath { get; set; }
	public string? BlurBackgroundPath { get; set; }
	public string? OutputPath { get; set; }
	public double? DownloadProgress { get; set; }
	public string? DownloadSpeed { get; set; }
	public string? DownloadEta { get; set; }
	public bool? IsMultiInstance { get; set; }
	public string? PreScaledPath { get; set; }
	public bool? IsShort { get; set; }
	public int[]? AvailableFormats { get; set; }
	public string? ParentId { get; set; }
	public int? PartIndex { get; set; }
	public int? TotalParts { get; set; }
	public int? DownloadPriority { get; set; }
	public int? RenderPriority { get; set; }
	public WorkspaceMetrics? Metrics { get; set; }
	public EditorState Editor { get; set; } = new();
}
