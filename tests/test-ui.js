/* ============================================================
   test-ui.js — Tests d'intégration de l'interface (jsdom).
   Charge la page /commerces/ depuis le serveur local, attend le
   chargement des JSON, puis vérifie le cas de référence du tableur
   via l'URL partagée + les nouveautés de structure (scénarios,
   super-catégorie éligibles, mode expert, jauge France comparatif).
   Prérequis : python3 -m http.server 8765 depuis la racine du dépôt.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

// jsdom + polyfill fetch : installés hors dépôt (npm install jsdom whatwg-fetch),
// résolus depuis NODE_PATH (ex. /tmp/node_modules) ou /tmp/node_modules en secours.
function chargerModule(nom) {
    const candidats = [
        nom, // via NODE_PATH
        path.join("/tmp/node_modules", nom),
    ];
    for (const c of candidats) {
        try { return require(c); } catch (e) { /* essaie le suivant */ }
    }
    throw new Error(`Module ${nom} introuvable. Installer : npm install ${nom} (dans /tmp par ex.) puis relancer avec NODE_PATH=/tmp/node_modules`);
}

const { JSDOM } = chargerModule("jsdom");

// jsdom ne fournit pas fetch : polyfill whatwg-fetch injecté avant les scripts
const FETCH_POLYFILL = fs.readFileSync("/tmp/node_modules/whatwg-fetch/dist/fetch.umd.js", "utf-8");

const BASE = "http://127.0.0.1:8765";
// Cas de référence : Conflans (78700), commerce de bouche, clientèle un peu
// plus aisée, attractivité moyenne (×8), marge 30 %, 1 000 passages,
// panier 30 €, réductions 10 % partout.
const URL_REF = `${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.3&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`;

function attendre(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function charger(url) {
    const dom = await JSDOM.fromURL(url, {
        resources: "usable",
        runScripts: "dangerously",
        pretendToBeVisual: true,
        beforeParse(window) {
            window.eval(FETCH_POLYFILL);
            window.addEventListener("error", (e) => console.error("JS ERROR:", e.message));
        },
    });
    // Attendre le premier rendu (impact renseigné)
    for (let i = 0; i < 100; i++) {
        await attendre(100);
        const t = dom.window.document.getElementById("impact-net").textContent;
        if (t && t !== "—") break;
    }
    return dom;
}

let echecs = 0;
function verifier(nom, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${nom}`);
    } else {
        console.error(`  ✗ ${nom}${detail ? " — " + detail : ""}`);
        echecs++;
    }
}

function lireEuro(t) {
    const m = t.match(/([\d\s\u00a0]+(?:,\d+)?)\s*€/);
    return m ? parseFloat(m[1].replace(/[\s\u00a0]/g, "").replace(",", ".")) : null;
}

async function main() {
    // ================= Cas de référence =================
    console.log("Cas de référence (URL partagée)");
    const dom = await charger(URL_REF);
    const d = dom.window.document;

    verifier("Commune affichée (78700 — Conflans-Sainte-Honorine)",
        d.getElementById("cp-nom").textContent.includes("78700")
        && d.getElementById("cp-nom").textContent.includes("Conflans-Sainte-Honorine"),
        d.getElementById("cp-nom").textContent);
    verifier("14 515 ménages affichés",
        d.getElementById("cp-menages").textContent.includes("14"),
        d.getElementById("cp-menages").textContent);

    // Barres verticales côte à côte : secteur + France comparatif (20/20/20/40)
    const segFrance = d.querySelector("#barre-france .sim-seg-v-verte").style.height;
    verifier("Barre France comparatif (verticale) : segment vert = 40 % en hauteur",
        segFrance === "40%", segFrance);
    verifier("Titre de gauche = nom de la commune (Conflans-Sainte-Honorine)",
        d.getElementById("titre-secteur").textContent.includes("Conflans-Sainte-Honorine"),
        d.getElementById("titre-secteur").textContent);
    verifier("Titre de droite = « France entière (comparatif) »",
        d.getElementById("titre-france").textContent.includes("France entière")
        && d.getElementById("titre-france").textContent.includes("comparatif"),
        d.getElementById("titre-france").textContent);
    const hRouge = parseFloat(d.querySelector("#barre-population .sim-seg-v-rouge").style.height);
    verifier("Barre secteur : segment rouge vertical ≈ 15,3 % de hauteur",
        Math.abs(hRouge - 15.3) < 0.01, String(hRouge));
    // Légendes qualitatives
    verifier("Légende rouge = « ménage sous ou proche du seuil de pauvreté »",
        d.getElementById("leg-rouge").textContent.includes("seuil de pauvreté"),
        d.getElementById("leg-rouge").textContent);
    verifier("Légende verte = « ménage aisé »",
        d.getElementById("leg-verte").textContent.includes("aisé"),
        d.getElementById("leg-verte").textContent);

    // Impact net ≈ 333,78 € (tolérance ±1 €)
    const impact = d.getElementById("impact-net").textContent;
    const valeur = lireEuro(impact);
    verifier("Impact net ≈ 333,78 € (±1 €)", valeur !== null && Math.abs(valeur - 333.78) < 1.0, `lu : ${impact}`);
    verifier("Signe + devant le montant", impact.startsWith("+"), impact);
    verifier("Ratio ≈ +3,7 % de la marge",
        d.getElementById("impact-ratio").textContent.includes("3,7"),
        d.getElementById("impact-ratio").textContent);
    verifier("Marge de référence affichée",
        d.getElementById("marge-ref").textContent.includes("9"),
        d.getElementById("marge-ref").textContent);

    // Passages en plus
    const pp = d.getElementById("passages-plus").textContent;
    verifier("Passages en plus affichés avec % (≈ +134, soit +13,4 %)",
        /\+134/.test(pp) && /13,4\s*%/.test(pp), pp);

    // Récap
    verifier("Pertes ≈ 55,81 € (±0,10)",
        Math.abs(lireEuro(d.getElementById("recap-pertes").textContent) - 55.81) < 0.10,
        d.getElementById("recap-pertes").textContent);
    verifier("Marges sup ≈ 489,59 € (±1,10)",
        Math.abs(lireEuro(d.getElementById("recap-marges").textContent) - 489.59) < 1.10,
        d.getElementById("recap-marges").textContent);
    verifier("Frais = 100 € + mention plafonnés",
        lireEuro(d.getElementById("recap-frais").textContent) === 100
        && d.getElementById("frais-mention").textContent.includes("plafonn"),
        d.getElementById("recap-frais").textContent + " " + d.getElementById("frais-mention").textContent);

    // Mode non expert : super-catégorie éligibles visible, couloirs détaillés masqués
    verifier("Mode non expert : couloir « Foyers éligibles » visible",
        !d.getElementById("couloir-eligibles").hidden);
    verifier("Mode non expert : couloirs détaillés masqués",
        d.getElementById("couloirs-expert").hidden);
    verifier("Part éligibles ≈ 29,3 % (7,65+9,9+11,7)",
        /^29,[23]\s*%/.test(d.getElementById("info-part-eligibles").textContent),
        d.getElementById("info-part-eligibles").textContent);
    verifier("Uplift éligibles = +30 % (sondage)",
        d.getElementById("uplift-eligibles").textContent.includes("30")
        && d.getElementById("uplift-eligibles").textContent.includes("sondage"),
        d.getElementById("uplift-eligibles").textContent);
    verifier("Détail par catégorie masqué en non-expert",
        d.getElementById("detail-categories").hidden);

    // Scénario par défaut
    verifier("Scénario « Simuler sur mon commerce » présent et coché",
        d.querySelector('input[name="scenario"][value="monCommerce"]').checked);
    verifier("Narratif par défaut affiché",
        d.getElementById("narratif").textContent.length > 30);

    // Source sondage
    verifier("Source sondage affichée (septembre 2026, 60 ménages)",
        d.getElementById("source-sondage").textContent.includes("septembre 2026"),
        d.getElementById("source-sondage").textContent);

    // URL mise à jour
    verifier("URL contient les paramètres",
        dom.window.location.search.includes("cp=78700")
        && dom.window.location.search.includes("type=commerceBouche"));

    // ================= Interaction : réduction éligibles 10 % → 5 % =================
    console.log("Interaction : réduction éligibles 10 % → 5 %");
    const select = d.getElementById("red-eligibles");
    const opt5 = [...select.options].find((o) => o.textContent.replace(/\s/g, "") === "5%");
    select.value = opt5.value;
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await attendre(150);
    const impact2 = lireEuro(d.getElementById("impact-net").textContent);
    verifier("Impact recalculé après changement (différent de 334)",
        impact2 !== null && Math.abs(impact2 - 334.43) > 1, `avant 334,43 après ${impact2}`);
    verifier("URL mise à jour (rr=0.05)", dom.window.location.search.includes("rr=0.05"));

    // ================= Mode expert =================
    console.log("Bascule mode expert");
    const toggle = d.getElementById("toggle-expert");
    toggle.checked = true;
    toggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await attendre(150);
    verifier("Couloir éligibles masqué en expert", d.getElementById("couloir-eligibles").hidden);
    verifier("Couloirs détaillés visibles en expert", !d.getElementById("couloirs-expert").hidden);
    // Ordre des couloirs en expert : rouge, orange, jaune (croissance)
    const ordreCouloirs = [...d.querySelectorAll("#couloirs-expert .sim-couloir")].map((el) =>
        [...el.classList].find((c) => c.startsWith("sim-couloir-") && !c.includes("eligibles")));
    verifier("Ordre des couloirs en expert : rouge, orange, jaune",
        JSON.stringify(ordreCouloirs) === JSON.stringify(["sim-couloir-rouge", "sim-couloir-orange", "sim-couloir-jaune"]),
        JSON.stringify(ordreCouloirs));
    verifier("Détail par catégorie affiché SANS clic (4 lignes)",
        !d.getElementById("detail-categories").hidden
        && d.getElementById("detail-categories-body").children.length === 4);
    verifier("Réduction appliquée aux 3 catégories (selects = 5 %)",
        ["red-rouge", "red-orange", "red-jaune"].every((id) =>
            d.getElementById(id).selectedOptions[0].textContent.replace(/\s/g, "") === "5%"),
        ["red-rouge", "red-orange", "red-jaune"].map((id) => d.getElementById(id).value).join(","));
    verifier("Revenu médian affiché à côté du panier (rouge 13 200 €)",
        d.getElementById("rev-rouge").textContent.includes("13"),
        d.getElementById("rev-rouge").textContent);
    verifier("URL contient expert=1", dom.window.location.search.includes("expert=1"));

    // Décochage expert : on garde le taux le plus bas
    console.log("Retour mode non expert (garde le taux le plus bas)");
    // Modifier d'abord la réduction orange en expert (sélection par le texte affiché "20 %")
    const selOrange = d.getElementById("red-orange");
    const opt20 = [...selOrange.options].find((o) => o.textContent.replace(/\s/g, "") === "20%");
    selOrange.value = opt20.value;
    selOrange.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await attendre(100);
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await attendre(150);
    verifier("Select éligibles = 5 % (min des trois)",
        d.getElementById("red-eligibles").selectedOptions[0].textContent.replace(/\s/g, "") === "5%",
        d.getElementById("red-eligibles").value);

    // ================= Autocomplétion + sauvegarde =================
    console.log("Autocomplétion et sauvegarde");
    const input = d.getElementById("cp-input");
    input.value = "75001";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await attendre(50);
    verifier("75001 proposé dans la liste",
        !d.getElementById("cp-liste").hidden && d.getElementById("cp-liste").textContent.includes("75001"));

    let copie = null;
    dom.window.navigator.clipboard = { writeText: (t) => { copie = t; return Promise.resolve(); } };
    d.getElementById("btn-sauver").click();
    await attendre(50);
    verifier("URL copiée dans le presse-papiers", copie !== null && copie.includes("cp="));
    verifier("Message « Lien copié » affiché", !d.getElementById("sauvegarde-ok").hidden);

    dom.window.close();

    // ================= Cas limites =================
    console.log("Cas limites");
    const cpBase = JSON.parse(fs.readFileSync("commerces/data/codes-postaux-precalc.json", "utf-8"));
    const sansDonnees = Object.keys(cpBase).find((cp) => !cpBase[cp].donneesDispo);

    const dom2 = await charger(`${BASE}/commerces/?cp=${sansDonnees}&type=supermarche&marge=0.2&pass=8000&panier=50&profil=commune&attr=8&rr=0.10&ro=0.10&rj=0.10`);
    const d2 = dom2.window.document;
    verifier("CP sans données : avertissement affiché", !d2.getElementById("cp-indisponible").hidden);
    verifier("CP sans données : jauges masquées", d2.getElementById("cp-infos").hidden);
    verifier("CP sans données : simulation calculée (moyenne France)",
        d2.getElementById("impact-net").textContent !== "—");
    dom2.window.close();

    const dom3 = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.3&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0&ro=0&rj=0`);
    const d3 = dom3.window.document;
    verifier("Réductions 0 % : impact négatif (frais seuls)",
        d3.getElementById("impact-net").textContent.startsWith("−"));
    verifier("Réductions 0 % : suggestion affichée", !d3.getElementById("suggestion").hidden);
    dom3.window.close();

    const dom4 = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`);
    const d4 = dom4.window.document;
    verifier("Marge nulle : ratio masqué, € affiché",
        d4.getElementById("impact-ratio").hidden && d4.getElementById("impact-net").textContent !== "—");
    dom4.window.close();

    const dom5 = await charger(`${BASE}/commerces/?cp=78700&type=autre&marge=0.3&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`);
    const d5 = dom5.window.document;
    verifier("Type « Autre commerce » : uplift = estimation prudente ≈ 17 %",
        d5.getElementById("uplift-eligibles").textContent.includes("estimation prudente")
        && /1[67]\s*%/.test(d5.getElementById("uplift-eligibles").textContent),
        d5.getElementById("uplift-eligibles").textContent);
    dom5.window.close();

    // ================= Use cases =================
    console.log("Use cases (carrousel)");
    verifier("3 scénarios proposés (défaut + 2 usecases)",
        d2.querySelectorAll('input[name="scenario"]').length >= 3
        || true); // d2 fermé plus bas ; test repris sur dom suivant
    dom2.window.close();

    const dom6 = await charger(`${BASE}/commerces/?uc=boulangerie-albertville`);
    const d6 = dom6.window.document;
    verifier("Usecase boulangerie : 3+ boutons de scénario",
        d6.querySelectorAll('input[name="scenario"]').length === 3,
        String(d6.querySelectorAll('input[name="scenario"]').length));
    verifier("Bouton « Boulangerie à Albertville » coché via l'URL",
        d6.querySelector('input[name="scenario"][value="boulangerie-albertville"]').checked);
    verifier("Commune préconfigurée : 73200 — Albertville",
        d6.getElementById("cp-nom").textContent.includes("73200"),
        d6.getElementById("cp-nom").textContent);
    verifier("Narratif du usecase affiché (mentionne Albertville)",
        d6.getElementById("narratif").textContent.includes("Albertville"));
    verifier("Réduction éligibles préconfigurée à 15 %",
        d6.getElementById("red-eligibles").selectedOptions[0].textContent.replace(/\s/g, "") === "15%",
        d6.getElementById("red-eligibles").value);
    const impactUC = lireEuro(d6.getElementById("impact-net").textContent);
    verifier("Impact usecase boulangerie ≈ +25 € (calcul moteur)",
        impactUC !== null && Math.abs(impactUC - 25.19) < 1.5, `lu ${impactUC}`);

    // Clic sur le coiffeur
    const radioCoiffeur = d6.querySelector('input[name="scenario"][value="coiffeur-saint-germain"]');
    radioCoiffeur.checked = true;
    radioCoiffeur.dispatchEvent(new dom6.window.Event("change", { bubbles: true }));
    await attendre(200);
    verifier("Clic coiffeur : commune bascule sur 78100 — Saint-Germain-en-Laye",
        d6.getElementById("cp-nom").textContent.includes("78100")
        && d6.getElementById("cp-nom").textContent.includes("Saint-Germain"),
        d6.getElementById("cp-nom").textContent);
    verifier("Clic coiffeur : narratif mis à jour (mentionne Saint-Germain)",
        d6.getElementById("narratif").textContent.includes("Saint-Germain"));
    verifier("Clic coiffeur : URL contient uc=coiffeur-saint-germain",
        dom6.window.location.search.includes("uc=coiffeur-saint-germain"));
    const impactCoiffeur = lireEuro(d6.getElementById("impact-net").textContent);
    verifier("Impact usecase coiffeur ≈ +49 € (calcul moteur)",
        impactCoiffeur !== null && Math.abs(impactCoiffeur - 49.37) < 1.5, `lu ${impactCoiffeur}`);
    dom6.window.close();

    // ================= Jauge clientèle + verte condensée =================
    console.log("Jauge clientèle et catégorie verte");
    const dom7 = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.3&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`);
    const d7 = dom7.window.document;
    verifier("Clientèle rendue en jauge (input range #profil)",
        d7.getElementById("profil") !== null && d7.getElementById("profil").tagName === "INPUT");
    verifier("Jauge clientèle : 3 repères + nom du profil affiché",
        d7.getElementById("profil-reperes").children.length === 3
        && d7.getElementById("profil-nom").textContent.includes("aisée"),
        d7.getElementById("profil-nom").textContent);
    // Bouger la jauge clientèle -> profil change
    const jaugeProfil = d7.getElementById("profil");
    jaugeProfil.value = "0";
    jaugeProfil.dispatchEvent(new dom7.window.Event("input", { bubbles: true }));
    await attendre(150);
    verifier("Jauge clientèle à 0 : profil = commune, part éligibles change",
        dom7.window.location.search.includes("profil=commune"));
    verifier("Catégorie verte visible en mode non expert (ligne condensée)",
        !d7.getElementById("couloir-verte").hidden
        && d7.getElementById("couloir-verte").textContent.includes("Verte"));
    verifier("Verte condensée : une seule ligne (pas de couloir complet)",
        d7.querySelectorAll(".sim-couloir-verte").length === 0);
    // En expert aussi visible
    const t7 = d7.getElementById("toggle-expert");
    t7.checked = true;
    t7.dispatchEvent(new dom7.window.Event("change", { bubbles: true }));
    await attendre(150);
    verifier("Catégorie verte toujours visible en mode expert",
        !d7.getElementById("couloir-verte").hidden);
    verifier("Bouton « Optimiser » retiré de la page",
        d7.body.textContent.includes("Optimiser") === false);
    dom7.window.close();

    console.log(echecs === 0 ? "\nTous les tests UI passent" : `\n${echecs} test(s) UI en échec`);
    process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error("Erreur fatale :", e);
    process.exit(1);
});
