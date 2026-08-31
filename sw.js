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
    './icon-512.png',
    './france-littoral.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
            .catch(() => {}) // si un fichier manque, on ne bloque pas l'installation
    );
    // Pas de self.skipWaiting() ici : on laisse le nouveau Service Worker en
    // attente ("waiting") tant que l'utilisateur n'a pas confirmé la mise à
    // jour via le bandeau "🔄 Nouvelle version disponible" côté page (qui
    // envoie le message SKIP_WAITING ci-dessous). Sans ça, une mise à jour
    // déployée pendant qu'un road trip est en cours de préparation
    // rechargerait la page sans prévenir, au moment où l'utilisateur s'y
    // attend le moins.
});

// Déclenché par le clic sur "Recharger" du bandeau de mise à jour (voir
// index.html) : fait prendre la main au nouveau Service Worker tout de
// suite, ce qui provoque l'évènement "controllerchange" côté page et son
// rechargement.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
                // IMPORTANT : ne jamais résoudre sur null ici. fetchPromise est un objet
                // Promise, donc "reponseCache || fetchPromise" est TOUJOURS vrai (un objet est
                // toujours "truthy" en JS, même une Promise qui résoudra plus tard sur null) —
                // le "|| new Response(...)" plus bas ne servait donc jamais de filet de
                // sécurité. Si fetch() échouait (pas de réseau, tuile jamais vue), la Promise
                // résolvait sur null et respondWith() plantait avec "Failed to convert value to
                // 'Response'". On renvoie donc directement une Response de repli ici.
                }).catch(() => new Response('', { status: 504 }));
                return reponseCache || fetchPromise;
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
                    // IMPORTANT : cloner IMMÉDIATEMENT (avant tout "await"/.then() async).
                    // Sinon, le temps que caches.open() se résolve, le navigateur a déjà
                    // commencé à consommer le corps de "reponse" (on l'a déjà "return"-é ci-
                    // dessous pour afficher la page) → clone() échoue avec "Response body is
                    // already used".
                    const copie = reponse.clone();
                    caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copie));
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
                        // Cloner IMMÉDIATEMENT (voir commentaire équivalent au cas 2 ci-dessus) :
                        // sinon la mise en cache asynchrone arrive après que le corps de la
                        // réponse a déjà été consommé par celui qui a demandé la ressource
                        // (le <script>/<link> qui l'a chargée), et clone() échoue.
                        const copie = reponseReseau.clone();
                        caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copie));
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
