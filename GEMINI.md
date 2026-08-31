# Diretrizes Globais do Projeto (Auto-Approve & Auto-Git Sync)

## 1. Aprovação Automática Total e Execução Direta (Auto-Approve)
- **Aprovação Automática Total**: Toda e qualquer alteração de código, ajuste de layout/CSS/JS, refatoração, criação de arquivos, execução de comandos e correções solicitadas pelo usuário estão **100% pré-aprovadas**.
- **Sem Interrupções para Confirmação**: **NUNCA** pausar para pedir autorização, confirmação ou permissão manual (ex.: *"Posso aplicar?"*, *"Deseja continuar?"*, *"Quer que eu envie para o Git?"*).
- **Validação Autônoma**: O próprio agente valida a sintaxe (ex: `node --check server.js`), integridade e coerência das alterações antes de finalizar.
- **Auto-Yes em Todas as Etapas**: Executar diretamente todas as etapas necessárias de ponta a ponta e entregar a solução pronta e funcional.

## 2. Sincronização Obrigatória e Automática com o Git (Auto-Push)
- **Sempre Subir ao Finalizar**: Ao concluir qualquer alteração, correção ou nova funcionalidade, **SEMPRE** sincronizar com o repositório Git automaticamente.
- **Fluxo de Sincronização Git**:
  1. `git status` para verificar as alterações.
  2. `git add .` para incluir todas as alterações relevantes.
  3. `git commit -m "<descrição objetiva da alteração realizada>"`
  4. `git push origin <branch_atual>`
- **Garantia de Envio**: O push para o repositório remoto deve ser executado e confirmado antes de dar a resposta final ao usuário.
