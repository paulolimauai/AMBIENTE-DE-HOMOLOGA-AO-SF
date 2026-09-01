# Diretrizes Globais do Projeto (Auto-Approve & Auto-Git Sync)

## 1. Aprovação Automática Total, Modificação Direta de Arquivos e Execução Sem Perguntas (Zero Interrupts)
- **Modificação Direta Sem Perguntar**: Todo e qualquer arquivo deve ser modificado, criado ou excluído diretamente **SEM NUNCA PERGUNTAR** ao usuário.
- **Sem Interrupções para Confirmação**: **NUNCA** pausar ou perguntar em momento algum (*"Posso aplicar?"*, *"Deseja continuar?"*, *"Quer que eu altere o arquivo?"*, *"Posso enviar para o Git?"*).
- **Aprovação Automática Total (Auto-Approve Permanente)**: Toda solicitação do usuário, ajuste visual/CSS/JS, refatoração, criação/edição de arquivos e comandos estão **100% pré-aprovados e memorizados permanentemente**.
- **Validação Autônoma**: O próprio agente valida a sintaxe (ex: `node --check server.js`), integridade e coerência das alterações antes de finalizar.
- **Auto-Yes de Ponta a Ponta**: Executar todas as etapas necessárias de forma totalmente autônoma e entregar a solução pronta e funcional.

## 2. Sincronização Obrigatória e Automática com o Git (Auto-Push)
- **Sempre Subir ao Finalizar**: Ao concluir qualquer alteração, correção ou nova funcionalidade, **SEMPRE** sincronizar com o repositório Git automaticamente sem perguntar.
- **Fluxo de Sincronização Git**:
  1. `git status` para verificar as alterações.
  2. `git add .` para incluir todas as alterações relevantes.
  3. `git commit -m "<descrição objetiva da alteração realizada>"`
  4. `git push origin <branch_atual>`
- **Garantia de Envio**: O push para o repositório remoto deve ser executado e confirmado antes de dar a resposta final ao usuário.

## 3. Apresentação Visual de Alterações de Código (Padrão Antigravity CLI Diff)
- **Apresentação no Formato Diff**: Ao programar ou alterar qualquer trecho de código, **SEMPRE** apresentar as alterações em bloco visual de `diff` com numeração de linhas, destacando claramente:
  - Linhas originais removidas (`-`)
  - Linhas novas adicionadas (`+`)
  - Linhas de contexto imediatas para rastreabilidade
  Exatamente como na visualização interativa do Antigravity CLI no terminal do VS Code.

