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
  são raros. As chaves ficam em `.env` localmente e em *secrets* do GitHub
  Actions para o build do Pages (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`); nunca em arquivo commitado. Login por e-mail e
  senha (sem provedores sociais, para não exigir configuração extra).
- **Sincronização**: "último a gravar ganha" por registro, comparando
  `updatedAt` (relógio do aparelho). Cada registro tem um `uid` global e
  determinístico (`db/uid.ts`: `mb-<mbid>` para o que vem do MusicBrainz,
  slug de nome/título+ano para o manual), então o mesmo álbum em dois
  aparelhos nunca duplica. Toda gravação local marca `dirty = 1` via
  middleware do Dexie (`db.ts`); a sincronização grava com a transação
  marcada `fromSync` para não sujar. Exclusões viram lápides (`tombstones`)
  enviadas à nuvem. O "desde quando" do pull usa `synced_at` do servidor,
  imune a relógio errado no celular. Os dados pré-carregados (Iron Maiden)
  nascem com data fixa antiga (`SEED_TIMESTAMP`) e `dirty = 0`: só vão para a
  nuvem depois de editados, e qualquer edição ganha deles.
- **Catálogo**: discografias importadas do **MusicBrainz** (busca do artista
  + release groups oficiais **que tenham pelo menos uma edição em vinil**,
  cruzando `release-group` e `release?query=format:*vinyl*`; sem esse filtro
  o Metallica vinha com 571 lançamentos por causa dos shows vendidos em
  download), capas do Cover Art Archive. Motivo da troca em
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
- **Valor pago** fica só no formulário da cópia: não aparece em nenhuma
  visualização (biblioteca, página do álbum), por pedido do usuário. Os
  totais mostram apenas o valor estimado.
- **Importação do MusicBrainz**: a busca paginada pode repetir lançamentos
  entre páginas (deu `ConstraintError` de uid nos Beatles); `fetchDiscography`
  e `importDiscography` removem repetidos antes do `bulkAdd`.

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
8. **Escanear** (aba própria): lê o código de barras com a câmera (ou o
   usuário digita o código / número de catálogo), mostra de que álbum é e
   quais edições existem com aquele código (país, ano, gravadora, catálogo).
   Ao escolher uma: cria o artista (via MusicBrainz, com a discografia
   importada em segundo plano) e o álbum se ainda não existirem, guarda a
   edição em `Album.editions` (`AlbumEdition`, com preço da edição exata via
   `marketplace/stats`) marcada como "tenho" ou "vista", e no "tenho" marca
   o álbum e preenche a cópia (ano/país/gravadora/catálogo/código). Só as
   edições escaneadas são guardadas, nunca todas as versões do Discogs.
   Decisões: edições ficam DENTRO do álbum (JSON) para sincronizar sem mudar
   o esquema do Supabase nem a versão do Dexie. Busca: Discogs
   `database/search?type=release&barcode=` (primeiro `format=Vinyl`, depois
   sem filtro) em paralelo com MusicBrainz `release?query=barcode:A OR
   barcode:B` (EAN-13 com zero à esquerda e UPC-A de 12 dígitos são o mesmo
   código; o MB guarda ora um, ora outro). Leitor: `BarcodeDetector` nativo
   quando existe (Chrome Android), senão `@zxing/browser` carregado sob
   demanda (chunk separado de ~450 KB). Testado com câmera falsa do Chromium
   (`--use-file-for-fake-video-capture` com um Y4M do EAN-13) e com
   respostas reais gravadas em `scratchpad/bc`. Discos antes de ~1985 não têm
   código de barras: usar o número de catálogo (`catno`).

## Fases

- **Fase 1 (concluída)**: esqueleto Vite + React + TS, Dexie, PWA,
  páginas Artistas / Artista / Álbum / Biblioteca / Configurações, dados do
  Iron Maiden pré-carregados, tudo funcionando offline sem conta nenhuma.
- **Fase 2 (concluída)**: login e sincronização com Supabase (projeto
  `lxaqiarpkixiakicpysn`, região São Paulo). Testada com dois "aparelhos" e
  uma nuvem falsa em memória (Playwright), incluindo migração v3→v4,
  exclusões, conflito e sair/entrar, e o esquema real foi validado via REST
  (RLS, trigger de synced_at, upsert). O secret `VITE_SUPABASE_URL` no GitHub
  ficou com a URL do site por engano; por isso `cloud.ts` deduz o endereço a
  partir do `ref` contido na chave anon quando a variável não parece uma URL
  do Supabase. Só a chave anon é realmente necessária.
- **Fase 3 (concluída)**: preço estimado e raridade automáticos via Discogs,
  sem chave: MusicBrainz (`inc=url-rels`) dá o "master" do Discogs (ou busca
  por artista+título), `masters/{id}/versions?format=Vinyl` lista as edições
  em vinil e a mais colecionada vira referência (pulando edições
  `blocked_from_sale`); `marketplace/stats/{release}?curr_abbr=USD` dá menor
  anúncio e quantidade à venda. O master vem primeiro da **busca do Discogs**
  (`database/search` type=master, SEM `format=Vinyl`, porque com o filtro a
  busca omitia o "Fear of the Dark" de estúdio; candidato oficial com título
  exatamente igual, preferindo o ano do álbum ±1 e depois o mais colecionado;
  parênteses contam: "(Live)" é outro disco), porque o link do MusicBrainz
  pode apontar para uma página secundária (Killers → master 14360, bloqueado,
  em vez de 4068163). O usuário pode escolher a página à mão ("Corrigir" na
  página do álbum → `DiscogsMasterPicker`; `discogsMasterSource = manual`
  trava a escolha) e adicionar álbuns direto do Discogs ("+ Álbum" →
  busca por título → `createAlbumFromMaster`, com faixas e capa do master;
  serve para discos fora do MusicBrainz, ex.: clássica). Raridade
  = heurística em `lib/pricing.ts` (coleções no Discogs, à venda, preço);
  `PRICING_ALGO` força reconsulta quando a regra muda. Foto do artista:
  `artists/{id}` do Discogs (id via MusicBrainz url-rels ou busca), guardada em
  `Artist.imageUrl`; o usuário pode pôr uma URL própria (`imageSource` manual).
  Capas: `Cover` recebe uma lista de fontes em ordem (`cardSources`,
  `listSources`, `pageSources` em `components/Cover.tsx`): Cover Art Archive
  em 500 px nos cards, 250 px nas listas, 1200 px na página do álbum (nem
  todo lançamento tem 1200; a cadeia cai para 500), depois a capa grande do
  Discogs (`discogsCoverUrl`, 600 px, via `releases/{id}`, buscada na tarefa
  de preços) e por fim a miniatura (`discogsThumb`, 150 px). O archive.org
  oscila (500/reset), por isso a reserva e a segunda tentativa após 2 s.
  `i.discogs.com` NÃO envia CORS: `Cover` só usa `crossOrigin` nos hosts que
  respondem CORS. `Cover` esconde a `<img>` até o `onLoad`; o estado é
  reiniciado durante a renderização (padrão "prevKey"), NUNCA num
  `useEffect`, porque uma imagem já em cache dispara `onLoad` antes do efeito
  e ficaria invisível para sempre (foi um bug real: fotos de artista sumiam
  ao voltar). A página do álbum mostra primeiro a mesma URL do card (já em
  cache) e troca pela 1200 px via `upgrade` quando ela termina de carregar.
  Valores editados à mão (`priceSource`/`raritySource` = manual) não são
  sobrescritos. Reconsulta a cada 30 dias. Limite do Discogs: 25/min, fila em
  `lib/discogs.ts`. Tarefa `prices` em `jobs.ts`, encadeada após as faixas.
- **Fase 4 (concluída)**: deploy automático no GitHub Pages; instalar no
  celular = abrir a URL no Chrome/Safari e "Adicionar à tela de início".

## Estado atual

- Branch de trabalho: `claude/sleepy-albattani-3pi081`; a `main` espelha
  ela quando o usuário pede para "subir". Cada push em qualquer uma das duas
  publica o app automaticamente no GitHub Pages (1 a 2 minutos).
- Fase 1 pronta e testada no navegador (Playwright): seed, marcar "tenho",
  formulário da cópia, biblioteca com totais, cotação, exportar/importar
  backup, artista e álbum manuais, recarga offline via service worker.
- Importação pelo MusicBrainz pronta (adiantada da fase 3) e testada com
  respostas reais da API gravadas em disco (o Chromium de teste não tem
  internet, então as chamadas são simuladas com `page.route`).
- Nunca alterar uma versão do Dexie já publicada: criar `this.version(5)` etc.
- A prévia publicada como Artifact (build com `VITE_STATIC_DEMO=1`) não tem
  acesso à internet: a busca de artistas mostra um aviso nela. Só funciona
  no app publicado de verdade (fase 4).
- Nuvem ativa: esquema aplicado, "Confirm email" desligado, cadastro aberto.
  Para recriar em outro projeto: rodar `supabase/schema.sql` no SQL Editor,
  desligar "Confirm email", pôr a URL do app em Site URL e colocar a chave
  anon no secret `VITE_SUPABASE_ANON_KEY` (e, se quiser, a Project URL em
  `VITE_SUPABASE_URL`). Sem as chaves o app funciona normalmente, só sem o
  card de login. Nunca guardar a senha do banco no repositório ou no chat.
- Banco Dexie na versão 4 (v4: `uid`, `dirty`, tabela `tombstones`).
- Acesso de rede a MusicBrainz, Discogs e iTunes confirmado com `curl`
  (HTTP 200). O Chromium do ambiente de testes NÃO tem saída para internet,
  então capas externas não aparecem nos testes automatizados; as URLs foram
  validadas com curl.

## Estrutura do código

- `src/db/types.ts` — tipos (Artist, Album, Copy, Setting) e rótulos em PT-BR.
- `src/db/db.ts` — banco Dexie (`vinil`, versão 4), middleware que marca
  `dirty`, `syncTransaction`, `onLocalChange`. `db/ops.ts` — exclusões com
  lápides (usar sempre em vez de `delete` direto). `db/uid.ts` — uids.
- `src/seed/ironMaiden.ts` — 36 LPs do Iron Maiden (gerado por script a
  partir do iTunes Search + Cover Art Archive; raridade e preço são
  estimativas iniciais). `src/seed/seed.ts` popula no primeiro uso e tem o
  "Recolocar Iron Maiden" das Configurações.
- `src/pages/` — uma página por rota: `/` Artistas, `/artistas/:id`,
  `/albuns/:id`, `/biblioteca`, `/configuracoes`.
- `src/components/` — Layout (cabeçalho + barra inferior), Cover, Rarity,
  AlbumCard, formulários (ArtistForm, AlbumForm, CopyForm).
- `src/lib/` — formatação de moeda/data, parser de faixas, backup JSON,
  `musicbrainz.ts` (cliente com fila de 1 req/s, prioridade alta para o que
  o usuário espera e baixa para segundo plano, cancelamento por AbortSignal,
  tentativas em 503), `importArtist.ts` (cria artista + álbuns, carrega
  faixas, revisão com `prune`) e `jobs.ts` (fila global de tarefas em
  segundo plano, fora do React: importar/revisar discografia e buscar
  faixas; continua ao trocar de tela, é retomada ao abrir o app, e uma
  importação interrompe a busca de faixas e a devolve à fila). Artistas
  importados antes do filtro de vinil (sem `discographyReviewedAt`) são
  revisados automaticamente na próxima abertura do app; o Iron Maiden
  (lista curada) é marcado como revisado na versão 3 do banco. `components/JobsBar.tsx` mostra o progresso
  acima do menu, em qualquer tela.
- `src/components/ArtistSearch.tsx` — caixa "Novo artista" com busca e
  importação; `SortFilter.tsx` — ordenação e filtro por raridade;
  `DiscogsMasterPicker.tsx` — busca de páginas do Discogs para corrigir ou
  adicionar álbum; `ScrollManager.tsx` — tela nova abre no topo, "voltar"
  restaura a rolagem (espera a lista carregar).
- `src/lib/cloud.ts` — interface `CloudProvider` + implementação Supabase
  (e `setCloudProvider` para os testes). `src/lib/sync.ts` — motor de
  sincronização (push/pull, estado para a UI, `startSync`, `scheduleSync`).
  `components/AccountCard.tsx` — login/cadastro/sair/sincronizar agora nas
  Configurações. `supabase/schema.sql` — tabelas, trigger de `synced_at` e
  RLS por usuário.
- Build de teste com `VITE_TEST_HOOKS=1` expõe `window.__vinil`
  (`setCloudProvider`, `syncNow`, `db`) para o Playwright.
- `src/lib/discogs.ts` (fila de 25/min, 429 com Retry-After) e
  `src/lib/pricing.ts` (resolução master → edição em vinil → preço/raridade).
- `src/lib/barcode.ts` — busca por código (`lookupCode`) e registro da edição
  (`registerEdition`, `setEditionOwned`, `removeEdition`);
  `components/BarcodeScanner.tsx` — câmera + leitor; `pages/ScanPage.tsx` —
  rota `/escanear`. A página do álbum lista "Edições que encontrei".
- `vite.config.ts` — plugin PWA; capas externas ficam em cache (CacheFirst)
  para funcionar offline. ATENÇÃO: o cache é restrito a
  `request.destination === 'image'`; nunca incluir domínios de API na regra,
  senão o service worker congela as respostas (foi um bug real com
  `discogs.com`).
- Não há testes no repositório; validar com `npm run typecheck` e
  `npm run build`, e testar o fluxo no navegador com `npm run dev`.

## Convenções

- Comandos: `npm run dev`, `npm run build`, `npm run typecheck`.
- Commits em português, mensagens curtas e descritivas.
- A `main` é a branch principal e recebe o código direto da branch de
  trabalho quando o usuário pede (ele preferiu não usar pull request). Nunca
  fazer push em outra branch sem permissão explícita.
