# Diretriz de Sincronização Obrigatória com o Git (Auto-Git Push)

- **Sincronização Obrigatória**: Ao finalizar qualquer alteração de código, ajuste de layout, correção de bug ou nova funcionalidade, **SEMPRE** sincronizar e subir as alterações para o repositório Git remoto.
- **Fluxo Automatizado de Commit e Push**:
  1. Identificar status das alterações (`git status`).
  2. Adicionar arquivos modificados/novos (`git add .`).
  3. Criar commit descritivo (`git commit -m "<mensagem clara do que foi feito>"`).
  4. Enviar para a branch remota (`git push origin <branch_atual>`).
- **Zero Interrupção**: Não perguntar se o usuário deseja fazer o commit/push; executar diretamente como parte natural do ciclo de entrega.
- **Validação de Envio**: Confirmar a conclusão do push antes de finalizar a resposta.
