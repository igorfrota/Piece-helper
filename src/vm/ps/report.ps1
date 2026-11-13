# junta o relatorio para o suporte num .zip (sem senhas; o nome do usuario e do PC sao trocados)
# $OutDir (pasta ja com resumo, logs e exames), $Zip
$ErrorActionPreference = 'Continue'
Write-Host 'Juntando os eventos do Hyper-V dos ultimos dias...'
$ev = foreach ($ln in 'Microsoft-Windows-Hyper-V-Worker-Admin', 'Microsoft-Windows-Hyper-V-VMMS-Admin', 'Microsoft-Windows-Hyper-V-Compute-Admin') {
    try { Get-WinEvent -LogName $ln -MaxEvents 200 -EA Stop | Where-Object { $_.Level -le 3 -and $_.TimeCreated -gt (Get-Date).AddDays(-7) } } catch {}
}
$ev | Sort-Object TimeCreated -Descending | Select-Object -First 200 TimeCreated, LogName, Id, LevelDisplayName, Message |
    Format-List | Out-File (Join-Path $OutDir 'eventos-hyper-v.txt') -Encoding UTF8 -Width 300
Write-Host 'Lendo as placas e os drivers de video...'
& pnputil.exe /enum-drivers /class Display 2>&1 | Out-File (Join-Path $OutDir 'drivers-video.txt') -Encoding UTF8
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate, Status, VideoModeDescription, AdapterRAM |
    Format-List | Out-File (Join-Path $OutDir 'placas-de-video.txt') -Encoding UTF8
try { Get-VM | Format-List Name, State, Generation, ProcessorCount, MemoryStartup, CheckpointType, Status, Version | Out-File (Join-Path $OutDir 'maquinas-virtuais.txt') -Encoding UTF8 } catch {}
foreach ($pair in @(@($env:USERNAME, '<usuario>'), @($env:COMPUTERNAME, '<pc>'))) {
    if (-not $pair[0]) { continue }
    Get-ChildItem $OutDir -Recurse -File | ForEach-Object {
        try { $t = [IO.File]::ReadAllText($_.FullName); if ($t.Contains($pair[0])) { [IO.File]::WriteAllText($_.FullName, $t.Replace($pair[0], $pair[1])) } } catch {}
    }
}
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $Zip -Force
Remove-Item $OutDir -Recurse -Force -EA SilentlyContinue
Write-Host ('Relatorio salvo: ' + $Zip)
@{ zip = $Zip } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
