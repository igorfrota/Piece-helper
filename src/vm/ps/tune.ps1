$was = Stop-SosVM $VMName
Set-VMProcessor -VMName $VMName -Count ([int]$Cpus)
Set-VMMemory -VMName $VMName -DynamicMemoryEnabled $false -StartupBytes ([int64]$RamGB * 1GB)
'Configuracao aplicada.'
if ($was) { 'Ligando a VM de novo...'; Start-VM -Name $VMName }
