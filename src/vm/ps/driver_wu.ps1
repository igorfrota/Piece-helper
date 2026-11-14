# procura e instala driver de video mais novo pelo Windows Update (usado para Intel e quando o site do fabricante falha)
Write-Host 'Procurando driver de video mais novo no Windows Update...'
$s = New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID = 'Piece Helper'
$sr = $s.CreateUpdateSearcher()
$r = $sr.Search("IsInstalled=0 and Type='Driver'")
$col = New-Object -ComObject Microsoft.Update.UpdateColl
foreach ($u in $r.Updates) {
    if (($u.DriverClass -match 'Display') -or ($u.Title -match 'Display|Graphics|Radeon|GeForce|Arc')) { Write-Host ('  encontrado: ' + $u.Title); [void]$col.Add($u) }
}
if ($col.Count -eq 0) {
    Write-Host 'O Windows Update nao tem driver de video mais novo para esta placa.'
    @{ installed = 0 } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
    return
}
Write-Host 'Baixando...'
$dl = $s.CreateUpdateDownloader(); $dl.Updates = $col; [void]$dl.Download()
Write-Host 'Instalando (a tela pode piscar)...'
$in = $s.CreateUpdateInstaller(); $in.Updates = $col; $res = $in.Install()
Write-Host ('Resultado do Windows Update: ' + $res.ResultCode + $(if ($res.RebootRequired) { ' (pede reinicio)' } else { '' }))
@{ installed = $col.Count; result = $res.ResultCode; reboot = [bool]$res.RebootRequired } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
