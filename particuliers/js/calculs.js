/* ============================================================
   calculs.js — Logique métier du simulateur de niveau de vie.
   Toutes les bornes (déciles, quartiles) proviennent du JSON,
   rien n'est codé en dur ici.
   ============================================================ */
"use strict";

/** Échelle OCDE modifiée : 1 UC au premier adulte, 0,5 par autre 14 ans ou plus,
 *  0,3 par enfant de moins de 14 ans. Garantit uc >= 1 (pas de division par zéro). */
function calculerUC(nb14Plus, nbEnfants) {
    if (nb14Plus <= 0) {
        // Foyer composé uniquement d'enfants (cas marginal) : uc >= 1
        return Math.max(1, 0.5 * nb14Plus + 0.3 * nbEnfants);
    }
    return 1 + 0.5 * Math.max(0, nb14Plus - 1) + 0.3 * nbEnfants;
}

/** Niveau de vie = revenu annuel net / unités de consommation, arrondi à l'euro. */
function calculerNiveauDeVie(revenu, uc) {
    return Math.round(revenu / uc);
}

/** Bornes ordonnées avec leur percentile : D1, Q1 (2,5e décile), D3..D7, Q3, D9. */
function bornesPercentiles(bornes) {
    return [
        { valeur: bornes.d1, percentile: 10 },
        { valeur: bornes.q1, percentile: 25 },
        { valeur: bornes.d3, percentile: 30 },
        { valeur: bornes.d4, percentile: 40 },
        { valeur: bornes.d5, percentile: 50 },
        { valeur: bornes.d6, percentile: 60 },
        { valeur: bornes.d7, percentile: 70 },
        { valeur: bornes.q3, percentile: 75 },
        { valeur: bornes.d8, percentile: 80 },
        { valeur: bornes.d9, percentile: 90 },
    ];
}

/**
 * Percentile exact d'un niveau de vie par interpolation linéaire entre
 * les deux bornes qui l'encadrent (D1, Q1, D3…D7, Q3, D8, D9).
 * @returns {{percentile: number, cas: "bas"|"haut"|"interieur"}}
 */
function calculerPercentile(niveauDeVie, bornes) {
    if (niveauDeVie < bornes.d1) {
        return { percentile: 10, cas: "bas" };
    }
    if (niveauDeVie >= bornes.d9) {
        return { percentile: 90, cas: "haut" };
    }
    const couples = bornesPercentiles(bornes);
    for (let i = 0; i < couples.length - 1; i++) {
        const bas = couples[i];
        const haut = couples[i + 1];
        if (niveauDeVie >= bas.valeur && niveauDeVie < haut.valeur) {
            const part = (niveauDeVie - bas.valeur) / (haut.valeur - bas.valeur);
            return {
                percentile: bas.percentile + part * (haut.percentile - bas.percentile),
                cas: "interieur",
            };
        }
    }
    return { percentile: 90, cas: "haut" };
}

/**
 * Position géométrique du curseur sur la jauge (0 = bas, 100 = haut).
 * Bornes étendues D0 = 0 € et D10 virtuel = MAX_JAUGE : l'utilisateur
 * au-dessus de D9 ou sous D1 est placé entre la borne et l'extrémité,
 * plutôt que collé en butée.
 * @returns {number} pourcentage 0–100 (non arrondi)
 */
function calculerPositionJauge(niveauDeVie, bornes) {
    const MAX_JAUGE = 100000; // D10 virtuel : max de la jauge en euros
    if (niveauDeVie <= 0) return 0;
    if (niveauDeVie < bornes.d1) {
        return 10 * (niveauDeVie / bornes.d1); // entre D0 (0 €) et D1
    }
    if (niveauDeVie >= bornes.d9) {
        // entre D9 et D10 virtuel, plafonné à 100 %
        return Math.min(100, 90 + 10 * (niveauDeVie - bornes.d9) / (MAX_JAUGE - bornes.d9));
    }
    return calculerPercentile(niveauDeVie, bornes).percentile;
}

/**
 * Catégorie equiprix, toujours définie sur les bornes France :
 * rouge (< D1), orange (D1–Q1), jaune (Q1–médiane), verte (>= médiane).
 * @returns {{cle: string, libelle: string}}
 */
function calculerCategorie(niveauDeVie, bornesFrance) {
    if (niveauDeVie < bornesFrance.d1) {
        return {
            cle: "rouge",
            libelle: "Catégorie rouge : les 10 % des niveaux de vie les plus bas, France entière > réductions très importantes en magasin.",
        };
    }
    if (niveauDeVie < bornesFrance.q1) {
        return {
            cle: "orange",
            libelle: "Catégorie orange : les 25 % des niveaux de vie les plus bas, France entière > réductions importantes en magasin.",
        };
    }
    if (niveauDeVie < bornesFrance.d5) {
        return {
            cle: "jaune",
            libelle: "Catégorie jaune : les 50 % des niveaux de vie les plus bas, France entière > réductions en magasin.",
        };
    }
    return {
        cle: "vert",
        libelle: "Catégorie verte : les 50 % des niveaux de vie les plus hauts, France entière > pas de réductions.",
    };
}

/** Format français : espaces insécables pour les milliers. */
function formaterEuros(valeur) {
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(valeur) + " €";
}

/** Format français à une décimale, virgule décimale. */
function formaterDecimal(valeur) {
    return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(valeur);
}

/* Export pour les tests Node ; ignoré dans le navigateur. */
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        calculerUC,
        calculerNiveauDeVie,
        calculerPercentile,
        calculerPositionJauge,
        calculerCategorie,
        bornesPercentiles,
        formaterEuros,
        formaterDecimal,
    };
}
