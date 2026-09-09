# Vinil — coleção de LPs

App pessoal para catalogar a coleção de LPs de Allan (allandavid18@gmail.com) e
comparar o que ele tem com a discografia completa de cada artista. Responder
sempre em português do Brasil. O usuário é iniciante em Git, GitHub e Claude
Code: explicar cada passo do fluxo (branch, commit, push, pull request) de
forma simples quando fizer sentido.

## Decisões já tomadas (não reabrir sem motivo)

- **Formato**: web app PWA (React + TypeScript + Vite), instalável no celular,
  em vez de app Android nativo. Motivo: mesmo código no celular e no PC, sem
  Play Store, deploy automático a cada merge.
- **Offline-first**: dados ficam no IndexedDB do navegador (Dexie). O app
  funciona sem internet e enfileira mudanças para sincronizar quando conectar.
- **Backend (fase 2)**: Supabase (Postgres). Escolhido em vez de Firebase por
  ser SQL, mais fácil de entender e consultar; uso pessoal, conflitos de sync
  são raros. As chaves ficam em `.env` e nunca vão para o GitHub.
- **Catálogo (fase 3)**: importar discografias pela API do Discogs, com
  MusicBrainz / Cover Art Archive e iTunes Search como fontes de capa.
- **Hospedagem (fase 4)**: Vercel ou Netlify, deploy automático da branch main.
- **Moedas**: preço estimado do disco mostrado em USD e convertido para BRL
  (cotação ajustável em Configurações). Valor pago pelo usuário sempre em BRL.
- **Local de compra**: apenas cidade e país.

## Funcionalidades combinadas

1. **Artistas**: lista com contagem "tenho X de Y". Começa com a discografia
   completa do Iron Maiden em LP (estúdio, ao vivo, coletâneas, EPs). Outras
   bandas serão informadas pelo usuário depois.
2. **Álbum**: capa, ano de lançamento, gravadora, faixas, raridade (escala 1 a
   5), preço estimado (USD + BRL), notas. Marcar como "tenho" ou "quero".
3. **Minha cópia** (quando marcado como "tenho"): ano e país da prensagem,
   gravadora da edição, condição do disco e da capa (escala Goldmine: M, NM,
   VG+, VG, G, F, P), valor pago em BRL, cidade e país da compra, data,
   observações.
4. **Biblioteca**: consolida tudo que o usuário tem, agrupado por banda, com
   busca e filtros, totais de discos, valor pago e valor estimado.
5. **Adicionar artista/álbum manualmente** pelo app (fase 1); importar do
   Discogs (fase 3).
6. **Backup**: exportar/importar JSON nas Configurações.

## Fases

- **Fase 1 (em andamento)**: esqueleto Vite + React + TS, Dexie, PWA,
  páginas Artistas / Artista / Álbum / Biblioteca / Configurações, dados do
  Iron Maiden pré-carregados, tudo funcionando offline sem conta nenhuma.
- **Fase 2**: login e sincronização com Supabase.
- **Fase 3**: importação de artistas pelo Discogs dentro do app.
- **Fase 4**: deploy automático e instalação no celular.

## Estado atual

- Branch de trabalho: `claude/sleepy-albattani-3pi081`.
- Já feito: `package.json` com dependências instaladas (react, react-dom,
  react-router-dom, dexie, dexie-react-hooks; dev: vite, @vitejs/plugin-react,
  typescript, vite-plugin-pwa, @types/react, @types/react-dom).
- Ainda não existe código em `src/`. Próximo passo: escrever o app da fase 1.
- A sessão anterior não tinha acesso de rede a MusicBrainz, Discogs e iTunes.
  O ambiente foi alterado para acesso Full; confirmar com um `curl` antes de
  depender dessas APIs.

## Convenções

- Comandos: `npm run dev`, `npm run build`, `npm run typecheck`.
- Commits em português, mensagens curtas e descritivas.
- Nunca fazer push em outra branch sem permissão explícita; a `main` só
  recebe código via pull request aprovado pelo usuário.
