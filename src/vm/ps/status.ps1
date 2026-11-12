$o = [ordered]@{}
$os = Get-CimInstance Win32_OperatingSystem
$o.edition = $os.Caption
$o.build = [int]$os.BuildNumber
$o.ram = [int64]$os.TotalVisibleMemorySize * 1024
$o.threads = [Environment]::ProcessorCount
$o.feature = $null
try { $o.feature = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -EA Stop).State.ToString() } catch {}
$o.hypervisor = [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent
$o.vtx = [bool]((Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled)
$o.module = [bool](Get-Command Get-VM -EA SilentlyContinue)
$svc = Get-Service vmms -EA SilentlyContinue
$o.vmms = $(if ($svc) { $svc.Status.ToString() } else { $null })
$o.instancePath = $false
$o.vms = @()
if ($o.module -and $svc) {
  $c = Get-Command Add-VMGpuPartitionAdapter -EA SilentlyContinue
  $o.instancePath = [bool]($c -and $c.Parameters.ContainsKey('InstancePath'))
  try {
    $o.vms = @(Get-VM -EA Stop | ForEach-Object {
      $g = @(Get-VMGpuPartitionAdapter -VMName $_.Name -EA SilentlyContinue)
      $m = Get-VMMemory -VMName $_.Name
      [ordered]@{ name = $_.Name; state = $_.State.ToString(); gen = $_.Generation;
        cpus = (Get-VMProcessor -VMName $_.Name).Count; dyn = [bool]$m.DynamicMemoryEnabled; ram = [int64]$m.Startup;
        gpu = ($g.Count -gt 0); gpuPath = $(if ($g.Count) { $g[0].InstancePath } else { $null });
        checkpoint = $_.CheckpointType.ToString(); autockpt = [bool]$_.AutomaticCheckpointsEnabled;
        stopAction = $_.AutomaticStopAction.ToString();
        snaps = @(Get-VMSnapshot -VMName $_.Name -EA SilentlyContinue).Count }
    })
  } catch { $o.vmerror = $_.Exception.Message }
}
$parts = @()
try { $parts = @(Get-VMHostPartitionableGpu -EA Stop) } catch { try { $parts = @(Get-VMPartitionableGpu -EA Stop) } catch {} }
$o.gpus = @(Get-PnpDevice -Class Display -PresentOnly -EA SilentlyContinue | ForEach-Object {
  $k = $_.InstanceId.Replace('\', '#').ToUpper()
  $p = $parts | Where-Object { $_.Name.ToUpper().Contains($k) } | Select-Object -First 1
  $d = Get-CimInstance Win32_PnPSignedDriver -Filter ("DeviceID='" + $_.InstanceId.Replace('\', '\\') + "'") -EA SilentlyContinue
  [ordered]@{ name = $_.FriendlyName; id = $_.InstanceId; ok = ($_.Status -eq 'OK');
    path = $(if ($p) { $p.Name } else { $null }); driver = $(if ($d) { $d.DriverVersion } else { $null }) }
})
$o | ConvertTo-Json -Depth 5 -Compress
