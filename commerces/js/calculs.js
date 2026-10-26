/* ============================================================
   calculs.js — Logique métier du simulateur commerçants.
   Toutes les valeurs métier proviennent des fichiers JSON
   (data/commerces.json, data/codes-postaux-precalc.json) ;
   rien n'est codé en dur ici.
   ============================================================ */
"use strict";

const CATEGORIES = ["rouge", "orange", "jaune", "verte"];
const CATEGORIES_REDUITES = ["rouge", "orange", "jaune"];

/**
 * Parts de la clientèle par catégorie.
 * Rouge/orange/jaune = part population × coefficient du profil ;
 * verte = complément à 100 % (non pondérée).
 */
function partsClientele(partsPop, profil) {
    const parts = {};
    for (const c of CATEGORIES_REDUITES) {
        parts[c] = partsPop[c] * (profil["coeff" + c.charAt(0).toUpperCase() + c.slice(1)] ?? 1);
    }
    parts.verte = 1 - parts.rouge - parts.orange - parts.jaune;
    return parts;
}

/**
 * Paniers moyens par catégorie : facteur k = panier déclaré / Σ(part × revenu),
 * panier_c = revenu_c × k. Propriété : Σ(part × panier) = panier déclaré.
 */
function paniersParCategorie(partsClient, revenus, panierDeclare) {
    const somme = CATEGORIES.reduce((acc, c) => acc + partsClient[c] * revenus[c], 0);
    const k = somme > 0 ? panierDeclare / somme : 0;
    const paniers = {};
    for (const c of CATEGORIES) {
        paniers[c] = revenus[c] * k;
    }
    return { paniers, k };
}

/**
 * Interpolation linéaire de l'uplift entre deux réductions connues
 * d'une ligne de la matrice (source « sondage »).
 */
function interpolerUplift(reduction, reductionsConnues, upliftsConnus) {
    if (reduction <= reductionsConnues[0]) return upliftsConnus[0];
    const dernier = reductionsConnues.length - 1;
    if (reduction >= reductionsConnues[dernier]) return upliftsConnus[dernier];
    for (let i = 0; i < dernier; i++) {
        const r0 = reductionsConnues[i];
        const r1 = reductionsConnues[i + 1];
        if (reduction >= r0 && reduction <= r1) {
            const t = (reduction - r0) / (r1 - r0);
            return upliftsConnus[i] + t * (upliftsConnus[i + 1] - upliftsConnus[i]);
        }
    }
    return upliftsConnus[dernier];
}

/**
 * Uplift attendu pour un type de commerce et une réduction.
 * Source « sondage » : interpolation dans la ligne du type.
 * Source « estimation » : coefPrudence × moyenne des uplifts des types de base.
 * @returns {{uplift: number, source: string}}
 */
function upliftPour(type, reduction, matrice) {
    if (type.source === "estimation") {
        const upliftsBase = type.base.map((idBase) =>
            interpolerUplift(reduction, matrice.reductions, matrice[idBase])
        );
        const moyenne = upliftsBase.reduce((a, b) => a + b, 0) / upliftsBase.length;
        return { uplift: type.coefPrudence * moyenne, source: "estimation" };
    }
    return {
        uplift: interpolerUplift(reduction, matrice.reductions, matrice[idType(type, matrice)]),
        source: "sondage",
    };
}

// Identifiant de la ligne de matrice pour un type « sondage »
function idType(type, matrice) {
    // Retrouve la clé de matrice correspondant au type (par nom ou par id implicite)
    for (const [cle, ligne] of Object.entries(matrice)) {
        if (cle !== "reductions" && Array.isArray(ligne) && type.idMatrice === cle) {
            return cle;
        }
    }
    return type.idMatrice;
}

/**
 * Simulation complète du mois pour un commerce.
 * @param {object} entree {partsPop, type, profil, facteurAttractivite, marge,
 *   passages, panier, reductions: {rouge, orange, jaune}, parametres, matrice}
 * @returns {object} résultat détaillé par catégorie + agrégats
 */
function simulerMois(entree) {
    const { partsPop, profil, facteurAttractivite, marge, passages, panier, reductions, parametres, matrice } = entree;

    // 1. Parts clientèle (verte = complément)
    const partsClient = partsClientele(partsPop, profil);

    // 2. Passages réels par catégorie
    const passagesReels = {};
    for (const c of CATEGORIES) {
        passagesReels[c] = passages * partsClient[c];
    }

    // 3. Paniers par catégorie (facteur k)
    const { paniers, k } = paniersParCategorie(partsClient, entree.revenus, panier);

    // 4-8. Par catégorie : équivalents, potentiel, uplift, clients+, perte, marge sup
    const parCategorie = {};
    for (const c of CATEGORIES) {
        // Règle de trois ancrée sur la verte (parts population, pas clientèle)
        const passagesEquivalents = partsPop.verte > 0
            ? passagesReels.verte * partsPop[c] / partsPop.verte
            : 0;
        const potentiel = passagesEquivalents * facteurAttractivite;

        let uplift = 0;
        let upliftSource = "sondage";
        let clientsPlus = 0;
        let perte = 0;
        let margeSup = 0;

        if (CATEGORIES_REDUITES.includes(c)) {
            const res = upliftPour(entree.type, reductions[c], matrice);
            uplift = res.uplift;
            upliftSource = res.source;
            clientsPlus = potentiel * uplift * parametres.tauxCapture;
            // Perte sur le chiffre d'affaires (pas de facteur marge)
            perte = passagesReels[c] * paniers[c] * parametres.tauxCapture * reductions[c];
            margeSup = clientsPlus * paniers[c] * (marge - reductions[c]);
        }

        // Frais de service par catégorie (avant cap global)
        const fraisBrut = parametres.fraisServiceParPassage * (passagesReels[c] + clientsPlus);

        parCategorie[c] = {
            partClientele: partsClient[c],
            partPopulation: partsPop[c],
            passagesReels: passagesReels[c],
            passagesEquivalents,
            potentiel,
            uplift,
            upliftSource,
            clientsPlus,
            panier: paniers[c],
            perte,
            margeSup,
            fraisBrut,
        };
    }

    // 9. Frais de service : somme puis cap global
    const fraisTotalBrut = CATEGORIES.reduce((acc, c) => acc + parCategorie[c].fraisBrut, 0);
    const fraisTotal = Math.min(fraisTotalBrut, parametres.capFraisServiceMensuel);
    const fraisCapes = fraisTotalBrut > parametres.capFraisServiceMensuel;

    // 10. Agrégats
    const totalPertes = CATEGORIES_REDUITES.reduce((acc, c) => acc + parCategorie[c].perte, 0);
    const totalMargesSup = CATEGORIES_REDUITES.reduce((acc, c) => acc + parCategorie[c].margeSup, 0);
    const totalClientsPlus = CATEGORIES_REDUITES.reduce((acc, c) => acc + parCategorie[c].clientsPlus, 0);
    const impactNet = totalMargesSup - totalPertes - fraisTotal;

    const caMensuel = passages * panier;
    const margeMensuelle = caMensuel * marge;
    const impactRelatif = margeMensuelle > 0 ? impactNet / margeMensuelle : null;

    return {
        parCategorie,
        facteurK: k,
        fraisTotal,
        fraisTotalBrut,
        fraisCapes,
        totalPertes,
        totalMargesSup,
        totalClientsPlus,
        impactNet,
        caMensuel,
        margeMensuelle,
        impactRelatif,
    };
}

/** Format euro français : espaces insécables, virgule décimale, € après. */
function formaterEuros(valeur, decimales = 0) {
    return new Intl.NumberFormat("fr-FR", {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
    }).format(valeur) + "\u00a0€";
}

/** Format pourcentage français (1 décimale par défaut). */
function formaterPourcent(valeur, decimales = 1) {
    return new Intl.NumberFormat("fr-FR", {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
    }).format(valeur * 100) + "\u00a0%";
}

/** Format nombre entier français (passages, ménages). */
function formaterNombre(valeur) {
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(valeur));
}

/* Export pour les tests Node ; ignoré dans le navigateur. */
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        CATEGORIES,
        CATEGORIES_REDUITES,
        partsClientele,
        paniersParCategorie,
        interpolerUplift,
        upliftPour,
        simulerMois,
        formaterEuros,
        formaterPourcent,
        formaterNombre,
    };
}
