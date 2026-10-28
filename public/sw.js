const CACHE_NAME = "sitio-4-irmaos-v7-4-20260928";

const ARQUIVOS_OFFLINE = [
    "./",
    "./index.html",
    "./caixa.html",
    "./clima.html",
    "./style.css",
    "./css/detalhes.css",
    "./css/clima-detalhes.css",
    "./js/bateria.js",
    "./js/caixa-detalhes.js",
    "./js/clima-detalhes.js",
    "./manifest.json",
    "./icons/logo-sitio.png"
];

// ======================================================
// INSTALAÇÃO
// Pré-carrega os arquivos necessários para modo offline
// ======================================================

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ARQUIVOS_OFFLINE))
            .then(() => self.skipWaiting())
    );
});

// ======================================================
// ATIVAÇÃO
// Remove caches antigos e assume o controle imediatamente
// ======================================================

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(nomes =>
                Promise.all(
                    nomes.map(nome => {
                        if (nome !== CACHE_NAME) {
                            return caches.delete(nome);
                        }
                    })
                )
            )
            .then(() => self.clients.claim())
    );
});

// ======================================================
// FETCH
//
// ONLINE:
// Sempre tenta buscar o arquivo mais recente no servidor.
//
// OFFLINE:
// Usa a última versão salva no cache.
//
// Quando encontra uma versão nova online,
// atualiza automaticamente o cache.
// ======================================================

self.addEventListener("fetch", event => {

    const request = event.request;

    // Somente requisições GET
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // Ignora protocolos que não sejam HTTP/HTTPS
    if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
    ) {
        return;
    }

    // Não interfere em Firebase, CDN, APIs etc.
    if (url.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        fetch(request, {
            cache: "no-store"
        })
        .then(response => {

            // Só salva respostas válidas
            if (
                response &&
                response.status === 200
            ) {

                const copia = response.clone();

                event.waitUntil(
                    caches.open(CACHE_NAME)
                        .then(cache =>
                            cache.put(request, copia)
                        )
                );
            }

            return response;
        })
        .catch(async () => {

            // Sem internet → procura no cache
            const cacheado =
                await caches.match(request);

            if (cacheado) {
                return cacheado;
            }

            // Se for navegação e não encontrar exatamente
            // a página, tenta abrir a página principal offline.
            if (request.mode === "navigate") {

                const index =
                    await caches.match("./index.html");

                if (index) {
                    return index;
                }
            }

            return new Response(
                "Sem conexão e arquivo não disponível offline.",
                {
                    status: 503,
                    statusText: "Offline"
                }
            );
        })
    );
});