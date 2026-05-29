using HyperClip.Core.Models;

namespace HyperClip.Tests.Services;

public class HardwareProfileTests
{
    [Fact]
    public void HardwareProfile_DefaultValues()
    {
        var p = new HardwareProfile();
        Assert.Equal(0, p.VramGB);
        Assert.Equal(0, p.RamGB);
    }

    [Fact]
    public void HardwarePreset_SetProperties()
    {
        var p = new HardwarePreset
        {
            Id = "rtx5080", Label = "RTX 5080 Desktop",
            VramGB = 16, RamGB = 64, Sessions = 30, RenderWorkers = 14,
        };
        Assert.Equal("rtx5080", p.Id);
        Assert.Equal(16, p.VramGB);
    }
}
