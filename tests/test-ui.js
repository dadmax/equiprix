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
    verifier("Ménages dans la ligne CP : « 78700 — Conflans-Sainte-Honorine (14 515 ménages) »",
        d.getElementById("cp-nom").textContent.includes("14") && d.getElementById("cp-nom").textContent.includes("ménages"),
        d.getElementById("cp-nom").textContent);

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
    // Pourcentages lisibles directement sur les segments des deux jauges
    const valRougeSecteur = d.querySelector("#barre-population .sim-seg-v-rouge .sim-seg-val").textContent;
    verifier("Jauge secteur : % lisible sur le segment (rouge ≈ 15 %)",
        valRougeSecteur.replace(/[\s\u00a0]/g, "") === "15%", valRougeSecteur);
    const valVerteFrance = d.querySelector("#barre-france .sim-seg-v-verte .sim-seg-val").textContent;
    verifier("Jauge France : % lisible sur le segment vert = 40 %",
        valVerteFrance.replace(/[\s\u00a0]/g, "") === "40%", valVerteFrance);
    verifier("Jauge France : les 4 segments portent un %",
        ["rouge", "orange", "jaune", "verte"].every((cat) =>
            d.querySelector(`#barre-france .sim-seg-v-${cat} .sim-seg-val`).textContent.includes("%")));
    const hRouge = parseFloat(d.querySelector("#barre-population .sim-seg-v-rouge").style.height);
    verifier("Barre secteur : segment rouge vertical ≈ 15,3 % de hauteur",
        Math.abs(hRouge - 15.3) < 0.01, String(hRouge));
    // Légendes qualitatives
    verifier("Légende rouge au pluriel = « ménages sous ou proches du seuil de pauvreté »",
        d.getElementById("leg-rouge").textContent.includes("ménages") && d.getElementById("leg-rouge").textContent.includes("seuil de pauvreté"),
        d.getElementById("leg-rouge").textContent);
    verifier("Légende verte au pluriel = « ménages aisés »",
        d.getElementById("leg-verte").textContent.includes("ménages aisés"),
        d.getElementById("leg-verte").textContent);
    // Alignement par le bas des deux barres + titre France lisible en entier
    verifier("Titre France comparatif non tronqué (retour à la ligne autorisé)",
        d.getElementById("titre-france").textContent === "France entière (comparatif)");
    verifier("Structure : conteneur flex + 2 blocs de barre (alignement par le bas en CSS)",
        d.querySelectorAll(".sim-barre-verticale-bloc").length === 2
        && d.querySelector(".sim-barres-cote-a-cote") !== null
        && d.querySelectorAll(".sim-barre-verticale").length === 2);

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
    verifier("Scénario « Simuler sur mon commerce » présent et actif",
        d.querySelector('[data-scenario="monCommerce"]').getAttribute("aria-pressed") === "true");
    verifier("Boutons scénarios sans radio native (button aria-pressed)",
        d.querySelectorAll('input[name="scenario"]').length === 0
        && d.querySelectorAll('button.sim-scenario').length === 5);
    verifier("Narratif par défaut = phrase courte « Utilisez le simulateur ci-dessous… »",
        d.getElementById("narratif").textContent.includes("améliore la performance de votre enseigne")
        && d.getElementById("narratif").textContent.includes("l'un des cas ci-dessus"),
        d.getElementById("narratif").textContent);

    // Source sondage
    verifier("Source sondage affichée (septembre 2026, 60 ménages)",
        d.getElementById("source-sondage").textContent.includes("septembre 2026"),
        d.getElementById("source-sondage").textContent);

    // URL mise à jour
    verifier("URL contient les paramètres",
        dom.window.location.search.includes("cp=78700")
        && dom.window.location.search.includes("type=commerceBouche"));

    // ================= Structure de la page (canevas « page pour les commerces ») =================
    console.log("Structure de la page (canevas)");
    const F = 4; // Node.DOCUMENT_POSITION_FOLLOWING
    verifier("Title SEO = « equiprix, la tarification solidaire dans votre commerce »",
        d.title === "equiprix, la tarification solidaire dans votre commerce", d.title);
    const h1 = d.querySelector("h1");
    verifier("H1 hero = slogan (proposition de valeur)",
        h1 && h1.textContent.includes("Des réductions qui font du bien à vos clients"), h1 && h1.textContent);
    verifier("Sous-titre hero EN DUR dans le HTML",
        d.getElementById("hero-sous-titre").textContent.includes("chaque client paie selon ses moyens"),
        d.getElementById("hero-sous-titre").textContent);
    const ctaContact = d.querySelector('.sim-hero-cta a.btn-primary');
    verifier("CTA hero principal bleu = « Nous contacter » (lien section Commerçants de l'accueil)",
        !!ctaContact && ctaContact.textContent.includes("Nous contacter")
        && (ctaContact.getAttribute("href") || "").includes("sibforms.com"),
        ctaContact && ctaContact.getAttribute("href"));
    const ctaSim = d.querySelector('.sim-hero-cta a.btn-secondaire[href="#simulateur"]');
    verifier("CTA hero secondaire blanc = « Lancer la simulation » vers #simulateur",
        !!ctaSim && ctaSim.textContent.includes("Lancer la simulation"));
    verifier("Plus de CTA « Comment ça marche ? » dans le hero",
        !d.querySelector('.sim-hero-cta a[href="#comment-ca-marche"]'));
    verifier("Résultats : « Sauver cette simulation » en blanc + « Nous contacter » bleu en dessous",
        d.getElementById("btn-sauver").classList.contains("btn-secondaire")
        && !d.getElementById("btn-sauver").classList.contains("btn-primary")
        && (() => { const c = d.getElementById("btn-contact"); return !!c
            && c.classList.contains("btn-primary")
            && (c.getAttribute("href") || "").includes("sibforms.com")
            && c.textContent.includes("Nous contacter")
            && d.querySelector(".sim-actions").contains(c); })());

    const secAccroche = d.getElementById("accroche");
    const secSim = d.getElementById("simulateur");
    verifier("Accroche présente et AVANT le simulateur",
        !!secAccroche && !!secSim && (secAccroche.compareDocumentPosition(secSim) & F) === F);
    verifier("Accroche : titre + texte EN DUR dans le HTML",
        d.getElementById("titre-accroche").textContent.includes("tarification solidaire")
        && d.getElementById("accroche-texte").textContent.includes("capacité financière"));
    verifier("Scénarios + narratif DANS le bloc simulateur",
        secSim.contains(d.getElementById("scenarios-liste")) && secSim.contains(d.getElementById("narratif")));
    verifier("Bloc simulateur englobe « Votre commerce » et « Simulation »",
        secSim.contains(d.getElementById("titre-commerce")) && secSim.contains(d.getElementById("titre-simulation")));

    const det = d.getElementById("bloc-sources");
    verifier("Sources en <details> replié, sans H2, à l'intérieur du simulateur",
        !!det && det.tagName === "DETAILS" && !det.open && !det.querySelector("h2") && secSim.contains(det));
    verifier("Sources : summary « Sources et données utilisées » + flèche ▾ (toggle visible)",
        det.querySelector("summary").textContent.includes("Sources et données")
        && !!det.querySelector("summary .sim-sources-fleche")
        && det.querySelector("summary .sim-sources-fleche").textContent.includes("▾"));
    verifier("Sources : sondage renseigné dans le <details>",
        det.contains(d.getElementById("source-sondage"))
        && d.getElementById("source-sondage").textContent.includes("septembre 2026"));

    const etapes = d.querySelectorAll("#ccm-etapes .ccm-etape");
    verifier("Comment ça marche : 3 étapes avec maquettes d'appli",
        etapes.length === 3
        && d.getElementById("ccm-img-0").getAttribute("src").includes("images/etape-1")
        && d.getElementById("ccm-img-2").getAttribute("src").includes("images/etape-3"));
    verifier("Comment ça marche : titres/textes EN DUR dans le HTML",
        d.getElementById("ccm-titre-0").textContent.includes("QR code")
        && d.getElementById("ccm-texte-2").textContent.length > 40,
        d.getElementById("ccm-titre-0").textContent);
    verifier("Comment ça marche : alt des maquettes en dur dans le HTML",
        d.getElementById("ccm-img-1").alt.includes("prix plein"));
    verifier("Comment ça marche vient APRÈS le simulateur",
        (secSim.compareDocumentPosition(d.getElementById("comment-ca-marche")) & F) === F);

    verifier("Engagement : titre « …faites-le rayonner »",
        d.getElementById("titre-engagement").textContent.includes("rayonner"));
    verifier("Engagement : stat 90 % + légende + paragraphe EN DUR dans le HTML",
        d.getElementById("engagement-stat").textContent.includes("90")
        && d.getElementById("engagement-stat-legende").textContent.includes("réaction de soutien")
        && d.getElementById("engagement-texte").textContent.includes("bouche"));
    verifier("Engagement : badge visuel (image + alt)",
        d.getElementById("engagement-badge").getAttribute("src").includes("badge-engage")
        && d.getElementById("engagement-badge").alt.length > 10);

    verifier("Tarification : message d'alignement",
        d.getElementById("tar-alignement").textContent.includes("aligné"));
    const fraisTxt = d.getElementById("tar-frais").textContent;
    verifier("Tarification : texte en dur + valeurs injectées depuis parametres (0,50 € / 100 €)",
        fraisTxt.includes("frais de service") && fraisTxt.includes("capés")
        && d.getElementById("tar-frais-par-passage").textContent.includes("0,50")
        && d.getElementById("tar-cap-mensuel").textContent.includes("100"), fraisTxt);
    const jsonMaitre = JSON.parse(fs.readFileSync("commerces/data/commerces.json", "utf-8"));
    verifier("Textes marketing HORS du JSON (heroSousTitre/accroche/commentCaMarche/engagement/tarification absents)",
        !jsonMaitre.textes.heroSousTitre && !jsonMaitre.textes.accroche
        && !jsonMaitre.textes.commentCaMarche && !jsonMaitre.textes.engagement
        && !jsonMaitre.textes.tarification);
    verifier("Tarification : sous-bloc marketing (vitrine vs milliers de ménages)",
        d.getElementById("tar-marketing-titre").textContent.length > 5
        && d.getElementById("tar-marketing-texte").textContent.includes("vitrine"));
    verifier("Ordre de page : simulateur → comment-ça-marche → engagement → tarification",
        (secSim.compareDocumentPosition(d.getElementById("comment-ca-marche")) & F) === F
        && (d.getElementById("comment-ca-marche").compareDocumentPosition(d.getElementById("engagement")) & F) === F
        && (d.getElementById("engagement").compareDocumentPosition(d.getElementById("tarification")) & F) === F);

    // Fonds pleine largeur : main n'est plus un conteneur, chaque section embarque son .sim-container
    verifier("Fonds pleine largeur : main sans .sim-container, chaque section a son propre conteneur",
        !d.querySelector("main").classList.contains("sim-container")
        && ["accroche", "simulateur", "comment-ca-marche", "engagement", "tarification"].every((id) => {
            const el = d.getElementById(id).firstElementChild;
            return el && el.classList.contains("sim-container");
        }));
    const css = fs.readFileSync("commerces/css/commerces.css", "utf-8");
    verifier("CSS : #simulateur et #engagement en bleu (--bg-why) pleine largeur, section basse transparente",
        /\.sim-bloc-simulateur\s*\{[^}]*var\(--bg-why\)/.test(css)
        && /\.page-engagement\s*\{[^}]*var\(--bg-why\)/.test(css)
        && !/\.page-engagement\s*\{[^}]*bg-commercants/.test(css)
        && /\.sim-section-basse\s*\{[^}]*transparent/.test(css));
    verifier("CSS : flèche du toggle sources (▾ pivotée à -90° replié, comme /particuliers/)",
        css.includes("sim-sources-fleche") && css.includes("rotate(-90deg)"));

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

    dom2.window.close();

    // Défauts du type supermarché (17,5 % / 8 000 / 50 €) + label/aide marge
    const domT = await charger(`${BASE}/commerces/`);
    const dT = domT.window.document;
    dT.querySelector('.sim-carte-type[data-type="supermarche"]').click();
    await attendre(200);
    verifier("Carte supermarché : préremplit marge 17,5 % (champ 18 ou 17 selon arrondi), 8 000 passages, 50 €",
        dT.getElementById("passages").value === "8000"
        && dT.getElementById("panier").value === "50"
        && ["17", "18"].includes(dT.getElementById("marge").value),
        [dT.getElementById("marge").value, dT.getElementById("passages").value, dT.getElementById("panier").value].join("/"));
    verifier("Label marge = « Marge sur produit (%) » + aide formule (prix vente − coût achat) / prix vente",
        dT.getElementById("label-marge").textContent.includes("Marge sur produit")
        && dT.getElementById("aide-marge").textContent.includes("coût d’achat")
        && dT.getElementById("aide-marge").textContent.includes("prix de vente"),
        dT.getElementById("label-marge").textContent + " | " + dT.getElementById("aide-marge").textContent);
    domT.window.close();

    // ================= Use cases =================
    console.log("Use cases (carrousel en boutons)");
    const dom6 = await charger(`${BASE}/commerces/?uc=boulangerie-albertville`);
    const d6 = dom6.window.document;
    verifier("Usecase boulangerie : 5 boutons de scénario (défaut + 4 usecases)",
        d6.querySelectorAll("button.sim-scenario").length === 5,
        String(d6.querySelectorAll("button.sim-scenario").length));
    verifier("Bouton « Boulangerie à Albertville » actif via l'URL (aria-pressed)",
        d6.querySelector('[data-scenario="boulangerie-albertville"]').getAttribute("aria-pressed") === "true");
    verifier("Commune préconfigurée : 73200 — Albertville",
        d6.getElementById("cp-nom").textContent.includes("73200"),
        d6.getElementById("cp-nom").textContent);
    verifier("Narratif du usecase affiché (mentionne Albertville)",
        d6.getElementById("narratif").textContent.includes("Albertville"));
    verifier("Réduction éligibles préconfigurée à 15 %",
        d6.getElementById("red-eligibles").selectedOptions[0].textContent.replace(/\s/g, "") === "15%",
        d6.getElementById("red-eligibles").value);
    const impactUC = lireEuro(d6.getElementById("impact-net").textContent);
    verifier("Impact usecase boulangerie ≈ +146 € (marge 40 % sur gâteaux, clientèle aisée, 40 achats, réduc 15 %)",
        impactUC !== null && Math.abs(impactUC - 146.28) < 1.5,
        `lu ${impactUC} | brut ${d6.getElementById("impact-net").textContent}`);
    verifier("Boulangerie préconfigurée selon le texte : marge 40 %, 40 passages, panier 30, clientèle essentiellement aisée, attr ×20",
        d6.getElementById("marge").value === "40"
        && d6.getElementById("passages").value === "40"
        && d6.getElementById("panier").value === "30"
        && dom6.window.location.search.includes("profil=essentiellementAisee")
        && dom6.window.location.search.includes("attr=20"),
        [d6.getElementById("marge").value, d6.getElementById("passages").value, d6.getElementById("panier").value, dom6.window.location.search].join(" | "));
    verifier("Badge « modifiés » caché au chargement du usecase",
        d6.getElementById("badge-modifie").hidden === true
        && d6.getElementById("btn-reset-usecase").hidden === true);

    // Clic sur le coiffeur (bouton, plus de radio)
    d6.querySelector('[data-scenario="coiffeur-pessac"]').click();
    await attendre(200);
    verifier("Clic coiffeur : commune bascule sur 33600 — Pessac",
        d6.getElementById("cp-nom").textContent.includes("33600")
        && d6.getElementById("cp-nom").textContent.includes("Pessac"),
        d6.getElementById("cp-nom").textContent);
    verifier("Clic coiffeur : narratif mis à jour (mentionne Pessac)",
        d6.getElementById("narratif").textContent.includes("Pessac"));
    verifier("Clic coiffeur : URL contient uc=coiffeur-pessac",
        dom6.window.location.search.includes("uc=coiffeur-pessac"));
    const impactCoiffeur = lireEuro(d6.getElementById("impact-net").textContent);
    verifier("Impact usecase coiffeur Pessac ≈ +270 € (panier 25 €, marge marginale 90 %)",
        impactCoiffeur !== null && Math.abs(impactCoiffeur - 270.36) < 1.5, `lu ${impactCoiffeur}`);
    dom6.window.close();

    // ================= Usecase restaurant + bascule sur saisie manuelle =================
    console.log("Usecase restaurant, badge modifiés et reset");
    const dom8 = await charger(`${BASE}/commerces/?uc=restaurant-lyon`);
    const d8 = dom8.window.document;
    verifier("Usecase restaurant : bouton actif via l'URL",
        d8.querySelector('[data-scenario="restaurant-lyon"]').getAttribute("aria-pressed") === "true");
    verifier("Commune préconfigurée : 69001 — Lyon 1er (ménages entre parenthèses)",
        d8.getElementById("cp-nom").textContent.includes("69001")
        && d8.getElementById("cp-nom").textContent.includes("ménages"),
        d8.getElementById("cp-nom").textContent);
    verifier("Narratif restaurant (mentionne Lyon, aucun RÉSULTAT en €/mois de la simulation)",
        /lyon/i.test(d8.getElementById("narratif").textContent)
        && !/\d[\d\s ]*,?\d*\s*€\s*\/\s*mois/.test(d8.getElementById("narratif").textContent),
        d8.getElementById("narratif").textContent.slice(0, 80));
    // Les narratifs des 3 usecases ne citent aucun résultat chiffré de la simulation
    // (seuls les paramètres d'entrée peuvent contenir un €, ex. panier 30 €)
    const domN = await charger(`${BASE}/commerces/?uc=boulangerie-albertville`);
    const dN = domN.window.document;
    dN.querySelector('[data-scenario="coiffeur-pessac"]').click();
    await attendre(200);
    const narrCoiffeur = dN.getElementById("narratif").textContent;
    verifier("Narratif coiffeur : histoire seule (pas de « +X €/mois » de la simulation)",
        !/\+?\d[\d\s ]*,?\d*\s*€\s*\/\s*mois/.test(narrCoiffeur),
        narrCoiffeur.slice(0, 80));
    domN.window.close();
    const impactResto = lireEuro(d8.getElementById("impact-net").textContent);
    verifier("Impact usecase restaurant \u2248 +51 \u20ac (repas 20 \u20ac, client\u00e8le un peu ais\u00e9e, r\u00e9duc 30 %)",
        impactResto !== null && Math.abs(impactResto - 50.75) < 1.5, `lu ${impactResto}`);
    verifier("Réduction éligibles préconfigurée à 30 %",
        d8.getElementById("red-eligibles").selectedOptions[0].textContent.replace(/\s/g, "") === "30%",
        d8.getElementById("red-eligibles").value);

    // Saisie manuelle sur un usecase : on GARDE le usecase et son narratif,
    // mais un badge « paramètres modifiés » + un bouton reset apparaissent.
    const marge8 = d8.getElementById("marge");
    marge8.value = "12";
    marge8.dispatchEvent(new dom8.window.Event("input", { bubbles: true }));
    await attendre(200);
    verifier("Édition de la marge sur un usecase : le usecase reste actif, narratif conservé",
        d8.querySelector(".sim-scenario.actif").dataset.scenario === "restaurant-lyon"
        && dom8.window.location.search.includes("uc=restaurant-lyon")
        && /lyon/i.test(d8.getElementById("narratif").textContent),
        d8.querySelector(".sim-scenario.actif").dataset.scenario + " | " + dom8.window.location.search);
    verifier("Badge « paramètres modifiés » + bouton reset visibles après édition",
        d8.getElementById("badge-modifie").hidden === false
        && d8.getElementById("btn-reset-usecase").hidden === false);
    // Le reset remet les params du usecase (marge 50 %) et masque le badge
    d8.getElementById("btn-reset-usecase").click();
    await attendre(200);
    verifier("Reset : marge restaurée à 50 %, badge masqué, usecase toujours actif",
        d8.getElementById("marge").value === "50"
        && d8.getElementById("badge-modifie").hidden === true
        && d8.getElementById("btn-reset-usecase").hidden === true
        && d8.querySelector(".sim-scenario.actif").dataset.scenario === "restaurant-lyon",
        "marge=" + d8.getElementById("marge").value);

    // La carte type change le type sans quitter le usecase (badge affiché)
    const dom9 = await charger(`${BASE}/commerces/?uc=boulangerie-albertville`);
    const d9 = dom9.window.document;
    d9.querySelector('.sim-carte-type[data-type="supermarche"]').click();
    await attendre(200);
    verifier("Clic carte supermarché sur un usecase : usecase conservé, type changé, badge affiché",
        d9.querySelector(".sim-scenario.actif").dataset.scenario === "boulangerie-albertville"
        && dom9.window.location.search.includes("uc=boulangerie-albertville")
        && d9.querySelector('.sim-carte-type[data-type="supermarche"]').getAttribute("aria-checked") === "true"
        && ["17", "18"].includes(d9.getElementById("marge").value)
        && d9.getElementById("passages").value === "8000"
        && d9.getElementById("panier").value === "50"
        && d9.getElementById("badge-modifie").hidden === false,
        d9.getElementById("marge").value + "/" + d9.getElementById("passages").value + "/" + d9.getElementById("panier").value);
    dom9.window.close();
    dom8.window.close();

    // En mode « mon commerce » (cas de réf), pas de badge ni de reset
    verifier("Pas de badge ni de reset sur le scénario par défaut",
        d.getElementById("badge-modifie").hidden === true
        && d.getElementById("btn-reset-usecase").hidden === true);

    // ================= Suggestion marge < 15 % + récap négatif + usecase supérette =================
    console.log("Suggestion marge faible, récap négatif, usecase supérette");
    // Marge 10 % -> suggestion avec le nouveau message (réductions ciblées)
    const domM = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.1&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`);
    const dM = domM.window.document;
    verifier("Marge 10 % : suggestion affichée avec le message « réductions ciblées » du JSON",
        !dM.getElementById("suggestion").hidden
        && dM.getElementById("suggestion").textContent.includes("15 %")
        && dM.getElementById("suggestion").textContent.includes("cibl"),
        dM.getElementById("suggestion").textContent.slice(0, 90));
    domM.window.close();

    // Réduction (30 %) > marge (10 %) -> marge suppl. négative, affichée « − » en rouge
    const domN2 = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.1&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.30&ro=0.30&rj=0.30`);
    const dN2 = domN2.window.document;
    const recap = dN2.getElementById("recap-marges");
    verifier("Réduction > marge : marge suppl. affichée « −980 € » (signe moins)",
        recap.textContent.includes("−") && lireEuro(recap.textContent) !== null
        && Math.abs(lireEuro(recap.textContent) - 980.60) < 1.5,
        recap.textContent);
    verifier("Réduction > marge : classe .negatif appliquée (rouge) sur la ligne marge suppl.",
        recap.classList.contains("negatif"));
    // En expert : le détail par catégorie affiche aussi des négatifs en rouge
    const tN2 = dN2.getElementById("toggle-expert");
    tN2.checked = true;
    tN2.dispatchEvent(new domN2.window.Event("change", { bubbles: true }));
    await attendre(200);
    const negatifs = dN2.querySelectorAll("#detail-categories-body td.negatif").length;
    verifier("Mode expert : 3 cellules « marge suppl. » négatives en rouge dans le détail",
        negatifs === 3, String(negatifs));
    // Retour à une marge normale -> plus de classe negatif
    const domP = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.3&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`);
    verifier("Marge 30 % / réduc 10 % : marge suppl. positive, « + » et SANS classe negatif",
        domP.window.document.getElementById("recap-marges").textContent.includes("+")
        && !domP.window.document.getElementById("recap-marges").classList.contains("negatif"),
        domP.window.document.getElementById("recap-marges").textContent);
    domP.window.close();
    domN2.window.close();

    // Usecase supérette Montreuil
    const domS = await charger(`${BASE}/commerces/?uc=supérette-montreuil`);
    const dS = domS.window.document;
    verifier("Usecase supérette : bouton actif, commune 93100 — Montreuil",
        dS.querySelector('[data-scenario="supérette-montreuil"]').getAttribute("aria-pressed") === "true"
        && dS.getElementById("cp-nom").textContent.includes("93100")
        && dS.getElementById("cp-nom").textContent.includes("Montreuil"),
        dS.getElementById("cp-nom").textContent);
    verifier("Supérette préconfigurée : marge 20 %, 2000 passages, panier 16 €, un peu aisée, attr ×8",
        dS.getElementById("marge").value === "20"
        && dS.getElementById("passages").value === "2000"
        && dS.getElementById("panier").value === "16"
        && domS.window.location.search.includes("profil=unPeuAisee")
        && domS.window.location.search.includes("attr=8"));
    verifier("Supérette : réductions 10 % rouge/orange, 0 % jaune (URL)",
        domS.window.location.search.includes("rr=0.1")
        && domS.window.location.search.includes("ro=0.1")
        && domS.window.location.search.includes("rj=0"),
        domS.window.location.search);
    const impactSup = lireEuro(dS.getElementById("impact-net").textContent);
    verifier("Impact usecase supérette ≈ +194 € (10 % sur rouge/orange uniquement)",
        impactSup !== null && Math.abs(impactSup - 194.44) < 1.5, `lu ${impactSup}`);
    verifier("Narratif supérette : histoire seule (pas de résultat en €/mois)",
        !/\d[\d\s ]*,?\d*\s*€\s*\/\s*mois/.test(dS.getElementById("narratif").textContent)
        && dS.getElementById("narratif").textContent.includes("Montreuil"));
    domS.window.close();
    // Réductions différenciées (rj=0) -> mode expert coché automatiquement
    const domS2 = await charger(`${BASE}/commerces/?uc=supérette-montreuil`);
    const dS2 = domS2.window.document;
    verifier("Usecase à réductions différenciées : mode expert coché par défaut (toggle + URL expert=1)",
        dS2.getElementById("toggle-expert").checked === true
        && domS2.window.location.search.includes("expert=1"));
    verifier("Usecase à réductions différenciées : couloir éligibles masqué, 3 couloirs visibles",
        dS2.getElementById("couloir-eligibles").hidden === true
        && dS2.getElementById("couloirs-expert").hidden === false
        && dS2.querySelectorAll("#couloirs-expert .sim-couloir").length === 3);
    verifier("Usecase à réductions identiques (boulangerie 15/15/15) : mode NON expert par défaut",
        (() => {
            const ok = d6.getElementById("toggle-expert").checked === false
                && !dom6.window.location.search.includes("expert=1");
            return ok;
        })());
    domS2.window.close();

    // Nouveau message « résultat négatif » (deux pistes), depuis le JSON
    const domNeg = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.3&pass=100&panier=30&profil=commune&attr=2&rr=0.50&ro=0.50&rj=0.50`);
    const dNeg = domNeg.window.document;
    const sugNeg = dNeg.getElementById("suggestion").textContent;
    verifier("Résultat négatif : suggestion « deux pistes » (modifier le taux / cibler forte marge)",
        !dNeg.getElementById("suggestion").hidden
        && sugNeg.includes("Résultat négatif")
        && sugNeg.includes("taux de réduction")
        && sugNeg.includes("forte marge"),
        sugNeg.slice(0, 90));
    domNeg.window.close();

    // ================= Jauge clientèle + verte condensée =================
    console.log("Jauge clientèle et catégorie verte");
    const dom7 = await charger(`${BASE}/commerces/?cp=78700&type=commerceBouche&marge=0.3&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`);
    const d7 = dom7.window.document;
    verifier("Clientèle rendue en jauge (input range #profil)",
        d7.getElementById("profil") !== null && d7.getElementById("profil").tagName === "INPUT");
    verifier("Jauge clientèle : 3 repères avec libellés courts complets",
        d7.getElementById("profil-reperes").children.length === 3
        && d7.getElementById("profil-reperes").textContent.includes("Un peu plus aisée")
        && d7.getElementById("profil-reperes").textContent.includes("Essentiellement aisée"),
        d7.getElementById("profil-reperes").textContent);
    verifier("Libellé détaillé du profil non répété sous la jauge",
        d7.getElementById("profil-nom") === null);
    verifier("Facteur multiplicatif non affiché sous la pénétration",
        !d7.body.textContent.includes("Facteur multiplicatif")
        && !d7.body.textContent.includes("× 20") && !d7.body.textContent.includes("×20"));
    verifier("Intitulé complet de la pénétration affiché",
        d7.getElementById("attractivite-nom").textContent.includes("Moyenne —"));
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
