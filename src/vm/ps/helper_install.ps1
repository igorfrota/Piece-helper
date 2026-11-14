# copia o Piece Helper deste PC para dentro do Windows da VM e cria o atalho na area de trabalho dela
$was = Stop-SosVM $VMName
$letter = Open-SosVhd $VMName
try { Install-SosHelper $letter }
finally { Close-SosVhd }
if ($was) { Write-Host 'Ligando a VM de novo...'; Start-VM -Name $VMName }
