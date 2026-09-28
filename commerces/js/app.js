/* ============================================================
   app.js — Simulateur « Que peut m'apporter equiprix ? »
   Tableau de bord mono-écran pour les commerçants. Tout le calcul
   est local : deux fichiers JSON (base codes postaux précalculée +
   configuration commerces/sondage), aucun envoi de données.
   L'état complet est encodé dans les paramètres GET de l'URL
   (history.replaceState) ; aucun localStorage.
   ============================================================ */
"use strict";

/* ---------- Constantes métier (documentées) ---------- */
/* Revenu disponible médian par catégorie — Filosofi 2023 (publication 2026,
   dispositif Filosofi 2), France métropolitaine, en € annuels.
   Source : https://www.insee.fr/fr/metadonnees/source/operation/s2286/presentation */
const REVENU_CATEGORIES = { rouge: 13200, orange: 16058, jaune: 22468, verte: 34630 };

/* ---------- Raccourcis DOM ---------- */
const $ = (id) => document.getElementById(id);
const dom = {
    erreurData: $("erreur-data"),
    communeInput: $("commune-input"),
    communeListe: $("commune-liste"),
    communeInfo: $("commune-info"),
    communeAlerte: $("commune-alerte"),
    barrePopulation: $("barre-population"),
    barreClientele: $("barre-clientele"),
    clienteleReset: $("clientele-reset"),
    legende: $("legende-categories"),
    typesContainer: $("types-commerce"),
    typesNote: $("types-note"),
    margeInput: $("marge-input"),
    clientsInput: $("clients-input"),
    panierInput: $("panier-input"),
    couvertureRange: $("couverture-range"),
    couvertureOut: $("couverture-out"),
    couloirs: $("couloirs"),
    expertToggle: $("expert-toggle"),
    resultatVide: $("resultat-vide"),
    resultatsContenu: $("resultats-contenu"),
    impactEuros: $("impact-euros"),
    impactPourcent: $("impact-pourcent"),
    fluxPerte: $("flux-perte"),
    fluxGainEquipe: $("flux-gain-equipe"),
    fluxGainCapture: $("flux-gain-capture"),
    fluxSolde: $("flux-solde"),
    suggestion: $("suggestion"),
    tableauTbody: document.querySelector("#tableau-categories tbody"),
    sauverBtn: $("sauver-btn"),
    sauverMessage: $("sauver-message"),
    infobulle: $("infobulle"),
};

/* ---------- État ---------- */
const CATEGORIES = ["rouge", "orange", "jaune", "verte"];
const CLASSES_CSS = { rouge: "com-seg-rouge", orange: "com-seg-orange", jaune: "com-seg-jaune", verte: "com-seg-verte" };

let baseCP = null;        // data/codes-postaux-precalc.json
let config = null;        // data/commerces.json
let indexNoms = [];       // index nom de commune -> CP (construit au chargement)

const etat = {
    cp: null,             // code postal sélectionné
    typeCommerce: "supermarche",
    marge: 0.20,          // marge commerciale
    clients: 47000,       // clients mensuels
    panier: 50,           // panier moyen (€)
    couverture: 1,        // couverture géographique (0-1)
    reductions: { rouge: 0.10, orange: 0.10, jaune: 0.10 },
    clientele: null,      // parts clientèle [r,o,j,v] ; null = calquée population
    paniersEdites: null,  // mode expert : paniers par catégorie édités
    expert: false,
    parametres: null,     // copie éditable des paramètres (mode expert)
};

/* ---------- Format français ---------- */
const fmtEuros = (v) => (v < 0 ? "−" : "") + Math.abs(Math.round(v)).toLocaleString("fr-FR") + "\u202f€";
const fmtEurosSigne = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v)).toLocaleString("fr-FR") + "\u202f€";
const fmtEntier = (v) => Math.round(v).toLocaleString("fr-FR");
const fmtPct = (v, dec = 1) => (v * 100).toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + "\u202f%";

/* ============================================================
   Chargement des données
   ============================================================ */
async function chargerDonnees() {
    try {
        const [repCP, repConfig] = await Promise.all([
            fetch("data/codes-postaux-precalc.json"),
            fetch("data/commerces.json"),
        ]);
        if (!repCP.ok) throw new Error("HTTP " + repCP.status);
        if (!repConfig.ok) throw new Error("HTTP " + repConfig.status);
        baseCP = await repCP.json();
        config = await repConfig.json();
        etat.parametres = { ...config.parametres };
        construireIndexNoms();
        construireTypesCommerce();
        construireCouloirs();
        construireLegende();
        restaurerDepuisURL();
        brancherEvenements();
        if (!etat.cp) preselectionConflans();
        recalculer();
    } catch (err) {
        console.error("Chargement impossible :", err);
        dom.erreurData.hidden = false;
    }
}

/** Index nom -> CP pour la recherche par nom de commune. */
function construireIndexNoms() {
    indexNoms = Object.keys(baseCP).map((cp) => ({ cp, nom: baseCP[cp].n.toLowerCase() }));
    indexNoms.sort((a, b) => a.cp.localeCompare(b.cp));
}

/* ============================================================
   Construction du DOM (une fois)
   ============================================================ */
function construireTypesCommerce() {
    dom.typesContainer.innerHTML = "";
    for (const [cle, t] of Object.entries(config.typesCommerce)) {
        const bouton = document.createElement("button");
        bouton.type = "button";
        bouton.className = "com-type-carte";
        bouton.setAttribute("role", "radio");
        bouton.dataset.type = cle;
        bouton.textContent = t.nom;
        bouton.setAttribute("aria-checked", cle === etat.typeCommerce);
        bouton.addEventListener("click", () => selectionnerType(cle));
        dom.typesContainer.appendChild(bouton);
    }
}

function construireCouloirs() {
    dom.couloirs.innerHTML = "";
    for (const cat of CATEGORIES) {
        const couloir = document.createElement("div");
        couloir.className = `com-couloir com-couloir-${cat}`;
        couloir.id = "couloir-" + cat;
        const estVerte = cat === "verte";
        couloir.innerHTML = `
            <div class="com-couloir-tete">
                <span class="com-couloir-nom" data-couloir-nom></span>
                <span class="com-couloir-uplift" data-couloir-uplift hidden></span>
            </div>
            <div class="com-couloir-slider" data-couloir-slider ${estVerte ? "hidden" : ""}>
                <input type="range" class="com-slider com-slider-${cat}" min="0" max="50" step="1"
                       data-categorie="${cat}" aria-label="Réduction pour la catégorie">
                <output data-couloir-valeur>0\u202f%</output>
            </div>
            <div class="com-couloir-resume" data-couloir-resume></div>`;
        dom.couloirs.appendChild(couloir);
    }
    dom.couloirs.querySelectorAll("input[type=range]").forEach((slider) => {
        slider.addEventListener("input", () => {
            etat.reductions[slider.dataset.categorie] = Number(slider.value) / 100;
            majURL();
            recalculer();
        });
    });
}

function construireLegende() {
    dom.legende.innerHTML = "";
    const libelles = { rouge: "Rouge", orange: "Orange", jaune: "Jaune", verte: "Vert" };
    for (const cat of CATEGORIES) {
        const item = document.createElement("span");
        item.className = "com-legend-item";
        item.innerHTML = `<span class="com-legend-pastille ${CLASSES_CSS[cat]}"></span>${libelles[cat]}`;
        dom.legende.appendChild(item);
    }
}

/** Poignées de frontière de la barre clientèle (3 curseurs). */
function construirePoignees() {
    dom.barreClientele.querySelectorAll(".com-poignee").forEach((p) => p.remove());
    for (let i = 0; i < 3; i++) {
        const poignee = document.createElement("button");
        poignee.type = "button";
        poignee.className = "com-poignee";
        poignee.dataset.index = i;
        poignee.setAttribute("aria-label", `Limite ${["rouge/orange", "orange/jaune", "jaune/vert"][i]} (${Math.round(frontieresClientele()[i] * 100)} %)`);
        poignee.addEventListener("keydown", (e) => {
            const pas = e.shiftKey ? 0.05 : 0.01;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") { deplacerPoignee(i, -pas); e.preventDefault(); }
            if (e.key === "ArrowRight" || e.key === "ArrowUp") { deplacerPoignee(i, pas); e.preventDefault(); }
        });
        poignee.addEventListener("pointerdown", (e) => {
            const deplacer = (ev) => {
                const rect = dom.barreClientele.getBoundingClientRect();
                deplacerPoignee(i, 0, (ev.clientX - rect.left) / rect.width);
            };
            deplacer(e);
            const surMove = (ev) => deplacer(ev);
            const surUp = () => {
                document.removeEventListener("pointermove", surMove);
                document.removeEventListener("pointerup", surUp);
            };
            document.addEventListener("pointermove", surMove);
            document.addEventListener("pointerup", surUp);
        });
        dom.barreClientele.appendChild(poignee);
    }
    positionnerPoignees();
}

/* ============================================================
   Clientèle : parts et frontières
   ============================================================ */
function partsClientele() {
    if (!etat.cp || !entreeCP()) return null;
    if (etat.clientele) return etat.clientele;
    return entreeCP().r; // calquée sur la population communale
}

/** Frontières cumulées [r, r+o, r+o+j] de la clientèle. */
function frontieresClientele() {
    const parts = partsClientele() || [0.25, 0.25, 0.25, 0.25];
    return [parts[0], parts[0] + parts[1], parts[0] + parts[1] + parts[2]];
}

function deplacerPoignee(index, delta, absolu) {
    const f = frontieresClientele();
    let cible = absolu !== undefined ? absolu : f[index] + delta;
    const min = index === 0 ? 0 : f[index - 1];
    const max = index === 2 ? 1 : f[index + 1];
    cible = Math.min(max, Math.max(min, cible));
    f[index] = cible;
    // Reconstruction des parts depuis les frontières
    const parts = [
        f[0],
        f[1] - f[0],
        f[2] - f[1],
        1 - f[2],
    ];
    etat.clientele = parts;
    positionnerPoignees();
    dessinerBarres();
    majURL();
    recalculer();
}

function positionnerPoignees() {
    const f = frontieresClientele();
    dom.barreClientele.querySelectorAll(".com-poignee").forEach((p) => {
        p.style.left = (f[Number(p.dataset.index)] * 100) + "%";
        p.setAttribute("aria-label", `Limite ${["rouge/orange", "orange/jaune", "jaune/vert"][p.dataset.index]} (${Math.round(f[p.dataset.index] * 100)} %)`);
    });
}

/* ============================================================
   Barres empilées
   ============================================================ */
function dessinerSegment(conteneur, cat, part, avecLibelle) {
    const seg = document.createElement("div");
    seg.className = `com-barre-segment ${CLASSES_CSS[cat]}`;
    seg.style.width = (part * 100) + "%";
    if (avecLibelle && part >= 0.06) seg.textContent = fmtPct(part, 0);
    conteneur.appendChild(seg);
}

function dessinerBarres() {
    const entree = entreeCP();
    dom.barrePopulation.innerHTML = "";
    dom.barreClientele.querySelectorAll(".com-barre-segment").forEach((s) => s.remove());
    if (!entree || !entree.r) return;
    for (const [i, cat] of CATEGORIES.entries()) {
        dessinerSegment(dom.barrePopulation, cat, entree.r[i], true);
        dessinerSegment(dom.barreClientele, cat, partsClientele()[i], true);
    }
    positionnerPoignees();
}

/* ============================================================
   Autocomplete commune
   ============================================================ */
function entreeCP() { return etat.cp ? baseCP[etat.cp] : null; }

function filtrerCommunes(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const estNum = /^\d+$/.test(q);
    const res = [];
    for (const { cp, nom } of indexNoms) {
        const match = estNum ? cp.startsWith(q) : (nom.includes(q) || cp.startsWith(q));
        if (match) res.push(cp);
        if (res.length >= 20) break;
    }
    return res;
}

function afficherSuggestions(liste) {
    dom.communeListe.innerHTML = "";
    if (!liste.length) { dom.communeListe.hidden = true; dom.communeInput.setAttribute("aria-expanded", "false"); return; }
    for (const cp of liste) {
        const li = document.createElement("li");
        li.role = "option";
        li.dataset.cp = cp;
        li.textContent = `${cp} — ${nomAffichage(cp)}`;
        li.addEventListener("click", () => selectionnerCommune(cp));
        dom.communeListe.appendChild(li);
    }
    dom.communeListe.hidden = false;
    dom.communeInput.setAttribute("aria-expanded", "true");
}

/** Nom d'affichage : nom complet, ou initiale + « … » si multi-communes. */
function nomAffichage(cp) {
    const n = baseCP[cp].n;
    return n.endsWith("+") ? n.slice(0, -1) + "… (plusieurs communes)" : n;
}

function selectionnerCommune(cp) {
    etat.cp = cp;
    etat.clientele = null; // réinitialisation sur la population communale
    etat.paniersEdites = null;
    dom.communeListe.hidden = true;
    dom.communeInput.setAttribute("aria-expanded", "false");
    dom.communeInput.value = `${cp} — ${nomAffichage(cp)}`;
    const e = entreeCP();
    const dispo = !!e.r;
    dom.communeAlerte.hidden = dispo;
    dom.communeInfo.textContent = dispo
        ? `${fmtEntier(e.m)} ménages, ${fmtEntier(e.p)} personnes`
        : "";
    dom.resultatVide.hidden = dispo;
    dom.resultatsContenu.hidden = !dispo;
    construirePoignees();
    dessinerBarres();
    majURL();
    recalculer();
}

/* ============================================================
   Commerce
   ============================================================ */
function selectionnerType(cle) {
    etat.typeCommerce = cle;
    const t = config.typesCommerce[cle];
    etat.marge = t.margeDefaut;
    etat.clients = t.clientsDefaut;
    etat.panier = t.panierDefaut;
    dom.margeInput.value = Math.round(t.margeDefaut * 100);
    dom.clientsInput.value = t.clientsDefaut;
    dom.panierInput.value = t.panierDefaut;
    dom.typesNote.textContent = "Valeur estimée — modifiable.";
    dom.typesContainer.querySelectorAll(".com-type-carte").forEach((b) =>
        b.setAttribute("aria-checked", b.dataset.type === cle));
    majURL();
    recalculer();
}

/* ============================================================
   Calculs métier
   ============================================================ */

/** Uplift pour une réduction et un type de commerce (interpolation linéaire). */
function uplift(reduction, type) {
    const t = config.typesCommerce[type];
    let valeurs;
    if (t.source === "sondage") {
        valeurs = config.matriceUplift[type];
    } else {
        // estimation prudente : coefPrudence × moyenne des uplifts des types de base
        const bases = t.base.map((b) => config.matriceUplift[b]);
        valeurs = config.matriceUplift.reductions.map((_, i) =>
            t.coefPrudence * bases.reduce((s, b) => s + b[i], 0) / bases.length);
    }
    const reds = config.matriceUplift.reductions;
    if (reduction <= reds[0]) return interpolationExtrapolation(reds, valeurs, reduction, true);
    if (reduction >= reds[reds.length - 1]) return interpolationExtrapolation(reds, valeurs, reduction, false);
    return interpolationExtrapolation(reds, valeurs, reduction, null);
}

function interpolationExtrapolation(reds, vals, r, cote) {
    if (cote === true) return vals[0] * (r / reds[0]);
    if (cote === false) {
        // au-delà du dernier palier : prolongation linéaire de la dernière pente
        const n = reds.length - 1;
        const pente = (vals[n] - vals[n - 1]) / (reds[n] - reds[n - 1]);
        return vals[n] + pente * (r - reds[n]);
    }
    for (let i = 0; i < reds.length - 1; i++) {
        if (r >= reds[i] && r <= reds[i + 1]) {
            const part = (r - reds[i]) / (reds[i + 1] - reds[i]);
            return vals[i] + part * (vals[i + 1] - vals[i]);
        }
    }
    return 0;
}

/** Revenu moyen pondéré par la clientèle (pour la pondération des paniers). */
function revenuMoyenPondere() {
    const parts = partsClientele();
    if (!parts) return null;
    let somme = 0;
    for (const cat of CATEGORIES) somme += parts[CATEGORIES.indexOf(cat)] * REVENU_CATEGORIES[cat];
    return somme;
}

/** Panier moyen de chaque catégorie. */
function paniersCategories() {
    const parts = partsClientele();
    if (!parts) return null;
    if (etat.paniersEdites) return etat.paniersEdites;
    const revMoyen = revenuMoyenPondere();
    const paniers = {};
    for (const cat of CATEGORIES) {
        paniers[cat] = etat.panier * REVENU_CATEGORIES[cat] / revMoyen;
    }
    return paniers;
}

/** Panier moyen implicite (somme pondérée par la clientèle). */
function panierMoyenImplicite() {
    const parts = partsClientele();
    const paniers = paniersCategories();
    if (!parts || !paniers) return null;
    let somme = 0;
    for (const [i, cat] of CATEGORIES.entries()) somme += parts[i] * paniers[cat];
    return somme;
}

/** Résultats par catégorie et agrégats. */
function calculer() {
    const entree = entreeCP();
    if (!entree || !entree.r) return null;
    const parts = partsClientele();
    const paniers = paniersCategories();
    const revMoyen = revenuMoyenPondere();
    const p = etat.parametres;
    const parCat = {};
    let perteTotale = 0, gainEquipeTotal = 0, gainCaptureTotal = 0;
    for (const cat of ["rouge", "orange", "jaune"]) {
        const i = CATEGORIES.indexOf(cat);
        const part = parts[i];
        const clientsCat = etat.clients * part;
        const reduction = etat.reductions[cat];
        const panier = paniers[cat];
        const upl = reduction > 0 ? uplift(reduction, etat.typeCommerce) : 0;
        // Flux 1 : perte de marge sur les clients existants équipés
        const clientsEquipes = clientsCat * p.tauxEquipement;
        const perte = clientsEquipes * reduction * panier * etat.marge;
        // Flux 2 : gain sur clients équipés existants (hausse de fréquence)
        const gainEquipe = clientsEquipes * upl * panier * etat.marge;
        // Flux 3 : nouveaux clients captés — clients potentiels de la catégorie =
        // ménages de la commune × couverture × part de la clientèle (tableur de référence)
        const clientsPotentiels = entree.m * etat.couverture * part;
        const nouveauxClients = clientsPotentiels * p.tauxCapture * upl;
        const gainCapture = nouveauxClients * panier * etat.marge;
        perteTotale += perte;
        gainEquipeTotal += gainEquipe;
        gainCaptureTotal += gainCapture;
        parCat[cat] = { part, clientsCat, reduction, panier, uplift: upl,
                        clientsEquipes, nouveauxClients, perte, gainEquipe, gainCapture,
                        solde: gainEquipe + gainCapture - perte };
    }
    // Catégorie verte (sans réduction) : pour information
    const iVerte = 3;
    parCat.verte = { part: parts[iVerte],
                     clientsCat: etat.clients * parts[iVerte],
                     panier: paniers.verte, solde: 0 };
    const impactNet = gainEquipeTotal + gainCaptureTotal - perteTotale;
    const ca = etat.clients * etat.panier;
    const resultat = ca * p.margeNette;
    // Taux d'activation (contrôle) : visites mensuelles par client potentiel
    const potentielsTotaux = entree.m * etat.couverture;
    const tauxActivation = potentielsTotaux > 0 ? etat.clients / potentielsTotaux : null;
    return { parCat, perteTotale, gainEquipeTotal, gainCaptureTotal, impactNet,
             ca, resultat, paniers, revMoyen, parts, tauxActivation };
}

/* ============================================================
   Rendu (mises à jour ciblées)
   ============================================================ */
function recalculer() {
    const res = calculer();
    // Couloirs : valeurs, uplifts, résumés
    for (const cat of ["rouge", "orange", "jaune", "verte"]) {
        const couloir = $("couloir-" + cat);
        const slider = couloir.querySelector("input[type=range]");
        const out = couloir.querySelector("[data-couloir-valeur]");
        const nom = couloir.querySelector("[data-couloir-nom]");
        const upl = couloir.querySelector("[data-couloir-uplift]");
        const resume = couloir.querySelector("[data-couloir-resume]");
        const libelles = { rouge: "Rouge", orange: "Orange", jaune: "Jaune", verte: "Vert" };
        nom.textContent = libelles[cat];
        const r = res ? res.parCat[cat] : null;
        if (cat !== "verte") {
            const valeur = Math.round(etat.reductions[cat] * 100);
            if (Number(slider.value) !== valeur) slider.value = valeur;
            out.textContent = valeur + "\u202f%";
            const t = config.typesCommerce[etat.typeCommerce];
            const up = r && r.reduction > 0 ? uplift(r.reduction, etat.typeCommerce) : 0;
            upl.hidden = !(r && r.reduction > 0);
            upl.innerHTML = `+${fmtPct(up, 0)} de visites <span class="com-source">${t.source === "sondage" ? "sondage equiprix" : "estimation prudente"}</span>`;
        }
        if (r) {
            const bits = [
                `Clients de la catégorie\u00a0: ${fmtEntier(r.clientsCat)}`,
            ];
            if (cat !== "verte") {
                bits.push(`Clients en plus\u00a0: +${fmtEntier(r.nouveauxClients + r.clientsEquipes * r.uplift)}`);
                const cls = r.solde >= 0 ? "com-pos" : "com-neg";
                bits.push(`Impact marge\u00a0: <span class="${cls}">${fmtEurosSigne(r.solde)}</span>`);
            } else {
                bits.push(`Panier\u00a0: ${fmtEuros(r.panier)}`);
            }
            resume.innerHTML = bits.join(" · ");
            couloir.hidden = r.part <= 0; // clientèle nulle : ligne masquée
        } else {
            resume.innerHTML = "";
        }
    }
    if (!res) return;
    // Chiffre héros
    dom.impactEuros.textContent = fmtEurosSigne(res.impactNet) + " par mois";
    dom.impactEuros.className = "com-heros-montant " + (res.impactNet >= 0 ? "com-pos" : "com-neg");
    dom.impactPourcent.textContent = `${res.impactNet >= 0 ? "+" : "−"}${fmtPct(Math.abs(res.impactNet / res.resultat))} sur votre résultat mensuel`;
    // Cascade
    dom.fluxPerte.textContent = fmtEurosSigne(-res.perteTotale);
    dom.fluxGainEquipe.textContent = fmtEurosSigne(res.gainEquipeTotal);
    dom.fluxGainCapture.textContent = fmtEurosSigne(res.gainCaptureTotal);
    dom.fluxSolde.textContent = fmtEurosSigne(res.impactNet);
    dom.fluxSolde.className = res.impactNet >= 0 ? "com-pos" : "com-neg";
    // Suggestion
    dom.suggestion.textContent = suggestion(res);
    // Tableau détaillé
    dom.tableauTbody.innerHTML = "";
    for (const cat of CATEGORIES) {
        const r = res.parCat[cat];
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${cat[0].toUpperCase() + cat.slice(1)}</td>
            <td>${fmtEntier(r.clientsCat)}</td>
            <td>${fmtEuros(r.panier)}</td>
            <td>${cat === "verte" ? "—" : fmtPct(r.reduction, 0)}</td>
            <td>${cat === "verte" ? "—" : "+" + fmtEntier(r.nouveauxClients + (r.clientsEquipes || 0) * (r.uplift || 0))}</td>
            <td class="${r.solde >= 0 ? "com-pos" : "com-neg"}">${cat === "verte" ? "—" : fmtEurosSigne(r.solde)}</td>
            ${etat.expert ? `<td>${fmtEuros(REVENU_CATEGORIES[cat])}</td>` : ""}`;
        dom.tableauTbody.appendChild(tr);
    }
}

/** Une seule suggestion contextuelle, formulée prudemment. */
function suggestion(res) {
    if (res.impactNet < 0) {
        // Cherche la réduction à abaisser pour rendre le solde positif
        for (const cat of ["rouge", "orange", "jaune"]) {
            const r = res.parCat[cat];
            if (r.reduction <= 0) continue;
            // essaie des réductions plus faibles par pas de 1 %
            for (let pct = Math.floor(r.reduction * 100) - 1; pct >= 0; pct--) {
                const delta = simulerImpact({ [cat]: pct / 100 });
                if (delta >= 0) {
                    return `En réduisant la réduction ${cat} de ${fmtPct(r.reduction, 0)} à ${pct}\u202f%, votre résultat deviendrait positif\u00a0: ${fmtEurosSigne(delta)} par mois. À tester\u00a0!`;
                }
            }
        }
        return "Votre solde est négatif : abaissez vos réductions ou ciblez-les sur les catégories qui vous apportent le plus de visites.";
    }
    // Solde positif : une piste d'optimisation simple
    const parts = res.parts;
    const catMax = ["rouge", "orange", "jaune"].reduce((a, b) => res.parCat[a].part >= res.parCat[b].part ? a : b);
    return `À tester\u00a0: ajustez légèrement vos réductions à la hausse sur la catégorie ${catMax} (part la plus large de votre clientèle) pour capter davantage de visites, et vérifiez que le solde reste positif.`;
}

/** Recalcule l'impact net avec une variation ponctuelle des réductions. */
function simulerImpact(variation) {
    const sauvee = { ...etat.reductions };
    Object.assign(etat.reductions, variation);
    const res = calculer();
    etat.reductions = sauvee;
    return res ? res.impactNet : 0;
}

/* ============================================================
   Infobulles ⓘ (formules générées programmatiquement)
   ============================================================ */
function texteFormule(cle, res) {
    const p = etat.parametres;
    const lignes = [];
    for (const cat of ["rouge", "orange", "jaune"]) {
        const r = res.parCat[cat];
        if (r.reduction <= 0) continue;
        if (cle === "perte") {
            lignes.push(`${cat}\u00a0: ${fmtEntier(r.clientsCat)} clients × ${fmtPct(p.tauxEquipement)} équipés × ${fmtPct(r.reduction, 0)} réduction × ${fmtEuros(r.panier)} panier × ${fmtPct(etat.marge)} marge = ${fmtEuros(r.perte)}`);
        } else if (cle === "gainEquip") {
            lignes.push(`${cat}\u00a0: ${fmtEntier(r.clientsCat)} × ${fmtPct(p.tauxEquipement)} × ${fmtPct(r.uplift, 0)} uplift × ${fmtEuros(r.panier)} × ${fmtPct(etat.marge)} = ${fmtEuros(r.gainEquipe)}`);
        } else if (cle === "gainCapture") {
            const potentiels = entreeCP().m * etat.couverture * r.part;
            lignes.push(`${cat}\u00a0: ${fmtEntier(entreeCP().m)} ménages × ${fmtPct(etat.couverture, 0)} couverture × ${fmtPct(r.part, 0)} clientèle = ${fmtEntier(potentiels)} potentiels × ${fmtPct(p.tauxCapture)} captés × ${fmtPct(r.uplift, 0)} uplift × ${fmtEuros(r.panier)} × ${fmtPct(etat.marge)} = ${fmtEuros(r.gainCapture)}`);
        }
    }
    return lignes.join("\n") || "Aucune réduction active.";
}

function montrerInfobulle(cible, cle) {
    const res = calculer();
    if (!res) return;
    dom.infobulle.textContent = texteFormule(cle, res);
    dom.infobulle.style.whiteSpace = "pre-line";
    dom.infobulle.hidden = false;
    const rect = cible.getBoundingClientRect();
    const largeur = dom.infobulle.offsetWidth;
    let gauche = Math.min(rect.left, window.innerWidth - largeur - 8);
    dom.infobulle.style.left = Math.max(8, gauche) + "px";
    dom.infobulle.style.top = Math.min(rect.bottom + 8, window.innerHeight - dom.infobulle.offsetHeight - 8) + "px";
}

function cacherInfobulle() {
    dom.infobulle.hidden = true;
}

/* ============================================================
   Mode expert
   ============================================================ */
function basculerExpert() {
    etat.expert = dom.expertToggle.checked;
    document.body.classList.toggle("com-expert", etat.expert);
    document.querySelectorAll(".com-expert-seule").forEach((el) => { el.hidden = !etat.expert; });
    if (etat.expert && !$("bloc-expert")) {
        const bloc = document.createElement("div");
        bloc.className = "com-bloc com-expert-bloc";
        bloc.id = "bloc-expert";
        bloc.innerHTML = `
            <p class="com-label">Hypothèses de calcul</p>
            <div class="com-grille-champs">
                <div class="com-champ"><label class="com-label" for="taux-capture">Taux de capture (%)</label><input type="number" id="taux-capture" class="com-input" step="0.5" value="${etat.parametres.tauxCapture * 100}"></div>
                <div class="com-champ"><label class="com-label" for="taux-equipement">Taux d'équipement (%)</label><input type="number" id="taux-equipement" class="com-input" step="0.5" value="${etat.parametres.tauxEquipement * 100}"></div>
                <div class="com-champ"><label class="com-label" for="taux-activation">Taux d'activation (visites/mois)</label><input type="number" id="taux-activation" class="com-input" step="0.05" value="${etat.parametres.tauxActivation}"></div>
                <div class="com-champ"><label class="com-label" for="marge-nette">Marge nette (%)</label><input type="number" id="marge-nette" class="com-input" step="0.5" value="${etat.parametres.margeNette * 100}"></div>
            </div>
            <p class="com-label" style="margin-top:12px">Paniers par catégorie (€)</p>
            <div class="com-grille-champs">
                ${["rouge", "orange", "jaune", "verte"].map((cat) => `
                    <div class="com-champ"><label class="com-label" for="panier-${cat}">${cat[0].toUpperCase() + cat.slice(1)}</label>
                    <input type="number" id="panier-${cat}" class="com-input com-panier-expert" data-categorie="${cat}" step="0.5"></div>`).join("")}
            </div>
            <p class="com-help">Panier moyen implicite (somme pondérée)\u00a0: <output id="panier-implicite">—</output></p>`;
        dom.couloirs.parentElement.insertBefore(bloc, dom.couloirs);
        bloc.querySelectorAll("input[type=number]").forEach((input) => {
            input.addEventListener("input", () => {
                const v = parseFloat(input.value.replace(",", "."));
                if (isNaN(v) || v < 0) return;
                if (input.id === "taux-capture") etat.parametres.tauxCapture = v / 100;
                if (input.id === "taux-equipement") etat.parametres.tauxEquipement = v / 100;
                if (input.id === "taux-activation") etat.parametres.tauxActivation = v;
                if (input.id === "marge-nette") etat.parametres.margeNette = v / 100;
                if (input.classList.contains("com-panier-expert")) {
                    const paniers = paniersCategories();
                    if (!etat.paniersEdites) etat.paniersEdites = { ...paniers };
                    etat.paniersEdites[input.dataset.categorie] = v;
                    const implicite = panierMoyenImplicite();
                    $("panier-implicite").textContent = implicite ? fmtEuros(implicite) : "—";
                }
                recalculer();
            });
        });
        const paniers = paniersCategories();
        if (paniers) for (const cat of CATEGORIES) $("panier-" + cat).value = Math.round(paniers[cat]);
        const implicite = panierMoyenImplicite();
        $("panier-implicite").textContent = implicite ? fmtEuros(implicite) : "—";
    }
    majURL();
    recalculer();
}

/* ============================================================
   État dans l'URL
   ============================================================ */
function majURL() {
    const params = new URLSearchParams();
    if (etat.cp) params.set("cp", etat.cp);
    params.set("type", etat.typeCommerce);
    params.set("marge", etat.marge);
    params.set("clients", etat.clients);
    params.set("panier", etat.panier);
    params.set("couv", etat.couverture);
    for (const cat of ["rouge", "orange", "jaune"]) params.set("r" + cat[0], etat.reductions[cat]);
    if (etat.clientele) etat.clientele.forEach((v, i) => params.set("cli" + i, v.toFixed(3)));
    if (etat.expert) params.set("expert", "1");
    history.replaceState(null, "", location.pathname + "?" + params.toString());
}

function restaurerDepuisURL() {
    const params = new URLSearchParams(location.search);
    const cp = params.get("cp");
    if (cp && baseCP[cp]) {
        selectionnerCommune(cp);
        dom.resultatVide.hidden = true;
        dom.resultatsContenu.hidden = !baseCP[cp].r;
    }
    const type = params.get("type");
    if (type && config.typesCommerce[type]) {
        etat.typeCommerce = type;
        dom.typesContainer.querySelectorAll(".com-type-carte").forEach((b) =>
            b.setAttribute("aria-checked", b.dataset.type === type));
    }
    const marge = parseFloat(params.get("marge"));
    if (marge > 0) { etat.marge = marge; dom.margeInput.value = Math.round(marge * 100); }
    const clients = parseInt(params.get("clients"));
    if (clients > 0) { etat.clients = clients; dom.clientsInput.value = clients; }
    const panier = parseFloat(params.get("panier"));
    if (panier > 0) { etat.panier = panier; dom.panierInput.value = panier; }
    const couv = parseFloat(params.get("couv"));
    if (couv > 0 && couv <= 1) { etat.couverture = couv; dom.couvertureRange.value = Math.round(couv * 100); majCouvertureOut(); }
    for (const cat of ["rouge", "orange", "jaune"]) {
        const r = parseFloat(params.get("r" + cat[0]));
        if (r >= 0 && r <= 0.5) etat.reductions[cat] = r;
    }
    const cli = [0, 1, 2].map((i) => parseFloat(params.get("cli" + i)));
    if (cli.every((v) => v >= 0 && v <= 1) && cli[0] > 0) {
        etat.clientele = [cli[0], cli[1] - cli[0], cli[2] - cli[1], 1 - cli[2]];
        dessinerBarres();
    }
    if (params.get("expert") === "1") {
        dom.expertToggle.checked = true;
        basculerExpert();
    }
    // synchroniser les sliders de réduction avec l'état
    dom.couloirs.querySelectorAll("input[type=range]").forEach((s) => {
        s.value = Math.round(etat.reductions[s.dataset.categorie] * 100);
        s.dispatchEvent(new Event("input"));
    });
}

/* ============================================================
   Événements
   ============================================================ */
function majCouvertureOut() {
    dom.couvertureOut.textContent = Math.round(etat.couverture * 100) + "\u202f%";
}

function brancherEvenements() {
    // Menu mobile (cohérent avec le site)
    document.querySelector(".hamburger").addEventListener("click", () =>
        document.querySelector(".nav-sidebar").classList.toggle("open"));
    document.querySelectorAll(".nav-sidebar a").forEach((link) =>
        link.addEventListener("click", () => document.querySelector(".nav-sidebar").classList.remove("open")));

    // Autocomplete
    dom.communeInput.addEventListener("input", () => afficherSuggestions(filtrerCommunes(dom.communeInput.value)));
    dom.communeInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { dom.communeListe.hidden = true; }
        if (e.key === "Enter") {
            const prem = dom.communeListe.querySelector("li");
            if (prem && !dom.communeListe.hidden) { selectionnerCommune(prem.dataset.cp); e.preventDefault(); }
        }
    });
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".com-autocomplete")) dom.communeListe.hidden = true;
    });

    // Réinitialisation clientèle
    dom.clienteleReset.addEventListener("click", () => {
        etat.clientele = null;
        dessinerBarres();
        majURL();
        recalculer();
    });

    // Caractéristiques du commerce
    dom.margeInput.addEventListener("input", () => {
        const v = parseFloat(dom.margeInput.value);
        if (v > 0 && v <= 90) { etat.marge = v / 100; majURL(); recalculer(); }
    });
    dom.clientsInput.addEventListener("input", () => {
        const v = parseInt(dom.clientsInput.value);
        if (v > 0) { etat.clients = v; majURL(); recalculer(); }
    });
    dom.panierInput.addEventListener("input", () => {
        const v = parseFloat(dom.panierInput.value);
        if (v > 0) { etat.panier = v; majURL(); recalculer(); }
    });
    dom.couvertureRange.addEventListener("input", () => {
        etat.couverture = Number(dom.couvertureRange.value) / 100;
        majCouvertureOut();
        majURL();
        recalculer();
    });

    // Mode expert
    dom.expertToggle.addEventListener("change", basculerExpert);

    // Infobulles
    document.querySelectorAll(".com-info").forEach((btn) => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); montrerInfobulle(btn, btn.dataset.info); });
        btn.addEventListener("mouseenter", () => montrerInfobulle(btn, btn.dataset.info));
        btn.addEventListener("mouseleave", cacherInfobulle);
    });
    document.addEventListener("click", cacherInfobulle);
    window.addEventListener("scroll", cacherInfobulle, { passive: true });

    // Sauvegarde par lien
    dom.sauverBtn.addEventListener("click", async () => {
        majURL();
        try {
            await navigator.clipboard.writeText(location.href);
            dom.sauverMessage.textContent = "Lien copié, gardez-le pour retrouver votre simulation.";
        } catch {
            dom.sauverMessage.textContent = "Copiez l'URL de la barre d'adresse pour retrouver votre simulation.";
        }
    });
}

/** Cas de référence par défaut : Conflans-Sainte-Honorine. */
function preselectionConflans() {
    if (baseCP["78700"]) selectionnerCommune("78700");
}

chargerDonnees();
