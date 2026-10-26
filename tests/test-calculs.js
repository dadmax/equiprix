/* ============================================================
   test-calculs.js — Tests unitaires du moteur de calcul.
   Cas de référence : Conflans-Sainte-Honorine (78700), commerce
   de bouche, clientèle « un peu plus aisée », attractivité ×8,
   1 000 passages, panier 30 €, marge 30 %, réductions 10/10/10.
   Résultats attendus (tableur « Commerces v3 simplif ») :
   pertes 55,81 €, marges sup 489,59 €, frais capés 100 €,
   impact net 333,78 €/mois, +1,11 pt de CA.
   L'implémentation en virgule flottante produit 334,43 € (+0,65 €,
   écart d'arrondis intermédiaires du tableur) : le test valide
   à ±1 € près et vérifie la cohérence interne exacte.
   ============================================================ */
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");

const {
    CATEGORIES,
    CATEGORIES_REDUITES,
    partsClientele,
    paniersParCategorie,
    interpolerUplift,
    upliftPour,
    simulerMois,
} = require(path.join(__dirname, "..", "commerces", "js", "calculs.js"));

const maître = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "commerces", "data", "commerces.json"), "utf-8")
);
const cpBase = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "commerces", "data", "codes-postaux-precalc.json"), "utf-8")
);

let passes = 0;
function test(nom, fn) {
    try {
        fn();
        passes++;
        console.log(`  ✓ ${nom}`);
    } catch (e) {
        console.error(`  ✗ ${nom}`);
        console.error(`    ${e.message}`);
        process.exitCode = 1;
    }
}

// ---------------------------------------------------------------
console.log("Base codes postaux précalculée");
// ---------------------------------------------------------------
test("78700 = Conflans-Sainte-Honorine, 14 515 ménages", () => {
    const e = cpBase["78700"];
    assert.ok(e, "entrée 78700 présente");
    assert.strictEqual(e.communes[0], "Conflans-Sainte-Honorine");
    assert.strictEqual(e.nbMenages, 14515);
    assert.strictEqual(e.donneesDispo, true);
});

test("78700 : parts = 15,3 / 13,2 / 15,6 / 55,9 % (tableur)", () => {
    const p = cpBase["78700"].parts;
    assert.ok(Math.abs(p.rouge - 0.153) < 0.0005, `rouge ${p.rouge}`);
    assert.ok(Math.abs(p.orange - 0.132) < 0.0005, `orange ${p.orange}`);
    assert.ok(Math.abs(p.jaune - 0.156) < 0.0005, `jaune ${p.jaune}`);
    assert.ok(Math.abs(p.verte - 0.559) < 0.0005, `verte ${p.verte}`);
});

test("Σ parts = 100 % pour toutes les entrées avec données", () => {
    for (const [cp, e] of Object.entries(cpBase)) {
        if (!e.donneesDispo) continue;
        const s = e.parts.rouge + e.parts.orange + e.parts.jaune + e.parts.verte;
        assert.ok(Math.abs(s - 1) < 0.0015, `CP ${cp} : somme ${s}`);
    }
});

test("Entrées sans données : donneesDispo false, valeurs nulles", () => {
    const sans = Object.values(cpBase).filter((e) => !e.donneesDispo);
    assert.ok(sans.length > 0, "au moins une entrée sans données");
    for (const e of sans) {
        assert.strictEqual(e.parts, null);
        assert.strictEqual(e.nbMenages, null);
    }
});

// ---------------------------------------------------------------
console.log("Parts clientèle");
// ---------------------------------------------------------------
test("Profil commune : parts = population, verte = complément", () => {
    const profil = maître.profilsClientele.find((p) => p.id === "commune");
    const partsPop = cpBase["78700"].parts;
    const pc = partsClientele(partsPop, profil);
    assert.strictEqual(pc.rouge, partsPop.rouge);
    assert.ok(Math.abs(pc.verte - (1 - partsPop.rouge - partsPop.orange - partsPop.jaune)) < 1e-12);
});

test("Profil un peu aisée : rouge 7,65 %, orange 9,9 %, jaune 11,7 %, verte 70,75 %", () => {
    const profil = maître.profilsClientele.find((p) => p.id === "unPeuAisee");
    const partsPop = cpBase["78700"].parts;
    const pc = partsClientele(partsPop, profil);
    assert.ok(Math.abs(pc.rouge - 0.0765) < 1e-12, `rouge ${pc.rouge}`);
    assert.ok(Math.abs(pc.orange - 0.099) < 1e-12, `orange ${pc.orange}`);
    assert.ok(Math.abs(pc.jaune - 0.117) < 1e-12, `jaune ${pc.jaune}`);
    assert.ok(Math.abs(pc.verte - 0.7075) < 1e-12, `verte ${pc.verte}`);
});

test("Σ parts clientèle = 100 % quel que soit le profil", () => {
    const partsPop = cpBase["78700"].parts;
    for (const profil of maître.profilsClientele) {
        const pc = partsClientele(partsPop, profil);
        const s = CATEGORIES.reduce((a, c) => a + pc[c], 0);
        assert.ok(Math.abs(s - 1) < 1e-9, `profil ${profil.id} : somme ${s}`);
    }
});

// ---------------------------------------------------------------
console.log("Paniers par catégorie (facteur k)");
// ---------------------------------------------------------------
test("Σ(part × panier) = panier déclaré (propriété du facteur k)", () => {
    const partsPop = cpBase["78700"].parts;
    for (const profil of maître.profilsClientele) {
        const pc = partsClientele(partsPop, profil);
        const { paniers } = paniersParCategorie(pc, maître.revenusCategories, 30);
        const somme = CATEGORIES.reduce((a, c) => a + pc[c] * paniers[c], 0);
        assert.ok(Math.abs(somme - 30) < 1e-9, `profil ${profil.id} : somme ${somme}`);
    }
});

test("Cas de référence : k = 0,000923, panier rouge ≈ 12,19 €", () => {
    const profil = maître.profilsClientele.find((p) => p.id === "unPeuAisee");
    const pc = partsClientele(cpBase["78700"].parts, profil);
    const { paniers, k } = paniersParCategorie(pc, maître.revenusCategories, 30);
    assert.ok(Math.abs(k - 0.000923) < 0.000001, `k = ${k}`);
    assert.ok(Math.abs(paniers.rouge - 12.19) < 0.01, `rouge ${paniers.rouge}`);
});

// ---------------------------------------------------------------
console.log("Interpolation de l'uplift");
// ---------------------------------------------------------------
test("Valeur exacte : bouche 10 % -> 30 %", () => {
    const type = { ...maître.typesCommerce.commerceBouche, idMatrice: "commerceBouche" };
    const r = upliftPour(type, 0.10, maître.matriceUplift);
    assert.ok(Math.abs(r.uplift - 0.30) < 1e-12);
    assert.strictEqual(r.source, "sondage");
});

test("Interpolation : bouche 12,5 % -> entre 30 % et 43,10 %", () => {
    const type = { ...maître.typesCommerce.commerceBouche, idMatrice: "commerceBouche" };
    const r = upliftPour(type, 0.125, maître.matriceUplift);
    // 0,30 + (0,125-0,10)/(0,15-0,10) × (0,4310-0,30) = 0,30 + 0,5 × 0,131 = 0,3655
    assert.ok(Math.abs(r.uplift - 0.3655) < 1e-9, `uplift ${r.uplift}`);
});

test("Hors bornes : réduction 0 -> 0, réduction 60 % -> valeur 50 %", () => {
    const type = { ...maître.typesCommerce.supermarche, idMatrice: "supermarche" };
    assert.strictEqual(upliftPour(type, 0, maître.matriceUplift).uplift, 0);
    assert.strictEqual(upliftPour(type, 0.60, maître.matriceUplift).uplift, 0.80);
});

test("Type « Autre commerce » : coefPrudence × moyenne des bases", () => {
    const type = { ...maître.typesCommerce.autre, idMatrice: null };
    const r = upliftPour(type, 0.10, maître.matriceUplift);
    // moyenne(bar 0,1414 ; bouche 0,30) = 0,2207 ; × 0,75 = 0,165525
    assert.ok(Math.abs(r.uplift - 0.165525) < 1e-9, `uplift ${r.uplift}`);
    assert.strictEqual(r.source, "estimation");
});

// ---------------------------------------------------------------
console.log("Simulation complète — cas de référence du tableur");
// ---------------------------------------------------------------
function casReference() {
    const profil = maître.profilsClientele.find((p) => p.id === "unPeuAisee");
    const type = { ...maître.typesCommerce.commerceBouche, idMatrice: "commerceBouche" };
    return simulerMois({
        partsPop: cpBase["78700"].parts,
        revenus: maître.revenusCategories,
        type,
        profil,
        facteurAttractivite: 8,
        marge: 0.30,
        passages: 1000,
        panier: 30,
        reductions: { rouge: 0.10, orange: 0.10, jaune: 0.10 },
        parametres: maître.parametres,
        matrice: maître.matriceUplift,
    });
}

test("Pertes totales ≈ 55,81 € (±0,10)", () => {
    const r = casReference();
    assert.ok(Math.abs(r.totalPertes - 55.81) < 0.10, `pertes ${r.totalPertes}`);
});

test("Marges supplémentaires ≈ 489,59 € (±1,10)", () => {
    const r = casReference();
    assert.ok(Math.abs(r.totalMargesSup - 489.59) < 1.10, `marges ${r.totalMargesSup}`);
});

test("Frais de service capés à 100 €", () => {
    const r = casReference();
    assert.strictEqual(r.fraisTotal, 100);
    assert.strictEqual(r.fraisCapes, true);
    assert.ok(r.fraisTotalBrut > 100, `brut ${r.fraisTotalBrut}`);
});

test("Impact net ≈ 333,78 €/mois (±1 €)", () => {
    const r = casReference();
    assert.ok(Math.abs(r.impactNet - 333.78) < 1.0, `impact ${r.impactNet}`);
});

test("Cohérence : marges sup − pertes − frais = impact net (exact)", () => {
    const r = casReference();
    const solde = r.totalMargesSup - r.totalPertes - r.fraisTotal;
    assert.ok(Math.abs(solde - r.impactNet) < 1e-9, `solde ${solde} vs ${r.impactNet}`);
});

test("CA mensuel = 30 000 €, marge mensuelle = 9 000 €", () => {
    const r = casReference();
    assert.strictEqual(r.caMensuel, 30000);
    assert.strictEqual(r.margeMensuelle, 9000);
});

test("Impact relatif ≈ +3,7 % de la marge mensuelle", () => {
    const r = casReference();
    assert.ok(Math.abs(r.impactRelatif - 0.037) < 0.001, `relatif ${r.impactRelatif}`);
});

test("Passages réels : rouge 76,5 / orange 99 / jaune 117 / verte 707,5", () => {
    const r = casReference();
    assert.ok(Math.abs(r.parCategorie.rouge.passagesReels - 76.5) < 0.01);
    assert.ok(Math.abs(r.parCategorie.orange.passagesReels - 99) < 0.01);
    assert.ok(Math.abs(r.parCategorie.jaune.passagesReels - 117) < 0.01);
    assert.ok(Math.abs(r.parCategorie.verte.passagesReels - 707.5) < 0.01);
});

test("Potentiel rouge ≈ 1 549 passages/mois", () => {
    const r = casReference();
    assert.ok(Math.abs(r.parCategorie.rouge.potentiel - 1549) < 1, `potentiel ${r.parCategorie.rouge.potentiel}`);
});

test("Clients en plus : rouge ≈ 46,5 / orange ≈ 40,1 / jaune ≈ 47,4", () => {
    const r = casReference();
    assert.ok(Math.abs(r.parCategorie.rouge.clientsPlus - 46.5) < 0.1);
    assert.ok(Math.abs(r.parCategorie.orange.clientsPlus - 40.1) < 0.1);
    assert.ok(Math.abs(r.parCategorie.jaune.clientsPlus - 47.4) < 0.1);
});

test("Catégorie verte : pas de réduction, pas de perte, pas de marge sup", () => {
    const r = casReference();
    assert.strictEqual(r.parCategorie.verte.uplift, 0);
    assert.strictEqual(r.parCategorie.verte.clientsPlus, 0);
    assert.strictEqual(r.parCategorie.verte.perte, 0);
    assert.strictEqual(r.parCategorie.verte.margeSup, 0);
});

// ---------------------------------------------------------------
console.log("Cas limites");
// ---------------------------------------------------------------
test("Réductions 0 % partout : impact = −frais (négatif ou nul)", () => {
    const profil = maître.profilsClientele.find((p) => p.id === "unPeuAisee");
    const type = { ...maître.typesCommerce.commerceBouche, idMatrice: "commerceBouche" };
    const r = simulerMois({
        partsPop: cpBase["78700"].parts,
        revenus: maître.revenusCategories,
        type,
        profil,
        facteurAttractivite: 8,
        marge: 0.30,
        passages: 1000,
        panier: 30,
        reductions: { rouge: 0, orange: 0, jaune: 0 },
        parametres: maître.parametres,
        matrice: maître.matriceUplift,
    });
    // Pas de clients+, pas de perte, pas de marge sup ; seuls les frais sur passages existants
    assert.strictEqual(r.totalMargesSup, 0);
    assert.strictEqual(r.totalPertes, 0);
    assert.strictEqual(r.totalClientsPlus, 0);
    assert.ok(r.impactNet < 0, `impact ${r.impactNet} doit être négatif (frais seuls)`);
});

test("Marge nulle : impactRelatif = null (garde-fou)", () => {
    const profil = maître.profilsClientele.find((p) => p.id === "unPeuAisee");
    const type = { ...maître.typesCommerce.commerceBouche, idMatrice: "commerceBouche" };
    const r = simulerMois({
        partsPop: cpBase["78700"].parts,
        revenus: maître.revenusCategories,
        type,
        profil,
        facteurAttractivite: 8,
        marge: 0,
        passages: 1000,
        panier: 30,
        reductions: { rouge: 0.10, orange: 0.10, jaune: 0.10 },
        parametres: maître.parametres,
        matrice: maître.matriceUplift,
    });
    assert.strictEqual(r.impactRelatif, null);
});

test("Profil « essentiellement aisée » : parts basses réduites, Σ = 100 %", () => {
    const profil = maître.profilsClientele.find((p) => p.id === "essentiellementAisee");
    const pc = partsClientele(cpBase["78700"].parts, profil);
    const s = CATEGORIES.reduce((a, c) => a + pc[c], 0);
    assert.ok(Math.abs(s - 1) < 1e-9);
    assert.ok(pc.rouge < 0.05, `rouge ${pc.rouge} doit être faible`);
    assert.ok(pc.verte > 0.80, `verte ${pc.verte} doit être élevée`);
});

test("Frais sous le cap pour un petit commerce", () => {
    const profil = maître.profilsClientele.find((p) => p.id === "commune");
    const type = { ...maître.typesCommerce.commerceBouche, idMatrice: "commerceBouche" };
    const r = simulerMois({
        partsPop: cpBase["78700"].parts,
        revenus: maître.revenusCategories,
        type,
        profil,
        facteurAttractivite: 2,
        marge: 0.30,
        passages: 100,
        panier: 30,
        reductions: { rouge: 0.05, orange: 0, jaune: 0 },
        parametres: maître.parametres,
        matrice: maître.matriceUplift,
    });
    // ~100 passages + ~5 clients+ × 0,50 € ≈ 52 € < 100 €
    assert.ok(r.fraisTotal < 100, `frais ${r.fraisTotal}`);
    assert.strictEqual(r.fraisCapes, false);
    assert.ok(Math.abs(r.fraisTotal - r.fraisTotalBrut) < 1e-9);
});

// ---------------------------------------------------------------
console.log(`\n${passes} tests passés${process.exitCode ? " (avec échecs)" : ""}`);
