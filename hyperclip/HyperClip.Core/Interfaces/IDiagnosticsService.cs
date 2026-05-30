namespace HyperClip.Core.Interfaces;

public interface IDiagnosticsService
{
    Task<DiagnosticResult> RunDiagnosticsAsync(CancellationToken ct = default);
}

public record DiagnosticResult(
    bool IsHealthy,
    List<DiagnosticIssue> Issues,
    DateTime RunAt
);

public record DiagnosticIssue(
    string Category,
    string Severity, // "critical", "warning", "info"
    string Message,
    string? Suggestion = null
);
