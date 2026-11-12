$was = Stop-SosVM $VMName
Copy-SosGpuDrivers $VMName $GpuId
if ($was) { 'Ligando a VM de novo...'; Start-VM -Name $VMName }
@{ guest = $script:GuestBuild } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
