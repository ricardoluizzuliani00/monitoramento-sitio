# Monitoramento do Sítio 4 Irmãos

Projeto de monitoramento de reservatórios de água com ESP32-S3, sensores ambientais, histórico no Firebase e painel web instalável (PWA). Este repositório é uma versão de demonstração preparada para publicação; as configurações reais foram removidas.

## Recursos

- Leitura de nível e volume da caixa d’água.
- Monitoramento de temperatura, umidade e pressão atmosférica.
- Leitura do sensor de chuva.
- Monitoramento da tensão e estimativa de carga da bateria/UPS.
- Histórico e visualização pelo painel web/PWA.
- Integração opcional com Firebase e notificações Telegram.
- Relógio RTC DS3231 e sincronização de horário pela rede.

## Estrutura

- `sitio_4_irmaos_firmware/`: firmware do ESP32-S3.
- `public/`: interface web/PWA e recursos estáticos.
- `functions/`: Firebase Cloud Functions.
- `firebase.json`: configuração de Hosting e Functions.
- `.firebaserc`: modelo de seleção de projeto Firebase.

## Segurança antes de usar

**Não publique credenciais reais.** Os valores de Wi-Fi, Firebase e Telegram no firmware estão vazios. As configurações do Firebase web e o e-mail administrativo foram substituídos por marcadores como `SEU_PROJETO_FIREBASE` e `SEU_EMAIL_ADMIN_AQUI`.

A configuração web do Firebase não deve ser tratada como senha: a segurança depende das regras do Firebase, das configurações de autenticação e das restrições de API. Este pacote não inclui as regras do Realtime Database do seu projeto. **Não conecte este código a um banco real nem faça deploy antes de configurar e testar regras restritivas de leitura/escrita.**

Se credenciais reais já foram publicadas ou compartilhadas, revogue/rotacione as credenciais apropriadas; apagar o valor do arquivo não invalida uma credencial já exposta.

## Configuração do firmware

1. Abra `sitio_4_irmaos_firmware/sitio_4_irmaos_firmware.ino` na Arduino IDE.
2. Preencha localmente as redes Wi-Fi na lista `REDES_WIFI`.
3. Configure `FIREBASE_URL`, `FIREBASE_API_KEY`, `FIREBASE_EMAIL` e `FIREBASE_PASSWORD` com os dados do seu próprio projeto.
4. Configure `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` somente se quiser habilitar os avisos do Telegram.
5. Não faça commit do arquivo com valores reais. Mantenha uma cópia local e revise `git diff` antes de cada commit.

O firmware usa bibliotecas para AHT20, BMP280, ArduinoJson e DS3231/RTClib, além das bibliotecas padrão do ESP32. Instale as dependências compatíveis na Arduino IDE antes de compilar.

## Configuração do painel web/Firebase

Os valores de configuração do Firebase foram substituídos por marcadores para impedir que o repositório aponte para o banco real. Para executar uma cópia própria, crie um projeto Firebase e substitua os marcadores nos blocos `firebaseConfig` dos seguintes arquivos: 

- `public/index.html`
- `public/firebase-messaging-sw.js`
- `public/js/firebase-sync.js`
- `public/js/clima.js`
- `public/js/clima-detalhes.js`
- `public/js/caixa-detalhes.js`

Preencha também `SEU_EMAIL_ADMIN_AQUI` em `public/index.html` e `functions/index.js` com a conta administrativa da sua própria instalação. Atualize `.firebaserc` para o ID do seu projeto.

Antes de publicar ou implantar: configure Authentication, regras do Realtime Database, domínios autorizados e limites/restrições da API key. Confirme que usuários não autenticados não conseguem ler, apagar ou modificar dados protegidos.

## Firebase Functions

A pasta `functions/` contém a função administrativa de reset do histórico. Ela exige usuário autenticado, e-mail administrativo verificado e regras de acesso corretas no projeto. Teste-a em um ambiente de desenvolvimento antes de implantar.

Para instalar dependências dentro de `functions/`, use `npm ci`. Para servir localmente, consulte a documentação oficial do Firebase CLI e configure o projeto de teste primeiro. `node_modules/` e caches locais foram removidos intencionalmente.

## Hardware e pinos

Consulte os comentários no firmware para a atribuição de GPIOs. Verifique a tensão lógica dos sensores, a proteção do pino ECHO do ultrassônico e o divisor de tensão da bateria antes de montar o circuito. Não conecte sinais acima da tensão máxima permitida pelos GPIOs do ESP32-S3.

## Publicação

Este repositório contém código-fonte e recursos do projeto, não dados reais de telemetria, credenciais, caches do Firebase ou dependências instaladas. Faça uma última busca por senhas, tokens, e-mails pessoais, endereços IP privados e dados de logs antes de cada publicação.

## Licença

Nenhuma licença de código foi definida neste pacote. Até que uma licença seja adicionada, a publicação pública permite visualizar o repositório, mas não concede automaticamente permissão para reutilizar, modificar ou redistribuir o código.
