#!/usr/bin/env python3
"""
Dépôt Se-baigner-en-Dordogne : le chat Cbox ne se charge plus qu'après un clic sur
« Accepter et charger le chat », et le texte d'information est complété (service tiers,
cookies possibles, adresse IP transmise), y compris dans l'aide et le tutoriel.
Traite tous les fichiers index*.html du dépôt.

    python3 chat_accord.py            # simulation (n'écrit rien)
    python3 chat_accord.py --write    # applique
Relançable sans risque (idempotent).
"""
import re, sys
from pathlib import Path

COULEUR = "#0b3954"   # couleur du bouton « Accepter » (bleu du site)

NOTE = ('<p class="chat-note">Chat public hébergé par Cbox (service tiers). Il ne se charge qu\'après votre accord : '
        'en l\'acceptant, Cbox peut déposer des cookies et reçoit votre adresse IP. Aucun compte requis, seul un nom '
        'ou pseudo suffit. Les messages sont visibles de tous, ne communiquez aucune information personnelle. '
        'Connexion Internet requise.</p>')

JS = r"""var loaded = false;
            var ok = false;
            try { ok = sessionStorage.getItem('chat-ok') === '1'; } catch (e) {}
            var cont = document.getElementById('chat-container');
            function charger() {
                if (loaded) return;
                if (!navigator.onLine) { cont.textContent = '📡 Le chat nécessite une connexion Internet.'; return; }
                loaded = true;
                var f = document.createElement('iframe');
                f.src = CHAT_URL;
                f.title = 'Chat Cbox';
                f.setAttribute('referrerpolicy', 'no-referrer');
                cont.textContent = '';
                cont.appendChild(f);
            }
            function accepter() { ok = true; try { sessionStorage.setItem('chat-ok', '1'); } catch (e) {} charger(); }
            function ouvrir() {
                modal.classList.add('visible');
                var cb = document.getElementById('chat-close'); if (cb) cb.focus();
                if (loaded) return;
                if (ok) { charger(); return; }
                if (cont.firstChild) return;
                var b = document.createElement('button');
                b.type = 'button'; b.id = 'chat-accept';
                b.textContent = 'Accepter et charger le chat';
                b.style.cssText = 'padding:10px 16px;border:0;border-radius:6px;cursor:pointer;font:inherit;background:@@COULEUR@@;color:#fff;';
                b.addEventListener('click', accepter);
                cont.appendChild(b);
            }
            """.replace("@@COULEUR@@", COULEUR)

# Textes d'aide / tutoriel à compléter (remplacements exacts, relançables sans risque)
AIDES = [
    ("Les messages y sont publics et visibles de tous : ne communiquez aucune information personnelle.</li>",
     "Les messages y sont publics et visibles de tous : ne communiquez aucune information personnelle. "
     "Le chat ne se charge qu'après votre accord (bouton « Accepter et charger le chat ») : Cbox peut alors déposer "
     "des cookies et reçoit votre adresse IP.</li>"),
    ("Le chat est modéré et nécessite une connexion Internet.",
     "Le chat est modéré et nécessite une connexion Internet.<br>"
     "🔒 Le chat ne se charge qu'<b>après votre accord</b> (bouton « Accepter et charger le chat ») : "
     "Cbox peut alors déposer des cookies et reçoit votre adresse IP."),
]

def patch(src):
    if 'id="chat-container"' not in src:
        return src, "pas de chat"
    n = re.sub(r'<p class="chat-note">.*?</p>', lambda m: NOTE, src, count=1, flags=re.S)
    n, k = re.subn(r"var loaded = false;.*?(?=function fermer\(\))", lambda m: JS, n, count=1, flags=re.S)
    if k == 0:
        return src, "code du chat non reconnu"
    trouves = 0
    for ancien, nouveau in AIDES:
        if nouveau in n:
            trouves += 1                      # déjà complété
        elif n.count(ancien) == 1:
            n = n.replace(ancien, nouveau); trouves += 1
    etat = "modifié" if n != src else "déjà à jour"
    return n, f"{etat} (aides : {trouves}/{len(AIDES)})"

def main():
    write = "--write" in sys.argv
    fichiers = sorted(p for p in Path(".").rglob("index*.html")
                      if not any(part.startswith(".") for part in p.parts))
    if not fichiers:
        print("Aucun fichier index*.html trouvé."); return
    for f in fichiers:
        try:
            src = f.read_text(encoding="utf-8", errors="strict")
        except Exception as e:
            print(f"[IGNORÉ ] {f} : lecture impossible ({e})"); continue
        new, etat = patch(src)
        print(f"[{'écrit ' if write else 'simulé'}] {str(f):30} {etat}")
        if write and new != src:
            f.write_text(new, encoding="utf-8")
    if not write:
        print("\nSimulation seulement. Relancez avec --write pour appliquer.")

if __name__ == "__main__":
    main()
