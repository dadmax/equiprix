/* ============================================================
   app.js — Interface du simulateur commerçants.
   Charge les JSON, gère l'état (URL uniquement), recalcule en
   temps réel et met à jour le DOM de façon ciblée.

   Structure de la page (page pour les commerces, avec un simulateur) :
   - en-tête : proposition de valeur (slogan) + CTA ;
   - accroche « La tarification solidaire, c'est quoi ? » ;
   - bloc #simulateur : scénarios + narratif, puis « Votre commerce »
     (Commune + Activité) et « Simulation » (Vos réductions + Résultats,
     badge « paramètres modifiés » + reset, toggle « Mode expert »), puis
     les sources en <details> replié (pas de titre H2) ;
   - « Comment ça marche ? » (3 maquettes d'appli), « Engagement »,
     « Tarification ».
   Textes marketing EN DUR dans index.html (éditables directement, avec
   balisage) ; seules les valeurs chiffrées de la tarification (frais par
   passage, cap mensuel) sont injectées depuis parametres.* du JSON.
   En mode non expert, une super-catégorie « Foyers éligibles » (60 %
   de niveaux de vie les plus bas) pilote les réductions rouge/orange/
   jaune à la même valeur. En mode expert, les trois catégories sont
   détaillées individuellement.
   ============================================================ */
"use strict";

(function () {
    // ---------- Données chargées au démarrage ----------
    let maître = null;       // data/commerces.json
    let cpBase = null;       // data/codes-postaux-precalc.json
    let indexNoms = [];      // [{cp, nom, nbMenages, nbCommunes, communes}]

    // ---------- État courant ----------
    // Valeurs par défaut initialisées depuis le JSON maître.
    const LISTE_REDUCTIONS = [0, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
    const ID_USECASE_DEFAUT = "monCommerce";
    const etat = {
        usecase: ID_USECASE_DEFAUT,
        cp: null,
        type: null,
        marge: null,
        passages: null,
        panier: null,
        profil: null,
        attractiviteIndex: null,
        reductions: {},          // {rouge, orange, jaune}
        expert: false,
        // Copie des params du usecase actif (null sur « mon commerce ») :
        // sert à détecter les modifications manuelles (badge + bouton reset)
        paramsUsecase: null,
    };

    // ---------- Éléments DOM ----------
    const $ = (id) => document.getElementById(id);
    const els = {
        scenariosListe: $("scenarios-liste"),
        narratif: $("narratif"),
        narratifImage: $("narratif-image"),
        cpInput: $("cp-input"),
        cpListe: $("cp-liste"),
        cpSelectionne: $("cp-selectionne"),
        cpNom: $("cp-nom"),
        cpDetail: $("cp-detail"),
        cpInfos: $("cp-infos"),
        cpIndisponible: $("cp-indisponible"),
        barrePopulation: $("barre-population"),
        barreFrance: $("barre-france"),
        cartesType: $("cartes-type"),
        marge: $("marge"),
        passages: $("passages"),
        panier: $("panier"),
        estimationNote: $("estimation-note"),
        profil: $("profil"),
        profilReperes: $("profil-reperes"),
        attractivite: $("attractivite"),
        attractiviteReperes: $("attractivite-reperes"),
        attractiviteNom: $("attractivite-nom"),
        toggleExpert: $("toggle-expert"),
        badgeModifie: $("badge-modifie"),
        btnResetUsecase: $("btn-reset-usecase"),
        couloirEligibles: $("couloir-eligibles"),
        couloirsExpert: $("couloirs-expert"),
        redEligibles: $("red-eligibles"),
        upliftEligibles: $("uplift-eligibles"),
        impactNet: $("impact-net"),
        impactRatio: $("impact-ratio"),
        margeRef: $("marge-ref"),
        heroResultat: $("hero-resultat"),
        passagesPlus: $("passages-plus"),
        recapMarges: $("recap-marges"),
        recapPertes: $("recap-pertes"),
        recapFrais: $("recap-frais"),
        fraisMention: $("frais-mention"),
        detailCategories: $("detail-categories"),
        detailBody: $("detail-categories-body"),
        suggestion: $("suggestion"),
        btnSauver: $("btn-sauver"),
        sauvegardeOk: $("sauvegarde-ok"),
        tooltip: $("tooltip"),
        sourceSondage: $("source-sondage"),
        // Seules valeurs injectées depuis le JSON maître (textes marketing en dur dans le HTML)
        tarFraisParPassage: $("tar-frais-par-passage"),
        tarCapMensuel: $("tar-cap-mensuel"),
    };

    // ---------- Initialisation ----------
    async function init() {
        try {
            const [rMaitre, rCp] = await Promise.all([
                fetch("data/commerces.json"),
                fetch("data/codes-postaux-precalc.json"),
            ]);
            if (!rMaitre.ok || !rCp.ok) throw new Error("HTTP " + rMaitre.status + "/" + rCp.status);
            maître = await rMaitre.json();
            cpBase = await rCp.json();
        } catch (e) {
            document.querySelector("main").insertAdjacentHTML(
                "afterbegin",
                '<p class="sim-warning">Les données n’ont pas pu être chargées. Vérifiez votre connexion puis rechargez la page.</p>'
            );
            return;
        }

        initialiserEtatDepuisJSON();
        construireIndexNoms();
        construireScenarios();
        construireCartesType();
        construireProfils();
        construireJaugeAttractivite();
        construireSelectEligibles();
        construireCouloirsExpert();
        construireBarreFrance();
        els.sourceSondage.textContent = maître.textes.sondage || "";
        // Libellé + aide de la marge (précise : marge sur produit, pas marge totale charges incluses)
        if (maître.textes.labelMarge) $("label-marge").textContent = maître.textes.labelMarge;
        if (maître.textes.aideMarge) $("aide-marge").textContent = maître.textes.aideMarge;
        appliquerValeursTarification();
        restaurerDepuisURL();
        brancherEvenements();
        mettreAJour();
    }

    // Valeurs par défaut issues du JSON maître (aucune valeur métier en dur)
    function initialiserEtatDepuisJSON() {
        const premierType = Object.keys(maître.typesCommerce)[0];
        etat.type = premierType;
        etat.marge = maître.typesCommerce[premierType].margeDefaut;
        etat.passages = maître.typesCommerce[premierType].passagesDefaut;
        etat.panier = maître.typesCommerce[premierType].panierDefaut;
        const profilDefaut = maître.profilsClientele.find((p) => p.id === "unPeuAisee")
            || maître.profilsClientele[Math.min(1, maître.profilsClientele.length - 1)];
        etat.profil = profilDefaut.id;
        const idxMoyenne = maître.attractivite.findIndex((a) => a.id === "moyenne");
        etat.attractiviteIndex = idxMoyenne >= 0 ? idxMoyenne : Math.floor(maître.attractivite.length / 2);
        for (const cat of CATEGORIES_REDUITES) {
            etat.reductions[cat] = 0.10;
        }
        els.marge.value = Math.round(etat.marge * 100);
        els.passages.value = etat.passages;
        els.panier.value = etat.panier;
    }

    // Index nom → CP pour l'autocomplétion (trié par ménages décroissants)
    function construireIndexNoms() {
        indexNoms = Object.entries(cpBase).map(([cp, e]) => ({
            cp,
            nom: e.communes[0] || cp,
            nb: e.nbMenages || 0,
            nbCommunes: e.communes.length,
            communes: e.communes,
        }));
        indexNoms.sort((a, b) => b.nb - a.nb);
    }

    // ---------- Scénarios (use cases) ----------
    function construireScenarios() {
        els.scenariosListe.innerHTML = "";
        // Choix par défaut : simuler sur son propre commerce
        const defaut = creerBoutonScenario(ID_USECASE_DEFAUT, "Simuler sur mon commerce", true);
        els.scenariosListe.appendChild(defaut);
        for (const uc of maître.useCases || []) {
            els.scenariosListe.appendChild(creerBoutonScenario(uc.id, uc.nom, false));
        }
    }

    // Boutons pilule sans radio native : le <button> porte aria-pressed,
    // l'état actif se lit via la classe .actif (pastille ✓ + fond plein).
    function creerBoutonScenario(id, nom, cocheParDefaut) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sim-scenario";
        btn.dataset.scenario = id;
        btn.setAttribute("aria-pressed", String(cocheParDefaut));
        if (cocheParDefaut) btn.classList.add("actif");
        btn.innerHTML = '<span class="sim-scenario-check" aria-hidden="true">✓</span>';
        btn.appendChild(document.createTextNode(nom));
        btn.addEventListener("click", () => appliquerUsecase(id));
        return btn;
    }

    // Active visuellement le bouton d'un scénario (sans réappliquer ses params)
    function activerBoutonScenario(id) {
        els.scenariosListe.querySelectorAll(".sim-scenario").forEach((b) => {
            const actif = b.dataset.scenario === id;
            b.classList.toggle("actif", actif);
            b.setAttribute("aria-pressed", String(actif));
        });
    }

    function appliquerUsecase(id) {
        appliquerUsecaseParams(id);
    }

    function appliquerUsecaseParams(id) {
        etat.usecase = id;
        activerBoutonScenario(id);
        const uc = (maître.useCases || []).find((u) => u.id === id);
        // Référence des params du usecase pour détecter les modifs manuelles
        etat.paramsUsecase = uc ? JSON.parse(JSON.stringify(uc.params || {})) : null;
        mettreAJourBadgeModifie();
        if (!uc) {
            // Retour au scénario par défaut : narratif générique, pas de préconfiguration
            etat.expert = false;
            els.toggleExpert.checked = false;
            els.narratif.textContent = maître.textes.narratifDefaut;
            els.narratifImage.hidden = true;
            mettreAJour();
            return;
        }
        // Préconfigurer le simulateur avec les hypothèses de l'usescase
        const p = uc.params || {};
        if (p.cp && cpBase[p.cp]) choisirCP(p.cp);
        if (p.type && maître.typesCommerce[p.type]) {
            etat.type = p.type;
            const t = maître.typesCommerce[p.type];
            if (p.marge === undefined) { etat.marge = t.margeDefaut; els.marge.value = Math.round(t.margeDefaut * 100); }
            if (p.passages === undefined) { etat.passages = t.passagesDefaut; els.passages.value = t.passagesDefaut; }
            if (p.panier === undefined) { etat.panier = t.panierDefaut; els.panier.value = t.panierDefaut; }
        }
        if (p.marge !== undefined) { etat.marge = p.marge; els.marge.value = Math.round(p.marge * 100); }
        if (p.passages !== undefined) { etat.passages = p.passages; els.passages.value = p.passages; }
        if (p.panier !== undefined) { etat.panier = p.panier; els.panier.value = p.panier; }
        if (p.profil && maître.profilsClientele.some((pr) => pr.id === p.profil)) {
            etat.profil = p.profil;
        }
        if (p.attr !== undefined) {
            const idx = maître.attractivite.findIndex((a) => a.facteur === p.attr);
            if (idx >= 0) etat.attractiviteIndex = idx;
        }
        for (const [cle, cat] of [["rr", "rouge"], ["ro", "orange"], ["rj", "jaune"]]) {
            if (p[cle] !== undefined) {
                etat.reductions[cat] = arrondirSurGrille(p[cle]);
            }
        }
        // Réductions différenciées (ex. 10 % sur rouge/orange, 0 % sur jaune) :
        // la super-catégorie « éligibles » n'a plus de sens -> mode expert coché
        // par défaut. L'URL (?expert=1) reste prioritaire si présente.
        const reds = CATEGORIES_REDUITES.map((c) => etat.reductions[c]);
        const expertForce = CATEGORIES_REDUITES.some((c) => p[["rr", "ro", "rj"][CATEGORIES_REDUITES.indexOf(c)]] !== undefined)
            && reds.some((r) => Math.abs(r - reds[0]) > 1e-9);
        etat.expert = expertForce;
        els.toggleExpert.checked = expertForce;
        // Narratif + illustration
        els.narratif.textContent = uc.narratif || maître.textes.narratifDefaut;
        if (uc.image) {
            els.narratifImage.src = uc.image;
            els.narratifImage.alt = uc.nom;
            els.narratifImage.hidden = false;
        } else {
            els.narratifImage.hidden = true;
        }
        mettreAJour();
    }

    // ---------- Badge « paramètres modifiés » + reset du usecase ----------
    // Vrai si l'état courant diffère des params du usecase actif
    function paramsSontModifies() {
        if (!etat.usecase || etat.usecase === ID_USECASE_DEFAUT || !etat.paramsUsecase) return false;
        const ref = etat.paramsUsecase;
        // On ne compare que les champs explicitement définis dans le usecase ;
        // marge/passages/panier omis => valeur de référence = défaut du type.
        const typeRef = (ref.type && maître.typesCommerce[ref.type]) || {};
        if (ref.cp !== undefined && etat.cp !== ref.cp) return true;
        if (ref.type !== undefined && etat.type !== ref.type) return true;
        if (ref.marge !== undefined && Math.abs(etat.marge - ref.marge) > 1e-9) return true;
        if (ref.passages !== undefined && etat.passages !== ref.passages) return true;
        if (ref.panier !== undefined && etat.panier !== ref.panier) return true;
        if (ref.profil !== undefined && etat.profil !== ref.profil) return true;
        if (ref.attr !== undefined && obtenirFacteurAttractivite() !== ref.attr) return true;
        if (ref.marge === undefined && ref.type !== undefined && Math.abs(etat.marge - typeRef.margeDefaut) > 1e-9) return true;
        if (ref.passages === undefined && ref.type !== undefined && etat.passages !== typeRef.passagesDefaut) return true;
        if (ref.panier === undefined && ref.type !== undefined && etat.panier !== typeRef.panierDefaut) return true;
        return CATEGORIES_REDUITES.some((cat) => {
            const cle = { rouge: "rr", orange: "ro", jaune: "rj" }[cat];
            return ref[cle] !== undefined
                && Math.abs(etat.reductions[cat] - arrondirSurGrille(ref[cle])) > 1e-9;
        });
    }

    function mettreAJourBadgeModifie() {
        const modifie = paramsSontModifies();
        els.badgeModifie.hidden = !modifie;
        els.btnResetUsecase.hidden = !modifie;
    }

    // Appelé à chaque mise à jour globale
    function mettreAJourUsecase() {
        mettreAJourBadgeModifie();
    }

    function arrondirSurGrille(v) {
        return LISTE_REDUCTIONS.reduce((prev, curr) =>
            Math.abs(curr - v) < Math.abs(prev - v) ? curr : prev);
    }

    // ---------- Construction des contrôles ----------
    function construireCartesType() {
        els.cartesType.innerHTML = "";
        for (const [id, type] of Object.entries(maître.typesCommerce)) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "sim-carte-type";
            btn.setAttribute("role", "radio");
            btn.setAttribute("aria-checked", String(id === etat.type));
            btn.dataset.type = id;
            btn.textContent = type.nom;
            btn.addEventListener("click", () => {
                // On garde le usecase actif (et son narratif) : la modification
                // est signalée par le badge « paramètres modifiés ».
                etat.type = id;
                etat.marge = type.margeDefaut;
                etat.passages = type.passagesDefaut;
                etat.panier = type.panierDefaut;
                els.marge.value = Math.round(type.margeDefaut * 100);
                els.passages.value = type.passagesDefaut;
                els.panier.value = type.panierDefaut;
                els.estimationNote.hidden = false;
                mettreAJour();
            });
            els.cartesType.appendChild(btn);
        }
    }

    // Clientèle en jauge (3 repères, comme la pénétration)
    function construireProfils() {
        els.profilReperes.innerHTML = "";
        maître.profilsClientele.forEach((profil) => {
            const span = document.createElement("span");
            span.textContent = profil.court || profil.nom; // libellés courts complets
            els.profilReperes.appendChild(span);
        });
        els.profil.max = String(maître.profilsClientele.length - 1);
        els.profil.addEventListener("input", () => {
            etat.profil = maître.profilsClientele[Number(els.profil.value)].id;
            mettreAJour();
        });
    }

    // Applique l'index du profil courant au curseur (le libellé détaillé
    // du profil n'est plus répété sous la jauge : les repères suffisent)
    function mettreAJourProfilJauge() {
        const idx = maître.profilsClientele.findIndex((p) => p.id === etat.profil);
        if (idx >= 0) {
            els.profil.value = String(idx);
        }
    }

    function construireJaugeAttractivite() {
        els.attractiviteReperes.innerHTML = "";
        maître.attractivite.forEach((a) => {
            const span = document.createElement("span");
            span.textContent = a.court || a.nom.split(" — ")[0]; // libellés courts
            els.attractiviteReperes.appendChild(span);
        });
        els.attractivite.max = String(maître.attractivite.length - 1);
        els.attractivite.addEventListener("input", () => {
            etat.attractiviteIndex = Number(els.attractivite.value);
            mettreAJour();
        });
    }

    // Select « foyers éligibles » (mode non expert)
    function construireSelectEligibles() {
        els.redEligibles.innerHTML = "";
        for (const r of LISTE_REDUCTIONS) {
            const opt = document.createElement("option");
            opt.value = String(r);
            opt.textContent = formaterPourcent(r, 0);
            els.redEligibles.appendChild(opt);
        }
        els.redEligibles.addEventListener("change", () => {
            const v = arrondirSurGrille(Number(els.redEligibles.value));
            // Appliquer la même réduction aux trois catégories
            for (const cat of CATEGORIES_REDUITES) etat.reductions[cat] = v;
            mettreAJour();
        });
    }

    // Couloirs détaillés rouge/orange/jaune (mode expert), construits en JS
    function construireCouloirsExpert() {
        const conteneur = els.couloirsExpert;
        // Ordre d'affichage : rouge, orange, jaune (du plus bas au plus haut)
        // On insère chaque couloir après le précédent pour conserver l'ordre.
        let precedent = null;
        for (const cat of ["rouge", "orange", "jaune"]) {
            const div = document.createElement("div");
            div.className = `sim-couloir sim-couloir-${cat}`;
            const plage = { rouge: "0 à 20 % des niveaux de vie", orange: "20 à 40 % des niveaux de vie", jaune: "40 à 60 % des niveaux de vie" }[cat];
            div.innerHTML = `
                <p class="sim-couloir-titre">
                    <span class="sim-couloir-dot" aria-hidden="true"></span>
                    ${cat.charAt(0).toUpperCase() + cat.slice(1)} — ${plage}
                </p>
                <div class="sim-field">
                    <label class="sim-label" for="red-${cat}">Réduction</label>
                    <select id="red-${cat}" class="sim-select"></select>
                </div>
                <p class="sim-uplift" id="uplift-${cat}"></p>
                <dl class="sim-couloir-infos">
                    <div><dt>Part de votre clientèle</dt><dd id="info-part-${cat}">—</dd></div>
                    <div><dt>Passages mensuels actuels</dt><dd id="info-passages-${cat}">—</dd></div>
                    <div><dt>Potentiel de passage mensuel</dt><dd id="info-potentiel-${cat}">—</dd></div>
                    <div><dt>Panier moyen (proportionnel au revenu médian&nbsp;: <span id="rev-${cat}"></span>)</dt><dd id="info-panier-${cat}">—</dd></div>
                    <div><dt>Clients mensuels en plus</dt><dd id="info-clients-${cat}">—</dd></div>
                </dl>`;
            if (precedent) {
                conteneur.insertBefore(div, precedent.nextSibling);
            } else {
                conteneur.insertBefore(div, conteneur.firstChild);
            }
            precedent = div;
        }
        // Brancher les selects + remplir les revenus médians
        for (const cat of CATEGORIES_REDUITES) {
            const select = $("red-" + cat);
            select.innerHTML = "";
            for (const r of LISTE_REDUCTIONS) {
                // Valeurs "0.05" style : String(0.05) = "0.05", String(0.1) = "0.1"
                const opt = document.createElement("option");
                opt.value = String(r);
                opt.textContent = formaterPourcent(r, 0);
                select.appendChild(opt);
            }
            select.addEventListener("change", () => {
                // Retrouver la valeur de la grille la plus proche (évite les écarts
                // de virgule flottante entre "0.05" saisi et 0.05 calculé)
                etat.reductions[cat] = arrondirSurGrille(Number(select.value));
                mettreAJour();
            });
            $("rev-" + cat).textContent = formaterEuros(maître.revenusCategories[cat]);
        }
        $("rev-verte").textContent = formaterEuros(maître.revenusCategories.verte);
    }

    // Remplit hauteur + pourcentage lisible de chaque segment d'une barre verticale
    function remplirBarreVerticale(barre, parts) {
        for (const cat of CATEGORIES) {
            const seg = barre.querySelector(`.sim-seg-v-${cat}`);
            seg.style.height = (parts[cat] * 100) + "%";
            const val = seg.querySelector(".sim-seg-val");
            if (val) val.textContent = formaterPourcent(parts[cat], 0);
        }
    }

    // Barre verticale France entière (20/20/20/40 depuis le JSON) + titres
    function construireBarreFrance() {
        const parts = maître.partsFranceComparatif;
        remplirBarreVerticale(els.barreFrance, parts);
        $("titre-france").textContent = maître.textes.titreBarreFrance || "France entière (comparatif)";
        $("titre-secteur").textContent = maître.textes.titreBarreSecteur || "Votre secteur";
        // Légendes communes (libellés qualitatifs du JSON)
        const legendes = maître.textes.legendesCategories || {};
        for (const cat of CATEGORIES) {
            $("leg-" + cat).textContent = legendes[cat]
                || `${cat.charAt(0).toUpperCase() + cat.slice(1)}`;
        }
    }

    // ---------- Valeurs de la tarification ----------
    // Les textes marketing sont en dur dans index.html ; seuls le tarif par
    // passage et le cap mensuel proviennent de parametres.* du JSON maître
    // (les <span> du HTML servent de repli si le JSON ne charge pas).
    function appliquerValeursTarification() {
        const p = maître.parametres;
        if (els.tarFraisParPassage) els.tarFraisParPassage.textContent = formaterEuros(p.fraisServiceParPassage, 2);
        if (els.tarCapMensuel) els.tarCapMensuel.textContent = formaterEuros(p.capFraisServiceMensuel);
    }

    // ---------- Événements ----------
    function brancherEvenements() {
        document.querySelector(".hamburger").addEventListener("click", function () {
            document.querySelector(".nav-sidebar").classList.toggle("open");
        });
        document.querySelectorAll(".nav-sidebar a").forEach((link) => {
            link.addEventListener("click", () => {
                document.querySelector(".nav-sidebar").classList.remove("open");
            });
        });

        els.marge.addEventListener("input", () => {
            etat.marge = (parseFloat(els.marge.value) || 0) / 100;
            els.estimationNote.hidden = true;
            mettreAJour();
        });
        els.passages.addEventListener("input", () => {
            etat.passages = parseInt(els.passages.value, 10) || 0;
            els.estimationNote.hidden = true;
            mettreAJour();
        });
        els.panier.addEventListener("input", () => {
            etat.panier = parseFloat(els.panier.value) || 0;
            els.estimationNote.hidden = true;
            mettreAJour();
        });

        // Autocomplétion CP
        els.cpInput.addEventListener("input", onRechercheCP);
        els.cpInput.addEventListener("keydown", onClavierCP);
        els.cpInput.addEventListener("blur", () => {
            setTimeout(() => { els.cpListe.hidden = true; }, 200);
        });
        els.cpInput.addEventListener("focus", () => {
            if (els.cpInput.value.trim().length >= 2) onRechercheCP();
        });

        // Reset : remettre les paramètres par défaut du usecase actif
        els.btnResetUsecase.addEventListener("click", () => {
            if (etat.usecase && etat.usecase !== ID_USECASE_DEFAUT) {
                appliquerUsecase(etat.usecase);
            }
        });

        // Mode expert : toggle haut de section « Simulation »
        els.toggleExpert.addEventListener("change", () => {
            etat.expert = els.toggleExpert.checked;
            if (etat.expert) {
                // Toggle vers expert : appliquer la réduction « éligibles » à toutes les catégories
                const v = Number(els.redEligibles.value);
                for (const cat of CATEGORIES_REDUITES) etat.reductions[cat] = v;
            } else {
                // Décochage expert : ne garder que le taux le plus bas
                const min = Math.min(...CATEGORIES_REDUITES.map((c) => etat.reductions[c]));
                for (const cat of CATEGORIES_REDUITES) etat.reductions[cat] = min;
            }
            mettreAJour();
        });

        // Bouton sauver
        els.btnSauver.addEventListener("click", () => {
            const url = window.location.href;
            const done = () => {
                els.sauvegardeOk.hidden = false;
                setTimeout(() => { els.sauvegardeOk.hidden = true; }, 4000);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopie(url, done));
            } else {
                fallbackCopie(url, done);
            }
        });

        // Pastilles ⓘ
        document.querySelectorAll(".sim-info-btn").forEach((btn) => {
            btn.addEventListener("mouseenter", () => montrerTooltip(btn));
            btn.addEventListener("focus", () => montrerTooltip(btn));
            btn.addEventListener("click", () => montrerTooltip(btn));
            btn.addEventListener("mouseleave", cacherTooltip);
            btn.addEventListener("blur", cacherTooltip);
        });

        document.addEventListener("click", (e) => {
            if (!els.cpInput.contains(e.target) && !els.cpListe.contains(e.target)) {
                els.cpListe.hidden = true;
            }
        });
    }

    function fallbackCopie(texte, done) {
        const ta = document.createElement("textarea");
        ta.value = texte;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* silencieux */ }
        document.body.removeChild(ta);
    }

    // ---------- Autocomplétion code postal ----------
    let resultatsCP = [];
    let indexCPClavier = -1;

    function normaliserTexte(t) {
        return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    }

    function onRechercheCP() {
        const q = normaliserTexte(els.cpInput.value.trim());
        els.cpListe.innerHTML = "";
        if (q.length < 2) {
            els.cpListe.hidden = true;
            return;
        }
        resultatsCP = indexNoms.filter((e) => {
            if (/^\d+$/.test(q)) return e.cp.startsWith(q);
            return normaliserTexte(e.nom).includes(q);
        }).slice(0, 20);

        if (resultatsCP.length === 0) {
            els.cpListe.hidden = true;
            return;
        }
        resultatsCP.forEach((e, i) => {
            const li = document.createElement("li");
            li.setAttribute("role", "option");
            li.dataset.index = String(i);
            const code = document.createElement("span");
            code.className = "cp-code";
            code.textContent = e.cp;
            li.appendChild(code);
            li.appendChild(document.createTextNode(e.nom + (e.nbCommunes > 1 ? ` et ${e.nbCommunes - 1} autre${e.nbCommunes > 2 ? "s" : ""} commune${e.nbCommunes > 2 ? "s" : ""}` : "")));
            li.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                choisirCP(e.cp);
            });
            els.cpListe.appendChild(li);
        });
        els.cpListe.hidden = false;
        els.cpInput.setAttribute("aria-expanded", "true");
        indexCPClavier = -1;
    }

    function onClavierCP(e) {
        if (els.cpListe.hidden) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            indexCPClavier = Math.min(indexCPClavier + 1, resultatsCP.length - 1);
            surlignerOptionCP();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            indexCPClavier = Math.max(indexCPClavier - 1, 0);
            surlignerOptionCP();
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (indexCPClavier >= 0 && resultatsCP[indexCPClavier]) {
                choisirCP(resultatsCP[indexCPClavier].cp);
            }
        } else if (e.key === "Escape") {
            els.cpListe.hidden = true;
        }
    }

    function surlignerOptionCP() {
        els.cpListe.querySelectorAll("li").forEach((li, i) => {
            li.setAttribute("aria-selected", String(i === indexCPClavier));
        });
    }

    function choisirCP(cp) {
        etat.cp = cp;
        els.cpListe.hidden = true;
        els.cpInput.setAttribute("aria-expanded", "false");
        const e = cpBase[cp];
        els.cpInput.value = "";
        els.cpSelectionne.hidden = false;
        // Le nombre de ménages du secteur suit directement le nom de la commune :
        // « 73200 — Albertville (14 255 ménages) »
        const menages = e.donneesDispo && e.nbMenages ? ` (${formaterNombre(e.nbMenages)} ménages)` : "";
        els.cpNom.textContent = `${cp} — ${e.communes[0]}${menages}`;
        if (e.communes.length > 1) {
            els.cpDetail.textContent = `et ${e.communes.length - 1} autre${e.communes.length > 2 ? "s" : ""} commune${e.communes.length > 2 ? "s" : ""}`;
            els.cpDetail.title = e.communes.join(", ");
        } else {
            els.cpDetail.textContent = "";
            els.cpDetail.removeAttribute("title");
        }
        els.cpIndisponible.hidden = e.donneesDispo;
        els.cpInfos.hidden = !e.donneesDispo;
        mettreAJour();
    }

    // ---------- Helpers d'accès à l'état ----------
    const PARTS_MOYENNE_FRANCE = { rouge: 0.20, orange: 0.20, jaune: 0.20, verte: 0.40 };

    function obtenirPartsPop() {
        if (etat.cp && cpBase[etat.cp] && cpBase[etat.cp].donneesDispo) {
            return cpBase[etat.cp].parts;
        }
        // CP sans données (ou non renseigné) : moyenne française
        return maître.partsFranceComparatif || PARTS_MOYENNE_FRANCE;
    }

    function obtenirType() {
        return { ...maître.typesCommerce[etat.type], idMatrice: etat.type };
    }

    function obtenirProfil() {
        return maître.profilsClientele.find((p) => p.id === etat.profil) || maître.profilsClientele[0];
    }

    function obtenirFacteurAttractivite() {
        return maître.attractivite[etat.attractiviteIndex].facteur;
    }

    function entreeSimulation() {
        return {
            partsPop: obtenirPartsPop(),
            revenus: maître.revenusCategories,
            type: obtenirType(),
            profil: obtenirProfil(),
            facteurAttractivite: obtenirFacteurAttractivite(),
            marge: etat.marge,
            passages: etat.passages,
            panier: etat.panier,
            reductions: etat.reductions,
            parametres: maître.parametres,
            matrice: maître.matriceUplift,
        };
    }

    let dernierResultat = null;

    // ---------- Mise à jour globale ----------
    function mettreAJour() {
        if (!maître || !cpBase) return;

        const resultat = simulerMois(entreeSimulation());
        dernierResultat = { resultat, partsPop: obtenirPartsPop() };

        mettreAJourCommune();
        mettreAJourActivite();
        mettreAJourProfilJauge();
        mettreAJourReductions(resultat);
        mettreAJourResultats(resultat);
        mettreAJourSuggestion(resultat);
        mettreAJourUsecase();
        mettreAJourURL();
    }

    // --- Zone commune : barre verticale du secteur (hauteur = part en %) ---
    function mettreAJourCommune() {
        if (!etat.cp) return;
        const e = cpBase[etat.cp];
        if (!e.donneesDispo) return;
        // Le titre de la barre de gauche reprend le nom de la commune principale
        // (tronqué proprement si trop long, jamais rogné au milieu)
        $("titre-secteur").textContent = e.communes[0];
        $("titre-secteur").title = e.communes[0]; // tooltip si tronqué
        remplirBarreVerticale(els.barrePopulation, e.parts);
        for (const cat of CATEGORIES) {
            els.barrePopulation.querySelector(`.sim-seg-v-${cat}`)
                .setAttribute("title", `${cat} : ${formaterPourcent(e.parts[cat], 1)}`);
        }
    }

    // --- Zone activité ---
    function mettreAJourActivite() {
        els.cartesType.querySelectorAll(".sim-carte-type").forEach((btn) => {
            btn.setAttribute("aria-checked", String(btn.dataset.type === etat.type));
        });
        const a = maître.attractivite[etat.attractiviteIndex];
        els.attractivite.value = String(etat.attractiviteIndex);
        // Intitulé complet de la pénétration (le facteur ×20…×2 n'est plus affiché)
        els.attractiviteNom.textContent = a.nom;
    }

    // --- Vos réductions (éligibles vs expert) ---
    function mettreAJourReductions(resultat) {
        // Bascule de visibilité
        els.couloirEligibles.hidden = etat.expert;
        els.couloirsExpert.hidden = !etat.expert;
        document.body.classList.toggle("mode-expert", etat.expert);
        els.detailCategories.hidden = !etat.expert;

        // Super-catégorie éligibles : réduction = min des trois, uplift effectif moyen pondéré
        const redMin = Math.min(...CATEGORIES_REDUITES.map((c) => etat.reductions[c]));
        // Comparaison via la grille pour éviter les écarts de virgule flottante
        if (arrondirSurGrille(Number(els.redEligibles.value)) !== redMin) {
            els.redEligibles.value = String(LISTE_REDUCTIONS.find((r) => r === redMin));
        }

        const partEligibles = CATEGORIES_REDUITES.reduce((a, c) => a + resultat.parCategorie[c].partClientele, 0);
        const passagesEligibles = CATEGORIES_REDUITES.reduce((a, c) => a + resultat.parCategorie[c].passagesReels, 0);
        const clientsEligibles = CATEGORIES_REDUITES.reduce((a, c) => a + resultat.parCategorie[c].clientsPlus, 0);
        // Panier moyen des éligibles (pondéré par les parts clientèle)
        const panierEligibles = partEligibles > 0
            ? CATEGORIES_REDUITES.reduce((a, c) => a + resultat.parCategorie[c].partClientele * resultat.parCategorie[c].panier, 0) / partEligibles
            : 0;
        const upliftMoyen = upliftEffectifMoyen(entreeSimulation());
        const source = obtenirType().source === "estimation" ? "estimation prudente" : "sondage equiprix";

        $("info-part-eligibles").textContent = formaterPourcent(partEligibles, 1);
        $("info-passages-eligibles").textContent = formaterNombre(passagesEligibles);
        $("info-panier-eligibles").textContent = formaterEuros(panierEligibles, 2);
        $("info-clients-eligibles").textContent = "+" + formaterNombre(clientsEligibles);
        els.upliftEligibles.textContent = `≈ +${formaterPourcent(upliftMoyen, 0)} de visites (${source})`;

        // Couloirs détaillés (expert)
        for (const cat of CATEGORIES) {
            const r = resultat.parCategorie[cat];
            $("info-part-" + cat).textContent = formaterPourcent(r.partClientele, 1);
            $("info-passages-" + cat).textContent = formaterNombre(r.passagesReels);
            $("info-panier-" + cat).textContent = formaterEuros(r.panier, 2);
            if (CATEGORIES_REDUITES.includes(cat)) {
                const select = $("red-" + cat);
                if (arrondirSurGrille(Number(select.value)) !== etat.reductions[cat]) {
                    select.value = String(LISTE_REDUCTIONS.find((r) => r === etat.reductions[cat]));
                }
                $("info-potentiel-" + cat).textContent = formaterNombre(r.potentiel);
                $("info-clients-" + cat).textContent = "+" + formaterNombre(r.clientsPlus);
                const src = r.upliftSource === "estimation" ? "estimation prudente" : "sondage equiprix";
                $("uplift-" + cat).textContent = `≈ +${formaterPourcent(r.uplift, 0)} de visites (${src})`;
            }
        }
    }

    // --- Résultats ---
    function mettreAJourResultats(resultat) {
        const impact = resultat.impactNet;
        const signe = impact > 0.005 ? "+" : impact < -0.005 ? "−" : "";
        els.impactNet.textContent = `${signe}${formaterEuros(Math.abs(impact))} par mois`;

        els.heroResultat.classList.remove("positif", "negatif", "neutre");
        els.heroResultat.classList.add(
            Math.abs(impact) < 0.005 ? "neutre" : impact > 0 ? "positif" : "negatif"
        );

        if (resultat.impactRelatif !== null) {
            const ratio = resultat.impactRelatif;
            const s = ratio > 0.0005 ? "+" : ratio < -0.0005 ? "−" : "";
            els.impactRatio.textContent = `${s}${formaterPourcent(Math.abs(ratio), 1)} de votre marge commerciale mensuelle`;
            els.impactRatio.hidden = false;
        } else {
            els.impactRatio.hidden = true; // garde-fou : marge nulle ou négative
        }
        els.margeRef.textContent = `Marge commerciale mensuelle : ${formaterEuros(resultat.margeMensuelle)}`;
        els.margeRef.hidden = resultat.margeMensuelle <= 0;

        // Passages en plus (en % du total)
        const totalPassages = etat.passages + resultat.totalClientsPlus;
        const pct = etat.passages > 0 ? resultat.totalClientsPlus / etat.passages : 0;
        els.passagesPlus.textContent = `+${formaterNombre(resultat.totalClientsPlus)} passages en caisse par mois (${formaterPourcent(pct, 1)} de plus, soit ${formaterNombre(totalPassages)} au total)`;

        // Marge supplémentaire : signe et couleur selon le signe (rouge si négative,
        // comme les deux lignes suivantes), et non toujours « + » en vert
        const ms = resultat.totalMargesSup;
        const signeMs = ms > 0.005 ? "+" : ms < -0.005 ? "−" : "";
        els.recapMarges.textContent = `${signeMs}${formaterEuros(Math.abs(ms), 2)}`;
        els.recapMarges.classList.toggle("negatif", ms < -0.005);
        els.recapPertes.textContent = `−${formaterEuros(resultat.totalPertes, 2)}`;
        els.recapFrais.textContent = `−${formaterEuros(resultat.fraisTotal, 2)}`;
        els.fraisMention.textContent = resultat.fraisCapes ? "(plafonnés)" : "";

        // Détail par catégorie (visible directement en mode expert)
        els.detailBody.innerHTML = "";
        const noms = { rouge: "Rouge", orange: "Orange", jaune: "Jaune", verte: "Verte" };
        for (const cat of CATEGORIES) {
            const r = resultat.parCategorie[cat];
            const tr = document.createElement("tr");
            const th = document.createElement("td");
            th.innerHTML = `<span class="cat-nom"><span class="sim-dot sim-dot-${cat}" aria-hidden="true"></span>${noms[cat]}</span>`;
            tr.appendChild(th);
            // Colonne « Marge suppl. » : signe − et rouge si négative (réduction > marge)
            const vals = [r.margeSup, r.perte, r.fraisBrut];
            vals.forEach((val, i) => {
                const td = document.createElement("td");
                if (i === 0 && val < -0.005) {
                    td.textContent = `−${formaterEuros(Math.abs(val), 2)}`;
                    td.classList.add("negatif");
                } else {
                    td.textContent = formaterEuros(val, 2);
                }
                tr.appendChild(td);
            });
            els.detailBody.appendChild(tr);
        }
    }

    // --- Suggestion contextuelle ---
    function mettreAJourSuggestion(resultat) {
        let texte = "";
        if (etat.marge > 0 && etat.marge < 0.15) {
            // Texte maintenu dans le JSON maître (textes.suggestionMargeFaible)
            texte = maître.textes.suggestionMargeFaible
                || "Avec une marge inférieure à 15 %, les réductions equiprix sont rarement gagnantes : vérifiez votre marge réelle.";
        } else if (resultat.impactNet < 0) {
            const cat = CATEGORIES_REDUITES.reduce((max, c) =>
                etat.reductions[c] > etat.reductions[max] ? c : max, "rouge");
            const rActuelle = etat.reductions[cat];
            if (rActuelle > 0) {
                const idx = LISTE_REDUCTIONS.indexOf(rActuelle);
                if (idx > 0) {
                    const rTest = LISTE_REDUCTIONS[idx - 1];
                    const sauv = etat.reductions[cat];
                    etat.reductions[cat] = rTest;
                    const test = simulerMois(entreeSimulation());
                    etat.reductions[cat] = sauv;
                    if (test.impactNet > 0) {
                        texte = `En passant la réduction ${cat} de ${formaterPourcent(rActuelle, 0)} à ${formaterPourcent(rTest, 0)}, votre résultat devient positif : +${formaterEuros(test.impactNet)} par mois.`;
                    } else {
                        texte = maître.textes.suggestionResultatNegatif || "";
                    }
                } else {
                    texte = maître.textes.suggestionResultatNegatif || "";
                }
            } else {
                texte = "Aucune réduction appliquée : equiprix vous coûte les frais de service sans générer de marge supplémentaire. Envisagez une réduction pour les foyers éligibles.";
            }
        }
        els.suggestion.textContent = texte;
        els.suggestion.hidden = !texte;
    }

    // ---------- Infobulles ⓘ ----------
    function montrerTooltip(btn) {
        if (!dernierResultat) return;
        const { resultat } = dernierResultat;
        const kind = btn.dataset.info;
        let texte = "";
        if (kind === "marges") {
            texte = "Marge supplémentaire = Σ clients en plus × panier moyen × (marge − réduction), par catégorie.";
            if (etat.expert) {
                texte += " Détail : " + CATEGORIES_REDUITES.map((c) => {
                    const r = resultat.parCategorie[c];
                    return `${c} : ${formaterNombre(r.clientsPlus)} clients × ${formaterEuros(r.panier, 2)} × ${formaterPourcent(etat.marge - etat.reductions[c], 0)} = ${formaterEuros(r.margeSup, 2)}`;
                }).join(" ; ");
            }
        } else if (kind === "pertes") {
            texte = "Perte = passages réels × panier moyen × taux de capture × réduction (la réduction se prend sur le chiffre d'affaires).";
            if (etat.expert) {
                texte += " Détail : " + CATEGORIES_REDUITES.map((c) => {
                    const r = resultat.parCategorie[c];
                    return `${c} : ${formaterNombre(r.passagesReels)} × ${formaterEuros(r.panier, 2)} × ${formaterPourcent(maître.parametres.tauxCapture, 0)} × ${formaterPourcent(etat.reductions[c], 0)} = ${formaterEuros(r.perte, 2)}`;
                }).join(" ; ");
            }
        } else if (kind === "frais") {
            const p = maître.parametres;
            texte = `Frais = ${formaterEuros(p.fraisServiceParPassage, 2)} × (passages réels + clients en plus), toutes catégories, plafonnés à ${formaterEuros(p.capFraisServiceMensuel)} par mois.`;
            texte += ` Total avant cap : ${formaterEuros(resultat.fraisTotalBrut, 2)}.`;
        } else if (kind === "passages") {
            texte = maître.textes.alertePassages || "";
        }
        els.tooltip.textContent = texte;
        els.tooltip.hidden = false;
        const rect = btn.getBoundingClientRect();
        els.tooltip.style.left = Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 340) + "px";
        els.tooltip.style.top = (rect.bottom + window.scrollY + 8) + "px";
    }

    function cacherTooltip() {
        els.tooltip.hidden = true;
    }

    // ---------- État dans l'URL ----------
    function mettreAJourURL() {
        const params = new URLSearchParams();
        if (etat.usecase && etat.usecase !== ID_USECASE_DEFAUT) params.set("uc", etat.usecase);
        if (etat.cp) params.set("cp", etat.cp);
        params.set("type", etat.type);
        params.set("marge", String(etat.marge));
        params.set("pass", String(etat.passages));
        params.set("panier", String(etat.panier));
        params.set("profil", etat.profil);
        params.set("attr", String(obtenirFacteurAttractivite()));
        params.set("rr", String(etat.reductions.rouge));
        params.set("ro", String(etat.reductions.orange));
        params.set("rj", String(etat.reductions.jaune));
        if (etat.expert) params.set("expert", "1");
        const qs = params.toString();
        history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
    }

    function restaurerDepuisURL() {
        const p = new URLSearchParams(window.location.search);
        const get = (k) => p.get(k);

        // Scénario
        const uc = get("uc");
        if (uc && (maître.useCases || []).some((u) => u.id === uc)) {
            appliquerUsecase(uc);
        } else {
            els.narratif.textContent = maître.textes.narratifDefaut;
        }

        // Code postal (param individuel prioritaire sur le usecase)
        const cp = get("cp");
        if (cp && cpBase[cp]) choisirCP(cp);

        // Type de commerce
        const type = get("type");
        if (type && maître.typesCommerce[type]) {
            etat.type = type;
            const t = maître.typesCommerce[type];
            etat.marge = t.margeDefaut;
            etat.passages = t.passagesDefaut;
            etat.panier = t.panierDefaut;
            els.marge.value = Math.round(etat.marge * 100);
            els.passages.value = etat.passages;
            els.panier.value = etat.panier;
        }
        // Valeurs numériques (prioritaires sur le usecase)
        const marge = parseFloat(get("marge"));
        if (!isNaN(marge) && marge >= 0 && marge <= 1) { etat.marge = marge; els.marge.value = Math.round(marge * 100); }
        const pass = parseInt(get("pass"), 10);
        if (!isNaN(pass) && pass >= 0) { etat.passages = pass; els.passages.value = pass; }
        const panier = parseFloat(get("panier"));
        if (!isNaN(panier) && panier >= 0) { etat.panier = panier; els.panier.value = panier; }
        // Profil
        const profil = get("profil");
        if (profil && maître.profilsClientele.some((pr) => pr.id === profil)) {
            etat.profil = profil;
        }
        // Attractivité (par facteur)
        const attr = parseInt(get("attr"), 10);
        if (!isNaN(attr)) {
            const idx = maître.attractivite.findIndex((a) => a.facteur === attr);
            if (idx >= 0) etat.attractiviteIndex = idx;
        }
        // Réductions
        for (const [cle, cat] of [["rr", "rouge"], ["ro", "orange"], ["rj", "jaune"]]) {
            const v = parseFloat(get(cle));
            if (!isNaN(v) && v >= 0 && v <= 1) etat.reductions[cat] = arrondirSurGrille(v);
        }
        // Mode expert
        if (get("expert") === "1") {
            etat.expert = true;
            els.toggleExpert.checked = true;
        }
    }

    // ---------- Démarrage ----------
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
