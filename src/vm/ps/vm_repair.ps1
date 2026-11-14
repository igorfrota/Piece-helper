# conserta a VM sem apagar nada: configuracoes, placa de video, drivers, rede, correcao da Steam e Piece Helper
# $VMName, $GpuId (vazio = sem placa), $SteamGlFix (1/0), $HelperSrc
$was = Stop-SosVM $VMName
Write-Host 'Conferindo as configuracoes da VM...'
Set-VM -Name $VMName -AutomaticStopAction ShutDown -AutomaticCheckpointsEnabled $false
Enable-SosVMTools $VMName
if ($GpuId) {
    Set-VM -Name $VMName -CheckpointType Disabled
    $snaps = @(Get-VMSnapshot -VMName $VMName -EA SilentlyContinue)
    if ($snaps.Count) {
        Write-Host ('Juntando ' + $snaps.Count + ' ponto(s) de verificacao ao disco da VM (VMs com placa de video nao aceitam)...')
        $snaps | Remove-VMSnapshot
        $t = 0
        while (((Get-VM -Name $VMName).Status -match 'Merg|Mescl') -and $t -lt 1800) { Start-Sleep -Seconds 3; $t += 3 }
    }
    Write-Host 'Colocando a placa de video de novo na VM...'
    Add-SosGpuAdapter $VMName $GpuId
}
$sw = Get-VMSwitch -Name 'Default Switch' -EA SilentlyContinue
if (-not $sw) { $sw = Get-VMSwitch -EA SilentlyContinue | Select-Object -First 1 }
if ($sw) {
    $na = @(Get-VMNetworkAdapter -VMName $VMName)
    if (-not $na.Count) { Add-VMNetworkAdapter -VMName $VMName -SwitchName $sw.Name; Write-Host 'Placa de rede adicionada a VM.' }
    elseif (-not $na[0].SwitchName) { Connect-VMNetworkAdapter -VMName $VMName -Name $na[0].Name -SwitchName $sw.Name; Write-Host 'Internet da VM religada.' }
}
$letter = Open-SosVhd $VMName
try {
    if ($GpuId) { Copy-SosGpuDriversTo $letter $GpuId }
    if ($SteamGlFix -eq '1') { Set-SosSteamGlFix $letter }
    if ($HelperSrc) { Install-SosHelper $letter }
}
finally { Close-SosVhd }
Write-Host 'VM conferida e consertada.'
if ($was) { Write-Host 'Ligando a VM de novo...'; Start-VM -Name $VMName }
@{ guest = $script:GuestBuild } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
