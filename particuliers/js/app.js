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

const MAX_SLIDER = 200000;

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
    jaugeEchelleD1: $("echelle-d1"),
    jaugeEchelleMed: $("echelle-med"),
    jaugeEchelleD9: $("echelle-d9"),
    badgeCategorie: $("badge-categorie"),
    blocCategorieDyn: $("bloc-categorie-dyn"),
    texteCategorieDyn: $("texte-categorie-dyn"),
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

/* ---------- Jauge ---------- */

/** Couleur equiprix d'une tranche selon son percentile de début.
 *  Bandes de catégories : rouge 0–D1, orange D1–Q1, jaune Q1–médiane,
 *  vert au-delà — les tranches étant en quantiles (10 % de hauteur chacune). */
function couleurSegment(percentileDebut) {
    if (percentileDebut < 10) return "rouge";
    if (percentileDebut < 25) return "orange";
    if (percentileDebut < 50) return "jaune";
    return "vert";
}

/** Construit les 10 tranches de la jauge (structure fixe, contenus mis à jour ensuite). */
function construireJauge() {
    dom.jauge.innerHTML = "";
    for (let i = 0; i < 10; i++) {
        const tranche = document.createElement("div");
        tranche.className = "sim-tranche";
        tranche.dataset.percentileDebut = String(i * 10);
        const borne = document.createElement("span");
        borne.className = "sim-tranche-borne";
        tranche.appendChild(borne);
        dom.jauge.appendChild(tranche);
    }
}

/**
 * Met à jour la jauge pour la population de référence choisie.
 * Chaque tranche démarre à un décile (percentile 10 × numéro de tranche),
 * affiché en euros ; la première tranche démarre à 0 €.
 */
function mettreAJourJauge(bornes) {
    const tranches = dom.jauge.querySelectorAll(".sim-tranche");
    for (const tranche of tranches) {
        const p = Number(tranche.dataset.percentileDebut);
        tranche.classList.remove(
            "sim-tranche-rouge", "sim-tranche-orange", "sim-tranche-jaune", "sim-tranche-verte"
        );
        tranche.classList.add("sim-tranche-" + couleurSegment(p));

        // Borne en euros de départ : décile correspondant (D1…D9), 0 € pour la première
        const borne = p === 0 ? 0 : bornes["d" + (p / 10)];
        const libelle = p === 0 ? "0 €" : formaterEuros(borne);
        tranche.querySelector(".sim-tranche-borne").textContent = libelle;
        tranche.title = "Population entre les percentiles " + p + " et " + (p + 10)
            + (p === 0 ? "" : " — à partir de " + libelle);
    }

    // Échelle sous la jauge : D1, médiane, D9 (minimum)
    dom.jaugeEchelleD1.textContent = "D1 : " + formaterEuros(bornes.d1);
    dom.jaugeEchelleMed.textContent = "médiane : " + formaterEuros(bornes.d5);
    dom.jaugeEchelleD9.textContent = "D9 : " + formaterEuros(bornes.d9);
}

/** Position du curseur (0 à 100 %) sur la hauteur de la jauge. */
function positionnerMarker(percentile, cas) {
    let pourcentage;
    if (cas === "bas") pourcentage = 0;        // butée gauche (bas de la jauge)
    else if (cas === "haut") pourcentage = 100; // butée droite (haut de la jauge)
    else pourcentage = Math.min(100, Math.max(0, percentile));
    dom.jaugeMarker.style.bottom = pourcentage + "%";
}

/* ---------- Libellés ---------- */

/** « 63e percentile — vous avez un niveau de vie supérieur à 63 % de la population … » */
function libellePercentile(resultat, nomPopulation) {
    if (resultat.cas === "bas") {
        return "Vous êtes dans les 10 % de niveaux de vie les plus bas (moins de 10e percentile) — population " + nomPopulation + ".";
    }
    if (resultat.cas === "haut") {
        return "Vous êtes dans le top 10 % (plus de 90e percentile) — population " + nomPopulation + ".";
    }
    return "Vous êtes au " + resultat.percentile + "e percentile — vous avez un niveau de vie supérieur à "
        + resultat.percentile + " % de la population " + nomPopulation + ".";
}

/** Texte du bloc dynamique de la section 4, selon la catégorie. */
function texteCategorieDynamique(categorie) {
    const intro = "Sur la base des informations saisies, vous êtes en catégorie ";
    switch (categorie.cle) {
        case "vert":
            return intro + "verte (top 50 % des niveaux de vie) : vous ne serez pas forcément éligible aux réductions equiprix.";
        case "jaune":
            return intro + "jaune (50 % des niveaux de vie les plus bas) : vous aurez accès à des réductions en magasin.";
        case "orange":
            return intro + "orange (25 % des niveaux de vie les plus bas) : vous aurez accès à des réductions importantes en magasin.";
        case "rouge":
            return intro + "rouge (10 % des niveaux de vie les plus bas) : vous aurez accès aux réductions les plus importantes en magasin.";
    }
    return "";
}

/* ---------- Recalcul (temps réel, mises à jour ciblées) ---------- */
function bornesReference() {
    if (etat.reference === "departement" && etat.departement) {
        const dep = etat.donnees.departements.find((d) => d.code === etat.departement);
        if (dep) return { bornes: dep, nom: "du " + dep.nom };
    }
    return { bornes: etat.donnees.france, nom: "française" };
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
    dom.blocCategorieDyn.hidden = !complet;
    if (!complet) return;

    // Niveau de vie
    const niveauDeVie = calculerNiveauDeVie(etat.revenu, uc);
    dom.niveauVie.textContent = new Intl.NumberFormat("fr-FR").format(niveauDeVie);

    // Position dans la population de référence
    const { bornes, nom } = bornesReference();
    const resultat = calculerPercentile(niveauDeVie, bornes);
    dom.libellePercentile.textContent = libellePercentile(resultat, nom);
    mettreAJourJauge(bornes);
    positionnerMarker(resultat.percentile, resultat.cas);
    dom.jauge.setAttribute(
        "aria-label",
        "Distribution des niveaux de vie. " + dom.libellePercentile.textContent
    );

    // Catégorie equiprix : toujours sur les bornes France
    const categorie = calculerCategorie(niveauDeVie, etat.donnees.france);
    dom.badgeCategorie.textContent = categorie.libelle;
    dom.badgeCategorie.className = "sim-categorie-badge cat-" + categorie.cle;
    dom.texteCategorieDyn.textContent = texteCategorieDynamique(categorie);
    dom.blocCategorieDyn.className = "sim-categorie-dyn cat-" + categorie.cle;
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
