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
 * Positionne un niveau de vie dans la distribution d'une population.
 * Interpolation linéaire entre les deux bornes qui l'encadrent.
 * @returns {{percentile: number, cas: "bas"|"haut"|"interieur"}}
 */
function calculerPercentile(niveauDeVie, bornes) {
    if (niveauDeVie < bornes.d1) {
        return { percentile: 10, cas: "bas" }; // « dans les 10 % les plus bas »
    }
    if (niveauDeVie >= bornes.d9) {
        return { percentile: 90, cas: "haut" }; // « dans le top 10 % »
    }
    const couples = bornesPercentiles(bornes);
    for (let i = 0; i < couples.length - 1; i++) {
        const bas = couples[i];
        const haut = couples[i + 1];
        if (niveauDeVie >= bas.valeur && niveauDeVie < haut.valeur) {
            const part = (niveauDeVie - bas.valeur) / (haut.valeur - bas.valeur);
            return {
                percentile: Math.round(bas.percentile + part * (haut.percentile - bas.percentile)),
                cas: "interieur",
            };
        }
    }
    // Cas résiduel (niveauDeVie == D9 exactement, déjà traité par le test >=)
    return { percentile: 90, cas: "haut" };
}

/**
 * Catégorie equiprix, toujours définie sur les bornes France :
 * rouge (< D1), orange (D1–Q1), jaune (Q1–médiane), verte (>= médiane).
 * @returns {{cle: string, libelle: string, sousTexte: string}}
 */
function calculerCategorie(niveauDeVie, bornesFrance) {
    if (niveauDeVie < bornesFrance.d1) {
        return {
            cle: "rouge",
            libelle: "Catégorie rouge — les 10 % des niveaux de vie les plus bas",
            sousTexte: "les 10 % des niveaux de vie les plus bas",
        };
    }
    if (niveauDeVie < bornesFrance.q1) {
        return {
            cle: "orange",
            libelle: "Catégorie orange — les 25 % des niveaux de vie les plus bas",
            sousTexte: "les 25 % des niveaux de vie les plus bas",
        };
    }
    if (niveauDeVie < bornesFrance.d5) {
        return {
            cle: "jaune",
            libelle: "Catégorie jaune — les 50 % des niveaux de vie les plus bas",
            sousTexte: "les 50 % des niveaux de vie les plus bas",
        };
    }
    return {
        cle: "vert",
        libelle: "Catégorie verte — top 50 % des niveaux de vie",
        sousTexte: "top 50 % des niveaux de vie",
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
        calculerCategorie,
        bornesPercentiles,
        formaterEuros,
        formaterDecimal,
    };
}
