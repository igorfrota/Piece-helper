# copia o Piece Helper deste PC para dentro do Windows da VM e cria o atalho na area de trabalho dela
$was = Stop-SosVM $VMName
$vhd = (Get-VMHardDiskDrive -VMName $VMName | Where-Object { $_.Path } | Select-Object -First 1).Path
if (-not $vhd) { throw 'A VM nao tem disco virtual.' }
Write-Host ('Abrindo o disco da VM: ' + $vhd)
$disk = Mount-VHD -Path $vhd -PassThru | Get-Disk
$added = @()
try {
    foreach ($p in @(Get-Partition -DiskNumber $disk.Number)) {
        if (-not $p.DriveLetter -and $p.Type -eq 'Basic' -and $p.Size -gt 10GB) {
            try { $p | Add-PartitionAccessPath -AssignDriveLetter -EA Stop; $added += $p.PartitionNumber } catch {}
        }
    }
    $letter = $null
    foreach ($p in @(Get-Partition -DiskNumber $disk.Number)) {
        if ($p.DriveLetter -and (Test-Path ($p.DriveLetter + ':\Windows\System32'))) { $letter = $p.DriveLetter + ':'; break }
    }
    if (-not $letter) { throw 'Nao achei o Windows dentro do disco da VM.' }
    Install-SosHelper $letter
}
finally {
    foreach ($n in $added) {
        try { $pp = Get-Partition -DiskNumber $disk.Number -PartitionNumber $n; if ($pp.DriveLetter) { $pp | Remove-PartitionAccessPath -AccessPath ($pp.DriveLetter + ':\') } } catch {}
    }
    Write-Host 'Fechando o disco da VM...'
    Dismount-VHD -Path $vhd
}
if ($was) { Write-Host 'Ligando a VM de novo...'; Start-VM -Name $VMName }
