# libera espaco: temporarios, cache do Windows Update e da Otimizacao de Entrega, downloads incompletos do Piece Helper
# $Recycle (1 = esvaziar a Lixeira), $Deep (1 = limpeza de componentes do Windows com DISM), $Partials (arquivos .part separados por |)
$ErrorActionPreference = 'Continue'
$before = @{}
Get-PSDrive -PSProvider FileSystem | ForEach-Object { $before[$_.Name] = $_.Free }
Write-Host 'Apagando arquivos temporarios...'
foreach ($d in @($env:TEMP, ($env:SystemRoot + '\Temp'))) {
    if ($d -and (Test-Path $d)) { Get-ChildItem -LiteralPath $d -Force -EA SilentlyContinue | Remove-Item -Recurse -Force -EA SilentlyContinue }
}
Write-Host 'Limpando o cache de downloads do Windows Update...'
Stop-Service wuauserv, bits -Force -EA SilentlyContinue
Remove-Item ($env:SystemRoot + '\SoftwareDistribution\Download\*') -Recurse -Force -EA SilentlyContinue
Start-Service wuauserv, bits -EA SilentlyContinue
Write-Host 'Limpando o cache da Otimizacao de Entrega...'
try { Delete-DeliveryOptimizationCache -Force -EA Stop } catch {}
foreach ($f in ($Partials -split '\|')) { if ($f -and (Test-Path -LiteralPath $f)) { Remove-Item -LiteralPath $f -Force -EA SilentlyContinue; Write-Host ('  download incompleto apagado: ' + $f) } }
if ($Recycle -eq '1') { Write-Host 'Esvaziando a Lixeira...'; Clear-RecycleBin -Force -EA SilentlyContinue }
if ($Deep -eq '1') {
    Write-Host 'Limpando versoes antigas de componentes do Windows (DISM). Pode levar de 5 a 15 minutos...'
    & dism.exe /Online /Cleanup-Image /StartComponentCleanup /Quiet | Out-Null
}
$freed = [ordered]@{}
Get-PSDrive -PSProvider FileSystem | ForEach-Object { if ($before.ContainsKey($_.Name)) { $freed[$_.Name] = [int64]($_.Free - $before[$_.Name]) } }
foreach ($k in $freed.Keys) { if ($freed[$k] -gt 100MB) { Write-Host ('Liberado no disco ' + $k + ': ' + [math]::Round($freed[$k] / 1GB, 1) + ' GB') } }
@{ freed = $freed } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
