# Diretrizes de Execução Direta, Validação Total e Auto-Approve (Zero Perguntas)

- **Modificação e Execução Direta Sem Perguntar**: Todo e qualquer comando de terminal, modificação, criação ou exclusão de arquivo deve ser executado diretamente **SEM NUNCA PERGUNTAR** ou pausar.
- **Sem Interrupções para Confirmação**: **NUNCA** pausar ou perguntar em momento algum (*"Posso aplicar?"*, *"Deseja continuar?"*, *"Quer que eu altere o arquivo?"*, *"Posso rodar o teste?"*, *"Posso enviar para o Git?"*).
- **Aprovação Automática Total (Auto-Approve Permanente)**: Todas as solicitações, validações, refatorações, criação/edição de arquivos e testes estão **100% pré-aprovados e memorizados permanentemente**.
- **Validação Autônoma e Resiliência**: O próprio agente valida a sintaxe (ex: `node --check server.js`), integridade e coerência das alterações antes de finalizar, corrigindo autonomamente qualquer falha detectada (auto-healing).
- **Auto-Yes em Todas as Ações**: Executar diretamente todas as ações necessárias de ponta a ponta, validar o projeto em execução e sincronizar no Git sem impedimentos.
- **Zero Modais de Confirmação ou Botões 'Proceed'**: NUNCA pausar para aprovação de planos ou botões 'Proceed'/'Accept'. Executar e entregar as modificações prontas de ponta a ponta.
