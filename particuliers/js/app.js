/* ============================================================
   app.js — Application du simulateur de niveau de vie.
   Charge le JSON de bornes, gère la saisie et met à jour
   les résultats en temps réel (mises à jour ciblées, pas de
   re-render complet).
   ============================================================ */
"use strict";

/* ---------- État ---------- */
const etat = {
    donnees: null,          // contenu du JSON
    departement: "",        // code du département sélectionné
    reference: "france",    // population de référence de la jauge
    adultes: 1,
    enfants: 0,
    revenu: 0,              // saisi manuellement (peut dépasser le max du slider)
};

const MAX_SLIDER = 100000;

/* ---------- Raccourcis DOM ---------- */
const $ = (id) => document.getElementById(id);

const dom = {
    selectDepartement: $("departement"),
    inputRevenu: $("revenu"),
    sliderRevenu: $("revenu-slider"),
    inputAdultes: $("adultes"),
    inputEnfants: $("enfants"),
    ucValeur: $("uc-valeur"),
    etatVide: $("etat-vide"),
    resultats: $("resultats"),
    erreurData: $("erreur-data"),
    niveauVie: $("niveau-vie"),
    segFrance: $("seg-france"),
    segDep: $("seg-dep"),
    libellePercentile: $("libelle-percentile"),
    jauge: $("jauge"),
    jaugeMarker: $("jauge-marker"),
    badgeCategorie: $("badge-categorie"),
    accBtn: $("acc-btn"),
    accContenu: $("acc-contenu"),
};

/* ---------- Chargement des données ---------- */
async function chargerDonnees() {
    try {
        const reponse = await fetch("data/niveaux-vie-dep-2023.json");
        if (!reponse.ok) throw new Error("HTTP " + reponse.status);
        etat.donnees = await reponse.json();
        remplirDepartements();
        construireJauge();
        recalculer();
    } catch (err) {
        console.error("Chargement des données impossible :", err);
        dom.erreurData.hidden = false;
    }
}

/** Remplit le select des départements, triés par code. */
function remplirDepartements() {
    const tries = [...etat.donnees.departements].sort((a, b) => a.code.localeCompare(b.code));
    for (const dep of tries) {
        const option = document.createElement("option");
        option.value = dep.code;
        option.textContent = dep.code + " – " + dep.nom;
        dom.selectDepartement.appendChild(option);
    }
}

/* ---------- Jauge ----------
   La jauge représente la population : chaque tranche de 10 % de hauteur
   contient 10 % de la population, classée du niveau de vie le plus bas
   (en bas) au plus haut (en haut). Les déciles et quartiles sont
   matérialisés par des pointillés à la hauteur exacte de leur percentile. */

/** Couleur equiprix d'une hauteur de jauge : sous D1 rouge, D1–Q1 orange,
 *  Q1–médiane jaune, au-delà vert. Les bandes suivent les bornes, pas
 *  des tranches arbitraires : la couleur change à la hauteur du percentile. */
function couleurHauteur(percentile) {
    if (percentile < 10) return "rouge";
    if (percentile < 25) return "orange";
    if (percentile < 50) return "jaune";
    return "vert";
}

/** Construit la jauge : bandes de catégories + pointillés des bornes. */
function construireJauge() {
    dom.jauge.innerHTML = "";

    // Bandes de couleurs : une par changement de catégorie (5 segments :
    // 0–10 rouge, 10–25 orange, 25–50 jaune, 50–100 vert en deux bandes
    // pour conserver des hauteurs de 10 % visibles lors des transitions)
    const segments = [
        { de: 0, a: 10, couleur: "rouge" },
        { de: 10, a: 25, couleur: "orange" },
        { de: 25, a: 50, couleur: "jaune" },
        { de: 50, a: 100, couleur: "vert" },
    ];
    for (const seg of segments) {
        const bande = document.createElement("div");
        bande.className = "sim-jauge-bande sim-jauge-" + seg.couleur;
        bande.style.bottom = seg.de + "%";
        bande.style.height = (seg.a - seg.de) + "%";
        dom.jauge.appendChild(bande);
    }
}

/**
 * Met à jour les pointillés des déciles/quartiles à leur hauteur exacte
 * (percentile), avec leur valeur en euros, pour la population choisie.
 */
function mettreAJourBornes(bornes) {
    // Retire les anciens repères
    dom.jauge.querySelectorAll(".sim-jauge-repere").forEach((r) => r.remove());

    const couples = [
        { cle: "d1", percentile: 10 },
        { cle: "q1", percentile: 25 },
        { cle: "d5", percentile: 50, libelle: "médiane" },
        { cle: "q3", percentile: 75 },
        { cle: "d9", percentile: 90 },
    ];
    for (const c of couples) {
        const repere = document.createElement("div");
        repere.className = "sim-jauge-repere";
        repere.style.bottom = c.percentile + "%";
        repere.title = (c.libelle || c.cle.toUpperCase()) + " : " + formaterEuros(bornes[c.cle]);
        const libelle = document.createElement("span");
        libelle.textContent = (c.libelle || c.cle.toUpperCase()) + " " + formaterEuros(bornes[c.cle]);
        repere.appendChild(libelle);
        dom.jauge.appendChild(repere);
    }
}

/** Positionne le curseur avec une animation de montée/descente fluide. */
function positionnerMarker(pourcentage) {
    dom.jaugeMarker.style.transition = "bottom 0.4s cubic-bezier(0.22, 0.61, 0.36, 1)";
    dom.jaugeMarker.style.bottom = Math.min(100, Math.max(0, pourcentage)) + "%";
}

/* ---------- Libellés ---------- */

/** Libellé contextuel du positionnement, en français courant.
 *  Cas 1 : > D9 → top 10 %. Cas 2 : médiane–D9 → top X %.
 *  Cas 3 : D1–médiane → les X % les plus bas. Cas 4 : < D1 → les 10 % les plus bas. */
function libellePercentile(resultat, bornes) {
    const p = resultat.percentile;
    if (resultat.cas === "bas") {
        return "Vous êtes dans les 10 % des niveaux de vie les plus bas.";
    }
    if (resultat.cas === "haut") {
        return "Vous êtes dans le top 10 % des niveaux de vie.";
    }
    if (p >= 50) {
        return "Vous êtes dans le top " + (100 - Math.round(p)) + " % des niveaux de vie.";
    }
    return "Vous êtes dans les " + Math.round(p) + " % des niveaux de vie les plus bas.";
}

/* ---------- Recalcul (temps réel, mises à jour ciblées) ---------- */
function bornesReference() {
    if (etat.reference === "departement" && etat.departement) {
        const dep = etat.donnees.departements.find((d) => d.code === etat.departement);
        if (dep) return dep;
    }
    return etat.donnees.france;
}

function recalculer() {
    if (!etat.donnees) return;

    // Unités de consommation (temps réel, même à revenu 0)
    const uc = calculerUC(etat.adultes, etat.enfants);
    dom.ucValeur.textContent = formaterDecimal(uc);

    // État vide tant que le revenu est à 0
    const complet = etat.revenu > 0;
    dom.etatVide.hidden = complet;
    dom.resultats.hidden = !complet;
    if (!complet) return;

    // Niveau de vie
    const niveauDeVie = calculerNiveauDeVie(etat.revenu, uc);
    dom.niveauVie.textContent = new Intl.NumberFormat("fr-FR").format(niveauDeVie);

    // Position dans la population de référence
    const bornes = bornesReference();
    const resultat = calculerPercentile(niveauDeVie, bornes);
    dom.libellePercentile.textContent = libellePercentile(resultat, bornes);
    mettreAJourBornes(bornes);
    positionnerMarker(calculerPositionJauge(niveauDeVie, bornes));
    dom.jauge.setAttribute(
        "aria-label",
        "Distribution des niveaux de vie. " + dom.libellePercentile.textContent
    );

    // Catégorie equiprix : toujours sur les bornes France entière
    const categorie = calculerCategorie(niveauDeVie, etat.donnees.france);
    dom.badgeCategorie.textContent = categorie.libelle;
    dom.badgeCategorie.className = "sim-categorie-badge cat-" + categorie.cle;
}

/* ---------- Saisie : parsing tolérant (espaces, virgule) ---------- */
function parserNombre(texte) {
    const nettoye = String(texte).replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
    const valeur = parseFloat(nettoye);
    return Number.isFinite(valeur) ? valeur : NaN;
}

/* ---------- Écouteurs ---------- */

/** Département : active le segment département de la section 2. */
dom.selectDepartement.addEventListener("change", () => {
    etat.departement = dom.selectDepartement.value;
    const dep = etat.donnees && etat.departement
        ? etat.donnees.departements.find((d) => d.code === etat.departement)
        : null;
    if (dep) {
        dom.segDep.disabled = false;
        dom.segDep.textContent = dep.nom;
    } else {
        dom.segDep.disabled = true;
        dom.segDep.textContent = "Sélectionnez un département";
        if (etat.reference === "departement") {
            etat.reference = "france";
            majSegments();
        }
    }
    recalculer();
});

/** Message d'aide si le segment département est cliqué alors qu'aucun département n'est choisi. */
dom.segDep.addEventListener("click", () => {
    if (dom.segDep.disabled && !dom.selectDepartement.value) {
        dom.selectDepartement.focus();
        dom.selectDepartement.setAttribute("aria-describedby", "aide-departement aide-departement-manquante");
        const aide = document.createElement("p");
        aide.id = "aide-departement-manquante";
        aide.className = "sim-help";
        aide.style.color = "var(--secondary-color)";
        aide.textContent = "Choisissez d’abord votre département dans la section « Vos informations ».";
        dom.selectDepartement.insertAdjacentElement("afterend", aide);
        setTimeout(() => {
            aide.remove();
            dom.selectDepartement.setAttribute("aria-describedby", "aide-departement");
        }, 4000);
    }
});

/** Slider de revenu : met à jour le champ texte. */
dom.sliderRevenu.addEventListener("input", () => {
    etat.revenu = Number(dom.sliderRevenu.value);
    dom.inputRevenu.value = new Intl.NumberFormat("fr-FR").format(etat.revenu);
    recalculer();
});

/** Champ texte de revenu : saisie directe libre (peut dépasser le slider, clampé visuellement). */
dom.inputRevenu.addEventListener("input", () => {
    const valeur = parserNombre(dom.inputRevenu.value);
    etat.revenu = Number.isNaN(valeur) || valeur < 0 ? 0 : Math.round(valeur);
    dom.sliderRevenu.value = Math.min(etat.revenu, MAX_SLIDER);
    recalculer();
});

/** Compteurs : boutons +/− avec bornage. */
document.querySelectorAll(".sim-compteur-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const cible = btn.dataset.cible === "adultes" ? dom.inputAdultes : dom.inputEnfants;
        const min = Number(cible.min);
        const max = Number(cible.max);
        let valeur = parserNombre(cible.value);
        if (Number.isNaN(valeur)) valeur = min;
        valeur = Math.min(max, Math.max(min, valeur + Number(btn.dataset.sens)));
        if (btn.dataset.cible === "adultes") etat.adultes = valeur;
        else etat.enfants = valeur;
        cible.value = String(valeur);
        majBoutonsCompteurs();
        recalculer();
    });
});

/** Compteurs : saisie clavier directe avec bornage au blur. */
[dom.inputAdultes, dom.inputEnfants].forEach((champ) => {
    champ.addEventListener("input", () => {
        const valeur = parserNombre(champ.value);
        const min = Number(champ.min);
        const max = Number(champ.max);
        if (!Number.isNaN(valeur)) {
            const bornee = Math.min(max, Math.max(min, Math.round(valeur)));
            if (champ === dom.inputAdultes) etat.adultes = bornee;
            else etat.enfants = bornee;
        }
        recalculer();
    });
    champ.addEventListener("blur", () => {
        const min = Number(champ.min);
        const max = Number(champ.max);
        const valeur = parserNombre(champ.value);
        const bornee = Number.isNaN(valeur) ? min : Math.min(max, Math.max(min, Math.round(valeur)));
        if (champ === dom.inputAdultes) etat.adultes = bornee;
        else etat.enfants = bornee;
        champ.value = String(bornee);
        majBoutonsCompteurs();
        recalculer();
    });
});

/** Désactive les boutons +/− aux bornes. */
function majBoutonsCompteurs() {
    $("adultes-moins").disabled = etat.adultes <= Number(dom.inputAdultes.min);
    $("adultes-plus").disabled = etat.adultes >= Number(dom.inputAdultes.max);
    $("enfants-moins").disabled = etat.enfants <= Number(dom.inputEnfants.min);
    $("enfants-plus").disabled = etat.enfants >= Number(dom.inputEnfants.max);
}

/** Segmented button France / département. */
function majSegments() {
    dom.segFrance.setAttribute("aria-selected", String(etat.reference === "france"));
    dom.segDep.setAttribute("aria-selected", String(etat.reference === "departement"));
}

dom.segFrance.addEventListener("click", () => {
    etat.reference = "france";
    majSegments();
    recalculer();
});

dom.segDep.addEventListener("click", () => {
    if (dom.segDep.disabled) return;
    etat.reference = "departement";
    majSegments();
    recalculer();
});

/** Navigation clavier gauche/droite du segmented button. */
[dom.segFrance, dom.segDep].forEach((segment) => {
    segment.addEventListener("keydown", (evenement) => {
        if (evenement.key !== "ArrowLeft" && evenement.key !== "ArrowRight") return;
        const autre = segment === dom.segFrance ? dom.segDep : dom.segFrance;
        if (autre.disabled) return;
        autre.focus();
        autre.click();
    });
});

/** Accordéon « Comprendre le calcul » : ouvert par défaut sur desktop. */
dom.accBtn.addEventListener("click", () => {
    const ouvert = dom.accBtn.getAttribute("aria-expanded") === "true";
    dom.accBtn.setAttribute("aria-expanded", String(!ouvert));
    dom.accContenu.hidden = ouvert;
});

/** Fermé par défaut sur mobile/tablette (empilement vertical). */
function initAccordion() {
    if (window.matchMedia("(min-width: 992px)").matches) {
        dom.accBtn.setAttribute("aria-expanded", "true");
        dom.accContenu.hidden = false;
    } else {
        dom.accBtn.setAttribute("aria-expanded", "false");
        dom.accContenu.hidden = true;
    }
}

/* ---------- Menu mobile (identique au site) ---------- */
document.querySelector(".hamburger").addEventListener("click", function () {
    document.querySelector(".nav-sidebar").classList.toggle("open");
});

document.querySelectorAll(".nav-sidebar a").forEach((link) => {
    link.addEventListener("click", function () {
        document.querySelector(".nav-sidebar").classList.remove("open");
    });
});

/* ---------- Démarrage ---------- */
initAccordion();
majBoutonsCompteurs();
chargerDonnees();
