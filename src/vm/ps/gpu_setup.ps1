$was = Stop-SosVM $VMName
Copy-SosGpuDrivers $VMName $GpuId
'Configurando a VM para usar a placa...'
Set-VM -Name $VMName -AutomaticStopAction ShutDown -AutomaticCheckpointsEnabled $false -CheckpointType Disabled
try { Set-VM -Name $VMName -GuestControlledCacheTypes $true -LowMemoryMappedIoSpace 1GB -HighMemoryMappedIoSpace 32GB } catch { 'Aviso: ' + $_.Exception.Message }
Get-VMGpuPartitionAdapter -VMName $VMName -EA SilentlyContinue | Remove-VMGpuPartitionAdapter
$path = Get-SosPartitionPath $GpuId
$c = Get-Command Add-VMGpuPartitionAdapter
if ($path -and $c.Parameters.ContainsKey('InstancePath')) { Add-VMGpuPartitionAdapter -VMName $VMName -InstancePath $path }
else { Add-VMGpuPartitionAdapter -VMName $VMName }
Set-VMGpuPartitionAdapter -VMName $VMName `
  -MinPartitionVRAM 80000000 -MaxPartitionVRAM 100000000 -OptimalPartitionVRAM 100000000 `
  -MinPartitionEncode 80000000 -MaxPartitionEncode 100000000 -OptimalPartitionEncode 100000000 `
  -MinPartitionDecode 80000000 -MaxPartitionDecode 100000000 -OptimalPartitionDecode 100000000 `
  -MinPartitionCompute 80000000 -MaxPartitionCompute 100000000 -OptimalPartitionCompute 100000000
'Placa adicionada a VM.'
if ($was) { 'Ligando a VM de novo...'; Start-VM -Name $VMName }
@{ guest = $script:GuestBuild } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
