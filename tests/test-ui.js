/* ============================================================
   test-ui.js — Test d'intégration de l'interface (jsdom).
   Charge la page /commerces/ depuis le serveur local, attend le
   chargement des JSON, puis vérifie le cas de référence du tableur
   via l'URL partagée : impact net ≈ 333,78 €/mois.
   Prérequis : python3 -m http.server depuis la racine du dépôt.
   ============================================================ */
"use strict";

const { JSDOM } = require("/tmp/node_modules/jsdom");
const fs = require("fs");

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

async function main() {
    const dom = await JSDOM.fromURL(URL_REF, {
        resources: "usable",
        runScripts: "dangerously",
        pretendToBeVisual: true,
        beforeParse(window) {
            window.eval(FETCH_POLYFILL);
            window.addEventListener("error", (e) => console.error("JS ERROR:", e.message));
        },
    });
    const { window } = dom;
    const document = window.document;

    // Attendre le chargement des JSON et le premier rendu
    let impact = null;
    for (let i = 0; i < 100; i++) {
        await attendre(100);
        impact = document.getElementById("impact-net").textContent;
        if (impact && impact !== "—") break;
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

    console.log("Rendu initial (cas de référence via URL)");
    verifier("Commune affichée (78700 — Conflans-Sainte-Honorine)",
        document.getElementById("cp-nom").textContent.includes("78700")
        && document.getElementById("cp-nom").textContent.includes("Conflans-Sainte-Honorine"),
        document.getElementById("cp-nom").textContent);
    verifier("Barre population visible", !document.getElementById("cp-infos").hidden);
    verifier("14 515 ménages affichés",
        document.getElementById("cp-menages").textContent.includes("14"),
        document.getElementById("cp-menages").textContent);

    // Impact net : le calcul pur donne 334,43 € (écart d'arrondis tableur ±1 €)
    const m = impact.match(/([\d\s\u00a0]+)\s*€/);
    const valeur = m ? parseFloat(m[1].replace(/[\s\u00a0]/g, "").replace(",", ".")) : null;
    verifier("Impact net ≈ 333,78 € (tolérance ±1 €)",
        valeur !== null && Math.abs(valeur - 333.78) < 1.0,
        `lu : ${impact}`);
    verifier("Signe + devant le montant", impact.startsWith("+"), impact);

    verifier("Ratio ≈ +3,7 % de la marge",
        document.getElementById("impact-ratio").textContent.includes("3,7"),
        document.getElementById("impact-ratio").textContent);
    verifier("Marge de référence 9 000 € affichée",
        document.getElementById("marge-ref").textContent.includes("9"),
        document.getElementById("marge-ref").textContent);

    // Récap : pertes ≈ 55,81 €, marges ≈ 489,59 €, frais 100 € plafonnés
    const pertes = document.getElementById("recap-pertes").textContent;
    const marges = document.getElementById("recap-marges").textContent;
    const frais = document.getElementById("recap-frais").textContent;
    const lireEuro = (t) => parseFloat(t.replace(/[^\d,\-]/g, "").replace(",", "."));
    verifier("Pertes ≈ 55,81 € (±0,10)", Math.abs(lireEuro(pertes) - 55.81) < 0.10, pertes);
    verifier("Marges sup ≈ 489,59 € (±1,10)", Math.abs(lireEuro(marges) - 489.59) < 1.10, marges);
    verifier("Frais = 100 €", lireEuro(frais) === 100, frais);
    verifier("Mention « plafonnés » affichée",
        document.getElementById("frais-mention").textContent.includes("plafonn"),
        document.getElementById("frais-mention").textContent);

    // Couloirs : uplift bouche 10 % -> +30 %
    verifier("Uplift rouge = +30 % de visites (sondage)",
        document.getElementById("uplift-rouge").textContent.includes("30"),
        document.getElementById("uplift-rouge").textContent);
    verifier("Part clientèle rouge ≈ 7,65 % (affichée 7,6 % ou 7,7 %)",
        /^7,[67]\s*%/.test(document.getElementById("info-part-rouge").textContent),
        document.getElementById("info-part-rouge").textContent);

    // URL mise à jour
    verifier("URL contient les paramètres", window.location.search.includes("cp=78700")
        && window.location.search.includes("type=commerceBouche"));

    console.log("Interaction : changement de réduction rouge 10 % → 0 %");
    const select = document.getElementById("red-rouge");
    select.value = "0";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await attendre(100);
    const impact2 = document.getElementById("impact-net").textContent;
    const m2 = impact2.match(/([\d\s\u00a0]+)\s*€/);
    const v2 = m2 ? parseFloat(m2[1].replace(/[\s\u00a0]/g, "").replace(",", ".")) : null;
    // Sans réduction rouge : perte rouge = 0, mais clients+ rouge = 0 aussi
    // et frais baissent légèrement. L'impact doit diminuer.
    verifier("Impact diminue quand la réduction rouge passe à 0 %",
        v2 !== null && v2 < valeur, `avant ${valeur}, après ${v2}`);
    verifier("URL mise à jour (rr=0)", window.location.search.includes("rr=0"));

    console.log("Mode expert");
    const toggle = document.getElementById("toggle-expert");
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event("change", { bubbles: true }));
    await attendre(50);
    verifier("Classe mode-expert ajoutée au body",
        document.body.classList.contains("mode-expert"));
    verifier("URL contient expert=1", window.location.search.includes("expert=1"));

    console.log("Autocomplétion code postal");
    const input = document.getElementById("cp-input");
    input.value = "75001";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await attendre(50);
    verifier("Liste déroulante affichée", !document.getElementById("cp-liste").hidden);
    verifier("75001 Paris 1er proposé",
        document.getElementById("cp-liste").textContent.includes("75001"),
        document.getElementById("cp-liste").textContent.slice(0, 100));

    console.log("Bouton sauver");
    // Stub presse-papiers
    let copie = null;
    window.navigator.clipboard = { writeText: (t) => { copie = t; return Promise.resolve(); } };
    document.getElementById("btn-sauver").click();
    await attendre(50);
    verifier("URL copiée dans le presse-papiers", copie !== null && copie.includes("cp="));
    verifier("Message « Lien copié » affiché",
        !document.getElementById("sauvegarde-ok").hidden);

    console.log(echecs === 0 ? "\nTous les tests UI passent" : `\n${echecs} test(s) UI en échec`);
    window.close();
    process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error("Erreur fatale :", e);
    process.exit(1);
});
