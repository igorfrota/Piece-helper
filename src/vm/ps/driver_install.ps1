# instala o driver oficial da placa baixado pelo Piece Helper e espera terminar
# $Installer, $Vendor (nvidia|amd), $Mode (silent|gui), $GpuId, $OldVersion
$ErrorActionPreference = 'Continue'
if ($Mode -eq 'gui') {
    Write-Host 'Abrindo o instalador oficial na tela. Clique em Concordar/Instalar e deixe as opcoes como estao; o Piece Helper espera ele terminar.'
    $pr = Start-Process -FilePath $Installer -PassThru
} else {
    Write-Host 'Instalando o driver novo sozinho (sem telas). A tela pode piscar ou ficar preta por alguns segundos: e normal.'
    $a = $(if ($Vendor -eq 'nvidia') { '-s -noreboot -noeula -nofinish -passive' } else { '-install' })
    $pr = Start-Process -FilePath $Installer -ArgumentList $a -PassThru
}
$t = 0
function Test-SosInstalling {
    if (-not $pr.HasExited) { return $true }
    # os instaladores da AMD e da NVIDIA abrem outros programas e saem antes de terminar
    return [bool](Get-Process -EA SilentlyContinue | Where-Object {
        try { $_.Path -and ($_.Path -like 'C:\AMD\*' -or $_.Path -like 'C:\NVIDIA\*' -or (($_.Company -match 'Advanced Micro Devices|NVIDIA') -and ($_.Name -match 'setup|install'))) } catch { $false }
    } | Select-Object -First 1)
}
Start-Sleep -Seconds 5
while ((Test-SosInstalling) -and $t -lt 2700) {
    Start-Sleep -Seconds 5; $t += 5
    if ($t % 60 -eq 0) { Write-Host ('  instalando... ' + [int]($t / 60) + ' min') }
}
$code = $(if ($pr.HasExited) { $pr.ExitCode } else { -1 })
if ($t -ge 2700) { Write-Host 'O instalador passou de 45 minutos; ele continua sozinho em segundo plano.' }
Start-Sleep -Seconds 8
$d = Get-CimInstance Win32_PnPSignedDriver -Filter ("DeviceID='" + $GpuId.Replace('\', '\\') + "'")
$new = $(if ($d) { $d.DriverVersion } else { $null })
Write-Host ('Versao do driver agora: ' + $new + ' (antes: ' + $OldVersion + ')')
@{ code = $code; driver = $new; changed = [bool]($new -and $new -ne $OldVersion) } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
