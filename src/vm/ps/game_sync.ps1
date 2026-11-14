# copia a versao atual dos jogos da Steam deste PC para dentro da VM (so o que mudou), sem baixar de novo
# $VMName, $Games (JSON com name, src, dir, manifest, gb)
$was = Stop-SosVM $VMName
$letter = Open-SosVhd $VMName
try {
    $lib = $letter + '\Program Files (x86)\Steam\steamapps'
    New-Item -ItemType Directory -Force -Path (Join-Path $lib 'common') | Out-Null
    foreach ($g in @($Games | ConvertFrom-Json)) {
        Write-Host ('Atualizando ' + $g.name + ' na VM (' + $g.gb + ' GB no PC; so os arquivos que mudaram sao copiados)...')
        $null = robocopy $g.src (Join-Path $lib ('common\' + $g.dir)) /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
        if ($LASTEXITCODE -ge 8) { throw ('Nao consegui copiar ' + $g.name + '. Feche o jogo no seu PC e tente de novo.') }
        Copy-Item -Path $g.manifest -Destination $lib -Force
        Write-Host ('  ' + $g.name + ' atualizado na VM.')
    }
}
finally { Close-SosVhd }
if ($was) { Write-Host 'Ligando a VM de novo...'; Start-VM -Name $VMName }
