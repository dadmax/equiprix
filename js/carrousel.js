/* ============================================================
   carrousel.js — Carrousel de maquettes d'appli (partagé :
   accueil, /particuliers/, /commerces/).

   Sur mobile (< 992px, géré en CSS dans style.css) :
   - scroll horizontal à scroll-snap, une maquette visible + aperçu
     de la suivante ;
   - pastilles .ccm-dot (au-dessus du carrousel) : clic = aller à l'étape ;
   - flèches latérales .ccm-arrow ‹ › : étape précédente / suivante
     (avec retour au début après la dernière) ;
   - la pastille active suit le scroll.
   Sur desktop (>= 992px) : grille 3 colonnes, pastilles et flèches
   masquées en CSS ; ce script ne fait alors que poser les écouteurs.
   ============================================================ */
(function () {
    "use strict";

    function initCarrousel(grille) {
        const portee = grille.parentElement; // .ccm-carousel
        if (!portee) return;
        const dots = Array.from(portee.querySelectorAll(".ccm-dot"));
        const etapes = Array.from(grille.querySelectorAll(".ccm-etape"));
        if (etapes.length === 0) return;
        let indiceActuel = 0;

        function activerDot(i) {
            indiceActuel = i;
            dots.forEach((dot, k) => {
                const actif = k === i;
                dot.classList.toggle("actif", actif);
                if (actif) dot.setAttribute("aria-current", "true");
                else dot.removeAttribute("aria-current");
            });
        }

        // Étape dont le centre est le plus proche du centre de la zone visible
        function indiceLePlusProche() {
            const centre = grille.scrollLeft + grille.clientWidth / 2;
            let meilleur = 0, meilleureDist = Infinity;
            etapes.forEach((etape, i) => {
                const c = etape.offsetLeft + etape.offsetWidth / 2;
                const dist = Math.abs(c - centre);
                if (dist < meilleureDist) { meilleureDist = dist; meilleur = i; }
            });
            return meilleur;
        }

        function allerA(i) {
            const etape = etapes[i];
            if (!etape) return;
            activerDot(i);
            const cible = Math.max(0, etape.offsetLeft - (grille.clientWidth - etape.offsetWidth) / 2);
            try {
                if (typeof grille.scrollTo === "function") {
                    grille.scrollTo({ left: cible, behavior: "smooth" });
                } else {
                    grille.scrollLeft = cible;
                }
            } catch (e) {
                grille.scrollLeft = cible;
            }
        }

        // Pastilles : clic = aller à l'étape
        dots.forEach((dot, i) => dot.addEventListener("click", () => allerA(i)));

        // Flèches latérales : précédente / suivante (boucle sur les 3 étapes)
        const prec = portee.querySelector(".ccm-prev");
        const suiv = portee.querySelector(".ccm-next");
        if (suiv) suiv.addEventListener("click", () => allerA((indiceActuel + 1) % etapes.length));
        if (prec) prec.addEventListener("click", () => allerA((indiceActuel - 1 + etapes.length) % etapes.length));

        // Pastille active = étape la plus proche du centre pendant le scroll
        const raf = window.requestAnimationFrame || ((f) => setTimeout(f, 16));
        let enAttente = false;
        grille.addEventListener("scroll", () => {
            if (enAttente) return;
            enAttente = true;
            raf(() => {
                enAttente = false;
                activerDot(indiceLePlusProche());
            });
        }, { passive: true });
    }

    function boot() {
        document.querySelectorAll(".ccm-grid").forEach(initCarrousel);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
