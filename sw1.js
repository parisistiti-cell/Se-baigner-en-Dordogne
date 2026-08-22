// Service Worker - TP Baignades Dordogne
// Objectif : permettre de consulter l'app (et les cartes déjà vues) même sans
// réseau, ce qui correspond à l'usage réel du site (bords de rivière, zones
// souvent mal couvertes). On ne met en cache QUE l'app elle-même, ses icônes,
// et les tuiles de carte (OpenStreetMap / CartoDB) déjà chargées une fois.
// Les appels dynamiques (météo, webcams, recherche Photon, Base de Lieux...)
// ne sont jamais mis en cache : ils doivent toujours refléter les données
// les plus fraîches quand une connexion est disponible.

const CACHE_VERSION = 'tp-baignades-v1';
const APP_SHELL_CACHE = CACHE_VERSION + '-shell';
const TILES_CACHE = CACHE_VERSION + '-tiles';
const MAX_TILES_EN_CACHE = 400; // limite volontairement modeste pour ne pas saturer le stockage de l'appareil

const APP_SHELL_URLS = [
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
            .catch(() => {}) // si un fichier manque, on ne bloque pas l'installation
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((noms) => Promise.all(
            noms.filter((nom) => nom !== APP_SHELL_CACHE && nom !== TILES_CACHE)
                .map((nom) => caches.delete(nom))
        ))
    );
    self.clients.claim();
});

function estUneTuileDeCarte(url) {
    return /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) ||
           /(^|\.)basemaps\.cartocdn\.com$/.test(url.hostname);
}

// Purge simple : si le cache des tuiles dépasse la limite, on retire les plus
// anciennes entrées (approximation LRU basée sur l'ordre d'insertion).
async function purgerCacheTuilesSiNecessaire() {
    const cache = await caches.open(TILES_CACHE);
    const cles = await cache.keys();
    if (cles.length > MAX_TILES_EN_CACHE) {
        const nbASupprimer = cles.length - MAX_TILES_EN_CACHE;
        for (let i = 0; i < nbASupprimer; i++) {
            await cache.delete(cles[i]);
        }
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    let url;
    try { url = new URL(request.url); } catch (e) { return; }

    // 1. Tuiles de carte : cache-first (une tuile déjà vue ne change jamais),
    //    avec mise à jour silencieuse en arrière-plan si le réseau est là.
    if (estUneTuileDeCarte(url)) {
        event.respondWith(
            caches.open(TILES_CACHE).then(async (cache) => {
                const reponseCache = await cache.match(request);
                const fetchPromise = fetch(request).then((reponseReseau) => {
                    if (reponseReseau && reponseReseau.ok) {
                        cache.put(request, reponseReseau.clone());
                        purgerCacheTuilesSiNecessaire();
                    }
                    return reponseReseau;
                }).catch(() => null);
                return reponseCache || fetchPromise || new Response('', { status: 504 });
            })
        );
        return;
    }

    // 2. Page principale (navigation) : réseau d'abord (pour avoir les
    //    dernières mises à jour), repli sur le cache si hors-ligne.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((reponse) => {
                    caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, reponse.clone()));
                    return reponse;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // 3. Bibliothèque Leaflet (JS/CSS) et autres ressources statiques du même
    //    site : cache-first avec repli réseau, pour accélérer les visites
    //    suivantes et fonctionner hors-ligne une fois chargées une première fois.
    if (url.origin === self.location.origin || /unpkg\.com|cdnjs\.cloudflare\.com|jsdelivr\.net/.test(url.hostname)) {
        event.respondWith(
            caches.match(request).then((reponseCache) => {
                if (reponseCache) return reponseCache;
                return fetch(request).then((reponseReseau) => {
                    if (reponseReseau && reponseReseau.ok) {
                        caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, reponseReseau.clone()));
                    }
                    return reponseReseau;
                }).catch(() => reponseCache);
            })
        );
        return;
    }

    // 4. Tout le reste (météo, webcams, Photon, Base de Lieux, Wikidata...) :
    //    on laisse passer normalement, sans jamais mettre en cache — ces
    //    données doivent rester à jour dès qu'une connexion existe.
});
