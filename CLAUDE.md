# Vinil — coleção de LPs

App pessoal para catalogar a coleção de LPs de Allan e
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
- **Catálogo**: discografias importadas do **MusicBrainz** (busca do artista
  + release groups oficiais), capas do Cover Art Archive. Motivo da troca em
  relação ao Discogs: a busca do Discogs exige token de API, que ficaria
  exposto dentro de um app de navegador; o MusicBrainz não precisa de chave,
  aceita chamadas do navegador (CORS) e já classifica estúdio / ao vivo /
  coletânea / EP. O Discogs fica para a fase 3 como fonte de preço estimado
  e raridade (estatísticas de mercado), não de discografia.
- **Hospedagem (fase 4)**: GitHub Pages, em https://macacolino.github.io/Vinil-App/
  (repositório `macacolino/Vinil-App`, antes chamado `main`). Atenção: o
  Pages diferencia maiúsculas no nome do repositório, então a URL precisa
  ser escrita exatamente assim; se o repositório for renomeado para
  minúsculas, a URL muda junto e basta rodar o workflow de novo. Workflow
  `.github/workflows/deploy-pages.yml`: publica a cada push na `main` e,
  enquanto durar o desenvolvimento, também na branch de trabalho. O
  repositório é público (exigência do Pages gratuito). O build usa
  `VITE_BASE=/<nome-do-repositório>/`, calculado no workflow; `404.html` é
  uma cópia do `index.html` para links diretos funcionarem.
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
5. **Adicionar artista**: digita o nome, escolhe na lista (MusicBrainz) e a
   discografia inteira é importada; faixas e gravadora são buscadas quando o
   álbum é aberto ou pelo botão "Buscar faixas de todos". Também dá para
   cadastrar artista e álbum à mão.
6. **Raridade**: escala 1 a 5 em estrelas nos cards e na biblioteca, com
   ordenação e filtro. Os valores do Iron Maiden são estimativas iniciais
   feitas à mão; álbuns importados começam com 2 até o usuário ajustar.
7. **Backup**: exportar/importar JSON nas Configurações.

## Fases

- **Fase 1 (concluída)**: esqueleto Vite + React + TS, Dexie, PWA,
  páginas Artistas / Artista / Álbum / Biblioteca / Configurações, dados do
  Iron Maiden pré-carregados, tudo funcionando offline sem conta nenhuma.
- **Fase 2**: login e sincronização com Supabase.
- **Fase 3**: preço estimado e raridade automáticos (Discogs marketplace
  stats), refinamentos da importação (filtrar só edições em vinil).
- **Fase 4 (concluída)**: deploy automático no GitHub Pages; instalar no
  celular = abrir a URL no Chrome/Safari e "Adicionar à tela de início".

## Estado atual

- Branch de trabalho: `claude/sleepy-albattani-3pi081`. Cada push nela
  publica o app automaticamente no GitHub Pages (1 a 2 minutos).
- Fase 1 pronta e testada no navegador (Playwright): seed, marcar "tenho",
  formulário da cópia, biblioteca com totais, cotação, exportar/importar
  backup, artista e álbum manuais, recarga offline via service worker.
- Importação pelo MusicBrainz pronta (adiantada da fase 3) e testada com
  respostas reais da API gravadas em disco (o Chromium de teste não tem
  internet, então as chamadas são simuladas com `page.route`).
- Banco Dexie na versão 2 (índices `mbid` e `rarity`). Nunca alterar uma
  versão já publicada: criar `this.version(3)` etc.
- A prévia publicada como Artifact (build com `VITE_STATIC_DEMO=1`) não tem
  acesso à internet: a busca de artistas mostra um aviso nela. Só funciona
  no app publicado de verdade (fase 4).
- Próximo passo: fase 2 (Supabase). Os campos `createdAt`/`updatedAt` já
  existem em todas as tabelas para facilitar a sincronização.
- Acesso de rede a MusicBrainz, Discogs e iTunes confirmado com `curl`
  (HTTP 200). O Chromium do ambiente de testes NÃO tem saída para internet,
  então capas externas não aparecem nos testes automatizados; as URLs foram
  validadas com curl.

## Estrutura do código

- `src/db/types.ts` — tipos (Artist, Album, Copy, Setting) e rótulos em PT-BR.
- `src/db/db.ts` — banco Dexie (`vinil`, versão 2) e chaves de settings.
- `src/seed/ironMaiden.ts` — 36 LPs do Iron Maiden (gerado por script a
  partir do iTunes Search + Cover Art Archive; raridade e preço são
  estimativas iniciais). `src/seed/seed.ts` popula no primeiro uso e tem o
  "Recolocar Iron Maiden" das Configurações.
- `src/pages/` — uma página por rota: `/` Artistas, `/artistas/:id`,
  `/albuns/:id`, `/biblioteca`, `/configuracoes`.
- `src/components/` — Layout (cabeçalho + barra inferior), Cover, Rarity,
  AlbumCard, formulários (ArtistForm, AlbumForm, CopyForm).
- `src/lib/` — formatação de moeda/data, parser de faixas, backup JSON,
  `musicbrainz.ts` (cliente com fila de 1 req/s e tentativas em 503) e
  `importArtist.ts` (cria artista + álbuns, carrega faixas).
- `src/components/ArtistSearch.tsx` — caixa "Novo artista" com busca e
  importação; `SortFilter.tsx` — ordenação e filtro por raridade.
- `vite.config.ts` — plugin PWA; capas externas ficam em cache
  (CacheFirst) para funcionar offline.
- Não há testes no repositório; validar com `npm run typecheck` e
  `npm run build`, e testar o fluxo no navegador com `npm run dev`.

## Convenções

- Comandos: `npm run dev`, `npm run build`, `npm run typecheck`.
- Commits em português, mensagens curtas e descritivas.
- Nunca fazer push em outra branch sem permissão explícita; a `main` só
  recebe código via pull request aprovado pelo usuário.
