$was = Stop-SosVM $VMName
Set-VMProcessor -VMName $VMName -Count ([int]$Cpus)
if ([bool]::Parse($Dyn)) { Set-VMMemory -VMName $VMName -DynamicMemoryEnabled $true -StartupBytes ([int64]$Ram) }
else { Set-VMMemory -VMName $VMName -DynamicMemoryEnabled $false -StartupBytes ([int64]$Ram) }
'Configuracao original restaurada.'
if ($was) { 'Ligando a VM de novo...'; Start-VM -Name $VMName }
